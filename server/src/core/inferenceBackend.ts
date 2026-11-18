import type { ModelTier, ThinkingBudget } from '../db/database.js';
import type { GpuTurnPriority } from '../swarm/swarmScheduler.js';

export interface InferenceMessage {
  role: string;
  content: any;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface InferenceCompletionParams {
  tier: ModelTier;
  thinkingBudget: ThinkingBudget;
  stepIndex?: number;
  hadToolError?: boolean;
  messages: InferenceMessage[];
  tools?: any[];
  abortSignal?: AbortSignal;
  onThoughtDelta: (delta: string, elapsedMs: number, tokenCount: number) => void;
  onTokenDelta: (delta: string, tokenCount: number, tokensPerSec?: number) => void;
  onToolCallRequest?: (toolName: string, args: Record<string, any>) => Promise<void>;
  onToolCallPreparing?: (toolName?: string) => void;
  gpuPriority?: GpuTurnPriority;
  skipGpuLock?: boolean;
}

export interface InferenceCompletionResult {
  content: string;
  thinkingContent: string;
  thinkingDurationMs: number;
  thinkingTokens: number;
  outputTokens: number;
}

export interface InferenceBackend {
  readonly id: string;
  getDisplayName(tier?: ModelTier): string;
  streamChatCompletion(params: InferenceCompletionParams): Promise<InferenceCompletionResult>;
}
