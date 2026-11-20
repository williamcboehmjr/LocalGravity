import fs from 'node:fs';
import path from 'node:path';
import type { ModelTier, ThinkingBudget } from '../db/database.js';
import {
  InferenceError,
  type InferenceErrorCode,
  type InferenceCompletionParams,
  type InferenceCompletionResult,
  type InferenceUsage,
  type MalformedToolCallInfo,
} from '../core/inferenceBackend.js';

export type BrainProviderId = 'strata' | 'google_ai_studio';

export type GoogleOrchestratorPlanner = 'neon' | 'carbon' | 'argon';
export type GoogleOrchestratorExecutor = 'hydrogen' | 'neon';
export type GooglePlannerChoice = 'neon' | 'carbon' | 'argon' | 'hydrogen';

export type GoogleModelId =
  | 'orchestrator-neon-hydrogen'
  | 'orchestrator-carbon-neon'
  | 'orchestrator-argon-hydrogen'
  | 'orchestrator-carbon-hydrogen'
  | 'gemini-4-neon'
  | 'gemini-4-hydrogen'
  | 'gemini-4-carbon'
  | 'gemini-4-argon'
  | 'gemini-3.8-flash';

export function isGoogleOrchestratorModel(id?: string | null): boolean {
  return (
    id === 'orchestrator' ||
    id === 'orchestrator-neon-hydrogen' ||
    id === 'orchestrator-carbon-neon' ||
    id === 'orchestrator-argon-hydrogen' ||
    id === 'orchestrator-carbon-hydrogen'
  );
}

export interface GoogleModelSpec {
  id: GoogleModelId;
  displayName: string;
  shortLabel: string;
  subtitle: string;
  apiModel: string;
  fallbackApiModels: string[];
  role: 'orchestrator' | 'execution' | 'planner' | 'fast';
}

export const GOOGLE_MODEL_SPECS: Record<GoogleModelId, GoogleModelSpec> = {
  'orchestrator-neon-hydrogen': {
    id: 'orchestrator-neon-hydrogen',
    displayName: 'Orchestrator (Neon → Hydrogen)',
    shortLabel: 'Orch: Neon → H',
    subtitle: 'Decisions API → Gemini 4 Neon Plan → Hydrogen Execute',
    apiModel: 'gemini-decision-1',
    fallbackApiModels: ['gemini-4-neon', 'gemini-4-hydrogen'],
    role: 'orchestrator',
  },
  'orchestrator-carbon-neon': {
    id: 'orchestrator-carbon-neon',
    displayName: 'Orchestrator (Carbon → Neon)',
    shortLabel: 'Orch: Carbon → Neon',
    subtitle: 'Decisions API → Gemini 4 Carbon Plan → Neon Execute',
    apiModel: 'gemini-decision-1',
    fallbackApiModels: ['gemini-4-carbon', 'gemini-4-neon'],
    role: 'orchestrator',
  },
  'orchestrator-argon-hydrogen': {
    id: 'orchestrator-argon-hydrogen',
    displayName: 'Orchestrator (Argon → Hydrogen)',
    shortLabel: 'Orch: Argon → H',
    subtitle: 'Decisions API → Gemini 4 Argon Plan → Hydrogen Execute',
    apiModel: 'gemini-decision-1',
    fallbackApiModels: ['gemini-4-argon', 'gemini-4-hydrogen'],
    role: 'orchestrator',
  },
  'orchestrator-carbon-hydrogen': {
    id: 'orchestrator-carbon-hydrogen',
    displayName: 'Orchestrator (Carbon → Hydrogen)',
    shortLabel: 'Orch: Carbon → H',
    subtitle: 'Decisions API → Gemini 4 Carbon Plan → Hydrogen Execute',
    apiModel: 'gemini-decision-1',
    fallbackApiModels: ['gemini-4-carbon', 'gemini-4-hydrogen'],
    role: 'orchestrator',
  },
  'gemini-4-neon': {
    id: 'gemini-4-neon',
    displayName: 'Gemini 4 Neon',
    shortLabel: 'Neon',
    subtitle: 'High-Efficiency Frontier Coding & Reasoning (1M • low..xhigh)',
    apiModel: 'gemini-4-neon',
    fallbackApiModels: ['gemini-4-neon-preview', 'gemini-4-argon', 'gemini-2.5-pro'],
    role: 'planner',
  },
  'gemini-4-hydrogen': {
    id: 'gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen',
    shortLabel: 'Hydrogen',
    subtitle: 'Fast Execution & Tool Coding Model',
    apiModel: 'gemini-4-hydrogen',
    fallbackApiModels: ['gemini-4-hydrogen-preview', 'gemini-2.5-flash'],
    role: 'execution',
  },
  'gemini-4-carbon': {
    id: 'gemini-4-carbon',
    displayName: 'Gemini 4 Carbon',
    shortLabel: 'Carbon',
    subtitle: 'Deepest Frontier Reasoning & Architecture Planner',
    apiModel: 'gemini-4-carbon',
    fallbackApiModels: ['gemini-4-carbon-preview', 'gemini-2.5-pro'],
    role: 'planner',
  },
  'gemini-4-argon': {
    id: 'gemini-4-argon',
    displayName: 'Gemini 4 Argon',
    shortLabel: 'Argon',
    subtitle: 'Balanced Frontier Planning & Reasoning',
    apiModel: 'gemini-4-argon',
    fallbackApiModels: ['gemini-4-argon-preview', 'gemini-2.5-pro'],
    role: 'planner',
  },
  'gemini-3.8-flash': {
    id: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    shortLabel: 'Flash 3.8',
    subtitle: 'Lightweight Fast Multimodal Flash',
    apiModel: 'gemini-3.8-flash',
    fallbackApiModels: ['gemini-3.8-flash-preview', 'gemini-2.5-flash'],
    role: 'fast',
  },
};

export interface BrainProviderConfig {
  provider: BrainProviderId;
  googleApiKey?: string;
  selectedGoogleModel: GoogleModelId;
}

export interface BrainProviderPublicConfig {
  provider: BrainProviderId;
  selectedGoogleModel: GoogleModelId;
  hasApiKey: boolean;
  maskedApiKey: string;
  activeDisplayName: string;
  models: GoogleModelSpec[];
}

export interface StreamCompletionParams extends InferenceCompletionParams {
  googleModelOverride?: GoogleModelId | string;
}

export type StreamCompletionResult = InferenceCompletionResult;

export interface GoogleAiEngineOptions {
  requestTimeoutMs?: number;
  streamStallTimeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
}

export interface OrchestratorDecision {
  needsPlanning: boolean;
  needsPlanningScore: number;
  plannerChoice: GooglePlannerChoice;
  confidence: number;
  source: 'decisions_api' | 'heuristic_fallback';
  reason: string;
}

const VALID_GOOGLE_MODELS = new Set<GoogleModelId>([
  'orchestrator-neon-hydrogen',
  'orchestrator-carbon-neon',
  'orchestrator-argon-hydrogen',
  'orchestrator-carbon-hydrogen',
  'gemini-4-neon',
  'gemini-4-hydrogen',
  'gemini-4-carbon',
  'gemini-4-argon',
  'gemini-3.8-flash',
]);

export function normalizeGoogleModelId(raw?: string | null): GoogleModelId {
  if (raw && VALID_GOOGLE_MODELS.has(raw as GoogleModelId)) {
    return raw as GoogleModelId;
  }
  const lower = String(raw || '').toLowerCase().trim();
  if (lower === 'orchestrator') return 'orchestrator-argon-hydrogen';
  if (lower.includes('orchestrator')) {
    if (lower.includes('carbon') && lower.includes('neon')) return 'orchestrator-carbon-neon';
    if (lower.includes('neon')) return 'orchestrator-neon-hydrogen';
    if (lower.includes('carbon')) return 'orchestrator-carbon-hydrogen';
    return 'orchestrator-argon-hydrogen';
  }
  if (lower.includes('neon')) return 'gemini-4-neon';
  if (lower.includes('carbon')) return 'gemini-4-carbon';
  if (lower.includes('argon')) return 'gemini-4-argon';
  if (lower.includes('hydrogen')) return 'gemini-4-hydrogen';
  if (lower.includes('3.8') || lower.includes('flash')) return 'gemini-3.8-flash';
  return 'orchestrator-argon-hydrogen';
}

export function maskApiKey(key: string): string {
  const clean = key.trim();
  if (!clean) return '';
  if (clean.length <= 8) return `${clean.slice(0, 2)}••••`;
  return `${clean.slice(0, 6)}••••••${clean.slice(-4)}`;
}

const MAX_SIG_CACHE_SIZE = 500;

export class GoogleAiEngine {
  private repoRoot: string;
  private configPath: string;
  private config: BrainProviderConfig;
  private lastTokensPerSec = 0;
  private thoughtSignatureCache = new Map<string, any>();
  private requestTimeoutMs: number;
  private streamStallTimeoutMs: number;
  private maxRetries: number;
  private baseBackoffMs: number;

  constructor(repoRoot: string, options?: GoogleAiEngineOptions) {
    this.repoRoot = repoRoot;
    this.configPath = path.join(this.repoRoot, '.runtime', 'brain-provider.json');
    this.config = this.loadConfig();
    this.requestTimeoutMs =
      options?.requestTimeoutMs ?? Number(process.env.LG_GOOGLE_REQUEST_TIMEOUT_MS || 45_000);
    this.streamStallTimeoutMs =
      options?.streamStallTimeoutMs ?? Number(process.env.LG_GOOGLE_STREAM_STALL_TIMEOUT_MS || 45_000);
    this.maxRetries = options?.maxRetries ?? Number(process.env.LG_GOOGLE_MAX_RETRIES || 2);
    this.baseBackoffMs = options?.baseBackoffMs ?? Number(process.env.LG_GOOGLE_BASE_BACKOFF_MS || 500);
  }

  private loadConfig(): BrainProviderConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        const provider: BrainProviderId =
          parsed?.provider === 'google_ai_studio' ? 'google_ai_studio' : 'strata';
        const selectedGoogleModel = normalizeGoogleModelId(parsed?.selectedGoogleModel);
        return {
          provider,
          googleApiKey: typeof parsed?.googleApiKey === 'string' ? parsed.googleApiKey.trim() : '',
          selectedGoogleModel,
        };
      }
    } catch (err) {
      console.warn('[GoogleAiEngine] Failed to load brain-provider.json, using defaults:', err);
    }
    return {
      provider: 'strata',
      googleApiKey: '',
      selectedGoogleModel: 'orchestrator-argon-hydrogen',
    };
  }

  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      console.error('[GoogleAiEngine] Failed to persist brain-provider.json:', err);
    }
  }

  public getProvider(): BrainProviderId {
    return this.config.provider;
  }

  public getSelectedModel(): GoogleModelId {
    return this.config.selectedGoogleModel;
  }

  public getApiKey(): string {
    return (
      this.config.googleApiKey?.trim() ||
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      ''
    );
  }

  public getActiveDisplayName(): string {
    const spec =
      GOOGLE_MODEL_SPECS[this.config.selectedGoogleModel] ||
      GOOGLE_MODEL_SPECS['orchestrator-argon-hydrogen'];
    return spec.displayName;
  }

  public getLastTokensPerSec(): number {
    return this.lastTokensPerSec;
  }

  public getConfig(): BrainProviderConfig {
    return { ...this.config };
  }

  public getPublicConfig(): BrainProviderPublicConfig {
    const effectiveKey = this.getApiKey();
    return {
      provider: this.config.provider,
      selectedGoogleModel: this.config.selectedGoogleModel,
      hasApiKey: effectiveKey.length > 0,
      maskedApiKey: effectiveKey ? maskApiKey(effectiveKey) : '',
      activeDisplayName: this.getActiveDisplayName(),
      models: Object.values(GOOGLE_MODEL_SPECS),
    };
  }

  public updateConfig(update: Partial<BrainProviderConfig>): BrainProviderPublicConfig {
    if (update.provider === 'strata' || update.provider === 'google_ai_studio') {
      this.config.provider = update.provider;
    }
    if (typeof update.googleApiKey === 'string') {
      const trimmed = update.googleApiKey.trim();
      // Ignore masked values sent accidentally from client inputs
      if (!trimmed.includes('••••••')) {
        this.config.googleApiKey = trimmed;
      }
    }
    if (update.selectedGoogleModel) {
      this.config.selectedGoogleModel = normalizeGoogleModelId(update.selectedGoogleModel);
    }
    this.saveConfig();
    return this.getPublicConfig();
  }

  private extractLatestUserText(messages: StreamCompletionParams['messages']): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'user') continue;
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text)
          .join('\n');
      }
    }
    return '';
  }

  private formatGemini4Label(name: GooglePlannerChoice): string {
    return `Gemini 4 ${name.charAt(0).toUpperCase() + name.slice(1)}`;
  }

  /**
   * Calls the Google Gemini Decisions API (`gemini-decision-1`) to determine whether
   * a turn requires planning before executing on the target executor (`hydrogen` or `neon`),
   * using the selected orchestrator planner (`neon`, `argon`, or `carbon`).
   */
  public async evaluateOrchestratorDecision(
    promptText: string,
    abortSignal?: AbortSignal,
    targetPlanner: GoogleOrchestratorPlanner = 'argon',
    targetExecutor: GoogleOrchestratorExecutor = 'hydrogen'
  ): Promise<OrchestratorDecision> {
    const apiKey = this.getApiKey();
    const cleanedInput = (promptText || '').trim().slice(0, 3500) || 'General assistant turn';
    const plannerDisplayName = this.formatGemini4Label(targetPlanner);
    const executorDisplayName = this.formatGemini4Label(targetExecutor);
    const plannerCriteriaDescription =
      targetPlanner === 'carbon'
        ? 'Any task requiring planning, investigation, architecture, multi-step reasoning, tool orchestration, or code generation using Gemini 4 Carbon.'
        : targetPlanner === 'neon'
          ? 'Any task requiring planning, investigation, complex coding, multi-step reasoning, tool orchestration, or science analysis using Gemini 4 Neon.'
          : 'Any task requiring planning, investigation, feature implementation, multi-step reasoning, tool orchestration, or code generation using Gemini 4 Argon.';

    if (apiKey) {
      try {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/decisions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            model: 'gemini-decision-1',
            input: cleanedInput,
            questions: {
              needs_planning: {
                type: 'noul',
                instructions:
                  'Does this request require architectural planning, multi-step investigation, code design, or tool orchestration before final execution?',
              },
              planner_model: {
                type: 'choice',
                instructions: `Decide whether this request needs a planning phase on ${plannerDisplayName} or can go straight to ${executorDisplayName}.`,
                criteria: {
                  [targetPlanner]: plannerCriteriaDescription,
                  [targetExecutor]:
                    `Simple greeting, trivial one-line question, or direct single lookup that can go straight to ${executorDisplayName} without a separate planning pass.`,
                },
              },
            },
          }),
          signal: abortSignal
            ? AbortSignal.any([abortSignal, AbortSignal.timeout(8000)])
            : AbortSignal.timeout(8000),
        });

        if (res.ok) {
          const data: any = await res.json();
          const needsScore = Number(data?.answers?.needs_planning?.noul ?? 0.7);
          const rawChoice = String(data?.answers?.planner_model?.choice || targetPlanner).toLowerCase();
          const confidence = Number(data?.answers?.planner_model?.confidence ?? 0.8);
          const needsPlanning = rawChoice !== targetExecutor && needsScore >= 0.3;
          const plannerChoice: GooglePlannerChoice = needsPlanning
            ? targetPlanner
            : targetExecutor;

          return {
            needsPlanning,
            needsPlanningScore: needsScore,
            plannerChoice,
            confidence,
            source: 'decisions_api',
            reason: `gemini-decision-1 selected ${plannerChoice.toUpperCase()} (needs_planning=${(needsScore * 100).toFixed(0)}%, confidence=${(confidence * 100).toFixed(0)}%)`,
          };
        } else {
          const errTxt = await res.text().catch(() => '');
          console.warn(
            `[GoogleAiEngine] Decisions API HTTP ${res.status}: ${errTxt.slice(0, 220)}. Using deterministic classifier fallback.`
          );
        }
      } catch (err: any) {
        if (abortSignal?.aborted || err?.name === 'AbortError') throw err;
        console.warn('[GoogleAiEngine] Decisions API unavailable, using deterministic classifier fallback:', err?.message);
      }
    }

    return this.heuristicOrchestratorDecision(cleanedInput, targetPlanner, targetExecutor);
  }

  private heuristicOrchestratorDecision(
    promptText: string,
    targetPlanner: GoogleOrchestratorPlanner = 'argon',
    targetExecutor: GoogleOrchestratorExecutor = 'hydrogen'
  ): OrchestratorDecision {
    const trimmed = promptText.trim();
    const executorDisplayName = this.formatGemini4Label(targetExecutor);

    const isGreetingOrTrivial =
      trimmed.length < 28 &&
      /^(hi|hello|hey|yo|sup|ping|test|status|thanks|thank you|ok|okay|yes|no)[\s!?.]*$/i.test(trimmed);

    if (isGreetingOrTrivial) {
      return {
        needsPlanning: false,
        needsPlanningScore: 0.12,
        plannerChoice: targetExecutor,
        confidence: 0.91,
        source: 'heuristic_fallback',
        reason: `Trivial conversational prompt routed directly to ${executorDisplayName}.`,
      };
    }

    if (targetPlanner === 'carbon') {
      return {
        needsPlanning: true,
        needsPlanningScore: 0.92,
        plannerChoice: 'carbon',
        confidence: 0.88,
        source: 'heuristic_fallback',
        reason: `Task routed to Gemini 4 Carbon for planning, then ${executorDisplayName} for execution.`,
      };
    }

    if (targetPlanner === 'neon') {
      return {
        needsPlanning: true,
        needsPlanningScore: 0.86,
        plannerChoice: 'neon',
        confidence: 0.87,
        source: 'heuristic_fallback',
        reason: `Task routed to Gemini 4 Neon for planning, then ${executorDisplayName} for execution.`,
      };
    }

    return {
      needsPlanning: true,
      needsPlanningScore: 0.78,
      plannerChoice: 'argon',
      confidence: 0.85,
      source: 'heuristic_fallback',
      reason: `Task routed to Gemini 4 Argon for planning, then ${executorDisplayName} for execution.`,
    };
  }

  private stableStringify(val: unknown): string {
    if (val === null || val === undefined) return 'null';
    if (typeof val !== 'object') return JSON.stringify(val);
    if (Array.isArray(val)) {
      return `[${val.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${this.stableStringify(v)}`);
    }
    return `{${parts.join(',')}}`;
  }

  private mergeExtraContent(existing: any, incoming: any): any {
    if (!existing || typeof existing !== 'object') {
      if (!incoming || typeof incoming !== 'object') return incoming;
      return {
        ...incoming,
        ...(incoming.google && typeof incoming.google === 'object' ? { google: { ...incoming.google } } : {}),
      };
    }
    if (!incoming || typeof incoming !== 'object') {
      return {
        ...existing,
        ...(existing.google && typeof existing.google === 'object' ? { google: { ...existing.google } } : {}),
      };
    }
    const merged: Record<string, any> = { ...existing, ...incoming };
    if (
      (existing.google && typeof existing.google === 'object') ||
      (incoming.google && typeof incoming.google === 'object')
    ) {
      merged.google = {
        ...(existing.google && typeof existing.google === 'object' ? existing.google : {}),
        ...(incoming.google && typeof incoming.google === 'object' ? incoming.google : {}),
      };
    }
    return merged;
  }

  private makeSignatureKey(name: string, args: unknown): string {
    let canonical = '{}';
    if (typeof args === 'string') {
      const parsed = this.tryParseToolCallArgs(args);
      if (parsed.ok) {
        canonical = this.stableStringify(parsed.args);
      } else {
        try {
          canonical = this.stableStringify(JSON.parse(args));
        } catch {
          canonical = args.trim() || '{}';
        }
      }
    } else if (args && typeof args === 'object') {
      canonical = this.stableStringify(args);
    }
    return `${name}::${canonical}`;
  }

  private setSignatureLru(key: string, extraContent: any): void {
    if (this.thoughtSignatureCache.has(key)) {
      this.thoughtSignatureCache.delete(key);
    }
    this.thoughtSignatureCache.set(key, extraContent);
    while (this.thoughtSignatureCache.size > MAX_SIG_CACHE_SIZE) {
      const oldestKey = this.thoughtSignatureCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.thoughtSignatureCache.delete(oldestKey);
    }
  }

  private getSignatureLru(key: string): any | undefined {
    if (!this.thoughtSignatureCache.has(key)) return undefined;
    const val = this.thoughtSignatureCache.get(key);
    this.thoughtSignatureCache.delete(key);
    this.thoughtSignatureCache.set(key, val);
    return val;
  }

  private recordThoughtSignature(opts: {
    id?: string;
    canonicalName: string;
    sanitizedName?: string;
    args: unknown;
    extraContent: any;
  }): void {
    if (!opts.extraContent?.google?.thought_signature) return;
    if (opts.id) {
      this.setSignatureLru(`id::${opts.id}`, opts.extraContent);
    }
    this.setSignatureLru(`sig::${this.makeSignatureKey(opts.canonicalName, opts.args)}`, opts.extraContent);
    if (opts.sanitizedName && opts.sanitizedName !== opts.canonicalName) {
      this.setSignatureLru(`sig::${this.makeSignatureKey(opts.sanitizedName, opts.args)}`, opts.extraContent);
    }
  }

  private lookupThoughtSignature(id: string | undefined, name: string, args: unknown): any | undefined {
    if (id) {
      const byId = this.getSignatureLru(`id::${id}`);
      if (byId) return byId;
    }
    return this.getSignatureLru(`sig::${this.makeSignatureKey(name, args)}`);
  }

  private toOpenAiMessages(
    messages: StreamCompletionParams['messages']
  ): Array<Record<string, any>> {
    return messages.map((m, msgIdx) => {
      const role = msgIdx > 0 && m.role === 'system' ? 'user' : m.role;
      const base: Record<string, any> = {
        role,
        content: m.content ?? '',
      };
      if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        let hasAnySignature = false;
        const mappedToolCalls = m.tool_calls.map((tc: any) => {
          const cloned = { ...tc };
          const cachedExtra = cloned.extra_content?.google?.thought_signature
            ? cloned.extra_content
            : this.lookupThoughtSignature(cloned.id, cloned.function?.name || '', cloned.function?.arguments);
          if (cachedExtra?.google?.thought_signature) {
            cloned.extra_content = this.mergeExtraContent(cloned.extra_content, cachedExtra);
            hasAnySignature = true;
          }
          return cloned;
        });
        if (!hasAnySignature && mappedToolCalls.length > 0) {
          mappedToolCalls[0] = {
            ...mappedToolCalls[0],
            extra_content: this.mergeExtraContent(mappedToolCalls[0].extra_content, {
              google: {
                thought_signature: 'context_engineering_is_the_way_to_go',
              },
            }),
          };
        }
        base.tool_calls = mappedToolCalls;
        if (!base.content) base.content = '';
      }
      if (role === 'tool') {
        base.tool_call_id = m.tool_call_id || `call_${Date.now()}`;
        if (m.name) base.name = m.name;
        base.content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      }
      return base;
    });
  }

  private budgetToReasoningEffort(
    budget: ThinkingBudget,
    modelId: GoogleModelId
  ): 'low' | 'medium' | 'high' | 'xhigh' {
    if (budget === 'xhigh') {
      return modelId === 'gemini-4-hydrogen' || modelId === 'gemini-4-neon' ? 'xhigh' : 'high';
    }
    if (budget === 'high' || budget === 'deep') return 'high';
    if (budget === 'medium') return 'medium';
    if (budget === 'low' || budget === 'fast' || budget === 'off') return 'low';
    return 'medium';
  }

  public resolveSwarmWorkerModel(
    memberName: string,
    requestedModel?: string
  ): { modelId: GoogleModelId; thinkingBudget: ThinkingBudget } {
    const req = String(requestedModel || '').toLowerCase().trim();
    if (req && req !== 'strata-high' && req !== 'default' && !req.startsWith('swift')) {
      const explicit = normalizeGoogleModelId(req);
      if (!isGoogleOrchestratorModel(explicit)) {
        return {
          modelId: explicit,
          thinkingBudget:
            explicit === 'gemini-3.8-flash'
              ? 'low'
              : explicit === 'gemini-4-carbon' || explicit === 'gemini-4-neon'
                ? 'high'
                : 'medium',
        };
      }
    }

    const lower = memberName.toLowerCase();
    if (lower === 'monitor' || /(monitor|verifier|verify|review|audit|check)/.test(lower)) {
      return { modelId: 'gemini-3.8-flash', thinkingBudget: 'low' };
    }
    if (lower === 'coordinator' || /(architect|planner|plan)/.test(lower)) {
      return { modelId: 'gemini-4-argon', thinkingBudget: 'medium' };
    }
    return { modelId: 'gemini-4-hydrogen', thinkingBudget: 'medium' };
  }

  private resolveOrchestratorConfig(selectedModel: GoogleModelId): {
    planner: GoogleOrchestratorPlanner;
    plannerModelId: GoogleModelId;
    executor: GoogleOrchestratorExecutor;
    executorModelId: GoogleModelId;
    modeLabel: string;
  } {
    switch (selectedModel) {
      case 'orchestrator-neon-hydrogen':
        return {
          planner: 'neon',
          plannerModelId: 'gemini-4-neon',
          executor: 'hydrogen',
          executorModelId: 'gemini-4-hydrogen',
          modeLabel: 'Neon → Hydrogen',
        };
      case 'orchestrator-carbon-neon':
        return {
          planner: 'carbon',
          plannerModelId: 'gemini-4-carbon',
          executor: 'neon',
          executorModelId: 'gemini-4-neon',
          modeLabel: 'Carbon → Neon',
        };
      case 'orchestrator-carbon-hydrogen':
        return {
          planner: 'carbon',
          plannerModelId: 'gemini-4-carbon',
          executor: 'hydrogen',
          executorModelId: 'gemini-4-hydrogen',
          modeLabel: 'Carbon → Hydrogen',
        };
      default:
        return {
          planner: 'argon',
          plannerModelId: 'gemini-4-argon',
          executor: 'hydrogen',
          executorModelId: 'gemini-4-hydrogen',
          modeLabel: 'Argon → Hydrogen',
        };
    }
  }

  private resolvePlannerThinkingBudget(budget: ThinkingBudget): ThinkingBudget {
    if (budget === 'off') return 'off';
    if (budget === 'fast' || budget === 'low') return 'medium';
    return budget;
  }

  private resolveExecutorThinkingBudget(
    budget: ThinkingBudget,
    _phase: 'direct' | 'post_plan' | 'followup',
    hadToolError: boolean
  ): ThinkingBudget {
    if (budget === 'off') return 'off';
    if (_phase === 'direct') return 'low';
    return hadToolError ? 'medium' : 'low';
  }

  private combineUsage(a?: InferenceUsage, b?: InferenceUsage): InferenceUsage | undefined {
    if (!a && !b) return undefined;
    const promptTokens = (a?.promptTokens ?? 0) + (b?.promptTokens ?? 0);
    const completionTokens = (a?.completionTokens ?? 0) + (b?.completionTokens ?? 0);
    const totalTokens =
      a?.totalTokens !== undefined || b?.totalTokens !== undefined
        ? (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0)
        : promptTokens + completionTokens;
    const thinkingTokens =
      a?.thinkingTokens !== undefined || b?.thinkingTokens !== undefined
        ? (a?.thinkingTokens ?? 0) + (b?.thinkingTokens ?? 0)
        : undefined;
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      ...(thinkingTokens !== undefined ? { thinkingTokens } : {}),
    };
  }

  public async streamChatCompletion(params: StreamCompletionParams): Promise<StreamCompletionResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new InferenceError(
        'Google AI Studio is selected as the Brain Provider, but no API key is configured. Open Settings -> Brain Inference Provider, paste your Google AI Studio API key (AIza...), and save.',
        {
          code: 'AUTH_MISSING',
          status: 401,
          retryable: false,
          provider: 'google_ai_studio',
        }
      );
    }

    const selectedModel = params.googleModelOverride
      ? normalizeGoogleModelId(params.googleModelOverride)
      : this.config.selectedGoogleModel;
    if (!isGoogleOrchestratorModel(selectedModel)) {
      return this.streamSingleModelCall(selectedModel, params, apiKey);
    }

    const orchConfig = this.resolveOrchestratorConfig(selectedModel);
    const executorModelId = orchConfig.executorModelId;
    const executorLabel = GOOGLE_MODEL_SPECS[executorModelId].displayName;

    // ==================== ORCHESTRATOR MODE ====================
    // 1. Step 1: Google Decisions API decides whether to plan on targetPlanner (Neon, Argon, or Carbon)
    //    or execute directly on targetExecutor (Hydrogen or Neon).
    // 2. If planning needed: targetPlanner produces the execution plan (streamed into Thinking),
    //    then Orchestrator automatically flips to targetExecutor to execute the plan!
    // 3. Step 2+: Execution continues on targetExecutor.
    const stepIndex = params.stepIndex ?? 1;
    let totalThinkingContent = '';
    let totalThinkingTokens = 0;
    const turnStart = Date.now();

    const emitThought = (chunk: string) => {
      if (params.thinkingBudget === 'off' || !chunk) return;
      totalThinkingContent += chunk;
      totalThinkingTokens += Math.max(1, Math.ceil(chunk.length / 4));
      params.onThoughtDelta(chunk, Date.now() - turnStart, totalThinkingTokens);
    };

    if (stepIndex > 1) {
      emitThought(`[Orchestrator → ${executorLabel} Executing Step ${stepIndex}]\n`);
      const execRes = await this.streamSingleModelCall(
        executorModelId,
        {
          ...params,
          thinkingBudget: this.resolveExecutorThinkingBudget(
            params.thinkingBudget,
            'followup',
            Boolean(params.hadToolError)
          ),
          onThoughtDelta: (delta) => {
            emitThought(delta);
          },
        },
        apiKey
      );
      return {
        ...execRes,
        thinkingContent: totalThinkingContent.trim(),
        thinkingTokens: totalThinkingTokens,
        thinkingDurationMs: Date.now() - turnStart,
      };
    }

    const latestUserPrompt = this.extractLatestUserText(params.messages);
    let decision: OrchestratorDecision;
    try {
      decision = await this.evaluateOrchestratorDecision(
        latestUserPrompt,
        params.abortSignal,
        orchConfig.planner,
        orchConfig.executor
      );
    } catch (err: any) {
      if (params.abortSignal?.aborted || err?.name === 'AbortError') {
        throw new InferenceError('Google AI Studio request aborted by caller', {
          code: 'ABORTED',
          retryable: false,
          provider: 'google_ai_studio',
          cause: err,
        });
      }
      throw err;
    }

    const sourceBadge =
      decision.source === 'decisions_api'
        ? `Google Decisions API (gemini-decision-1 • ${orchConfig.modeLabel})`
        : `Decisions Classifier Fallback (${orchConfig.modeLabel})`;

    emitThought(
      `[${sourceBadge}]\n` +
        `• Needs Planning: ${(decision.needsPlanningScore * 100).toFixed(0)}%\n` +
        `• Planner Selected: ${this.formatGemini4Label(decision.plannerChoice)} (${(decision.confidence * 100).toFixed(0)}% conf)\n` +
        `• Execution Model: ${executorLabel}\n\n`
    );

    if (!decision.needsPlanning || decision.plannerChoice === orchConfig.executor) {
      emitThought(`[Orchestrator → Direct Execution on ${executorLabel}]\n`);
      const directRes = await this.streamSingleModelCall(
        executorModelId,
        {
          ...params,
          thinkingBudget: this.resolveExecutorThinkingBudget(
            params.thinkingBudget,
            'direct',
            Boolean(params.hadToolError)
          ),
          onThoughtDelta: (delta) => {
            emitThought(delta);
          },
        },
        apiKey
      );
      return {
        ...directRes,
        thinkingContent: totalThinkingContent.trim(),
        thinkingTokens: totalThinkingTokens,
        thinkingDurationMs: Date.now() - turnStart,
      };
    }

    // Phase 1: Planning on Gemini 4 Neon, Gemini 4 Argon, or Gemini 4 Carbon
    const plannerModelId: GoogleModelId =
      decision.plannerChoice === 'carbon'
        ? 'gemini-4-carbon'
        : decision.plannerChoice === 'neon'
          ? 'gemini-4-neon'
          : 'gemini-4-argon';
    const plannerLabel = GOOGLE_MODEL_SPECS[plannerModelId].displayName;

    emitThought(`[${plannerLabel} • Formulating Plan...]\n`);

    const plannerMessages = [
      ...params.messages,
      {
        role: 'system',
        content:
          `[ORCHESTRATOR PLANNING PHASE — ${plannerLabel.toUpperCase()}]:\n` +
          `Analyze the user's request and context above, and write a concise, concrete, numbered execution plan for ${executorLabel} to execute. ` +
          `Specify exact files, commands, tools, checks, and edge cases. Do NOT ask the user questions unless impossible to proceed; produce the plan directly so ${this.formatGemini4Label(orchConfig.executor).replace('Gemini 4 ', '')} can execute immediately.`,
      },
    ];

    let planText = '';
    const plannerResult = await this.streamSingleModelCall(
      plannerModelId,
      {
        ...params,
        thinkingBudget: this.resolvePlannerThinkingBudget(params.thinkingBudget),
        tools: undefined, // Planning phase outputs the plan without calling tools directly
        messages: plannerMessages,
        onThoughtDelta: (delta) => {
          emitThought(delta);
        },
        onTokenDelta: (delta) => {
          // Stream the planner's textual plan into the collapsible Thinking section cleanly
          planText += delta;
          emitThought(delta);
        },
        onToolCallRequest: undefined,
        onToolCallPreparing: undefined,
      },
      apiKey
    );

    if (params.abortSignal?.aborted) {
      throw new InferenceError('Google AI Studio request aborted by caller', {
        code: 'ABORTED',
        retryable: false,
        provider: 'google_ai_studio',
      });
    }

    const effectivePlan = (planText || plannerResult.content || '').trim();
    emitThought(
      `\n\n[Orchestrator Hand-off → Flipping to ${executorLabel} for Plan Execution]\n`
    );

    // Phase 2: Execute the plan on the selected execution model with full tool belt
    const executionMessages = [
      ...params.messages,
      {
        role: 'system',
        content:
          `[ORCHESTRATOR EXECUTION HAND-OFF — ${executorLabel.toUpperCase()}]:\n` +
          `${plannerLabel} produced the following approved execution plan. Execute it now using your available tools (or respond directly if no tools are needed):\n\n` +
          `${effectivePlan || 'Proceed directly with implementing the user request accurately and verifying the result.'}`,
      },
    ];

    const executorResult = await this.streamSingleModelCall(
      executorModelId,
      {
        ...params,
        thinkingBudget: this.resolveExecutorThinkingBudget(
          params.thinkingBudget,
          'post_plan',
          Boolean(params.hadToolError)
        ),
        messages: executionMessages,
        onThoughtDelta: (delta) => {
          emitThought(delta);
        },
      },
      apiKey
    );

    return {
      content: executorResult.content,
      thinkingContent: totalThinkingContent.trim(),
      thinkingDurationMs: Date.now() - turnStart,
      thinkingTokens: totalThinkingTokens,
      outputTokens: executorResult.outputTokens,
      finishReason: executorResult.finishReason,
      usage: this.combineUsage(plannerResult.usage, executorResult.usage),
      ...(executorResult.malformedToolCalls?.length
        ? { malformedToolCalls: executorResult.malformedToolCalls }
        : {}),
    };
  }

  private sanitizeJsonSchemaForGoogle(schema: any): any {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return { type: 'object', properties: {} };
    }
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === '$schema' || k === '$id' || k === '$defs' || k === 'definitions') continue;
      if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
        const cleanProps: Record<string, any> = {};
        for (const [pk, pv] of Object.entries(v)) {
          cleanProps[pk] =
            pv && typeof pv === 'object' ? this.sanitizeJsonSchemaForGoogle(pv) : pv;
        }
        out.properties = cleanProps;
      } else if (k === 'items' && v && typeof v === 'object') {
        out.items = Array.isArray(v)
          ? v.map((item) => this.sanitizeJsonSchemaForGoogle(item))
          : this.sanitizeJsonSchemaForGoogle(v);
      } else {
        out[k] = v;
      }
    }
    if (!out.type && out.properties) out.type = 'object';
    if (Array.isArray(out.required) && out.properties && typeof out.properties === 'object') {
      out.required = out.required.filter((reqKey: any) =>
        Object.prototype.hasOwnProperty.call(out.properties, String(reqKey))
      );
    }
    return out;
  }

  private sanitizeToolsForGoogle(tools?: any[]): {
    tools?: any[];
    nameMap: Map<string, string>;
  } {
    const nameMap = new Map<string, string>();
    if (!Array.isArray(tools) || tools.length === 0) {
      return { tools: undefined, nameMap };
    }

    const usedNames = new Set<string>();
    const sanitized = tools
      .filter((t) => t?.function?.name)
      .map((t) => {
        const originalName = String(t.function.name);
        let safeName = originalName.replace(/[^a-zA-Z0-9_.-]/g, '_');
        if (!/^[a-zA-Z_]/.test(safeName)) safeName = `t_${safeName}`;
        if (safeName.length > 64) {
          let hash = 0;
          for (let i = 0; i < originalName.length; i += 1) {
            hash = (hash * 31 + originalName.charCodeAt(i)) >>> 0;
          }
          const suffix = `_${hash.toString(36).slice(0, 6)}`;
          safeName = `${safeName.slice(0, 64 - suffix.length)}${suffix}`;
        }
        let uniqueName = safeName;
        let counter = 2;
        while (usedNames.has(uniqueName)) {
          const suffix = `_${counter++}`;
          uniqueName = `${safeName.slice(0, 64 - suffix.length)}${suffix}`;
        }
        usedNames.add(uniqueName);
        nameMap.set(uniqueName, originalName);

        return {
          type: 'function',
          function: {
            name: uniqueName,
            description: String(t.function.description || '').slice(0, 1024),
            parameters: this.sanitizeJsonSchemaForGoogle(t.function.parameters),
          },
        };
      });

    return { tools: sanitized.length > 0 ? sanitized : undefined, nameMap };
  }

  private tryParseToolCallArgs(
    rawArgs: string
  ): { ok: true; args: Record<string, any> } | { ok: false; error: string } {
    const trimmed = String(rawArgs ?? '').trim();
    if (!trimmed) {
      return { ok: true, args: {} };
    }

    const asPlainObject = (val: unknown): Record<string, any> | null => {
      let cur = val;
      if (typeof cur === 'string') {
        try {
          cur = JSON.parse(cur);
        } catch {
          return null;
        }
      }
      if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
        return cur as Record<string, any>;
      }
      return null;
    };

    try {
      const parsed = asPlainObject(JSON.parse(trimmed));
      if (parsed) return { ok: true, args: parsed };
    } catch {}

    // Safe repair pass (no eval, no auto-closing truncated JSON):
    // 1. Strip markdown code fences
    let repaired = trimmed
      .replace(/^```(?:json)?\s*\r?\n?/i, '')
      .replace(/\r?\n?```\s*$/i, '')
      .trim();

    try {
      const parsed = asPlainObject(JSON.parse(repaired));
      if (parsed) return { ok: true, args: parsed };
    } catch {}

    // 2. Escape raw control chars inside strings and strip trailing commas outside strings
    const sanitizeJsonText = (input: string): string => {
      let out = '';
      let inStr = false;
      let escaped = false;
      for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (inStr) {
          if (escaped) {
            out += ch;
            escaped = false;
          } else if (ch === '\\') {
            out += ch;
            escaped = true;
          } else if (ch === '"') {
            out += ch;
            inStr = false;
          } else if (ch === '\n') {
            out += '\\n';
          } else if (ch === '\r') {
            out += '\\r';
          } else if (ch === '\t') {
            out += '\\t';
          } else {
            out += ch;
          }
        } else {
          if (ch === '"') {
            out += ch;
            inStr = true;
          } else if (ch === ',') {
            let j = i + 1;
            while (j < input.length && /\s/.test(input[j])) j += 1;
            if (j < input.length && (input[j] === '}' || input[j] === ']')) {
              continue;
            }
            out += ch;
          } else {
            out += ch;
          }
        }
      }
      return out;
    };

    repaired = sanitizeJsonText(repaired);
    try {
      const parsed = asPlainObject(JSON.parse(repaired));
      if (parsed) return { ok: true, args: parsed };
    } catch {}

    // 3. Extract first complete balanced {...} object if surrounded by prose
    const firstBrace = repaired.indexOf('{');
    if (firstBrace >= 0) {
      let depth = 0;
      let inStr = false;
      let escaped = false;
      let endIdx = -1;
      for (let i = firstBrace; i < repaired.length; i += 1) {
        const ch = repaired[i];
        if (inStr) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            inStr = false;
          }
        } else {
          if (ch === '"') {
            inStr = true;
          } else if (ch === '{') {
            depth += 1;
          } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
              endIdx = i;
              break;
            }
          }
        }
      }
      if (endIdx > firstBrace) {
        const candidateObj = sanitizeJsonText(repaired.slice(firstBrace, endIdx + 1));
        try {
          const parsed = asPlainObject(JSON.parse(candidateObj));
          if (parsed) return { ok: true, args: parsed };
        } catch {}
      }
    }

    try {
      JSON.parse(trimmed);
      return { ok: false, error: 'Tool call arguments must be a JSON object' };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Malformed JSON arguments' };
    }
  }

  private parseRetryAfterMs(headerVal: string | null): number | undefined {
    if (!headerVal) return undefined;
    const trimmed = headerVal.trim();
    if (!trimmed) return undefined;
    const numSec = Number(trimmed);
    if (Number.isFinite(numSec)) {
      return Math.max(0, Math.min(60_000, Math.round(numSec * 1000)));
    }
    const parsedDate = Date.parse(trimmed);
    if (Number.isFinite(parsedDate)) {
      return Math.max(0, Math.min(60_000, parsedDate - Date.now()));
    }
    return undefined;
  }

  private computeBackoffMs(attempt: number, retryAfterMs?: number): number {
    const exp = Math.min(15_000, this.baseBackoffMs * Math.pow(2, attempt));
    const jittered = Math.round(exp * (0.5 + Math.random() * 0.5));
    if (retryAfterMs !== undefined) {
      return Math.min(60_000, Math.max(retryAfterMs, jittered));
    }
    return jittered;
  }

  private sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(
        new InferenceError('Google AI Studio request aborted by caller', {
          code: 'ABORTED',
          retryable: false,
          provider: 'google_ai_studio',
        })
      );
    }
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(
          new InferenceError('Google AI Studio request aborted by caller', {
            code: 'ABORTED',
            retryable: false,
            provider: 'google_ai_studio',
          })
        );
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async streamSingleModelCall(
    modelId: GoogleModelId,
    params: StreamCompletionParams,
    apiKey: string
  ): Promise<StreamCompletionResult> {
    const spec = GOOGLE_MODEL_SPECS[modelId] || GOOGLE_MODEL_SPECS['gemini-4-hydrogen'];
    const candidates = [spec.apiModel, ...spec.fallbackApiModels];
    const startTime = Date.now();
    const reasoningEffort = this.budgetToReasoningEffort(params.thinkingBudget, modelId);
    const openAiMessages = this.toOpenAiMessages(params.messages);
    const { tools: googleTools, nameMap: toolNameMap } = this.sanitizeToolsForGoogle(params.tools);

    let lastError: InferenceError | null = null;

    for (const candidateModel of candidates) {
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        if (params.abortSignal?.aborted) {
          throw new InferenceError('Google AI Studio request aborted by caller', {
            code: 'ABORTED',
            retryable: false,
            provider: 'google_ai_studio',
          });
        }

        const candidateEffort =
          reasoningEffort === 'xhigh' &&
          !candidateModel.startsWith('gemini-4-hydrogen') &&
          !candidateModel.startsWith('gemini-4-neon')
            ? 'high'
            : reasoningEffort;

        const bodyPayload: Record<string, any> = {
          model: candidateModel,
          messages: openAiMessages,
          stream: true,
          stream_options: { include_usage: true },
          temperature:
            params.thinkingBudget === 'deep' ||
            params.thinkingBudget === 'high' ||
            params.thinkingBudget === 'xhigh'
              ? 0.35
              : 0.6,
          ...(googleTools && googleTools.length > 0 ? { tools: googleTools, tool_choice: 'auto' } : {}),
          ...(candidateEffort ? { reasoning_effort: candidateEffort } : {}),
        };

        const attemptController = new AbortController();
        let abortReason: 'caller' | 'timeout' | 'stall' | null = null;
        const onCallerAbort = () => {
          abortReason = 'caller';
          attemptController.abort();
        };
        params.abortSignal?.addEventListener('abort', onCallerAbort, { once: true });

        let requestTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          abortReason = 'timeout';
          attemptController.abort();
        }, this.requestTimeoutMs);

        let response: Response;
        try {
          response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(bodyPayload),
              signal: attemptController.signal,
            }
          );
        } catch (fetchErr: any) {
          if (requestTimer) {
            clearTimeout(requestTimer);
            requestTimer = null;
          }
          params.abortSignal?.removeEventListener('abort', onCallerAbort);

          if (abortReason === 'caller' || params.abortSignal?.aborted) {
            throw new InferenceError('Google AI Studio request aborted by caller', {
              code: 'ABORTED',
              retryable: false,
              provider: 'google_ai_studio',
              cause: fetchErr,
            });
          }

          if (abortReason === 'timeout') {
            lastError = new InferenceError(
              `Google AI Studio request timed out after ${this.requestTimeoutMs}ms`,
              {
                code: 'TIMEOUT',
                retryable: true,
                provider: 'google_ai_studio',
                cause: fetchErr,
              }
            );
          } else {
            const rawMsg = String(fetchErr?.message || fetchErr || 'Network failure').replace(
              /abort/gi,
              'cancel'
            );
            lastError = new InferenceError(
              `Google AI Studio network error: ${rawMsg}`,
              {
                code: 'NETWORK_ERROR',
                retryable: true,
                provider: 'google_ai_studio',
                cause: fetchErr,
              }
            );
          }

          if (attempt < this.maxRetries) {
            await this.sleepWithAbort(this.computeBackoffMs(attempt), params.abortSignal);
            continue;
          }
          break;
        } finally {
          if (requestTimer) {
            clearTimeout(requestTimer);
            requestTimer = null;
          }
        }

        if (!response.ok || !response.body) {
          params.abortSignal?.removeEventListener('abort', onCallerAbort);
          const retryAfterMs = this.parseRetryAfterMs(response.headers?.get?.('retry-after') ?? null);
          const errBody = await response.text().catch(() => response.statusText);
          const safeErrBody = errBody.slice(0, 300).replace(/abort/gi, 'cancel');

          if (response.status === 401 || response.status === 403) {
            throw new InferenceError(
              `Google AI Studio authentication failed (HTTP ${response.status}): ${safeErrBody}`,
              {
                code: 'AUTH_MISSING',
                status: response.status,
                retryable: false,
                provider: 'google_ai_studio',
              }
            );
          }

          if (response.status === 400 && /safety|prohibited|blocked|content_filter/i.test(errBody)) {
            throw new InferenceError(
              `Google AI Studio content filter triggered (HTTP 400): ${safeErrBody}`,
              {
                code: 'CONTENT_FILTER',
                status: 400,
                retryable: false,
                provider: 'google_ai_studio',
              }
            );
          }

          // If 404 or 400 mentions model not found / invalid model, immediately try next fallback alias
          if (
            response.status === 404 ||
            (response.status === 400 && /model|not found|unsupported|unknown/i.test(errBody))
          ) {
            console.warn(
              `[GoogleAiEngine] Model "${candidateModel}" rejected (${response.status}), trying next alias...`
            );
            lastError = new InferenceError(
              `Google AI Studio model "${candidateModel}" unavailable (HTTP ${response.status}): ${safeErrBody}`,
              {
                code: 'ENGINE_UNAVAILABLE',
                status: response.status,
                retryable: false,
                provider: 'google_ai_studio',
              }
            );
            break;
          }

          if (response.status === 400) {
            throw new InferenceError(
              `Google AI Studio bad request (HTTP 400): ${safeErrBody}`,
              {
                code: 'SERVER_ERROR',
                status: 400,
                retryable: false,
                provider: 'google_ai_studio',
              }
            );
          }

          if (response.status === 429) {
            lastError = new InferenceError(
              `Google AI Studio rate limited (HTTP 429): ${safeErrBody}`,
              {
                code: 'RATE_LIMIT',
                status: 429,
                retryable: true,
                retryAfterMs,
                provider: 'google_ai_studio',
              }
            );
            if (attempt < this.maxRetries) {
              await this.sleepWithAbort(
                this.computeBackoffMs(attempt, retryAfterMs),
                params.abortSignal
              );
              continue;
            }
            break;
          }

          if (response.status === 408) {
            lastError = new InferenceError(
              `Google AI Studio request timed out (HTTP 408): ${safeErrBody}`,
              {
                code: 'TIMEOUT',
                status: 408,
                retryable: true,
                retryAfterMs,
                provider: 'google_ai_studio',
              }
            );
            if (attempt < this.maxRetries) {
              await this.sleepWithAbort(
                this.computeBackoffMs(attempt, retryAfterMs),
                params.abortSignal
              );
              continue;
            }
            break;
          }

          if (response.status >= 500 || !response.body) {
            lastError = new InferenceError(
              `Google AI Studio server error (HTTP ${response.status || 502}): ${safeErrBody}`,
              {
                code: 'SERVER_ERROR',
                status: response.status || 502,
                retryable: true,
                retryAfterMs,
                provider: 'google_ai_studio',
              }
            );
            if (attempt < this.maxRetries) {
              await this.sleepWithAbort(
                this.computeBackoffMs(attempt, retryAfterMs),
                params.abortSignal
              );
              continue;
            }
            break;
          }

          throw new InferenceError(
            `Google AI Studio request failed (HTTP ${response.status}): ${safeErrBody}`,
            {
              code: 'SERVER_ERROR',
              status: response.status,
              retryable: false,
              provider: 'google_ai_studio',
            }
          );
        }

        // Stream SSE response
        let content = '';
        let thinkingContent = '';
        let thinkingTokens = 0;
        let outputTokens = 0;
        let firstTokenAt = 0;
        let hasEmittedAnyOutput = false;
        let finishReason: string | undefined;
        let apiUsage: InferenceUsage | undefined;
        let streamCompletedCleanly = false;
        let sawDone = false;

        // Sliding-buffer <thought>/<think> parser: tags may be split across SSE chunks.
        let activeThinkTag: 'thought' | 'think' | null = null;
        let tagCarry = '';

        const toolCallSlots: Array<{
          id: string;
          index?: number;
          name: string;
          args: string;
          announced: boolean;
          extraContent?: any;
        }> = [];

        const emitThoughtText = (text: string) => {
          if (!text || params.thinkingBudget === 'off') return;
          hasEmittedAnyOutput = true;
          thinkingContent += text;
          thinkingTokens += Math.max(1, Math.ceil(text.length / 4));
          params.onThoughtDelta(text, Date.now() - startTime, thinkingTokens);
        };

        const emitAnswerText = (text: string) => {
          if (!text) return;
          hasEmittedAnyOutput = true;
          if (!firstTokenAt) firstTokenAt = Date.now();
          content += text;
          outputTokens += Math.max(1, Math.ceil(text.length / 4));
          const tps = Number(
            (outputTokens / Math.max(0.08, (Date.now() - firstTokenAt) / 1000)).toFixed(1)
          );
          this.lastTokensPerSec = tps;
          params.onTokenDelta(text, outputTokens, tps);
        };

        const partialAnyTagLen = (s: string, tags: string[]): number => {
          let maxHold = 0;
          for (const tag of tags) {
            const max = Math.min(s.length, tag.length - 1);
            for (let n = max; n > maxHold; n -= 1) {
              if (tag.startsWith(s.slice(s.length - n))) {
                maxHold = n;
                break;
              }
            }
          }
          return maxHold;
        };

        const processContentChunk = (chunk: string, flush = false) => {
          let pending = tagCarry + chunk;
          tagCarry = '';
          while (pending.length > 0) {
            if (activeThinkTag === null) {
              const thoughtIdx = pending.indexOf('<thought>');
              const thinkIdx = pending.indexOf('<think>');
              let openIdx = -1;
              let matchedTag: 'thought' | 'think' | null = null;
              let openLen = 0;
              if (thoughtIdx >= 0 && (thinkIdx < 0 || thoughtIdx <= thinkIdx)) {
                openIdx = thoughtIdx;
                matchedTag = 'thought';
                openLen = 9;
              } else if (thinkIdx >= 0) {
                openIdx = thinkIdx;
                matchedTag = 'think';
                openLen = 7;
              }
              if (openIdx >= 0 && matchedTag) {
                const before = pending.slice(0, openIdx);
                emitAnswerText(before);
                activeThinkTag = matchedTag;
                pending = pending.slice(openIdx + openLen);
                continue;
              }
              const hold = flush ? 0 : partialAnyTagLen(pending, ['<thought>', '<think>']);
              const emitPart = pending.slice(0, pending.length - hold);
              tagCarry = pending.slice(pending.length - hold);
              emitAnswerText(emitPart);
              break;
            } else {
              const closeTag = `</${activeThinkTag}>`;
              const closeIdx = pending.indexOf(closeTag);
              if (closeIdx >= 0) {
                const thoughtPart = pending.slice(0, closeIdx);
                emitThoughtText(thoughtPart);
                activeThinkTag = null;
                pending = pending.slice(closeIdx + closeTag.length);
                continue;
              }
              const hold = flush ? 0 : partialAnyTagLen(pending, [closeTag]);
              const emitPart = pending.slice(0, pending.length - hold);
              tagCarry = pending.slice(pending.length - hold);
              emitThoughtText(emitPart);
              break;
            }
          }
        };

        const processSseLine = (rawLine: string) => {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) return;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr) return;
          if (payloadStr === '[DONE]') {
            sawDone = true;
            return;
          }

          let parsed: any;
          try {
            parsed = JSON.parse(payloadStr);
          } catch {
            return;
          }

          if (parsed?.error) {
            const errStatus = Number(parsed.error?.code || parsed.error?.status || 500);
            const rawErrMsg = String(parsed.error?.message || 'Google AI Studio stream error').replace(
              /abort/gi,
              'cancel'
            );
            throw new InferenceError(rawErrMsg, {
              code: errStatus === 429 ? 'RATE_LIMIT' : 'SERVER_ERROR',
              status: Number.isFinite(errStatus) ? errStatus : 500,
              retryable: errStatus === 429 || errStatus >= 500,
              provider: 'google_ai_studio',
            });
          }

          if (parsed?.promptFeedback?.blockReason && !parsed?.choices?.length) {
            finishReason = 'content_filter';
          }

          const choice0 = parsed?.choices?.[0];
          if (choice0?.finish_reason) {
            finishReason = String(choice0.finish_reason);
          }

          if (parsed?.usage && typeof parsed.usage === 'object') {
            const u = parsed.usage;
            const promptTokens = Number(u.prompt_tokens ?? u.promptTokens ?? 0);
            const completionTokens = Number(u.completion_tokens ?? u.completionTokens ?? 0);
            const totalTokens =
              u.total_tokens !== undefined ? Number(u.total_tokens) : promptTokens + completionTokens;
            const rawThinking =
              u.completion_tokens_details?.reasoning_tokens ??
              u.reasoning_tokens ??
              u.thinking_tokens;
            apiUsage = {
              promptTokens,
              completionTokens,
              totalTokens,
              ...(rawThinking !== undefined ? { thinkingTokens: Number(rawThinking) } : {}),
            };
          }

          const delta = choice0?.delta;
          if (!delta) return;

          const reasoningDelta = delta.reasoning_content || delta.reasoning;
          if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
            emitThoughtText(reasoningDelta);
          }

          if (typeof delta.content === 'string' && delta.content.length > 0) {
            processContentChunk(delta.content, false);
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              let slot:
                | {
                    id: string;
                    index?: number;
                    name: string;
                    args: string;
                    announced: boolean;
                    extraContent?: any;
                  }
                | undefined;

              if (typeof tc.id === 'string' && tc.id.length > 0) {
                slot = toolCallSlots.find((s) => s.id === tc.id);
                if (!slot) {
                  slot = {
                    id: tc.id,
                    index: typeof tc.index === 'number' ? tc.index : toolCallSlots.length,
                    name: '',
                    args: '',
                    announced: false,
                    extraContent: undefined,
                  };
                  toolCallSlots.push(slot);
                }
              } else if (typeof tc.index === 'number') {
                for (let i = toolCallSlots.length - 1; i >= 0; i -= 1) {
                  if (toolCallSlots[i].index === tc.index) {
                    slot = toolCallSlots[i];
                    break;
                  }
                }
                if (!slot) slot = toolCallSlots[tc.index];
              } else {
                slot = toolCallSlots[toolCallSlots.length - 1];
              }

              if (!slot) {
                slot = {
                  id: `call_${Date.now()}_${toolCallSlots.length}`,
                  index: typeof tc.index === 'number' ? tc.index : toolCallSlots.length,
                  name: '',
                  args: '',
                  announced: false,
                  extraContent: undefined,
                };
                toolCallSlots.push(slot);
              }

              if (tc.function?.name) {
                if (!slot.name) {
                  slot.name = tc.function.name;
                } else if (slot.args === '' && tc.function.name !== slot.name) {
                  slot.name += tc.function.name;
                }
              }
              if (tc.function?.arguments) slot.args += tc.function.arguments;
              if (tc.extra_content) {
                slot.extraContent = this.mergeExtraContent(slot.extraContent, tc.extra_content);
              }
              if (slot.name && !slot.announced) {
                slot.announced = true;
                hasEmittedAnyOutput = true;
                params.onToolCallPreparing?.(slot.name);
              }
            }
          }
        };

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let sseBuffer = '';
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        let streamReadError: InferenceError | null = null;

        const onReaderAbort = () => {
          abortReason = 'caller';
          attemptController.abort();
          void reader.cancel().catch(() => {});
        };
        params.abortSignal?.addEventListener('abort', onReaderAbort, { once: true });

        try {
          while (true) {
            if (params.abortSignal?.aborted || abortReason === 'caller') {
              abortReason = 'caller';
              break;
            }
            stallTimer = setTimeout(() => {
              abortReason = 'stall';
              attemptController.abort();
              void reader.cancel().catch(() => {});
            }, this.streamStallTimeoutMs);

            let readResult: ReadableStreamReadResult<Uint8Array>;
            try {
              readResult = await reader.read();
            } finally {
              if (stallTimer) {
                clearTimeout(stallTimer);
                stallTimer = null;
              }
            }

            if (readResult.done) {
              sseBuffer += decoder.decode();
              if (sseBuffer.trim().length > 0) {
                for (const trailingLine of sseBuffer.split(/\r?\n/)) {
                  processSseLine(trailingLine);
                }
                sseBuffer = '';
              }
              streamCompletedCleanly = true;
              break;
            }

            sseBuffer += decoder.decode(readResult.value, { stream: true });
            const lines = sseBuffer.split(/\r?\n/);
            sseBuffer = lines.pop() ?? '';

            for (const rawLine of lines) {
              processSseLine(rawLine);
              if (sawDone) break;
            }
            if (sawDone) {
              streamCompletedCleanly = true;
              break;
            }
          }
        } catch (readErr: any) {
          if (readErr instanceof InferenceError) {
            streamReadError = readErr;
          } else if (abortReason === 'caller' || params.abortSignal?.aborted) {
            abortReason = 'caller';
          } else if (abortReason === 'stall') {
            streamReadError = new InferenceError(
              `Google AI Studio stream stalled after ${this.streamStallTimeoutMs}ms without data`,
              {
                code: 'STREAM_STALL',
                retryable: !hasEmittedAnyOutput,
                provider: 'google_ai_studio',
                cause: readErr,
              }
            );
          } else {
            const rawMsg = String(readErr?.message || readErr || 'Stream interrupted').replace(
              /abort/gi,
              'cancel'
            );
            streamReadError = new InferenceError(
              `Google AI Studio stream error: ${rawMsg}`,
              {
                code: 'NETWORK_ERROR',
                retryable: !hasEmittedAnyOutput,
                provider: 'google_ai_studio',
                cause: readErr,
              }
            );
          }
        } finally {
          if (stallTimer) {
            clearTimeout(stallTimer);
            stallTimer = null;
          }
          params.abortSignal?.removeEventListener('abort', onCallerAbort);
          params.abortSignal?.removeEventListener('abort', onReaderAbort);
          if (!streamCompletedCleanly || sawDone) {
            await reader.cancel().catch(() => {});
          }
        }

        if (abortReason === 'caller' || params.abortSignal?.aborted) {
          throw new InferenceError('Google AI Studio request aborted by caller', {
            code: 'ABORTED',
            retryable: false,
            provider: 'google_ai_studio',
          });
        }

        if (abortReason === 'stall' && !streamReadError) {
          streamReadError = new InferenceError(
            `Google AI Studio stream stalled after ${this.streamStallTimeoutMs}ms without data`,
            {
              code: 'STREAM_STALL',
              retryable: !hasEmittedAnyOutput,
              provider: 'google_ai_studio',
            }
          );
        }

        if (streamReadError) {
          lastError = streamReadError;
          if (!hasEmittedAnyOutput && streamReadError.retryable && attempt < this.maxRetries) {
            await this.sleepWithAbort(
              this.computeBackoffMs(attempt, streamReadError.retryAfterMs),
              params.abortSignal
            );
            continue;
          }
          if (hasEmittedAnyOutput) {
            throw new InferenceError(streamReadError.message, {
              code: streamReadError.code,
              status: streamReadError.status,
              retryable: false,
              provider: 'google_ai_studio',
              cause: streamReadError,
            });
          }
          break;
        }

        // Flush any remaining tag carry buffer
        if (tagCarry.length > 0) {
          processContentChunk('', true);
        }

        // Treat empty 200 stream drop (zero tokens, zero tool calls, zero finish_reason, zero usage) as transient
        if (!hasEmittedAnyOutput && toolCallSlots.length === 0 && !finishReason && !apiUsage) {
          lastError = new InferenceError('Google AI Studio stream closed with empty response', {
            code: 'NETWORK_ERROR',
            retryable: true,
            provider: 'google_ai_studio',
          });
          if (attempt < this.maxRetries) {
            await this.sleepWithAbort(this.computeBackoffMs(attempt), params.abortSignal);
            continue;
          }
          break;
        }

        const malformedToolCalls: MalformedToolCallInfo[] = [];
        if (toolCallSlots.length > 0) {
          for (const tc of toolCallSlots) {
            if (!tc.name) continue;
            const canonicalToolName = toolNameMap.get(tc.name) || tc.name;
            const parsed = this.tryParseToolCallArgs(tc.args);
            if (!parsed.ok) {
              malformedToolCalls.push({
                callId: tc.id,
                toolName: canonicalToolName,
                rawArguments: tc.args,
                error: parsed.error,
              });
              if (params.onToolCallParseError) {
                await params.onToolCallParseError({
                  toolName: canonicalToolName,
                  rawArguments: tc.args,
                  error: parsed.error,
                  callId: tc.id,
                });
              }
              continue;
            }
            if (tc.extraContent) {
              this.recordThoughtSignature({
                id: tc.id,
                canonicalName: canonicalToolName,
                sanitizedName: tc.name,
                args: parsed.args,
                extraContent: tc.extraContent,
              });
            }
            if (params.onToolCallRequest) {
              await params.onToolCallRequest(canonicalToolName, parsed.args);
            }
          }
        }

        if (apiUsage) {
          if (apiUsage.completionTokens > 0) {
            outputTokens = apiUsage.completionTokens;
          }
          if (params.thinkingBudget !== 'off' && typeof apiUsage.thinkingTokens === 'number') {
            thinkingTokens = apiUsage.thinkingTokens;
          }
        }

        return {
          content,
          thinkingContent,
          thinkingDurationMs: Date.now() - startTime,
          thinkingTokens,
          outputTokens,
          ...(finishReason ? { finishReason } : {}),
          ...(apiUsage ? { usage: apiUsage } : {}),
          ...(malformedToolCalls.length > 0 ? { malformedToolCalls } : {}),
        };
      }
    }

    throw (
      lastError ||
      new InferenceError('Google AI Studio request failed across all candidate models', {
        code: 'ENGINE_UNAVAILABLE',
        retryable: false,
        provider: 'google_ai_studio',
      })
    );
  }
}
