/**
 * Strict TypeScript Protocol Definitions aligned with shared/protocol.ts.
 */
import type {
  ModelTier,
  ThinkingBudget,
  GoogleThinkingLevel,
  PlatformType,
  ModelStateStatus,
  ExecAction,
  BrainProviderId,
  ComfyCompanionBrainId,
  ComfyStudioConfig,
  ComfyWorkflowPreset,
  BaseMessage,
  TurnPhase,
  TurnPhasePayload,
  SwarmMemberState,
  SwarmMemberPayload,
  SwarmMessagePayload,
  SwarmSnapshotPayload,
  ContextCompactedPayload,
  HarnessReloadedPayload,
  ThreadRewoundPayload,
} from '../../../shared/protocol';

export type {
  ModelTier,
  ThinkingBudget,
  GoogleThinkingLevel,
  PlatformType,
  ModelStateStatus,
  ExecAction,
  BrainProviderId,
  ComfyCompanionBrainId,
  ComfyStudioConfig,
  ComfyWorkflowPreset,
  BaseMessage,
  TurnPhase,
  TurnPhasePayload,
  SwarmMemberState,
  SwarmMemberPayload,
  SwarmMessagePayload,
  SwarmSnapshotPayload,
  ContextCompactedPayload,
  HarnessReloadedPayload,
  ThreadRewoundPayload,
};

export interface SessionInitMessage extends BaseMessage<{
  workspace_path: string;
  platform: PlatformType;
  client_version?: string;
  hostname?: string;
}> {
  type: 'SESSION_INIT';
}

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

export interface TierSwitchMessage extends BaseMessage<{
  session_id: string;
  new_tier: ModelTier;
}> {
  type: 'TIER_SWITCH';
}

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

export interface TokenStreamMessage extends BaseMessage<{
  session_id: string;
  chunk: string;
  output_tokens?: number;
  tokens_per_sec?: number;
  is_finished: boolean;
}> {
  type: 'TOKEN_STREAM';
}

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

export interface ExecStreamMessage extends BaseMessage<{
  request_id: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}> {
  type: 'EXEC_STREAM';
}

export interface ExecResultMessage extends BaseMessage<{
  request_id: string;
  exit_code: number;
  duration_ms: number;
  error?: string;
  data?: unknown;
}> {
  type: 'EXEC_RESULT';
}

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

export interface StopGenerationMessage extends BaseMessage<{
  session_id: string;
  thread_id?: string;
  turn_id?: string;
}> {
  type: 'STOP_GENERATION';
}

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

export interface TurnPhaseMessage extends BaseMessage<TurnPhasePayload> {
  type: 'TURN_PHASE';
}

export interface ComfyConfigUpdatedMessage extends BaseMessage<{
  config: ComfyStudioConfig;
  workflows: string[];
  comfyRunning?: boolean;
}> {
  type: 'COMFY_CONFIG_UPDATED';
}

export interface ThreadRewoundMessage extends BaseMessage<ThreadRewoundPayload> {
  type: 'THREAD_REWOUND';
}

export interface HarnessReloadedMessage extends BaseMessage<HarnessReloadedPayload> {
  type: 'HARNESS_RELOADED';
}

export interface ContextCompactedMessage extends BaseMessage<ContextCompactedPayload> {
  type: 'CONTEXT_COMPACTED';
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
  | TelemetryMessage
  | ComfyConfigUpdatedMessage
  | ThreadRewoundMessage
  | HarnessReloadedMessage
  | ContextCompactedMessage;

export type AnyOutgoingMessage =
  | SessionInitMessage
  | PromptSubmitMessage
  | TierSwitchMessage
  | ExecStreamMessage
  | ExecResultMessage
  | ArtifactSyncMessage;
