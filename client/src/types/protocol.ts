/**
 * Strict TypeScript Protocol Definitions matching Python Pydantic v2 schemas.
 */

export type ModelTier = 'low' | 'medium' | 'high';
export type ThinkingBudget = 'off' | 'fast' | 'deep';
export type PlatformType = 'macos' | 'windows' | 'android';
export type ModelStateStatus = 'idle' | 'swapping' | 'ready' | 'generating' | 'error';
export type ExecAction = 'shell' | 'read_file' | 'write_file' | 'delete_file' | 'list_dir';

export interface BaseMessage<T = unknown> {
  id: string;
  type: string;
  payload: T;
}

// 1. SESSION_INIT
export interface SessionInitMessage extends BaseMessage<{
  workspace_path: string;
  platform: PlatformType;
  client_version?: string;
  hostname?: string;
}> {
  type: 'SESSION_INIT';
}

// 2. PROMPT_SUBMIT
export interface PromptSubmitMessage extends BaseMessage<{
  session_id: string;
  prompt: string;
  tier: ModelTier;
  thinking_budget: ThinkingBudget;
  images?: string[];
}> {
  type: 'PROMPT_SUBMIT';
}

// 3. TIER_SWITCH
export interface TierSwitchMessage extends BaseMessage<{
  session_id: string;
  new_tier: ModelTier;
}> {
  type: 'TIER_SWITCH';
}

// 4. MODEL_STATE
export interface ModelStateMessage extends BaseMessage<{
  status: ModelStateStatus;
  active_tier: ModelTier;
  active_model: string;
  status_text?: string;
  vram_used_gb: number;
  vram_total_gb: number;
  host_ram_used_gb: number;
  host_ram_total_gb: number;
}> {
  type: 'MODEL_STATE';
}

// 5. THOUGHT_STREAM
export interface ThoughtStreamMessage extends BaseMessage<{
  session_id: string;
  chunk: string;
  elapsed_ms: number;
  token_count: number;
  tokens_per_sec?: number;
  is_finished: boolean;
}> {
  type: 'THOUGHT_STREAM';
}

// 6. TOKEN_STREAM
export interface TokenStreamMessage extends BaseMessage<{
  session_id: string;
  chunk: string;
  output_tokens?: number;
  tokens_per_sec?: number;
  is_finished: boolean;
}> {
  type: 'TOKEN_STREAM';
}

// 7. EXEC_REQUEST (Brain -> Edge)
export interface ExecRequestMessage extends BaseMessage<{
  action: ExecAction;
  command?: string;
  path?: string;
  content?: string;
  cwd?: string;
  timeout_ms?: number;
}> {
  type: 'EXEC_REQUEST';
}

// 8. EXEC_STREAM (Edge -> Brain)
export interface ExecStreamMessage extends BaseMessage<{
  request_id: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}> {
  type: 'EXEC_STREAM';
}

// 9. EXEC_RESULT (Edge -> Brain)
export interface ExecResultMessage extends BaseMessage<{
  request_id: string;
  exit_code: number;
  duration_ms: number;
  error?: string;
  data?: unknown;
}> {
  type: 'EXEC_RESULT';
}

// 10. ARTIFACT_SYNC (Bidirectional)
export interface ArtifactSyncMessage extends BaseMessage<{
  session_id: string;
  artifact_name: 'task.md' | 'implementation_plan.md';
  content: string;
  version: number;
}> {
  type: 'ARTIFACT_SYNC';
}

// 11. STOP_GENERATION
export interface StopGenerationMessage extends BaseMessage<{
  session_id: string;
}> {
  type: 'STOP_GENERATION';
}

// 11. TELEMETRY
export interface TelemetryMessage extends BaseMessage<{
  vram_used_gb: number;
  vram_total_gb: number;
  vram_percent: number;
  host_ram_used_gb: number;
  host_ram_total_gb: number;
  host_ram_percent: number;
  gpu_utilization_percent: number;
  cpu_utilization_percent: number;
  active_tier: ModelTier;
  active_model: string;
}> {
  type: 'TELEMETRY';
}

export type AnyIncomingMessage =
  | ModelStateMessage
  | ThoughtStreamMessage
  | TokenStreamMessage
  | ExecRequestMessage
  | ArtifactSyncMessage
  | TelemetryMessage;

export type AnyOutgoingMessage =
  | SessionInitMessage
  | PromptSubmitMessage
  | TierSwitchMessage
  | ExecStreamMessage
  | ExecResultMessage
  | ArtifactSyncMessage;
