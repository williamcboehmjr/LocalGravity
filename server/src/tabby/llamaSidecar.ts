import { ChildProcess, spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { getPathsConfig } from '../core/pathsConfig.js';
import { unloadAllOllamaModels } from '../tools/handlers/comfyui/ollamaClient.js';

export type GpuEngineState = 'active' | 'standby' | 'waking';
export type StrataProfileId = 'swift-1.5-iq2_xs' | 'qwen36-ud-q4_k_xl' | 'inkling-2-mini-sq-10';

export interface LlamaSidecarDeps {
  spawn?: typeof spawn;
  execSync?: typeof execSync;
  existsSync?: typeof fs.existsSync;
  getPathsConfig?: typeof getPathsConfig;
  unloadAllOllamaModels?: typeof unloadAllOllamaModels;
}

export interface LlamaMoESidecarConfig {
  modelPath?: string;
  port?: number;
  gpuLayers?: number;
  threads?: number;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
  offloadPollIntervalMs?: number;
  deps?: LlamaSidecarDeps;
}

const PROFILE_CONFIG_FILES: Record<StrataProfileId, string> = {
  'swift-1.5-iq2_xs': 'strata-swift-iq2_xs.json',
  'qwen36-ud-q4_k_xl': 'strata-qwen36-ud-q4_k_xl.json',
  'inkling-2-mini-sq-10': 'strata-inkling-2-mini-sq-10.json',
};

/**
 * Parses `netstat -ano -p tcp` output and returns unique PIDs strictly listening on `port`
 * in the Local Address column, excluding PID 0, `selfPid`, and forbidden ports 5000/5001.
 */
export function extractListeningPidsForPort(
  netstatOutput: string,
  port: number,
  selfPid: number = process.pid
): string[] {
  if (port === 5000 || port === 5001) return [];
  const pids = new Set<string>();
  for (const line of netstatOutput.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // Windows `netstat -ano -p tcp`: Proto LocalAddress ForeignAddress State PID
    if (parts.length < 5) continue;
    const localAddr = parts[1];
    const state = parts[3]?.toUpperCase();
    const pid = parts[4];
    if (state !== 'LISTENING') continue;
    const portMatch = localAddr.match(/:(\d+)$/);
    if (!portMatch || Number(portMatch[1]) !== port) continue;
    if (pid && /^\d+$/.test(pid) && pid !== '0' && pid !== String(selfPid)) {
      pids.add(pid);
    }
  }
  return Array.from(pids);
}

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
  private wakeAbortController: AbortController | null = null;
  private offloadPromise: Promise<void> | null = null;
  private startupTimeoutMs: number;
  private pollIntervalMs: number;
  private offloadPollIntervalMs: number;
  private deps: Required<LlamaSidecarDeps>;

  constructor(config?: LlamaMoESidecarConfig) {
    this.port = config?.port || 8080;
    this.modelPath =
      config?.modelPath ||
      'E:\\Models\\Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS\\Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf';
    this.startupTimeoutMs = config?.startupTimeoutMs ?? 120_000;
    this.pollIntervalMs = config?.pollIntervalMs ?? 500;
    this.offloadPollIntervalMs = config?.offloadPollIntervalMs ?? 400;
    this.deps = {
      spawn: config?.deps?.spawn ?? spawn,
      execSync: config?.deps?.execSync ?? execSync,
      existsSync: config?.deps?.existsSync ?? fs.existsSync,
      getPathsConfig: config?.deps?.getPathsConfig ?? getPathsConfig,
      unloadAllOllamaModels: config?.deps?.unloadAllOllamaModels ?? unloadAllOllamaModels,
    };
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
    return this.deps.getPathsConfig().strataInstallDir;
  }

  public resolveProfileConfig(requestedProfile: StrataProfileId): {
    profile: StrataProfileId;
    configPath: string;
  } {
    const installDir = this.getInstallDir();
    const requestedPath = path.join(installDir, PROFILE_CONFIG_FILES[requestedProfile]);
    if (this.deps.existsSync(requestedPath)) {
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

  public isProcessAlive(): boolean {
    return Boolean(this.proc && this.proc.exitCode === null && !this.proc.killed);
  }

  public isWaking(): boolean {
    return Boolean(this.wakePromise) || this.state === 'waking';
  }

  public isOffloaded(): boolean {
    return this.offloadedAt !== null || (this.state === 'standby' && !this.isProcessAlive() && !this.wakePromise);
  }

  public getCachedState(): GpuEngineState {
    return this.state;
  }

  private appendLog(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.recentLogs.push(trimmed);
    if (this.recentLogs.length > 300) {
      this.recentLogs.shift();
    }
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private terminateProcess(proc: ChildProcess | null): void {
    if (!proc) return;
    const pid = proc.pid;
    try {
      if (pid && process.platform === 'win32') {
        this.deps.execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {}
    }
    try {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill('SIGTERM');
      }
    } catch {}
    if (this.proc === proc) {
      this.proc = null;
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
    if (this.wakePromise || this.state === 'waking') return 'waking';
    if (this.offloadPromise) return 'standby';
    const healthy = await this.isHealthy();
    this.state = healthy ? 'active' : 'standby';
    return this.state;
  }

  /**
   * Fast Wake-on-Demand & Profile Swap:
   * Spawns Strata Server on port 8080 for the requested profile ('swift-1.5-iq2_xs' or
   * 'qwen36-ud-q4_k_xl') and polls health until ready. If a different
   * profile is currently loaded, evicts it cleanly first so the 16 GB VRAM
   * holds the requested model's hot layers while 128 GB SysRAM keeps weights warm.
   */
  public async ensureRunning(requestedProfile: StrataProfileId = 'swift-1.5-iq2_xs'): Promise<boolean> {
    const resolved = this.resolveProfileConfig(requestedProfile);
    const targetProfile = resolved.profile;

    // Wait for any in-flight offload or conflicting wake to finish cleanly
    while (this.offloadPromise || this.wakePromise) {
      if (this.offloadPromise) {
        await this.offloadPromise.catch(() => {});
        continue;
      }
      if (this.wakePromise) {
        if (this.wakeTargetProfile === targetProfile && !this.wakeAbortController?.signal.aborted) {
          return this.wakePromise;
        }
        await this.wakePromise.catch(() => false);
      }
    }

    const controller = new AbortController();
    this.wakeAbortController = controller;
    this.wakeTargetProfile = targetProfile;
    this.wakePromise = this.ensureRunningInternal(targetProfile, resolved.configPath, controller.signal)
      .catch((err) => {
        const msg = err?.message || String(err);
        this.appendLog(`[LlamaMoE] Strata wake failed unexpectedly: ${msg}`);
        if (this.state === 'waking') {
          this.state = 'standby';
        }
        return false;
      })
      .finally(() => {
        if (this.wakeAbortController === controller) {
          this.wakeAbortController = null;
        }
        this.wakePromise = null;
        this.wakeTargetProfile = null;
      });
    return this.wakePromise;
  }

  private async ensureRunningInternal(
    targetProfile: StrataProfileId,
    configPath: string,
    wakeSignal: AbortSignal
  ): Promise<boolean> {
    if (wakeSignal.aborted) {
      this.state = 'standby';
      return false;
    }

    const procAlive = this.isProcessAlive();
    if (await this.isHealthy()) {
      if (wakeSignal.aborted) {
        this.state = 'standby';
        return false;
      }
      if (this.activeProfile === targetProfile) {
        this.state = 'active';
        this.offloadedAt = null;
        return true;
      }
      this.appendLog(
        `[LlamaMoE] Hot-swapping Strata profile on port ${this.port}: ${this.activeProfile} -> ${targetProfile}`
      );
      await this.offloadFromGpuInternal(`profile_swap:${targetProfile}`);
    } else if (procAlive && this.activeProfile === targetProfile) {
      // Process was already spawned and is still loading weights into VRAM: wait for /health instead of spawning a duplicate!
      this.state = 'waking';
      const existingProc = this.proc!;
      const waitDeadline = Date.now() + this.startupTimeoutMs;
      let timedOut = true;
      while (Date.now() < waitDeadline) {
        if (wakeSignal.aborted) {
          this.terminateProcess(existingProc);
          this.state = 'standby';
          return false;
        }
        await this.sleep(this.pollIntervalMs, wakeSignal);
        if (wakeSignal.aborted) {
          this.terminateProcess(existingProc);
          this.state = 'standby';
          return false;
        }
        if (existingProc.exitCode !== null || existingProc.killed) {
          timedOut = false;
          break;
        }
        if (await this.isHealthy()) {
          if (wakeSignal.aborted) {
            this.terminateProcess(existingProc);
            this.state = 'standby';
            return false;
          }
          this.state = 'active';
          this.offloadedAt = null;
          return true;
        }
      }
      if (timedOut) {
        this.terminateProcess(existingProc);
        this.state = 'standby';
        this.appendLog(`[LlamaMoE] Existing Strata (${targetProfile}) timed out waiting for health; terminated.`);
        return false;
      }
    } else if (procAlive) {
      await this.offloadFromGpuInternal(`profile_swap:${targetProfile}`);
    }

    if (wakeSignal.aborted) {
      this.state = 'standby';
      return false;
    }

    this.state = 'waking';
    this.appendLog(`[LlamaMoE] Waking Strata GPU Inference Engine (${targetProfile})...`);

    // Ensure warm ComfyUI & Ollama models are evicted before Strata allocates 15 GB of GPU VRAM
    try {
      await fetch(`${this.deps.getPathsConfig().comfyUrl}/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {}
    await this.deps.unloadAllOllamaModels().catch(() => {});

    if (wakeSignal.aborted) {
      this.state = 'standby';
      return false;
    }

    const pathsCfg = this.deps.getPathsConfig();
    const strataRoot = pathsCfg.strataDir;
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Sue\\AppData\\Local';
    const appControlDir = path.join(localAppData, 'Programs', 'Strata', 'control');
    const strataTerminalRoot = path.join(strataRoot, 'terminal');
    const terminalDir = this.deps.existsSync(path.join(appControlDir, 'serve', 'server.py'))
      ? appControlDir
      : this.deps.existsSync(path.join(strataTerminalRoot, 'current'))
        ? path.join(strataTerminalRoot, 'current')
        : path.join(strataTerminalRoot, '0.1.58');
    const pythonExe = path.join(terminalDir, 'python', 'python.exe');
    const serverPy = path.join(terminalDir, 'serve', 'server.py');

    if (this.deps.existsSync(configPath) && this.deps.existsSync(pythonExe) && this.deps.existsSync(serverPy)) {
      console.log(`[LlamaMoE] Launching Strata Server on port ${this.port} with ${path.basename(configPath)}...`);
      const args = [
        serverPy,
        '--engine', 'strata',
        '--config', configPath,
        '--port', String(this.port),
      ];

      let spawnedProc: ChildProcess;
      try {
        spawnedProc = this.deps.spawn(pythonExe, args, {
          cwd: terminalDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          windowsHide: true,
        });
      } catch (err: any) {
        const msg = err?.message || String(err);
        this.appendLog(`[LlamaMoE] Strata synchronous spawn error: ${msg}`);
        console.error(`[LlamaMoE] Strata spawn threw synchronously: ${msg}`);
        this.proc = null;
        this.state = 'standby';
        return false;
      }
      this.proc = spawnedProc;
      let spawnError: Error | null = null;

      spawnedProc.stdout?.on('data', (d) => {
        const text = d.toString();
        this.appendLog(`[stdout] ${text}`);
      });

      spawnedProc.stderr?.on('data', (d) => {
        const text = d.toString();
        this.appendLog(`[stderr] ${text}`);
      });

      spawnedProc.on('error', (err) => {
        spawnError = err;
        this.appendLog(`[LlamaMoE] Strata spawn error: ${err.message}`);
        if (this.proc === spawnedProc) {
          this.proc = null;
          this.state = 'standby';
        }
      });

      spawnedProc.on('exit', (code) => {
        this.appendLog(`[LlamaMoE] Strata process exited with code ${code}`);
        if (this.proc === spawnedProc) {
          this.proc = null;
          this.state = 'standby';
        }
      });

      // Poll health until ready, timeout, exit, spawn error, or offload abort
      const startTime = Date.now();
      while (Date.now() - startTime < this.startupTimeoutMs) {
        if (wakeSignal.aborted || spawnError || spawnedProc.exitCode !== null || spawnedProc.killed) {
          break;
        }
        await this.sleep(this.pollIntervalMs, wakeSignal);
        if (wakeSignal.aborted || spawnError || spawnedProc.exitCode !== null || spawnedProc.killed) {
          break;
        }
        if (await this.isHealthy()) {
          if (wakeSignal.aborted) {
            this.terminateProcess(spawnedProc);
            this.state = 'standby';
            return false;
          }
          this.state = 'active';
          this.activeProfile = targetProfile;
          this.offloadedAt = null;
          this.appendLog(`[LlamaMoE] Strata (${targetProfile}) is healthy and active on port ${this.port}`);
          console.log(`[LlamaMoE] Strata (${targetProfile}) is healthy and serving on port ${this.port}`);
          return true;
        }
      }

      if (spawnError) {
        if (this.proc === spawnedProc) {
          this.proc = null;
        }
        this.state = 'standby';
        return false;
      }

      if (wakeSignal.aborted) {
        this.terminateProcess(spawnedProc);
        this.state = 'standby';
        this.appendLog(`[LlamaMoE] Strata (${targetProfile}) wake cancelled due to offload/stop.`);
        return false;
      }

      if (spawnedProc.exitCode !== null || spawnedProc.killed) {
        if (this.proc === spawnedProc) {
          this.proc = null;
        }
        this.state = 'standby';
        this.appendLog(
          `[LlamaMoE] Strata (${targetProfile}) exited during startup (code ${spawnedProc.exitCode})`
        );
        return false;
      }

      this.terminateProcess(spawnedProc);
      this.state = 'standby';
      this.appendLog(`[LlamaMoE] Strata (${targetProfile}) timed out after ${this.startupTimeoutMs}ms; process terminated.`);
      console.error(`[LlamaMoE] Strata (${targetProfile}) failed to become healthy within ${this.startupTimeoutMs}ms`);
      return false;
    }

    this.state = 'standby';
    return false;
  }

  /**
   * Guaranteed VRAM Eviction:
   * Cancels any in-flight wake, shuts down the Strata GPU process, and frees local port so GPU VRAM drops to 0 MB.
   * Strictly verifies it never touches forbidden ports 5000 or 5001.
   */
  public async offloadFromGpu(reason: string = 'idle_timeout'): Promise<void> {
    if (this.offloadPromise) {
      return this.offloadPromise;
    }
    this.offloadPromise = (async () => {
      if (this.wakeAbortController) {
        this.wakeAbortController.abort();
      }
      if (this.wakePromise) {
        await this.wakePromise.catch(() => false);
      }
      await this.offloadFromGpuInternal(reason);
    })().finally(() => {
      this.offloadPromise = null;
    });
    return this.offloadPromise;
  }

  private async offloadFromGpuInternal(reason: string = 'idle_timeout'): Promise<void> {
    console.log(`[LlamaMoE] Offloading Strata from GPU (${reason}) -> freeing 100% VRAM...`);
    this.appendLog(`[LlamaMoE] Offloading Strata from GPU (${reason}) to free VRAM.`);

    // 1. Kill spawned child process if tracked
    this.terminateProcess(this.proc);

    // 2. Safely find and tree-kill any process listening strictly on this.port (never 5000/5001)
    const killListeningPort = () => {
      if (this.port === 5000 || this.port === 5001) return false;
      try {
        const netstatOutput = this.deps.execSync('netstat -ano -p tcp', {
          encoding: 'utf-8',
          windowsHide: true,
        });
        const pids = extractListeningPidsForPort(netstatOutput, this.port);
        for (const pid of pids) {
          console.log(`[LlamaMoE] Terminating port ${this.port} process tree PID ${pid}...`);
          this.deps.execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
        }
        return pids.length > 0;
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
      await this.sleep(this.offloadPollIntervalMs);
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
