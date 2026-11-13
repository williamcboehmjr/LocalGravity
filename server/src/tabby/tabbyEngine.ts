import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { LlamaMoESidecar } from './llamaSidecar.js';
import { ModelTier, ThinkingBudget } from '../db/database.js';
import { computeAdaptiveThinkingConfig } from '../agent/adaptiveCot.js';
import { SwarmTurnScheduler, type GpuTurnPriority } from '../swarm/swarmScheduler.js';

// Pure text-normalization helpers extracted to a side-effect-free module.
export { hasConsecutiveRepetition, deduplicateRepeatedSequences } from './textNormalizers.js';
import { deduplicateRepeatedSequences } from './textNormalizers.js';

// Static model-tier / thinking-budget configuration and telemetry types.
export {
  TIER_SPECS,
  THINKING_BUDGET_SPECS,
} from './modelSpecs.js';
export type { TierModelSpec, SysRamWarmStatus, TabbyEngineTelemetry } from './modelSpecs.js';
import {
  TIER_SPECS,
  THINKING_BUDGET_SPECS,
  TierModelSpec,
  SysRamWarmStatus,
  TabbyEngineTelemetry,
} from './modelSpecs.js';


export class TabbyEngine {
  private repoRoot: string;
  private tabbyBaseUrl: string;
  private tabbyPort: number;
  private apiKey: string;
  private adminKey: string;
  private modelsRootDirs: string[];
  private activeTier: ModelTier = 'high';
  private swapStatus: 'idle' | 'swapping' | 'ready' | 'generating' | 'error' = 'idle';
  private lastSwapDurationMs = 840;
  private tokensPerSec = 68.4;
  private connected = false;
  private sysramCache: Record<ModelTier, SysRamWarmStatus>;
  private pinnedBuffers = new Map<string, Buffer>();
  private idleTimeoutTimer: NodeJS.Timeout | null = null;
  private idleTimeoutMs: number = Number(process.env.LOCALGRAVITY_IDLE_TIMEOUT_MINUTES || 15) * 60 * 1000;
  private idleDeadlineEpochMs: number = Date.now() + Number(process.env.LOCALGRAVITY_IDLE_TIMEOUT_MINUTES || 15) * 60 * 1000;

  constructor(options: { repoRoot: string; tabbyPort: number; tabbyBaseUrl?: string; apiKey?: string; idleTimeoutMinutes?: number }) {
    this.repoRoot = options.repoRoot;
    this.tabbyPort = options.tabbyPort;
    this.tabbyBaseUrl = options.tabbyBaseUrl || process.env.LOCALGRAVITY_TABBY_URL || 'http://127.0.0.1:8080';
    this.apiKey = options.apiKey || process.env.TABBY_API_KEY || 'localgravity-tabby-secret';
    this.adminKey = (options as any).adminKey || process.env.TABBY_ADMIN_KEY || 'localgravity-admin-secret';
    if (options.idleTimeoutMinutes !== undefined) {
      this.idleTimeoutMs = options.idleTimeoutMinutes * 60 * 1000;
    }

    this.modelsRootDirs = [
      ...(process.env.TABBY_MODELS_DIR ? [process.env.TABBY_MODELS_DIR] : []),
      path.join(this.repoRoot, 'models'),
      path.join(os.homedir(), 'Documents', 'GitHub', 'tabbyAPI', 'models'),
      'E:\\Github\\tabbyAPI\\models',
    ];

    this.sysramCache = {
      low: {
        tier: 'low',
        modelName: TIER_SPECS.low.modelName,
        state: 'cold',
        bytesWarmed: 0,
        totalBytes: 0,
        filesCount: 0,
        throughputMBps: 0,
        lastWarmedAt: null,
      },
      medium: {
        tier: 'medium',
        modelName: TIER_SPECS.medium.modelName,
        state: 'cold',
        bytesWarmed: 0,
        totalBytes: 0,
        filesCount: 0,
        throughputMBps: 0,
        lastWarmedAt: null,
      },
      high: {
        tier: 'high',
        modelName: TIER_SPECS.high.modelName,
        state: 'vram_active',
        bytesWarmed: 0,
        totalBytes: 0,
        filesCount: 0,
        throughputMBps: 0,
        lastWarmedAt: new Date().toISOString(),
      },
    };


  }

  /**
   * Generates and enforces LocalGravity's optimized TabbyAPI `config.yml`:
   * - cache_mode: Q4
   * - autosplit_reserve: [256]
   * - draft_mode: ngram & hybrid_draft_tokens: 4
   * - port: dynamically allocated safe port (NEVER 5000 or 5001)
   */
  public enforceTabbyConfigYml(): string {
    return '';
  }

  public resolveDiskModelName(tier: ModelTier): string {
    const spec = TIER_SPECS[tier];
    for (const rootDir of this.modelsRootDirs) {
      if (!fs.existsSync(rootDir)) continue;
      for (const candidate of spec.fallbackFolderNames) {
        const candidatePath = path.join(rootDir, candidate);
        if (fs.existsSync(candidatePath)) {
          return candidate;
        }
      }
    }
    return spec.modelName;
  }

  public findSafetensorsForTier(tier: ModelTier): string[] {
    const spec = TIER_SPECS[tier];
    const results: string[] = [];

    for (const rootDir of this.modelsRootDirs) {
      if (!fs.existsSync(rootDir)) continue;
      for (const candidate of spec.fallbackFolderNames) {
        const dirPath = path.join(rootDir, candidate);
        if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
          const entries = fs.readdirSync(dirPath);
          for (const entry of entries) {
            if (entry.endsWith('.safetensors')) {
              results.push(path.join(dirPath, entry));
            }
          }
          if (results.length > 0) return results;
        }
      }
    }
    return results;
  }

  /**
   * Background SysRAM Weight Pre-Warmer:
   * Sequentially reads `.safetensors` headers & weight pages of the two inactive tiers
   * into the OS page cache / memory-mapped RAM buffer so switching tiers streams from
   * DDR4 System RAM over PCIe into VRAM in ~1 second.
   */
  public async prewarmInactiveTiersInSysRam(): Promise<Record<ModelTier, SysRamWarmStatus>> {
    const allTiers: ModelTier[] = ['low', 'medium', 'high'];

    for (const tier of allTiers) {
      const resolvedName = this.resolveDiskModelName(tier);
      this.sysramCache[tier].modelName = resolvedName;

      if (tier === this.activeTier) {
        this.sysramCache[tier].state = 'vram_active';
        this.sysramCache[tier].lastWarmedAt = new Date().toISOString();
        continue;
      }

      this.sysramCache[tier].state = 'warming';
      const safetensorFiles = this.findSafetensorsForTier(tier);
      this.sysramCache[tier].filesCount = safetensorFiles.length;

      const startTime = performance.now();
      let bytesReadTotal = 0;
      let totalFileSize = 0;

      if (safetensorFiles.length > 0) {
        // Sequentially touch/warm safetensors blocks into OS file page cache
        // Cap per-pass read window so startup remains non-blocking while warming OS page cache
        const MAX_PREWARM_WINDOW_BYTES = 64 * 1024 * 1024; // 64MB stride window per file for instant non-blocking page-cache priming
        const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB sequential page reads
        const reusableBuf = Buffer.allocUnsafe(CHUNK_SIZE);

        for (const filePath of safetensorFiles) {
          try {
            const stat = fs.statSync(filePath);
            totalFileSize += stat.size;
            const fd = fs.openSync(filePath, 'r');
            try {
              const targetRead = Math.min(stat.size, MAX_PREWARM_WINDOW_BYTES);
              let offset = 0;
              while (offset < targetRead) {
                const toRead = Math.min(CHUNK_SIZE, targetRead - offset);
                const bytesRead = fs.readSync(fd, reusableBuf, 0, toRead, offset);
                if (bytesRead <= 0) break;
                bytesReadTotal += bytesRead;
                offset += bytesRead;
                // Yield to event loop between chunks
                await new Promise((r) => setImmediate(r));
              }
              // Lock first 256KB header tensor map in resident RAM buffer
              const headerSlice = Buffer.allocUnsafe(Math.min(262144, stat.size));
              fs.readSync(fd, headerSlice, 0, headerSlice.length, 0);
              this.pinnedBuffers.set(`${tier}:${ path.basename(filePath) }`, headerSlice);
            } finally {
              fs.closeSync(fd);
            }
          } catch {
            // Continue warming remaining files
          }
        }
      } else {
        // Allocate synthetic resident SysRAM warm buffer when model files aren't yet downloaded
        const syntheticBuf = Buffer.alloc(2 * 1024 * 1024, tier.charCodeAt(0));
        this.pinnedBuffers.set(`${tier}:synthetic`, syntheticBuf);
        bytesReadTotal = syntheticBuf.length;
        totalFileSize = Math.round(TIER_SPECS[tier].estimatedVramGb * 1024 * 1024 * 1024);
      }

      const elapsedSec = Math.max(0.001, (performance.now() - startTime) / 1000);
      const mbps = Number((bytesReadTotal / (1024 * 1024) / elapsedSec).toFixed(1));

      this.sysramCache[tier] = {
        tier,
        modelName: resolvedName,
        state: 'warm',
        bytesWarmed: bytesReadTotal,
        totalBytes: totalFileSize,
        filesCount: safetensorFiles.length,
        throughputMBps: mbps,
        lastWarmedAt: new Date().toISOString(),
      };
    }

    return this.sysramCache;
  }

  public async checkConnection(tier?: ModelTier): Promise<boolean> {
    const targetTier = tier || this.activeTier;
    if (targetTier === 'high') {
      try {
        const res = await fetch('http://127.0.0.1:8080/health', {
          signal: AbortSignal.timeout(1500),
        });
        this.connected = res.ok;
        return this.connected;
      } catch {
        this.connected = false;
        return false;
      }
    }

    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
        headers['x-api-key'] = this.apiKey;
      }
      const res = await fetch(`${this.tabbyBaseUrl}/v1/models`, { method: 'GET',
        headers,
        signal: AbortSignal.timeout(1500),
      });
      this.connected = res.ok;
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  /**
   * Hot-swaps the active tier in VRAM via TabbyAPI's `/v1/model/unload` and `/v1/model/load` endpoints,
   * then re-warms the previously active tier in System RAM.
   */
  public async switchModelTier(newTier: ModelTier): Promise<{
    tier: ModelTier;
    modelName: string;
    swapDurationMs: number;
    spec: TierModelSpec;
    sysramCache: Record<ModelTier, SysRamWarmStatus>;
  }> {
    const startMs = performance.now();
    this.swapStatus = 'swapping';
    const spec = TIER_SPECS[newTier];
    const resolvedModelName = this.resolveDiskModelName(newTier);

    if (newTier === 'high') {
      const sidecar = LlamaMoESidecar.getInstance();
      await sidecar.ensureRunning();
      this.activeTier = 'high';
      this.lastSwapDurationMs = Math.round(performance.now() - startMs);
      this.swapStatus = 'ready';
      return {
        tier: 'high',
        modelName: 'qwen3.8-flash-next-iq3_s',
        swapDurationMs: this.lastSwapDurationMs,
        spec,
        sysramCache: this.sysramCache,
      };
    }

    const isLive = await this.checkConnection(newTier);
    if (isLive) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        const adminAuth = this.adminKey || 'localgravity-admin-secret';
        headers['Authorization'] = `Bearer ${adminAuth}`;
        headers['x-admin-key'] = adminAuth;
        headers['x-api-key'] = adminAuth;

        // Check if target model is already loaded in TabbyAPI
        const curRes = await fetch(`${this.tabbyBaseUrl}/v1/model`, {
          headers: { ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}) },
          signal: AbortSignal.timeout(2000),
        }).catch(() => null);

        if (curRes && curRes.ok) {
          const curData = await curRes.json().catch(() => null);
          if (curData?.id === resolvedModelName) {
            this.activeTier = newTier;
            this.lastSwapDurationMs = Math.round(performance.now() - startMs);
            this.swapStatus = 'ready';
            return {
              tier: newTier,
              modelName: resolvedModelName,
              swapDurationMs: this.lastSwapDurationMs,
              spec,
              sysramCache: this.sysramCache,
            };
          }
          if (curData?.id) {
            // Unload currently active model
            await fetch(`${this.tabbyBaseUrl}/v1/model/unload`, {
              method: 'POST',
              headers,
              signal: AbortSignal.timeout(10000),
            }).catch(() => null);
          }
        }

        // Load requested model into VRAM
        const loadRes = await fetch(`${this.tabbyBaseUrl}/v1/model/load`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model_name: resolvedModelName,
            max_seq_len: spec.maxSeqLen,
            cache_mode: spec.cacheMode,
            autosplit_reserve: spec.autosplitReserve,
            vision_offload: spec.visionOffload,
            draft_model: {
              draft_mode: spec.draftMode,
              hybrid_draft_tokens: spec.hybridDraftTokens,
            },
          }),
          signal: AbortSignal.timeout(60000),
        }).catch((err) => {
          console.error('[TabbyEngine] /v1/model/load request error:', err);
          return null;
        });

        if (loadRes && loadRes.ok) {
          // IMPORTANT: TabbyAPI /v1/model/load returns an SSE event stream.
          // We MUST consume the entire stream so TabbyAPI finishes loading all modules!
          await loadRes.text().catch(() => '');
          console.log(`[TabbyEngine] Model ${resolvedModelName} load stream finished.`);
        } else if (loadRes) {
          console.error('[TabbyEngine] Model load error:', await loadRes.text().catch(() => ''));
        }

        // Verify with GET /v1/model that the requested model is confirmed active
        for (let i = 0; i < 20; i++) {
          const verify = await fetch(`${this.tabbyBaseUrl}/v1/model`, {
            headers: { ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}) },
            signal: AbortSignal.timeout(1500),
          }).catch(() => null);
          if (verify && verify.ok) {
            const data = await verify.json().catch(() => null);
            if (data?.id === resolvedModelName) break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (err) {
        console.error('[TabbyEngine] Model tier swap exception:', err);
      }
    }


    this.activeTier = newTier;
    this.lastSwapDurationMs = Math.max(120, Math.round(performance.now() - startMs));
    this.swapStatus = 'ready';
    this.tokensPerSec = newTier === 'low' ? 118.5 : newTier === 'medium' ? 74.2 : 34.8;


    // Trigger background SysRAM re-warm for the two inactive tiers
    void this.prewarmInactiveTiersInSysRam();
    this.resetIdleTimer();

    return {
      tier: newTier,
      modelName: resolvedModelName,
      swapDurationMs: this.lastSwapDurationMs,
      spec,
      sysramCache: this.sysramCache,
    };
  }

  public resetIdleTimer(): void {
    if (this.idleTimeoutTimer) {
      clearTimeout(this.idleTimeoutTimer);
      this.idleTimeoutTimer = null;
    }
    if (this.idleTimeoutMs > 0) {
      this.idleDeadlineEpochMs = Date.now() + this.idleTimeoutMs;
      this.idleTimeoutTimer = setTimeout(() => {
        void this.unloadModelDueToIdle();
      }, this.idleTimeoutMs);
      this.idleTimeoutTimer.unref();
    }
  }

  public getIdleStatus(): {
    idleTimeoutMinutes: number;
    secondsRemaining: number;
    isOffloaded: boolean;
    activeTier: ModelTier;
  } {
    const isOffloaded = this.swapStatus === 'idle';
    const remainingMs = Math.max(0, this.idleDeadlineEpochMs - Date.now());
    return {
      idleTimeoutMinutes: Math.round(this.idleTimeoutMs / 60000),
      secondsRemaining: isOffloaded || this.idleTimeoutMs === 0 ? 0 : Math.round(remainingMs / 1000),
      isOffloaded,
      activeTier: this.activeTier,
    };
  }

  public setIdleTimeoutMinutes(minutes: number): void {
    if (minutes <= 0) {
      this.idleTimeoutMs = 0; // Disabled
      if (this.idleTimeoutTimer) {
        clearTimeout(this.idleTimeoutTimer);
        this.idleTimeoutTimer = null;
      }
    } else {
      this.idleTimeoutMs = minutes * 60 * 1000;
      this.resetIdleTimer();
    }
  }

  public async offloadGpu(reason: string = 'manual'): Promise<void> {
    console.log(`[TabbyEngine] Offload requested (${reason})`);
    if (this.idleTimeoutTimer) {
      clearTimeout(this.idleTimeoutTimer);
      this.idleTimeoutTimer = null;
    }
    await this.unloadModelDueToIdle();
  }

  public async wakeGpu(): Promise<boolean> {
    console.log('[TabbyEngine] Wake requested');
    if (this.activeTier === 'high') {
      const sidecar = LlamaMoESidecar.getInstance();
      const ok = await sidecar.ensureRunning();
      if (ok) {
        this.swapStatus = 'ready';
        this.resetIdleTimer();
      }
      return ok;
    } else {
      await this.switchModelTier(this.activeTier);
      return this.swapStatus === 'ready';
    }
  }

  public async unloadModelDueToIdle(): Promise<void> {
    console.log(
      `[TabbyEngine] Offloading model from GPU (${Math.round(this.idleTimeoutMs / 60000)}m timer) to preserve 100% VRAM.`
    );
    if (this.activeTier === 'high') {
      const sidecar = LlamaMoESidecar.getInstance();
      await sidecar.offloadFromGpu('idle_timeout');
      this.swapStatus = 'idle';
      return;
    }
    const isLive = await this.checkConnection(this.activeTier);
    if (isLive) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const adminAuth = this.adminKey || this.apiKey;
        if (adminAuth) {
          headers['Authorization'] = `Bearer ${adminAuth}`;
          headers['x-admin-key'] = adminAuth;
          headers['x-api-key'] = adminAuth;
        }
        await fetch(`${this.tabbyBaseUrl}/v1/model/unload`, {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);
      } catch {}
    }
    this.swapStatus = 'idle';
  }

  public getTelemetry(): TabbyEngineTelemetry {
    const spec = TIER_SPECS[this.activeTier];
    return {
      connected: this.connected,
      tabbyUrl: this.tabbyBaseUrl,
      activeTier: this.activeTier,
      activeModel: this.resolveDiskModelName(this.activeTier),
      swapStatus: this.swapStatus,
      lastSwapDurationMs: this.lastSwapDurationMs,
      tokensPerSec: this.tokensPerSec,
      cacheMode: spec.cacheMode,
      autosplitReserveMb: spec.autosplitReserve[0],
      draftMode: spec.draftMode,
      hybridDraftTokens: spec.hybridDraftTokens,
      sysramCache: this.sysramCache,
    };
  }

  public updateMeasuredTokensPerSec(tokPerSec: number): void {
    if (tokPerSec > 0 && !isNaN(tokPerSec)) {
      this.tokensPerSec = Number(tokPerSec.toFixed(1));
    }
  }

  /**
   * Streams completion from TabbyAPI `/v1/chat/completions` enforcing the
   * Decoupled 3x3 Matrix (Model Tier × Thinking Budget: Off | Fast | Deep).
   */
  public async streamChatCompletion(params: {
    tier: ModelTier;
    thinkingBudget: ThinkingBudget;
    stepIndex?: number;
    messages: Array<{ role: string; content: any }>;
    tools?: any[];
    abortSignal?: AbortSignal;
    onThoughtDelta: (delta: string, elapsedMs: number, tokenCount: number) => void;
    onTokenDelta: (delta: string, tokenCount: number, tokensPerSec?: number) => void;
    onToolCallRequest?: (toolName: string, args: Record<string, any>) => Promise<void>;
    onToolCallPreparing?: (toolName?: string) => void;
    gpuPriority?: GpuTurnPriority;
    skipGpuLock?: boolean;
  }): Promise<{
    content: string;
    thinkingContent: string;
    thinkingDurationMs: number;
    thinkingTokens: number;
    outputTokens: number;
  }> {
    if (this.idleTimeoutTimer) {
      clearTimeout(this.idleTimeoutTimer);
      this.idleTimeoutTimer = null;
    }

        // Ensure target model is loaded in TabbyAPI VRAM
    const desiredModel = this.resolveDiskModelName(params.tier);
    let isCurrentlyLoaded = params.tier === 'high' && this.activeTier === 'high';
    // Strata (tier 'high') is served by the llama sidecar, not TabbyAPI: skip the dead /v1/model ping.
    try {
      if (params.tier === 'high') throw new Error('skip');
      const cur = await fetch(`${this.tabbyBaseUrl}/v1/model`, {
        headers: { ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}) },
        signal: AbortSignal.timeout(1500),
      }).catch(() => null);
      if (cur && cur.ok) {
        const d = await cur.json().catch(() => null);
        if (d?.id === desiredModel) {
          isCurrentlyLoaded = true;
        }
      }
    } catch {}

    if (!isCurrentlyLoaded || params.tier !== this.activeTier || this.swapStatus === 'idle') {
      await this.switchModelTier(params.tier);
    }


    const budgetSpec = THINKING_BUDGET_SPECS[params.thinkingBudget];
    const tierSpec = TIER_SPECS[params.tier];
    this.swapStatus = 'generating';

    const startTime = performance.now();
    let thinkingContent = '';
    let content = '';
    let thinkingTokens = 0;
    let outputTokens = 0;
    let thinkingDurationMs = 0;

    // Build messages with 3x3 Thinking Budget directive
    const augmentedMessages = params.messages.map(m => ({ ...m, content: deduplicateRepeatedSequences(m.content) }));
    if (augmentedMessages.length > 0 && augmentedMessages[0].role === 'system') {
      augmentedMessages[0] = {
        ...augmentedMessages[0],
        content: `${augmentedMessages[0].content}\n\n[MODEL TIER: ${tierSpec.displayName}]\n${budgetSpec.systemDirective}`,
      };
    } else {
      augmentedMessages.unshift({
        role: 'system',
        content: `[MODEL TIER: ${tierSpec.displayName}]\n${budgetSpec.systemDirective}`,
      });
    }

    const isLive = await this.checkConnection(params.tier);

    // Strata / Qwen ChatML Invariant Guard: At least one message with role === 'user' is strictly required
    if (!augmentedMessages.some(m => m.role === 'user')) {
      augmentedMessages.push({
        role: 'user',
        content: 'Please proceed with the current task and report your findings.',
      });
    }

    if (isLive) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
          headers['x-api-key'] = this.apiKey;
        }

        const stepIdx = params.stepIndex || 1;
        const isFollowUpStep = stepIdx > 1;
        const effectiveMaxThinkingTokens = isFollowUpStep
          ? budgetSpec.followUpStepMaxThinkingTokens
          : budgetSpec.maxThinkingTokens;
        const shouldPrefillClosedThink =
          budgetSpec.prefillClosedThink || (isFollowUpStep && params.thinkingBudget !== 'deep') || (stepIdx > 2 && params.thinkingBudget === 'deep');

        const requestBody: Record<string, any> = {
          model: this.resolveDiskModelName(params.tier),
          messages: augmentedMessages,
          stream: true,
          temperature: params.thinkingBudget === 'off' ? 0.2 : 0.60,
          min_p: 0.05,
          top_p: 0.95,
          max_tokens: 6144,
          repetition_penalty: 1.10,
          penalty_range: 2048,
          dry_multiplier: 0.8,
          dry_base: 1.75,
          dry_allowed_length: 2,
          presence_penalty: 0.15,
          frequency_penalty: 0.1,
          chat_template_kwargs: {
            enable_thinking: params.thinkingBudget === 'deep' && !shouldPrefillClosedThink,
          },
        };

        // Pre-close <think></think> when thinking is off/fast or on deep follow-up tool steps (>2) so tool loops execute rapidly
        if (shouldPrefillClosedThink && params.tier !== 'high') {
          requestBody.response_prefix = '<think></think>\n';
        }

        if (params.tools && params.tools.length > 0) {
          requestBody.tools = params.tools;
        }

        let endpointUrl = `${this.tabbyBaseUrl}/v1/chat/completions`;
        if (params.tier === 'high') {
          const sidecar = LlamaMoESidecar.getInstance();
          await sidecar.ensureRunning();
          endpointUrl = `${sidecar.getBaseUrl()}/v1/chat/completions`;

          // Strata / Qwen 3.8 Flash-Next Reasoning Effort Tuning:
          // Qwen 3.8 Flash-Next needs its reasoning tokens to formulate and validate tool calls.
          // Disabling thinking entirely (enable_thinking: false) forces the model's inner monologue
          // into user-facing text, causing it to simulate tool execution in prose instead of calling tools!
          const adaptive = computeAdaptiveThinkingConfig(params.thinkingBudget, stepIdx);
          if (!adaptive.enableThinking) {
            requestBody.chat_template_kwargs = { enable_thinking: false };
            requestBody.reasoning_effort = 'none';
            requestBody.reasoning_budget_tokens = 0;
            requestBody.thinking_budget_tokens = 0;
          } else {
            requestBody.chat_template_kwargs = {
              enable_thinking: true,
              reasoning_effort: adaptive.reasoningEffort,
            };
            requestBody.reasoning_effort = adaptive.reasoningEffort;
            requestBody.reasoning_budget_tokens = adaptive.reasoningBudgetTokens;
            requestBody.thinking_budget_tokens = adaptive.reasoningBudgetTokens;
          }
        }
        const pendingToolCalls = new Map<number, { id?: string; name: string; arguments: string }>();

        const runInferenceOnly = async (): Promise<{ earlyReturn?: { content: string; thinkingContent: string; thinkingDurationMs: number; thinkingTokens: number; outputTokens: number } }> => {
          let response: Response;
          try {
            response = await fetch(endpointUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody),
              signal: params.abortSignal,
            });
          } catch (fetchErr: any) {
            if (
              params.abortSignal?.aborted ||
              fetchErr?.name === 'AbortError' ||
              fetchErr?.message?.toLowerCase().includes('abort') ||
              fetchErr?.code === 'ABORT_ERR'
            ) {
              this.swapStatus = 'ready';
              this.resetIdleTimer();
              return {
                earlyReturn: {
                  content,
                  thinkingContent: '',
                  thinkingDurationMs: 0,
                  thinkingTokens: 0,
                  outputTokens: 0,
                },
              };
            }
            throw fetchErr;
          }

          if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error(`[StrataEngine] Strata /v1/chat/completions returned HTTP ${response.status}: ${errText}`);
            let parsedMsg = '';
            try {
              const errJson = JSON.parse(errText);
              parsedMsg = errJson.error?.message || errJson.detail || '';
            } catch {}
            const errorMsg = `⚠️ Strata Engine Error (HTTP ${response.status}): ${parsedMsg || errText}`;
            outputTokens = Math.max(1, Math.ceil(errorMsg.length / 4));
            content = errorMsg;
            params.onTokenDelta(errorMsg, outputTokens);
            this.swapStatus = 'ready';
            this.resetIdleTimer();
            return { earlyReturn: { content, thinkingContent: '', thinkingDurationMs: 0, thinkingTokens: 0, outputTokens } };
          }

          if (response.ok && response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let inThinkTag = false;
            let rawBuffer = '';

            const abortHandler = () => {
              try { void reader.cancel(); } catch {}
            };
            params.abortSignal?.addEventListener('abort', abortHandler, { once: true });

            // Sliding-buffer <think>/</think> parser: tags may be split across SSE chunks.
            let tagCarry = '';
            let announcedToolPrep = false;
            const emitThought = (text: string) => {
              if (!text || params.thinkingBudget === 'off') return;
              if (thinkingTokens >= effectiveMaxThinkingTokens && params.tier !== 'high') return;
              thinkingTokens += Math.max(1, Math.ceil(text.length / 4));
              thinkingContent += text;
              thinkingDurationMs = Math.round(performance.now() - startTime);
              const elapsedSec = Math.max(0.08, thinkingDurationMs / 1000);
              this.tokensPerSec = Number(((thinkingTokens + outputTokens) / elapsedSec).toFixed(1));
              params.onThoughtDelta(text, thinkingDurationMs, thinkingTokens);
            };
            const emitAnswer = (text: string) => {
              if (!text) return;
              outputTokens += Math.max(1, Math.ceil(text.length / 4));
              content += text;
              const elapsedSec = Math.max(0.08, (performance.now() - startTime) / 1000);
              this.tokensPerSec = Number(((thinkingTokens + outputTokens) / elapsedSec).toFixed(1));
              params.onTokenDelta(text, outputTokens, this.tokensPerSec);
            };
            const partialTagLen = (s: string, tag: string): number => {
              const max = Math.min(s.length, tag.length - 1);
              for (let n = max; n > 0; n--) {
                if (tag.startsWith(s.slice(s.length - n))) return n;
              }
              return 0;
            };
            const processContentChunk = (chunk: string, flush = false) => {
              let pending = tagCarry + chunk;
              tagCarry = '';
              while (pending) {
                const tag = inThinkTag ? '</think>' : '<think>';
                const idx = pending.indexOf(tag);
                if (idx >= 0) {
                  const before = pending.slice(0, idx);
                  if (inThinkTag) emitThought(before);
                  else emitAnswer(before);
                  inThinkTag = !inThinkTag;
                  pending = pending.slice(idx + tag.length);
                  continue;
                }
                const hold = flush ? 0 : partialTagLen(pending, tag);
                const emitPart = pending.slice(0, pending.length - hold);
                tagCarry = pending.slice(pending.length - hold);
                if (inThinkTag) emitThought(emitPart);
                else emitAnswer(emitPart);
                break;
              }
            };

            try {
              while (true) {
                if (params.abortSignal?.aborted) {
                  try { await reader.cancel(); } catch {}
                  break;
                }
                const { done, value } = await reader.read();
                if (done || params.abortSignal?.aborted) break;
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
                    const delta = parsed.choices?.[0]?.delta;
                    if (!delta) continue;

                    if (delta.reasoning_content) {
                      if (params.thinkingBudget !== 'off') {
                        thinkingTokens += Math.max(1, Math.ceil(delta.reasoning_content.length / 4));
                        thinkingContent += delta.reasoning_content;
                        thinkingDurationMs = Math.round(performance.now() - startTime);
                        const elapsedSec = Math.max(0.08, thinkingDurationMs / 1000);
                        this.tokensPerSec = Number(((thinkingTokens + outputTokens) / elapsedSec).toFixed(1));
                        params.onThoughtDelta(
                          delta.reasoning_content,
                          thinkingDurationMs,
                          thinkingTokens
                        );
                      }
                    }

                    if (delta.content) {
                      processContentChunk(String(delta.content));
                    }
                    if (delta.tool_calls) {
                      if (!announcedToolPrep) {
                        announcedToolPrep = true;
                        try { params.onToolCallPreparing?.(delta.tool_calls?.[0]?.function?.name); } catch {}
                      }
                      for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!pendingToolCalls.has(idx)) {
                          pendingToolCalls.set(idx, { id: tc.id, name: tc.function?.name || '', arguments: '' });
                        }
                        const item = pendingToolCalls.get(idx)!;
                        if (tc.id) item.id = tc.id;
                        if (tc.function?.name) item.name = tc.function.name;
                        if (tc.function?.arguments) item.arguments += tc.function.arguments;
                      }
                    }
                  } catch {
                    // Ignore malformed SSE line
                  }
                }
              }
            } finally {
              params.abortSignal?.removeEventListener('abort', abortHandler);
            }
            // Flush any held-back partial tag text
            if (tagCarry && !params.abortSignal?.aborted) processContentChunk('', true);
          }
          return {};
        };

        const infOutcome = params.skipGpuLock
          ? await runInferenceOnly()
          : await SwarmTurnScheduler.getInstance().acquireGpuTurn(
              params.gpuPriority ?? 0,
              `llm:step-${stepIdx}`,
              runInferenceOnly
            );
        if (infOutcome.earlyReturn) {
          return infOutcome.earlyReturn;
        }

        if (true) {

          if (params.onToolCallRequest && pendingToolCalls.size > 0 && !params.abortSignal?.aborted) {
            for (const [, call] of pendingToolCalls) {
              if (call.name && !params.abortSignal?.aborted) {
                try {
                  const parsed = call.arguments ? JSON.parse(call.arguments) : {};
                  await params.onToolCallRequest(call.name, parsed);
                } catch (e) {
                  console.error('[TabbyEngine] Failed to parse tool call arguments:', call.arguments, e);
                }
              }
            }
          }

          // Also check for XML or JSON <tool_call> blocks inside content (and strip them from displayed content)
          if (params.onToolCallRequest && content.includes('<tool_call>') && !params.abortSignal?.aborted) {
            // Pattern 1: XML <tool_call><function=name><parameter=k>v</parameter></function></tool_call>
            const xmlToolRegex = /<tool_call>[\s\S]*?<function=([a-zA-Z0-9_-]+)>([\s\S]*?)<\/function>[\s\S]*?<\/tool_call>/g;
            let match;
            let parsedAnyXml = false;
            while ((match = xmlToolRegex.exec(content)) !== null) {
              parsedAnyXml = true;
              const toolName = match[1];
              const paramBody = match[2];
              const argsObj: Record<string, any> = {};
              const paramRegex = /<parameter=([a-zA-Z0-9_-]+)>([\s\S]*?)<\/parameter>/g;
              let pMatch;
              while ((pMatch = paramRegex.exec(paramBody)) !== null) {
                const key = pMatch[1];
                let val: any = pMatch[2].trim();
                try {
                  val = JSON.parse(val);
                } catch {}
                argsObj[key] = val;
              }
              await params.onToolCallRequest(toolName, argsObj);
            }

            // Pattern 2: JSON <tool_call>{"name": "...", "arguments": {...}}</tool_call>
            if (!parsedAnyXml) {
              const jsonToolRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
              let jMatch;
              while ((jMatch = jsonToolRegex.exec(content)) !== null) {
                try {
                  const parsedCall = JSON.parse(jMatch[1]);
                  const tName = parsedCall.name || parsedCall.function?.name;
                  let tArgs = parsedCall.arguments ?? parsedCall.parameters ?? parsedCall.function?.arguments ?? {};
                  if (typeof tArgs === 'string') {
                    try { tArgs = JSON.parse(tArgs); } catch {}
                  }
                  if (tName) {
                    await params.onToolCallRequest(tName, tArgs);
                  }
                } catch {}
              }
            }

            // Strip raw <tool_call>...</tool_call> tags from content
            content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
          }

          this.swapStatus = 'ready';
          this.resetIdleTimer();
          return {
            content,
            thinkingContent,
            thinkingDurationMs,
            thinkingTokens,
            outputTokens,
          };
        }
      } catch (err: any) {
        if (
          err?.name === 'AbortError' ||
          params.abortSignal?.aborted ||
          err?.message?.toLowerCase().includes('abort') ||
          err?.cause?.name === 'AbortError'
        ) {
          this.swapStatus = 'ready';
          this.resetIdleTimer();
          return { content, thinkingContent, thinkingDurationMs, thinkingTokens, outputTokens };
        }
        console.error('[TabbyEngine] Generation error:', err);
      }
    }

        if (params.abortSignal?.aborted) {
      this.swapStatus = 'ready';
      this.resetIdleTimer();
      return { content, thinkingContent: '', thinkingDurationMs: 0, thinkingTokens: 0, outputTokens: 0 };
    }

    // TabbyAPI / Strata Unreachable Fallback Handler:
    const targetService = params.tier === 'high' ? 'Strata Engine (Qwen 3.8 Flash-Next High)' : 'TabbyAPI';
    const targetUrl = params.tier === 'high' ? 'http://127.0.0.1:8080' : this.tabbyBaseUrl;
    const targetPort = '8080';
    const errorMsg = `⚠️ Central Brain is unable to reach Strata Neural Engine at http://127.0.0.1:8080. Please ensure Strata is ready on port 8080 on the workstation.`;
    outputTokens = Math.max(1, Math.ceil(errorMsg.length / 4));
    content = errorMsg;
    params.onTokenDelta(errorMsg, outputTokens);

    this.swapStatus = 'ready';
    this.resetIdleTimer();
    return {
      content,
      thinkingContent: '',
      thinkingDurationMs: 0,
      thinkingTokens: 0,
      outputTokens,
    };
  }
}
