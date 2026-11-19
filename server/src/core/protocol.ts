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
