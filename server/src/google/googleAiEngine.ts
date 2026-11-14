import fs from 'node:fs';
import path from 'node:path';
import type { ModelTier, ThinkingBudget } from '../db/database.js';
import type { GpuTurnPriority } from '../swarm/swarmScheduler.js';

export type BrainProviderId = 'strata' | 'google_ai_studio';

export type GoogleModelId =
  | 'orchestrator'
  | 'gemini-4-hydrogen'
  | 'gemini-4-carbon'
  | 'gemini-4-argon'
  | 'gemini-3.8-flash';

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
  orchestrator: {
    id: 'orchestrator',
    displayName: 'Orchestrator (Argon/Carbon → Hydrogen)',
    shortLabel: 'Orchestrator',
    subtitle: 'Decisions API → Argon/Carbon Plan → Hydrogen Execute',
    apiModel: 'gemini-decision-1',
    fallbackApiModels: ['gemini-4-argon', 'gemini-4-hydrogen'],
    role: 'orchestrator',
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

export interface StreamCompletionParams {
  tier: ModelTier;
  thinkingBudget: ThinkingBudget;
  stepIndex?: number;
  messages: Array<{ role: string; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string }>;
  tools?: any[];
  abortSignal?: AbortSignal;
  onThoughtDelta: (delta: string, elapsedMs: number, tokenCount: number) => void;
  onTokenDelta: (delta: string, tokenCount: number, tokensPerSec?: number) => void;
  onToolCallRequest?: (toolName: string, args: Record<string, any>) => Promise<void>;
  onToolCallPreparing?: (toolName?: string) => void;
  gpuPriority?: GpuTurnPriority;
  skipGpuLock?: boolean;
}

export interface StreamCompletionResult {
  content: string;
  thinkingContent: string;
  thinkingDurationMs: number;
  thinkingTokens: number;
  outputTokens: number;
}

export interface OrchestratorDecision {
  needsPlanning: boolean;
  needsPlanningScore: number;
  plannerChoice: 'carbon' | 'argon' | 'hydrogen';
  confidence: number;
  source: 'decisions_api' | 'heuristic_fallback';
  reason: string;
}

const VALID_GOOGLE_MODELS = new Set<GoogleModelId>([
  'orchestrator',
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
  if (lower.includes('carbon')) return 'gemini-4-carbon';
  if (lower.includes('argon')) return 'gemini-4-argon';
  if (lower.includes('hydrogen')) return 'gemini-4-hydrogen';
  if (lower.includes('3.8') || lower.includes('flash')) return 'gemini-3.8-flash';
  return 'orchestrator';
}

export function maskApiKey(key: string): string {
  const clean = key.trim();
  if (!clean) return '';
  if (clean.length <= 8) return `${clean.slice(0, 2)}••••`;
  return `${clean.slice(0, 6)}••••••${clean.slice(-4)}`;
}

export class GoogleAiEngine {
  private repoRoot: string;
  private configPath: string;
  private config: BrainProviderConfig;
  private lastTokensPerSec = 0;
  private thoughtSignatureCache = new Map<string, any>();

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.configPath = path.join(this.repoRoot, '.runtime', 'brain-provider.json');
    this.config = this.loadConfig();
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
      selectedGoogleModel: 'orchestrator',
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
    const spec = GOOGLE_MODEL_SPECS[this.config.selectedGoogleModel] || GOOGLE_MODEL_SPECS.orchestrator;
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

  /**
   * Calls the Google Gemini Decisions API (`gemini-decision-1`) to determine whether
   * a turn requires planning and which planner model (`carbon`, `argon`, or `hydrogen`)
   * should handle Step 1 before handing off execution to Gemini 4 Hydrogen.
   */
  public async evaluateOrchestratorDecision(
    promptText: string,
    abortSignal?: AbortSignal
  ): Promise<OrchestratorDecision> {
    const apiKey = this.getApiKey();
    const cleanedInput = (promptText || '').trim().slice(0, 3500) || 'General assistant turn';

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
                instructions: 'Select the optimal model for the initial planning phase of this request.',
                criteria: {
                  carbon:
                    'Complex architecture, multi-file refactoring, deep systems/concurrency debugging, security design, or high-risk changes requiring Gemini 4 Carbon.',
                  argon:
                    'Standard software engineering planning, feature implementation, UI updates, or multi-step tool reconnaissance requiring Gemini 4 Argon.',
                  hydrogen:
                    'Simple greeting, trivial one-line question, or direct single lookup that can go straight to Gemini 4 Hydrogen without a separate planning pass.',
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
          const rawChoice = String(data?.answers?.planner_model?.choice || 'argon').toLowerCase();
          const confidence = Number(data?.answers?.planner_model?.confidence ?? 0.8);
          const plannerChoice: 'carbon' | 'argon' | 'hydrogen' =
            rawChoice === 'carbon' ? 'carbon' : rawChoice === 'hydrogen' ? 'hydrogen' : 'argon';

          return {
            needsPlanning: plannerChoice !== 'hydrogen' && needsScore >= 0.3,
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

    return this.heuristicOrchestratorDecision(cleanedInput);
  }

  private heuristicOrchestratorDecision(promptText: string): OrchestratorDecision {
    const trimmed = promptText.trim();
    const lower = trimmed.toLowerCase();

    const isGreetingOrTrivial =
      trimmed.length < 28 &&
      /^(hi|hello|hey|yo|sup|ping|test|status|thanks|thank you|ok|okay|yes|no)[\s!?.]*$/i.test(trimmed);

    if (isGreetingOrTrivial) {
      return {
        needsPlanning: false,
        needsPlanningScore: 0.12,
        plannerChoice: 'hydrogen',
        confidence: 0.91,
        source: 'heuristic_fallback',
        reason: 'Trivial conversational prompt routed directly to Gemini 4 Hydrogen.',
      };
    }

    const isDeepArchitecture =
      trimmed.length > 350 ||
      /\b(architect|refactor|redesign|migration|concurrency|race condition|deadlock|distributed|security|performance|optimize|multi-?file|end[- ]to[- ]end|system design|protocol|consensus|compiler|kernel|orchestrat)\b/i.test(
        lower
      );

    if (isDeepArchitecture) {
      return {
        needsPlanning: true,
        needsPlanningScore: 0.94,
        plannerChoice: 'carbon',
        confidence: 0.88,
        source: 'heuristic_fallback',
        reason: 'High-complexity engineering task routed to Gemini 4 Carbon for planning, then Gemini 4 Hydrogen for execution.',
      };
    }

    return {
      needsPlanning: true,
      needsPlanningScore: 0.78,
      plannerChoice: 'argon',
      confidence: 0.85,
      source: 'heuristic_fallback',
      reason: 'Standard multi-step engineering task routed to Gemini 4 Argon for planning, then Gemini 4 Hydrogen for execution.',
    };
  }

  private makeSignatureKey(name: string, args: unknown): string {
    let canonical = '{}';
    if (typeof args === 'string') {
      try {
        canonical = JSON.stringify(JSON.parse(args));
      } catch {
        canonical = args.trim() || '{}';
      }
    } else if (args && typeof args === 'object') {
      canonical = JSON.stringify(args);
    }
    return `${name}::${canonical}`;
  }

  private recordThoughtSignature(name: string, args: unknown, extraContent: any): void {
    if (!extraContent?.google?.thought_signature) return;
    const key = this.makeSignatureKey(name, args);
    this.thoughtSignatureCache.set(key, extraContent);
    if (this.thoughtSignatureCache.size > 200) {
      const oldestKey = this.thoughtSignatureCache.keys().next().value;
      if (oldestKey !== undefined) this.thoughtSignatureCache.delete(oldestKey);
    }
  }

  private lookupThoughtSignature(name: string, args: unknown): any | undefined {
    const key = this.makeSignatureKey(name, args);
    return this.thoughtSignatureCache.get(key);
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
            : this.lookupThoughtSignature(cloned.function?.name || '', cloned.function?.arguments);
          if (cachedExtra?.google?.thought_signature) {
            cloned.extra_content = cachedExtra;
            hasAnySignature = true;
          }
          return cloned;
        });
        if (!hasAnySignature && mappedToolCalls.length > 0) {
          mappedToolCalls[0] = {
            ...mappedToolCalls[0],
            extra_content: {
              google: {
                thought_signature: 'context_engineering_is_the_way_to_go',
              },
            },
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
  ): 'low' | 'medium' | 'high' | undefined {
    if (budget === 'off') return undefined;
    if (modelId === 'gemini-4-carbon') return 'high';
    if (budget === 'deep') return 'high';
    return 'medium';
  }

  public async streamChatCompletion(params: StreamCompletionParams): Promise<StreamCompletionResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      const msg =
        '⚠️ Google AI Studio is selected as the Brain Provider, but no API key is configured. Open **Settings → Brain Inference Provider**, paste your Google AI Studio API key (`AIza...`), and save.';
      const tok = Math.ceil(msg.length / 4);
      params.onTokenDelta(msg, tok);
      return {
        content: msg,
        thinkingContent: '',
        thinkingDurationMs: 0,
        thinkingTokens: 0,
        outputTokens: tok,
      };
    }

    const selectedModel = this.config.selectedGoogleModel;
    if (selectedModel !== 'orchestrator') {
      return this.streamSingleModelCall(selectedModel, params, apiKey);
    }

    // ==================== ORCHESTRATOR MODE ====================
    // 1. Step 1: Google Decisions API decides Carbon vs Argon vs Hydrogen.
    // 2. If Carbon or Argon: Planner produces the execution plan (streamed into Thinking),
    //    then Orchestrator automatically flips to Gemini 4 Hydrogen to execute the plan!
    // 3. Step 2+: Execution continues on Gemini 4 Hydrogen.
    const stepIndex = params.stepIndex ?? 1;
    let totalThinkingContent = '';
    let totalThinkingTokens = 0;
    const turnStart = Date.now();

    const emitThought = (chunk: string) => {
      // Mirror Strata's emitThought gate: when the thinking budget is OFF, suppress all
      // orchestrator planning/badge deltas so `totalThinkingTokens` stays 0.
      if (!chunk || params.thinkingBudget === 'off') return;
      totalThinkingContent += chunk;
      totalThinkingTokens += Math.max(1, Math.ceil(chunk.length / 4));
      params.onThoughtDelta(chunk, Date.now() - turnStart, totalThinkingTokens);
    };

    if (stepIndex > 1) {
      emitThought(`[Orchestrator → Gemini 4 Hydrogen Executing Step ${stepIndex}]\n`);
      const execRes = await this.streamSingleModelCall('gemini-4-hydrogen', params, apiKey);
      return {
        ...execRes,
        thinkingContent: `${totalThinkingContent}${execRes.thinkingContent}`.trim(),
        thinkingTokens: totalThinkingTokens + execRes.thinkingTokens,
        thinkingDurationMs: Date.now() - turnStart,
      };
    }

    const latestUserPrompt = this.extractLatestUserText(params.messages);
    const decision = await this.evaluateOrchestratorDecision(latestUserPrompt, params.abortSignal);
    const sourceBadge =
      decision.source === 'decisions_api'
        ? 'Google Decisions API (gemini-decision-1)'
        : 'Decisions Classifier Fallback (gemini-decision-1 unavailable)';

    emitThought(
      `[${sourceBadge}]\n` +
        `• Needs Planning: ${(decision.needsPlanningScore * 100).toFixed(0)}%\n` +
        `• Planner Selected: Gemini 4 ${decision.plannerChoice.charAt(0).toUpperCase() + decision.plannerChoice.slice(1)} (${(decision.confidence * 100).toFixed(0)}% conf)\n` +
        `• Execution Model: Gemini 4 Hydrogen\n\n`
    );

    if (!decision.needsPlanning || decision.plannerChoice === 'hydrogen') {
      emitThought('[Orchestrator → Direct Execution on Gemini 4 Hydrogen]\n');
      const directRes = await this.streamSingleModelCall('gemini-4-hydrogen', params, apiKey);
      return {
        ...directRes,
        thinkingContent: `${totalThinkingContent}${directRes.thinkingContent}`.trim(),
        thinkingTokens: totalThinkingTokens + directRes.thinkingTokens,
        thinkingDurationMs: Date.now() - turnStart,
      };
    }

    // Phase 1: Planning on Gemini 4 Argon or Gemini 4 Carbon
    const plannerModelId: GoogleModelId =
      decision.plannerChoice === 'carbon' ? 'gemini-4-carbon' : 'gemini-4-argon';
    const plannerLabel = GOOGLE_MODEL_SPECS[plannerModelId].displayName;

    emitThought(`[${plannerLabel} • Formulating Plan...]\n`);

    const plannerMessages = [
      ...params.messages,
      {
        role: 'system',
        content:
          `[ORCHESTRATOR PLANNING PHASE — ${plannerLabel.toUpperCase()}]:\n` +
          `Analyze the user's request and context above, and write a concise, concrete, numbered execution plan for Gemini 4 Hydrogen to execute. ` +
          `Specify exact files, commands, tools, checks, and edge cases. Do NOT ask the user questions unless impossible to proceed; produce the plan directly so Hydrogen can execute immediately.`,
      },
    ];

    let planText = '';
    const plannerResult = await this.streamSingleModelCall(
      plannerModelId,
      {
        ...params,
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
      return {
        content: '',
        thinkingContent: totalThinkingContent,
        thinkingDurationMs: Date.now() - turnStart,
        thinkingTokens: totalThinkingTokens,
        outputTokens: 0,
      };
    }

    const effectivePlan = (planText || plannerResult.content || '').trim();
    emitThought(
      `\n\n[Orchestrator Hand-off → Flipping to Gemini 4 Hydrogen for Plan Execution]\n`
    );

    // Phase 2: Execute the plan on Gemini 4 Hydrogen with full tool belt
    const executionMessages = [
      ...params.messages,
      {
        role: 'system',
        content:
          `[ORCHESTRATOR EXECUTION HAND-OFF — GEMINI 4 HYDROGEN]:\n` +
          `${plannerLabel} produced the following approved execution plan. Execute it now using your available tools (or respond directly if no tools are needed):\n\n` +
          `${effectivePlan || 'Proceed directly with implementing the user request accurately and verifying the result.'}`,
      },
    ];

    const hydrogenResult = await this.streamSingleModelCall(
      'gemini-4-hydrogen',
      {
        ...params,
        messages: executionMessages,
        onThoughtDelta: (delta) => {
          emitThought(delta);
        },
      },
      apiKey
    );

    return {
      content: hydrogenResult.content,
      thinkingContent: `${totalThinkingContent}${hydrogenResult.thinkingContent}`.trim(),
      thinkingDurationMs: Date.now() - turnStart,
      thinkingTokens: totalThinkingTokens + hydrogenResult.thinkingTokens,
      outputTokens: hydrogenResult.outputTokens,
    };
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

    let lastErrorStatus = 0;
    let lastErrorBody = '';

    for (const candidateModel of candidates) {
      if (params.abortSignal?.aborted) {
        return { content: '', thinkingContent: '', thinkingDurationMs: 0, thinkingTokens: 0, outputTokens: 0 };
      }

      const bodyPayload: Record<string, any> = {
        model: candidateModel,
        messages: openAiMessages,
        stream: true,
        temperature: params.thinkingBudget === 'deep' ? 0.35 : 0.6,
        ...(params.tools && params.tools.length > 0 ? { tools: params.tools, tool_choice: 'auto' } : {}),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      };

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
            signal: params.abortSignal,
          }
        );
      } catch (fetchErr: any) {
        if (params.abortSignal?.aborted || fetchErr?.name === 'AbortError') {
          return {
            content: '',
            thinkingContent: '',
            thinkingDurationMs: Date.now() - startTime,
            thinkingTokens: 0,
            outputTokens: 0,
          };
        }
        lastErrorBody = fetchErr?.message || String(fetchErr);
        continue;
      }

      if (!response.ok || !response.body) {
        lastErrorStatus = response.status;
        lastErrorBody = await response.text().catch(() => response.statusText);
        // If 404 or 400 mentions model not found / invalid model, try fallback candidate model
        if (
          response.status === 404 ||
          (response.status === 400 && /model|not found|unsupported|unknown/i.test(lastErrorBody))
        ) {
          console.warn(
            `[GoogleAiEngine] Model "${candidateModel}" rejected (${response.status}), trying next alias...`
          );
          continue;
        }
        break;
      }

      // Stream SSE response
      let content = '';
      let thinkingContent = '';
      let thinkingTokens = 0;
      let outputTokens = 0;
      let firstTokenAt = 0;
      let inThinkTag = false;
      const toolCallSlots: Array<{
        id: string;
        index?: number;
        name: string;
        args: string;
        announced: boolean;
        extraContent?: any;
      }> = [];

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let sseBuffer = '';

      while (true) {
        if (params.abortSignal?.aborted) break;
        const { value, done } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr || payloadStr === '[DONE]') continue;

          let parsed: any;
          try {
            parsed = JSON.parse(payloadStr);
          } catch {
            continue;
          }

          const delta = parsed?.choices?.[0]?.delta;
          if (!delta) continue;

          const reasoningDelta = delta.reasoning_content || delta.reasoning;
          // Mirror Strata's emitThought gate: when the thinking budget is OFF, suppress all
          // reasoning deltas entirely (do not count tokens, do not surface a thought stream).
          if (params.thinkingBudget === 'off') {
            // Intentionally drop reasoning_content so `thinkingTokens` stays 0.
          } else if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
            thinkingContent += reasoningDelta;
            thinkingTokens += Math.max(1, Math.ceil(reasoningDelta.length / 4));
            params.onThoughtDelta(reasoningDelta, Date.now() - startTime, thinkingTokens);
          }

          if (typeof delta.content === 'string' && delta.content.length > 0) {
            let chunkText = delta.content;

            // Support models emitting <thought>...</thought> or <think>...</think>.
            // When budget is OFF, treat the entire stream as plain answer content and skip tag parsing.
            if (params.thinkingBudget !== 'off' && !inThinkTag && (chunkText.includes('<thought>') || chunkText.includes('<think>'))) {
              const openMatch = chunkText.match(/<(thought|think)>/);
              if (openMatch && openMatch.index !== undefined) {
                const before = chunkText.slice(0, openMatch.index);
                const after = chunkText.slice(openMatch.index + openMatch[0].length);
                if (before) {
                  if (!firstTokenAt) firstTokenAt = Date.now();
                  content += before;
                  outputTokens += Math.max(1, Math.ceil(before.length / 4));
                  const tps = Number(
                    (outputTokens / Math.max(0.08, (Date.now() - firstTokenAt) / 1000)).toFixed(1)
                  );
                  this.lastTokensPerSec = tps;
                  params.onTokenDelta(before, outputTokens, tps);
                }
                inThinkTag = true;
                chunkText = after;
              }
            }

            if (inThinkTag) {
              const closeMatch = chunkText.match(/<\/(thought|think)>/);
              if (closeMatch && closeMatch.index !== undefined) {
                const thoughtPart = chunkText.slice(0, closeMatch.index);
                const prosePart = chunkText.slice(closeMatch.index + closeMatch[0].length);
                if (thoughtPart) {
                  thinkingContent += thoughtPart;
                  thinkingTokens += Math.max(1, Math.ceil(thoughtPart.length / 4));
                  params.onThoughtDelta(thoughtPart, Date.now() - startTime, thinkingTokens);
                }
                inThinkTag = false;
                chunkText = prosePart;
              } else {
                thinkingContent += chunkText;
                thinkingTokens += Math.max(1, Math.ceil(chunkText.length / 4));
                params.onThoughtDelta(chunkText, Date.now() - startTime, thinkingTokens);
                continue;
              }
            }

            if (chunkText.length > 0) {
              if (!firstTokenAt) firstTokenAt = Date.now();
              content += chunkText;
              outputTokens += Math.max(1, Math.ceil(chunkText.length / 4));
              const tps = Number(
                (outputTokens / Math.max(0.08, (Date.now() - firstTokenAt) / 1000)).toFixed(1)
              );
              this.lastTokensPerSec = tps;
              params.onTokenDelta(chunkText, outputTokens, tps);
            }
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
              if (tc.extra_content) slot.extraContent = tc.extra_content;
              if (slot.name && !slot.announced) {
                slot.announced = true;
                params.onToolCallPreparing?.(slot.name);
              }
            }
          }
        }
      }

      if (!params.abortSignal?.aborted && toolCallSlots.length > 0 && params.onToolCallRequest) {
        for (const tc of toolCallSlots) {
          if (!tc.name) continue;
          let parsedArgs: Record<string, any> = {};
          const rawArgs = tc.args.trim();
          if (rawArgs) {
            try {
              parsedArgs = JSON.parse(rawArgs);
            } catch {
              parsedArgs = {};
            }
          }
          if (tc.extraContent) {
            this.recordThoughtSignature(tc.name, parsedArgs, tc.extraContent);
          }
          await params.onToolCallRequest(tc.name, parsedArgs);
        }
      }

      return {
        content,
        thinkingContent,
        thinkingDurationMs: Date.now() - startTime,
        thinkingTokens,
        outputTokens,
      };
    }

    const errMsg = `⚠️ Google AI Studio request failed (${lastErrorStatus || 'network'}): ${lastErrorBody.slice(0, 400)}`;
    const tok = Math.max(1, Math.ceil(errMsg.length / 4));
    params.onTokenDelta(errMsg, tok);
    return {
      content: errMsg,
      thinkingContent: '',
      thinkingDurationMs: Date.now() - startTime,
      thinkingTokens: 0,
      outputTokens: tok,
    };
  }
}
