/**
 * Server-local copy of canonical shared protocol types (kept inside server/src for tsconfig rootDir compliance).
 */
export type {
  ModelTier,
  ThinkingBudget,
  ThreadStatus,
  MessageRole,
} from '../db/database.js';

export type GoogleThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';
export type PlatformType = 'macos' | 'windows' | 'linux' | 'android';
export type ModelStateStatus = 'idle' | 'swapping' | 'ready' | 'generating' | 'error';
export type ExecAction = 'shell' | 'read_file' | 'write_file' | 'delete_file' | 'list_dir';
export type BrainProviderId = 'strata' | 'google_ai_studio';

export type ComfyCompanionBrainId =
  | 'auto'
  | 'ollama_vision'
  | 'gemini_flash'
  | 'cpu_lightweight'
  | 'gemma4_litert'
  | 'strata';

export interface OllamaModelItem {
  name: string;
  sizeGb: number;
  isVision: boolean;
  supportsTools: boolean;
  recommended?: boolean;
  hint?: string;
  installed: boolean;
}

export interface ComfyStudioConfig {
  studioMode: boolean;
  defaultWorkflow: string;
  companionBrain: ComfyCompanionBrainId;
  customGgufPath: string;
  ollamaModel: string;
  ollamaKeepAlive: string;
  keepVramWarm: boolean;
  enhancePrompt: boolean;
}

export interface ComfyWorkflowPreset {
  id: string;
  label: string;
  workflow: string;
  speedHint: string;
  vramHint: string;
  stepsHint: string;
  kind: 'comfyui' | 'cloud';
}

export type TurnPhase =
  | 'queued'
  | 'prefilling'
  | 'thinking'
  | 'streaming_prose'
  | 'preparing_tool_call'
  | 'executing_tools'
  | 'synthesizing_final_prose'
  | 'completed'
  | 'aborted'
  | 'error';

export interface TurnPhasePayload {
  seq: number;
  thread_id: string;
  threadId?: string;
  turn_id: string;
  message_id: string;
  phase: TurnPhase;
  is_active: boolean;
  step: number;
  max_steps: number;
  status_label: string;
  thinking_finished: boolean;
  active_tool_id?: string;
  error?: string;
  timestamp?: number | string;
}

export type CanonicalSyncEventType =
  | 'SYNC_STATE'
  | 'THREAD_CREATED'
  | 'THREAD_UPDATED'
  | 'THREAD_DELETED'
  | 'THREAD_CLEARED'
  | 'THREAD_REWOUND'
  | 'CHECKPOINT_REVERTED'
  | 'TURN_STARTED'
  | 'TURN_PHASE'
  | 'TURN_COMPLETED'
  | 'TURN_ABORTED'
  | 'TURN_ERROR'
  | 'TOKEN_STREAM'
  | 'THOUGHT_STREAM'
  | 'TERMINAL_RESIZE'
  | 'SWARM_STATE'
  | 'SWARM_MESSAGE'
  | 'SWARM_MEMBER_UPDATED'
  | 'BACKGROUND_TASK_UPDATED'
  | 'TIMER_FIRED'
  | 'COUNTDOWN'
  | 'ARTIFACT_UPDATED'
  | 'ARTIFACT_SYNC';

export interface ThreadCreatedPayload {
  thread: Record<string, any>;
  parentThreadId?: string;
  branchedFromMessageId?: string;
}

export interface ThreadUpdatedPayload {
  thread: Record<string, any>;
}

export interface ThreadDeletedPayload {
  threadId: string;
}

export interface ThreadClearedPayload {
  threadId: string;
}

export interface ThreadRewoundPayload {
  rewound: boolean;
  threadId: string;
  targetMessageId: string;
  prunedMessageCount: number;
  revertedFiles: string[];
}

export interface CheckpointRevertedPayload {
  checkpointId: string;
  reverted: boolean;
  rewound?: boolean;
  threadId?: string;
  filePath: string;
  restoredContent?: string | null;
}

export interface TurnStartedPayload {
  thread_id: string;
  session_id?: string;
  turn_id?: string;
  message_id: string;
  tier?: string;
  thinking_budget?: string;
  timestamp?: number;
}

export interface TurnCompletedPayload {
  thread_id: string;
  session_id?: string;
  turn_id?: string;
  message_id: string;
  final_content: string;
  thinking_content?: string;
  thinking_duration_ms?: number;
  thinking_tokens?: number;
  output_tokens?: number;
  tokens_per_sec?: number;
  timestamp?: number;
}

export interface TurnAbortedPayload {
  thread_id?: string;
  session_id?: string;
  turn_id?: string;
  message_id?: string;
}

export interface TurnErrorPayload {
  thread_id: string;
  session_id?: string;
  turn_id?: string;
  message_id?: string;
  error: string;
}

export interface TerminalResizePayload {
  cols: number;
  rows: number;
}
