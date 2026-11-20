import type { ModelTier, ThinkingBudget } from '../db/database.js';
import type { GpuTurnPriority } from '../swarm/swarmScheduler.js';

export type InferenceErrorCode =
  | 'AUTH_MISSING'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'STREAM_STALL'
  | 'TIMEOUT'
  | 'CONTENT_FILTER'
  | 'ABORTED'
  | 'ENGINE_UNAVAILABLE';

export interface InferenceErrorOptions {
  code: InferenceErrorCode;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;
  provider?: string;
  cause?: unknown;
}

export class InferenceError extends Error {
  public readonly code: InferenceErrorCode;
  public readonly status?: number;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly provider?: string;

  constructor(
    messageOrOptions: string | (InferenceErrorOptions & { message: string }),
    maybeOptions?: InferenceErrorOptions
  ) {
    const isString = typeof messageOrOptions === 'string';
    const message = isString ? messageOrOptions : messageOrOptions.message;
    const options: InferenceErrorOptions = isString
      ? (maybeOptions ?? { code: 'SERVER_ERROR', retryable: false })
      : messageOrOptions;

    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'InferenceError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.provider = options.provider;
  }
}

export interface InferenceUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
  thinkingTokens?: number;
}

export interface MalformedToolCallInfo {
  callId?: string;
  toolName: string;
  rawArguments: string;
  error: string;
}

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
  onToolCallParseError?: (info: {
    toolName: string;
    rawArguments: string;
    error: string;
    callId?: string;
  }) => Promise<void> | void;
  onToolCallPreparing?: (toolName?: string) => void;
  gpuPriority?: GpuTurnPriority;
  skipGpuLock?: boolean;
  googleModelOverride?: string;
}

export interface InferenceCompletionResult {
  content: string;
  thinkingContent: string;
  thinkingDurationMs: number;
  thinkingTokens: number;
  outputTokens: number;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | string;
  usage?: InferenceUsage;
  malformedToolCalls?: MalformedToolCallInfo[];
}

export interface InferenceBackend {
  readonly id: string;
  getDisplayName(tier?: ModelTier): string;
  streamChatCompletion(params: InferenceCompletionParams): Promise<InferenceCompletionResult>;
}
