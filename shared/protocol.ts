/**
 * Canonical Shared Protocol Definitions for LocalGravity Central Brain & Edge Clients.
 */

export type ModelTier = 'low' | 'medium' | 'high';
export type ThinkingBudget = 'off' | 'fast' | 'deep' | 'low' | 'medium' | 'high' | 'xhigh';
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

export interface BaseMessage<T = unknown> {
  id: string;
  type: string;
  payload: T;
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

export interface ContextCompactedPayload {
  threadId: string;
  previousTokens: number;
  compactedTokens: number;
  compactedTurnCount: number;
  summary?: string;
  timestamp: number;
}

export interface HarnessReloadedPayload {
  reloaded: boolean;
  skillsCount: number;
  componentsCount: number;
  mcpServersCount: number;
  permissionRulesCount: number;
  timestamp: number;
}

export interface ThreadRewoundPayload {
  rewound: boolean;
  threadId: string;
  targetMessageId: string;
  prunedMessageCount: number;
  revertedFiles: string[];
}
