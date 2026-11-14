/**
 * Static model-tier and thinking-budget configuration for LocalGravity's local
 * TabbyAPI stack, plus the telemetry/status shape surfaced by TabbyEngine.
 *
 * Kept free of runtime logic so it can be imported by the engine, the HTTP/WS
 * routes, and host-telemetry utilities without pulling in the engine class.
 */

import { ModelTier, ThinkingBudget } from '../db/database.js';

export interface TierModelSpec {
  tier: ModelTier;
  displayName: string;
  shortLabel: string;
  modelName: string;
  fallbackFolderNames: string[];
  bpw: string;
  maxSeqLen: number;
  cacheMode: 'Q4';
  autosplitReserve: [number];
  visionOffload: boolean;
  draftMode: 'ngram';
  hybridDraftTokens: number;
  estimatedVramGb: number;
}

export interface SysRamWarmStatus {
  tier: ModelTier;
  modelName: string;
  state: 'cold' | 'warming' | 'warm' | 'vram_active';
  bytesWarmed: number;
  totalBytes: number;
  filesCount: number;
  throughputMBps: number;
  lastWarmedAt: string | null;
}

export interface TabbyEngineTelemetry {
  connected: boolean;
  tabbyUrl: string;
  activeTier: ModelTier;
  activeModel: string;
  swapStatus: 'idle' | 'swapping' | 'ready' | 'generating' | 'error';
  lastSwapDurationMs: number;
  tokensPerSec: number;
  cacheMode: 'Q4';
  autosplitReserveMb: number;
  draftMode: 'ngram';
  hybridDraftTokens: number;
  sysramCache: Record<ModelTier, SysRamWarmStatus>;
}

export const TIER_SPECS: Record<ModelTier, TierModelSpec> = {
  low: {
    tier: 'low',
    displayName: 'Qwen 3.5 4B (EXL3 4.0bpw)',
    shortLabel: 'Low 4B',
    modelName: 'Qwen3.5-4B-EXL3-4.0bpw',
    fallbackFolderNames: ['Qwen3.5-4B-EXL3-4.0bpw', 'Qwen3.5-4B-EXL3-4.5bpw'],
    bpw: '4.0 bpw',
    maxSeqLen: 32768,
    cacheMode: 'Q4',
    autosplitReserve: [256],
    visionOffload: false,
    draftMode: 'ngram',
    hybridDraftTokens: 4,
    estimatedVramGb: 3.4,
  },
  medium: {
    tier: 'medium',
    displayName: 'Qwen 3.8 27B (EXL3 11.5GB)',
    shortLabel: 'Med 27B',
    modelName: 'Qwen3.8-27B-EXL3-11.5GB',
    fallbackFolderNames: [
      'Qwen3.8-27B-EXL3-11.5GB',
      'Qwen-3.8-27B-VL-EXL3-4.0bpw',
      'Qwen-3.8-27B-VL-EXL3-3.5bpw',
    ],
    bpw: '3.5 bpw',
    maxSeqLen: 24576,
    cacheMode: 'Q4',
    autosplitReserve: [256],
    visionOffload: true,
    draftMode: 'ngram',
    hybridDraftTokens: 4,
    estimatedVramGb: 14.6,
  },
  high: {
    tier: 'high',
    displayName: 'Swift 1.5 Flash-Next High (IQ2_XS + Vision)',
    shortLabel: 'Flash-Next High',
    modelName: 'swift-1.5-iq2_xs',
    fallbackFolderNames: [
      'Swift-1.5',
      'Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS',
      'Qwen3.8-Flash-Next-IQ3_S',
      'Qwen3.8-Flash-Next-IQ3_XXS',
      'Qwen3.8-Flash-Next',
    ],
    bpw: 'IQ3_S (Sparse MoE + Vision)',
    maxSeqLen: 65536,
    cacheMode: 'Q4',
    autosplitReserve: [256],
    visionOffload: true,
    draftMode: 'ngram',
    hybridDraftTokens: 4,
    estimatedVramGb: 14.8,
  },
};

export const THINKING_BUDGET_SPECS: Record<
  ThinkingBudget,
  {
    budget: ThinkingBudget;
    maxThinkingTokens: number;
    followUpStepMaxThinkingTokens: number;
    prefillClosedThink: boolean;
    systemDirective: string;
  }
> = {
  off: {
    budget: 'off',
    maxThinkingTokens: 0,
    followUpStepMaxThinkingTokens: 256,
    prefillClosedThink: true,
    systemDirective:
      'THINKING BUDGET: OFF (0 tokens). Execute requested tools or respond directly with zero deliberation.',
  },
  fast: {
    budget: 'fast',
    maxThinkingTokens: 1024,
    followUpStepMaxThinkingTokens: 640,
    prefillClosedThink: true,
    systemDirective:
      'THINKING BUDGET: FAST. Reason concisely to select tools accurately, then execute immediately.',
  },
  deep: {
    budget: 'deep',
    maxThinkingTokens: 2560,
    followUpStepMaxThinkingTokens: 1024,
    prefillClosedThink: false,
    systemDirective:
      'THINKING BUDGET: DEEP (Goal-Directed Action). Plan concisely (under 20 lines): determine objective, select exact tools/files, then IMMEDIATELY execute. Never output speculative prose or monologue in place of executing real tool calls.',
  },
  low: {
    budget: 'low',
    maxThinkingTokens: 512,
    followUpStepMaxThinkingTokens: 512,
    prefillClosedThink: true,
    systemDirective:
      'THINKING LEVEL: LOW. Reason briefly to select tools accurately, then execute immediately.',
  },
  medium: {
    budget: 'medium',
    maxThinkingTokens: 1024,
    followUpStepMaxThinkingTokens: 640,
    prefillClosedThink: true,
    systemDirective:
      'THINKING LEVEL: MEDIUM. Reason concisely to select tools accurately, then execute immediately.',
  },
  high: {
    budget: 'high',
    maxThinkingTokens: 2560,
    followUpStepMaxThinkingTokens: 1024,
    prefillClosedThink: false,
    systemDirective:
      'THINKING LEVEL: HIGH. Plan concisely: determine objective, select exact tools/files, then IMMEDIATELY execute.',
  },
  xhigh: {
    budget: 'xhigh',
    maxThinkingTokens: 4096,
    followUpStepMaxThinkingTokens: 1536,
    prefillClosedThink: false,
    systemDirective:
      'THINKING LEVEL: EXTRA HIGH. Perform thorough verification and multi-step reasoning, then execute accurately.',
  },
};
