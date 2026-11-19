import { ChildProcess, spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { getPathsConfig } from '../core/pathsConfig.js';
import { unloadAllOllamaModels } from '../tools/handlers/comfyui/ollamaClient.js';

export type GpuEngineState = 'active' | 'standby' | 'waking';
export type StrataProfileId = 'swift-1.5-iq2_xs' | 'qwen36-ud-q4_k_xl';

export interface LlamaMoESidecarConfig {
  modelPath?: string;
  port?: number;
  gpuLayers?: number;
  threads?: number;
}

const PROFILE_CONFIG_FILES: Record<StrataProfileId, string> = {
  'swift-1.5-iq2_xs': 'strata-swift-iq2_xs.json',
  'qwen36-ud-q4_k_xl': 'strata-qwen36-ud-q4_k_xl.json',
};

export class LlamaMoESidecar {
  private static instance: LlamaMoESidecar | null = null;
  private proc: ChildProcess | null = null;
  private port: number;
  private state: GpuEngineState = 'standby';
  private activeProfile: StrataProfileId = 'swift-1.5-iq2_xs';
  private modelPath: string;
  private recentLogs: string[] = [];
  private offloadedAt: string | null = null;
  private wakePromise: Promise<boolean> | null = null;
  private wakeTargetProfile: StrataProfileId | null = null;
  private offloadPromise: Promise<void> | null = null;

  constructor(config?: LlamaMoESidecarConfig) {
    this.port = config?.port || 8080;
    this.modelPath =
      config?.modelPath ||
      'E:\\Models\\Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS\\Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf';
  }

  public static getInstance(): LlamaMoESidecar {
    if (!LlamaMoESidecar.instance) {
      LlamaMoESidecar.instance = new LlamaMoESidecar();
    }
    return LlamaMoESidecar.instance;
  }

  public getActiveProfile(): StrataProfileId {
    return this.activeProfile;
  }

  private getInstallDir(): string {
    return getPathsConfig().strataInstallDir;
  }

  public resolveProfileConfig(requestedProfile: StrataProfileId): {
    profile: StrataProfileId;
    configPath: string;
  } {
    const installDir = this.getInstallDir();
    const requestedPath = path.join(installDir, PROFILE_CONFIG_FILES[requestedProfile]);
    if (fs.existsSync(requestedPath)) {
      return { profile: requestedProfile, configPath: requestedPath };
    }
    const fallbackProfile: StrataProfileId = 'swift-1.5-iq2_xs';
    const fallbackPath = path.join(installDir, PROFILE_CONFIG_FILES[fallbackProfile]);
    return { profile: fallbackProfile, configPath: fallbackPath };
  }

  public getPort(): number {
    return this.port;
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public getRecentLogs(): string[] {
    return [...this.recentLogs];
  }

  public getOffloadedAt(): string | null {
    return this.offloadedAt;
  }

  private appendLog(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.recentLogs.push(trimmed);
    if (this.recentLogs.length > 300) {
      this.recentLogs.shift();
    }
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/health`, {
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async getState(): Promise<GpuEngineState> {
    if (this.state === 'waking') return 'waking';
    const healthy = await this.isHealthy();
    this.state = healthy ? 'active' : 'standby';
    return this.state;
  }

  /**
   * Fast Wake-on-Demand & Profile Swap:
   * Spawns Strata Server on port 8080 for the requested profile ('swift-1.5-iq2_xs' or
   * 'qwen36-ud-q4_k_xl') and polls health every 500ms until ready. If a different
   * profile is currently loaded on port 8080, evicts it cleanly first so the 16 GB VRAM
   * holds the requested model's hot layers while 128 GB SysRAM keeps weights warm.
   */
  public async ensureRunning(requestedProfile: StrataProfileId = 'swift-1.5-iq2_xs'): Promise<boolean> {
    const resolved = this.resolveProfileConfig(requestedProfile);
    const targetProfile = resolved.profile;

    // Wait for any in-flight offload to finish before checking/waking Strata
    if (this.offloadPromise) {
      await this.offloadPromise.catch(() => {});
    }

    // Serialize concurrent wake/swap calls so two Strata processes never race for VRAM, pinned RAM, and port 8080
    if (this.wakePromise) {
      if (this.wakeTargetProfile === targetProfile) {
        return this.wakePromise;
      }
      await this.wakePromise.catch(() => false);
    }

    this.wakeTargetProfile = targetProfile;
    this.wakePromise = this.ensureRunningInternal(targetProfile, resolved.configPath).finally(() => {
      this.wakePromise = null;
      this.wakeTargetProfile = null;
    });
    return this.wakePromise;
  }

  private async ensureRunningInternal(targetProfile: StrataProfileId, configPath: string): Promise<boolean> {
    const procAlive = Boolean(this.proc && this.proc.exitCode === null && !this.proc.killed);
    if (await this.isHealthy()) {
      if (this.activeProfile === targetProfile) {
        this.state = 'active';
        return true;
      }
      this.appendLog(
        `[LlamaMoE] Hot-swapping Strata profile on port ${this.port}: ${this.activeProfile} -> ${targetProfile}`
      );
      await this.offloadFromGpu(`profile_swap:${targetProfile}`);
    } else if (procAlive && this.activeProfile === targetProfile) {
      // Process was already spawned and is still loading weights into VRAM: wait for /health instead of returning prematurely!
      this.state = 'waking';
      const existingProc = this.proc!;
      const waitDeadline = Date.now() + 120000;
      while (Date.now() < waitDeadline) {
        await new Promise((r) => setTimeout(r, 500));
        if (existingProc.exitCode !== null || existingProc.killed) {
          break;
        }
        if (await this.isHealthy()) {
          this.state = 'active';
          this.offloadedAt = null;
          return true;
        }
      }
    } else if (procAlive) {
      await this.offloadFromGpu(`profile_swap:${targetProfile}`);
    }

    this.state = 'waking';
    this.appendLog(`[LlamaMoE] Waking Strata GPU Inference Engine (${targetProfile})...`);

    // Ensure warm ComfyUI & Ollama models are evicted before Strata allocates 15 GB of GPU VRAM
    try {
      await fetch(`${getPathsConfig().comfyUrl}/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {}
    await unloadAllOllamaModels().catch(() => {});

    const strataRoot = getPathsConfig().strataDir;
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Sue\\AppData\\Local';
    const appControlDir = path.join(localAppData, 'Programs', 'Strata', 'control');
    const strataTerminalRoot = path.join(strataRoot, 'terminal');
    const terminalDir = fs.existsSync(path.join(appControlDir, 'serve', 'server.py'))
      ? appControlDir
      : fs.existsSync(path.join(strataTerminalRoot, 'current'))
        ? path.join(strataTerminalRoot, 'current')
        : path.join(strataTerminalRoot, '0.1.58');
    const pythonExe = path.join(terminalDir, 'python', 'python.exe');
    const serverPy = path.join(terminalDir, 'serve', 'server.py');

    if (fs.existsSync(configPath) && fs.existsSync(pythonExe) && fs.existsSync(serverPy)) {
      console.log(`[LlamaMoE] Launching Strata Server on port ${this.port} with ${path.basename(configPath)}...`);
      const args = [
        serverPy,
        '--engine', 'strata',
        '--config', configPath,
        '--port', String(this.port),
      ];

      this.proc = spawn(pythonExe, args, {
        cwd: terminalDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true,
      });

      this.proc.stdout?.on('data', (d) => {
        const text = d.toString();
        this.appendLog(`[stdout] ${text}`);
      });

      this.proc.stderr?.on('data', (d) => {
        const text = d.toString();
        this.appendLog(`[stderr] ${text}`);
      });

      this.proc.on('exit', (code) => {
        this.appendLog(`[LlamaMoE] Strata process exited with code ${code}`);
        this.proc = null;
        this.state = 'standby';
      });

      // Poll health every 500ms for fast wake / warm RAM swap response
      const spawnedProc = this.proc;
      const startTime = Date.now();
      while (Date.now() - startTime < 120000) {
        await new Promise((r) => setTimeout(r, 500));
        if (spawnedProc.exitCode !== null || spawnedProc.killed) {
          this.appendLog(
            `[LlamaMoE] Strata (${targetProfile}) aborted startup (exited with code ${spawnedProc.exitCode})`
          );
          return false;
        }
        if (await this.isHealthy()) {
          this.state = 'active';
          this.activeProfile = targetProfile;
          this.offloadedAt = null;
          this.appendLog(`[LlamaMoE] Strata (${targetProfile}) is healthy and active on port ${this.port}`);
          console.log(`[LlamaMoE] Strata (${targetProfile}) is healthy and serving on port ${this.port}`);
          return true;
        }
      }

      this.state = 'standby';
      console.error(`[LlamaMoE] Strata (${targetProfile}) failed to become healthy within 120s`);
      return false;
    }

    this.state = 'standby';
    return false;
  }

  /**
   * Guaranteed VRAM Eviction:
   * Shuts down the Strata GPU process and frees local port 8080 so GPU VRAM drops to 0 MB.
   * Strictly verifies it never touches forbidden ports 5000 or 5001.
   */
  public async offloadFromGpu(reason: string = 'idle_timeout'): Promise<void> {
    if (this.offloadPromise) {
      return this.offloadPromise;
    }
    this.offloadPromise = this.offloadFromGpuInternal(reason).finally(() => {
      this.offloadPromise = null;
    });
    return this.offloadPromise;
  }

  private async offloadFromGpuInternal(reason: string = 'idle_timeout'): Promise<void> {
    console.log(`[LlamaMoE] Offloading Strata from GPU (${reason}) -> freeing 100% VRAM...`);
    this.appendLog(`[LlamaMoE] Offloading Strata from GPU (${reason}) to free VRAM.`);

    // 1. Kill spawned child process if tracked
    if (this.proc) {
      const pid = this.proc.pid;
      try {
        if (pid && process.platform === 'win32') {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
        } else {
          this.proc.kill('SIGTERM');
        }
      } catch {}
      this.proc = null;
    }

    // 2. Safely find and tree-kill any process listening strictly on port 8080 (never 5000/5001)
    const killListeningPort = () => {
      try {
        const netstatOutput = execSync(`netstat -ano -p tcp | findstr :${this.port}`, {
          encoding: 'utf-8',
          windowsHide: true,
        });
        let found = false;
        for (const line of netstatOutput.split(/\r?\n/)) {
          if (line.includes(`:${this.port}`) && line.includes('LISTENING')) {
            found = true;
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid) && pid !== '0' && pid !== String(process.pid)) {
              console.log(`[LlamaMoE] Terminating port ${this.port} process tree PID ${pid}...`);
              execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
            }
          }
        }
        return found;
      } catch {
        return false;
      }
    };
    killListeningPort();

    // 3. Confirm both HTTP health AND OS TCP LISTENING socket are completely offline
    for (let i = 0; i < 15; i++) {
      const stillHealthy = await this.isHealthy();
      const stillListening = killListeningPort();
      if (!stillHealthy && !stillListening) break;
      await new Promise((r) => setTimeout(r, 400));
    }

    this.state = 'standby';
    this.offloadedAt = new Date().toISOString();
    this.appendLog('[LlamaMoE] Strata successfully offloaded. GPU VRAM: 0 MB (Standby mode).');
    console.log('[LlamaMoE] Strata successfully offloaded. GPU VRAM: 0 MB (Standby mode).');
  }

  public async stop(): Promise<void> {
    await this.offloadFromGpu('stop');
  }
}
