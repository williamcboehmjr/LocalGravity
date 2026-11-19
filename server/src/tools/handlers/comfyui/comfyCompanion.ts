import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChildProcess, spawn } from 'node:child_process';
import { getPathsConfig } from '../../../core/pathsConfig.js';
import type {
  ComfyCompanionBrainId,
  ComfyStudioConfig,
  ComfyWorkflowPreset,
  OllamaModelItem,
} from '../../../core/protocol.js';
import type { InferenceCompletionParams, InferenceCompletionResult } from '../../../core/inferenceBackend.js';
import { LlamaMoESidecar } from '../../../tabby/llamaSidecar.js';
import type { GoogleAiEngine } from '../../../google/googleAiEngine.js';
import { cleanEnhancedPrompt, enhancePromptWithGemini, readBrainProviderConfig } from './geminiMedia.js';
import { freeComfyVram } from './comfyClient.js';
import {
  discoverOllamaModelsFromDisk,
  enhancePromptWithOllama,
  ensureOllamaServerRunning,
  getOllamaRunningModels,
  isOllamaHealthy,
  listOllamaModels,
  pickBestInstalledOllamaVisionModel,
  streamOllamaChat,
} from './ollamaClient.js';

export const COMFY_WORKFLOW_PRESETS: ComfyWorkflowPreset[] = [
  {
    id: 'moss',
    label: 'MOSS Image (Default)',
    workflow: 'Moss Image.json',
    speedHint: 'Fast-Balanced (~25 steps)',
    vramHint: '5.0 GB UNET + 18 GB CLIP',
    stepsHint: '25 steps',
    kind: 'comfyui',
  },
  {
    id: 'z-image',
    label: 'Z-Image Turbo (Draft Speed)',
    workflow: 'z-image.json',
    speedHint: 'Ultra-Fast (~9 steps)',
    vramHint: 'BF16 UNET + 4B CLIP',
    stepsHint: '9 steps',
    kind: 'comfyui',
  },
  {
    id: 'krea',
    label: 'Krea 2 Spice Turbo',
    workflow: 'Famegrid Krea 2 Spice V2 - Simplified.json',
    speedHint: 'Very Fast (~8 steps)',
    vramHint: '13.2 GB UNET + 8.3 GB CLIP',
    stepsHint: '8 steps',
    kind: 'comfyui',
  },
  {
    id: 'h3',
    label: 'MiniMax H3 Image',
    workflow: 'H3 Image Easy Workflow.json',
    speedHint: 'Heavy (~131s cold / 6 steps)',
    vramHint: '19.5 GB UNET + 14.6 GB CLIP',
    stepsHint: '6 steps',
    kind: 'comfyui',
  },
  {
    id: 'qwen',
    label: 'Qwen 2.1 Image Edit',
    workflow: 'Qwen 2.1 Image Edit.json',
    speedHint: 'Edit (~25 steps)',
    vramHint: 'INT8 UNET + FP8 CLIP',
    stepsHint: '25 steps',
    kind: 'comfyui',
  },
  {
    id: 'h3_video',
    label: 'MiniMax H3 Video',
    workflow: 'MiniMax H3.json',
    speedHint: 'Video + Audio (~15m)',
    vramHint: '19.5 GB UNET + VAE',
    stepsHint: '20 steps',
    kind: 'comfyui',
  },
  {
    id: 'gemini_image',
    label: 'Gemini Nano Banana 2.1 (Cloud)',
    workflow: 'gemini_image',
    speedHint: 'Instant (~5s, 0 VRAM)',
    vramHint: '0 MB Local VRAM',
    stepsHint: 'Cloud',
    kind: 'cloud',
  },
];

export interface DiscoveredGgufItem {
  name: string;
  path: string;
  sizeGb: number;
}

const DEFAULT_STUDIO_CONFIG: ComfyStudioConfig = {
  studioMode: false,
  defaultWorkflow: 'Moss Image.json',
  companionBrain: 'auto',
  customGgufPath: '',
  ollamaModel: 'qwen3.5:4b',
  ollamaKeepAlive: '2m',
  keepVramWarm: true,
  enhancePrompt: true,
};

export function discoverLightweightGgufs(): DiscoveredGgufItem[] {
  const { modelsDirs } = getPathsConfig();
  const candidates: DiscoveredGgufItem[] = [];
  const seen = new Set<string>();

  const searchDirs: string[] = [];
  for (const base of modelsDirs) {
    searchDirs.push(path.join(base, 'fast-companion'));
    searchDirs.push(base);
  }

  const walk = (dir: string, depth: number) => {
    if (depth > 3 || candidates.length >= 25 || !fs.existsSync(dir)) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (candidates.length >= 25) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.toLowerCase().includes('swift-1.5') || ent.name.toLowerCase() === '.cache') continue;
        walk(full, depth + 1);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.gguf')) {
        const lower = ent.name.toLowerCase();
        if (lower.includes('mmproj') || lower.includes('mtp-') || lower.includes('swift-qwen3.8')) continue;
        if (lower.includes('-00002-of-') || lower.includes('-00003-of-')) continue;
        const norm = path.resolve(full);
        if (seen.has(norm)) continue;
        seen.add(norm);
        try {
          const st = fs.statSync(norm);
          const sizeGb = Math.round((st.size / (1024 ** 3)) * 100) / 100;
          candidates.push({ name: ent.name, path: norm, sizeGb });
        } catch {}
      }
    }
  };

  for (const dir of searchDirs) {
    walk(dir, 0);
  }

  // Prefer smaller GGUFs first (2-8 GB run much faster on CPU at -ngl 0)
  candidates.sort((a, b) => a.sizeGb - b.sizeGb);
  return candidates;
}

export class ComfyCompanionManager {
  private static instance: ComfyCompanionManager | null = null;
  private static configPathOverrideForTest: string | null = null;
  private config: ComfyStudioConfig;
  private cpuProc: ChildProcess | null = null;
  private activeCpuModelPath: string | null = null;
  private cpuWakePromise: Promise<boolean> | null = null;

  private constructor() {
    this.config = this.loadConfig();
  }

  public static getInstance(): ComfyCompanionManager {
    if (!ComfyCompanionManager.instance) {
      ComfyCompanionManager.instance = new ComfyCompanionManager();
    }
    return ComfyCompanionManager.instance;
  }

  public static setConfigPathForTest(customPath: string | null): void {
    ComfyCompanionManager.configPathOverrideForTest = customPath;
    ComfyCompanionManager.resetInstanceForTest();
  }

  public static resetInstanceForTest(): void {
    if (ComfyCompanionManager.instance) {
      ComfyCompanionManager.instance.stopCpuServer();
    }
    ComfyCompanionManager.instance = null;
  }

  private getConfigPath(): string {
    return (
      ComfyCompanionManager.configPathOverrideForTest ||
      path.join(getPathsConfig().runtimeDir, 'comfyui-studio.json')
    );
  }

  private loadConfig(): ComfyStudioConfig {
    try {
      const p = this.getConfigPath();
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return {
          ...DEFAULT_STUDIO_CONFIG,
          ...(parsed && typeof parsed === 'object' ? parsed : {}),
        };
      }
    } catch {}
    return { ...DEFAULT_STUDIO_CONFIG };
  }

  public reloadConfigFromDisk(): ComfyStudioConfig {
    this.config = this.loadConfig();
    return this.getConfig();
  }

  private saveConfig(): void {
    try {
      const p = this.getConfigPath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[ComfyCompanion] Failed to persist comfyui-studio.json:', err);
    }
  }

  public getConfig(): ComfyStudioConfig {
    return { ...this.config };
  }

  public updateConfig(patch: Partial<ComfyStudioConfig>): ComfyStudioConfig {
    if (typeof patch.studioMode === 'boolean') this.config.studioMode = patch.studioMode;
    if (typeof patch.defaultWorkflow === 'string' && patch.defaultWorkflow.trim()) {
      this.config.defaultWorkflow = patch.defaultWorkflow.trim();
    }
    if (
      patch.companionBrain &&
      ['auto', 'ollama_vision', 'gemini_flash', 'cpu_lightweight', 'gemma4_litert', 'strata'].includes(
        patch.companionBrain
      )
    ) {
      this.config.companionBrain = patch.companionBrain;
    }
    if (typeof patch.customGgufPath === 'string') {
      this.config.customGgufPath = patch.customGgufPath.trim();
    }
    if (typeof patch.ollamaModel === 'string' && patch.ollamaModel.trim()) {
      this.config.ollamaModel = patch.ollamaModel.trim();
    }
    if (typeof patch.ollamaKeepAlive === 'string' && patch.ollamaKeepAlive.trim()) {
      this.config.ollamaKeepAlive = patch.ollamaKeepAlive.trim();
    }
    if (typeof patch.keepVramWarm === 'boolean') this.config.keepVramWarm = patch.keepVramWarm;
    if (typeof patch.enhancePrompt === 'boolean') this.config.enhancePrompt = patch.enhancePrompt;
    this.saveConfig();
    return this.getConfig();
  }

  public resolveOllamaModel(
    config: ComfyStudioConfig = this.config,
    knownModels?: OllamaModelItem[]
  ): string {
    if (config.ollamaModel && config.ollamaModel.trim()) {
      return config.ollamaModel.trim();
    }
    return pickBestInstalledOllamaVisionModel(knownModels || discoverOllamaModelsFromDisk());
  }

  public getCapabilities() {
    const cfg = getPathsConfig();
    const provider = readBrainProviderConfig();
    const ggufs = discoverLightweightGgufs();
    const ollamaModels = discoverOllamaModelsFromDisk();
    const hasOllamaBin = Boolean(cfg.ollamaExe && (cfg.ollamaExe === 'ollama' || fs.existsSync(cfg.ollamaExe)));
    return {
      hasGoogleApiKey: Boolean(provider.googleApiKey),
      hasLlamaServer: Boolean(cfg.llamaServerExe && fs.existsSync(cfg.llamaServerExe)),
      llamaServerExe: cfg.llamaServerExe,
      hasLitertLm: Boolean(cfg.litertLmExe && fs.existsSync(cfg.litertLmExe)),
      litertLmExe: cfg.litertLmExe,
      hasOllama: hasOllamaBin || ollamaModels.length > 0,
      ollamaRunning: false,
      ollamaUrl: cfg.ollamaUrl,
      ollamaLoadedModels: [] as Array<{ name: string; sizeVramGb: number }>,
      ollamaModels,
      resolvedOllamaModel: this.resolveOllamaModel(this.config, ollamaModels),
      cpuServerRunning: Boolean(this.cpuProc && this.cpuProc.exitCode === null && !this.cpuProc.killed),
      companionUrl: cfg.companionUrl,
      presets: COMFY_WORKFLOW_PRESETS,
      discoveredGgufs: ggufs,
      resolvedEffectiveBrain: this.resolveEffectiveBrain(this.config),
    };
  }

  public async getLiveCapabilities() {
    const base = this.getCapabilities();
    const [ollamaRunning, ollamaLoadedModels, ollamaModels] = await Promise.all([
      isOllamaHealthy(),
      getOllamaRunningModels(),
      listOllamaModels(),
    ]);
    return {
      ...base,
      hasOllama: base.hasOllama || ollamaRunning || ollamaModels.some((m) => m.installed),
      ollamaRunning,
      ollamaLoadedModels,
      ollamaModels,
      resolvedOllamaModel: this.resolveOllamaModel(this.config, ollamaModels),
    };
  }

  public resolveEffectiveBrain(config: ComfyStudioConfig = this.config): Exclude<ComfyCompanionBrainId, 'auto'> {
    if (config.companionBrain !== 'auto') {
      return config.companionBrain;
    }
    const provider = readBrainProviderConfig();
    if (provider.googleApiKey) return 'gemini_flash';

    const paths = getPathsConfig();
    const ollamaDiskModels = discoverOllamaModelsFromDisk();
    const hasOllamaBin = Boolean(
      paths.ollamaExe && (paths.ollamaExe === 'ollama' || fs.existsSync(paths.ollamaExe))
    );
    if (hasOllamaBin && ollamaDiskModels.some((m) => m.installed && m.isVision)) {
      return 'ollama_vision';
    }

    const ggufs = discoverLightweightGgufs();
    if (paths.llamaServerExe && (config.customGgufPath || ggufs.length > 0)) {
      return 'cpu_lightweight';
    }
    if (paths.litertLmExe) return 'gemma4_litert';
    return 'strata';
  }

  public isZeroVramBrain(config: ComfyStudioConfig = this.config): boolean {
    const brain = this.resolveEffectiveBrain(config);
    return brain !== 'strata' && brain !== 'ollama_vision';
  }

  public isFastLocalSwapBrain(config: ComfyStudioConfig = this.config): boolean {
    return this.resolveEffectiveBrain(config) === 'ollama_vision';
  }

  private resolveTargetGgufPath(): string | null {
    if (this.config.customGgufPath && fs.existsSync(this.config.customGgufPath)) {
      return this.config.customGgufPath;
    }
    const ggufs = discoverLightweightGgufs();
    return ggufs[0]?.path || null;
  }

  public async isCpuServerHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${getPathsConfig().companionUrl}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public stopCpuServer(): void {
    if (this.cpuProc) {
      try {
        this.cpuProc.kill();
      } catch {}
      this.cpuProc = null;
    }
    this.activeCpuModelPath = null;
  }

  public async ensureCpuLlamaServer(modelOverride?: string): Promise<boolean> {
    const modelPath = modelOverride || this.resolveTargetGgufPath();
    const { llamaServerExe, companionPort } = getPathsConfig();
    if (!modelPath || !fs.existsSync(modelPath) || !llamaServerExe || !fs.existsSync(llamaServerExe)) {
      return false;
    }

    if (this.cpuWakePromise) {
      return this.cpuWakePromise;
    }

    this.cpuWakePromise = (async () => {
      if (this.activeCpuModelPath === modelPath && (await this.isCpuServerHealthy())) {
        return true;
      }

      if (this.cpuProc) {
        this.stopCpuServer();
      }

      const threads = Math.min(12, Math.max(4, os.cpus().length - 2));
      console.log(
        `[ComfyCompanion] Launching 0-VRAM CPU llama-server on port ${companionPort} (-ngl 0, ${threads} threads) with ${path.basename(modelPath)}`
      );

      this.cpuProc = spawn(
        llamaServerExe,
        [
          '-m',
          modelPath,
          '-ngl',
          '0',
          '--port',
          String(companionPort),
          '--host',
          '127.0.0.1',
          '--ctx-size',
          '8192',
          '--threads',
          String(threads),
          '--jinja',
        ],
        {
          stdio: 'ignore',
          windowsHide: true,
          detached: false,
        }
      );

      const child = this.cpuProc;
      child.on('exit', () => {
        if (this.cpuProc === child) {
          this.cpuProc = null;
          this.activeCpuModelPath = null;
        }
      });

      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.killed) {
          return false;
        }
        await new Promise((r) => setTimeout(r, 600));
        if (await this.isCpuServerHealthy()) {
          this.activeCpuModelPath = modelPath;
          return true;
        }
      }
      return false;
    })().finally(() => {
      this.cpuWakePromise = null;
    });

    return this.cpuWakePromise;
  }

  public async enhancePrompt(
    systemPrompt: string,
    userPrompt: string,
    abortSignal?: AbortSignal
  ): Promise<{ enhanced: string; enhancedBy: string | null }> {
    const brain = this.resolveEffectiveBrain(this.config);
    const providerCfg = readBrainProviderConfig();

    if (brain === 'ollama_vision') {
      const targetModel = this.resolveOllamaModel(this.config);
      const sidecar = LlamaMoESidecar.getInstance();
      if (await sidecar.isHealthy()) {
        await sidecar.offloadFromGpu('ollama_vision_enhance');
      }
      const runningModels = await getOllamaRunningModels();
      const targetLoaded = runningModels.some(
        (m) => m.name.toLowerCase() === targetModel.toLowerCase()
      );
      if (!targetLoaded) {
        await freeComfyVram().catch(() => {});
      }
      const ollamaRes = await ensureOllamaServerRunning();
      if (ollamaRes.running) {
        const enhanced = await enhancePromptWithOllama({
          model: targetModel,
          systemPrompt,
          userPrompt,
          keepAlive: this.config.ollamaKeepAlive,
          abortSignal,
        });
        return { enhanced, enhancedBy: enhanced !== userPrompt ? `ollama:${targetModel}` : null };
      }
    }

    if (brain === 'gemini_flash' && providerCfg.googleApiKey) {
      const enhanced = await enhancePromptWithGemini(systemPrompt, userPrompt, providerCfg.googleApiKey, abortSignal);
      return { enhanced, enhancedBy: enhanced !== userPrompt ? 'gemini_flash' : null };
    }

    if (brain === 'cpu_lightweight') {
      const ready = await this.ensureCpuLlamaServer();
      if (ready) {
        try {
          const res = await fetch(`${getPathsConfig().companionUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              max_tokens: 900,
              temperature: 0.6,
              chat_template_kwargs: { enable_thinking: false },
            }),
            signal: abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
          });
          if (res.ok) {
            const data: any = await res.json();
            const content = data?.choices?.[0]?.message?.content;
            if (typeof content === 'string' && content.trim().length > 10) {
              return { enhanced: cleanEnhancedPrompt(content), enhancedBy: 'cpu_lightweight' };
            }
          }
        } catch {}
      }
    }

    if (brain === 'gemma4_litert') {
      const litertOut = await this.runLitertOnce(
        `${systemPrompt}\n\nUser concept: ${userPrompt}\n\nOutput only the expanded prompt text:`,
        45000
      );
      if (litertOut && litertOut.trim().length > 10) {
        return { enhanced: cleanEnhancedPrompt(litertOut), enhancedBy: 'gemma4_litert' };
      }
    }

    // Strata fallback (only when brain === 'strata' or zero-VRAM engines weren't ready)
    if (brain === 'strata' || providerCfg.provider === 'strata') {
      const sidecar = LlamaMoESidecar.getInstance();
      const targetProfile = sidecar.getActiveProfile();
      const awake = await sidecar.ensureRunning(targetProfile);
      if (awake) {
        try {
          const res = await fetch(`${getPathsConfig().strataUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: targetProfile,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              max_tokens: 1200,
              temperature: 0.6,
              chat_template_kwargs: { enable_thinking: false },
            }),
            signal: abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
          });
          if (res.ok) {
            const data: any = await res.json();
            const content = data?.choices?.[0]?.message?.content;
            if (typeof content === 'string' && content.trim().length > 10) {
              return { enhanced: cleanEnhancedPrompt(content), enhancedBy: 'strata' };
            }
          }
        } catch {}
      }
    }

    return { enhanced: userPrompt, enhancedBy: null };
  }

  private async runLitertOnce(prompt: string, timeoutMs = 45000): Promise<string> {
    const exe = getPathsConfig().litertLmExe;
    if (!exe || !fs.existsSync(exe)) return '';
    return await new Promise<string>((resolve) => {
      let stdout = '';
      const child = spawn(exe, ['run', 'gemma-4-e4b-gpu', '--prompt', prompt], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        resolve(stdout.trim());
      }, timeoutMs);
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.on('error', () => {
        clearTimeout(timer);
        resolve('');
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve(stdout.trim());
      });
    });
  }

  private tryBuildFastCompletedComfySummary(
    messages: Array<Record<string, any>>
  ): string | null {
    if (!this.config.keepVramWarm || messages.length === 0) return null;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== 'tool' || lastMsg?.name !== 'comfyui') return null;

    const latestUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const userText =
      typeof latestUserMsg?.content === 'string'
        ? latestUserMsg.content
        : Array.isArray(latestUserMsg?.content)
          ? latestUserMsg.content.map((p: any) => p?.text || '').join(' ')
          : '';
    if (
      /\b(inspect|critique|review|analyze|describe|check|compare|evaluate|look at|what does it look|how does it look|fix the)\b/i.test(
        userText
      )
    ) {
      return null;
    }

    const rawOutput = String(lastMsg.content || '');
    const mdLines = rawOutput
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith('[MCP ') && l.includes('](/api/mcp-outputs/'));
    if (mdLines.length === 0) return null;

    const jsonIdx = rawOutput.indexOf('\n[MCP ');
    const jsonPart = (jsonIdx >= 0 ? rawOutput.slice(0, jsonIdx) : rawOutput).trim();
    try {
      const parsed = JSON.parse(jsonPart);
      if (parsed?.status !== 'completed') return null;
      const wf = parsed.workflow || this.config.defaultWorkflow;
      const seedNote = parsed.seed ? ` (seed \`${parsed.seed}\`)` : '';
      const enhancedNote = parsed.promptEnhanced
        ? `\n\nPrompt (${parsed.promptEnhancedBy || 'enhanced'}): ${String(parsed.effectivePrompt || '').slice(0, 260)}`
        : '';
      return `Generated with **${wf}**${seedNote}.${enhancedNote}\n\n${mdLines.join('\n')}`;
    } catch {
      return null;
    }
  }

  public async streamStudioTurn(
    params: InferenceCompletionParams,
    googleEngine: GoogleAiEngine,
    fallbackStream: (p: InferenceCompletionParams) => Promise<InferenceCompletionResult>
  ): Promise<InferenceCompletionResult> {
    const effectiveBrain = this.resolveEffectiveBrain(this.config);

    if (effectiveBrain === 'ollama_vision') {
      const startTime = performance.now();
      const fastSummary = this.tryBuildFastCompletedComfySummary(params.messages);
      if (fastSummary) {
        const tok = Math.max(1, Math.ceil(fastSummary.length / 4));
        params.onTokenDelta(fastSummary, tok, 120);
        return {
          content: fastSummary,
          thinkingContent: '',
          thinkingDurationMs: 0,
          thinkingTokens: 0,
          outputTokens: tok,
        };
      }

      const targetModel = this.resolveOllamaModel(this.config);
      const sidecar = LlamaMoESidecar.getInstance();
      if (await sidecar.isHealthy()) {
        await sidecar.offloadFromGpu('ollama_vision_studio');
      }

      const runningModels = await getOllamaRunningModels();
      const targetLoaded = runningModels.some(
        (m) => m.name.toLowerCase() === targetModel.toLowerCase()
      );
      if (!targetLoaded) {
        await freeComfyVram().catch(() => {});
      }

      const started = await ensureOllamaServerRunning();
      if (!started.running) {
        const errText = `⚠️ ${started.error || 'Ollama server is unavailable.'}`;
        const tok = Math.max(1, Math.ceil(errText.length / 4));
        params.onTokenDelta(errText, tok);
        return {
          content: errText,
          thinkingContent: '',
          thinkingDurationMs: Math.round(performance.now() - startTime),
          thinkingTokens: 0,
          outputTokens: tok,
        };
      }

      return await streamOllamaChat({
        model: targetModel,
        keepAlive: this.config.ollamaKeepAlive,
        completion: params,
      });
    }

    if (effectiveBrain === 'gemini_flash') {
      const apiKey = googleEngine.getApiKey();
      if (apiKey) {
        return await googleEngine.streamChatCompletion({
          ...params,
          googleModelOverride: 'gemini-3.8-flash',
          skipGpuLock: true,
        });
      }
    }

    if (effectiveBrain === 'cpu_lightweight') {
      const awake = await this.ensureCpuLlamaServer();
      if (awake) {
        return await this.streamOpenAiEndpoint(
          `${getPathsConfig().companionUrl}/v1/chat/completions`,
          'local-companion',
          params
        );
      }
    }

    if (effectiveBrain === 'gemma4_litert') {
      const startTime = performance.now();
      const lastUser = [...params.messages].reverse().find((m) => m.role === 'user');
      const hasToolOutput = params.messages.some((m) => m.role === 'tool');
      if (!hasToolOutput && params.onToolCallRequest && params.tools && params.tools.length > 0 && lastUser) {
        const userText = typeof lastUser.content === 'string' ? lastUser.content : JSON.stringify(lastUser.content);
        const args = {
          action: this.config.defaultWorkflow === 'gemini_image' ? 'gemini_image' : 'generate',
          workflow: this.config.defaultWorkflow === 'gemini_image' ? undefined : this.config.defaultWorkflow,
          prompt: userText,
          enhance_prompt: this.config.enhancePrompt,
        };
        params.onToolCallPreparing?.('comfyui');
        await params.onToolCallRequest('comfyui', args);
        return {
          content: '',
          thinkingContent: '',
          thinkingDurationMs: Math.round(performance.now() - startTime),
          thinkingTokens: 0,
          outputTokens: 0,
        };
      }
      const toolMsgs = params.messages.filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n');
      const summary = toolMsgs
        ? (await this.runLitertOnce(`Summarize the image generation output concisely and include exact markdown image links:\n${toolMsgs}`, 30000)) || toolMsgs
        : 'Completed.';
      const tok = Math.max(1, Math.ceil(summary.length / 4));
      params.onTokenDelta(summary, tok, 25);
      return {
        content: summary,
        thinkingContent: '',
        thinkingDurationMs: Math.round(performance.now() - startTime),
        thinkingTokens: 0,
        outputTokens: tok,
      };
    }

    return await fallbackStream(params);
  }

  private async streamOpenAiEndpoint(
    url: string,
    modelName: string,
    params: InferenceCompletionParams
  ): Promise<InferenceCompletionResult> {
    const startTime = performance.now();
    let content = '';
    let outputTokens = 0;
    const pendingToolCalls = new Map<number, { id?: string; name: string; arguments: string }>();

    const body: Record<string, any> = {
      model: modelName,
      messages: params.messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 2048,
      chat_template_kwargs: { enable_thinking: false },
    };
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.abortSignal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText);
      const msg = `⚠️ ComfyUI CPU Companion error (${res.status}): ${errText.slice(0, 400)}`;
      params.onTokenDelta(msg, Math.max(1, Math.ceil(msg.length / 4)));
      return { content: msg, thinkingContent: '', thinkingDurationMs: 0, thinkingTokens: 0, outputTokens: 10 };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let rawBuffer = '';
    let announced = false;

    while (true) {
      if (params.abortSignal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      rawBuffer += decoder.decode(value, { stream: true });
      const lines = rawBuffer.split('\n');
      rawBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') break;
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed?.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            const c = String(delta.content);
            content += c;
            outputTokens += Math.max(1, Math.ceil(c.length / 4));
            const tps = Number((outputTokens / Math.max(0.08, (performance.now() - startTime) / 1000)).toFixed(1));
            params.onTokenDelta(c, outputTokens, tps);
          }
          if (Array.isArray(delta.tool_calls)) {
            if (!announced) {
              announced = true;
              params.onToolCallPreparing?.(delta.tool_calls[0]?.function?.name);
            }
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!pendingToolCalls.has(idx)) {
                pendingToolCalls.set(idx, { id: tc.id, name: tc.function?.name || '', arguments: '' });
              }
              const slot = pendingToolCalls.get(idx)!;
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name = tc.function.name;
              if (tc.function?.arguments) slot.arguments += tc.function.arguments;
            }
          }
        } catch {}
      }
    }

    if (params.onToolCallRequest && pendingToolCalls.size > 0 && !params.abortSignal?.aborted) {
      for (const [, call] of pendingToolCalls) {
        if (!call.name) continue;
        try {
          const parsed = call.arguments ? JSON.parse(call.arguments) : {};
          await params.onToolCallRequest(call.name, parsed);
        } catch {}
      }
    }

    return {
      content,
      thinkingContent: '',
      thinkingDurationMs: Math.round(performance.now() - startTime),
      thinkingTokens: 0,
      outputTokens,
    };
  }
}
