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
  thread_id?: string;
  attachments?: unknown[];
  execution_policy?: 'always_proceed' | 'request_review';
  executionPolicy?: 'always_proceed' | 'request_review';
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
  id?: string;
  session_id: string;
  artifact_name: 'task.md' | 'implementation_plan.md' | 'plan.md' | 'walkthrough.md' | string;
  content: string;
  version: number;
  type?: 'plan' | 'walkthrough' | 'task' | 'html' | string;
  requestFeedback?: boolean;
  userFacing?: boolean;
}> {
  type: 'ARTIFACT_SYNC';
}

// 13. SWARM_STATE / SWARM_MESSAGE / SWARM_MEMBER_UPDATED (Brain -> UI)
export type SwarmMemberState = 'waiting' | 'working' | 'stopped' | 'killed';

export interface SwarmMemberPayload {
  id: string;
  swarm_id?: string;
  name: string;
  added_by?: string;
  thread_id?: string;
  model?: string;
  state: SwarmMemberState;
  workspace_mode?: string;
  workspace_path?: string;
  channels?: string[];
  wait_since?: number;
  mentions_only?: boolean;
  last_read_seq?: number;
  last_post_seq?: number;
  brief?: string;
}

export interface SwarmMessagePayload {
  seq: number;
  swarm_id?: string;
  channel: string;
  agent: string;
  text: string;
  kind?: string;
  mentions?: string[];
  created_at: string | number;
}

export interface SwarmSnapshotPayload {
  id: string;
  title: string;
  status: string;
  head: number;
  members: SwarmMemberPayload[];
  messages: SwarmMessagePayload[];
}

export interface SwarmStateMessage extends BaseMessage<{
  thread_id: string;
  swarm: SwarmSnapshotPayload | null;
}> {
  type: 'SWARM_STATE';
}

export interface SwarmMessageEvent extends BaseMessage<{
  thread_id: string;
  swarm_id: string;
  message: SwarmMessagePayload;
}> {
  type: 'SWARM_MESSAGE';
}

export interface SwarmMemberUpdatedEvent extends BaseMessage<{
  thread_id: string;
  swarm_id: string;
  member: SwarmMemberPayload;
}> {
  type: 'SWARM_MEMBER_UPDATED';
}

// 11. STOP_GENERATION
export interface StopGenerationMessage extends BaseMessage<{
  session_id: string;
  thread_id?: string;
  turn_id?: string;
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

// 12. TURN_PHASE (Brain -> UI): authoritative per-turn lifecycle state
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

export interface TurnPhaseMessage extends BaseMessage<TurnPhasePayload> {
  type: 'TURN_PHASE';
}

export type AnyIncomingMessage =
  | TurnPhaseMessage
  | SwarmStateMessage
  | SwarmMessageEvent
  | SwarmMemberUpdatedEvent
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
