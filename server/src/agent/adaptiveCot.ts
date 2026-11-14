import type { ModelTier, ThinkingBudget } from '../db/database.js';
import type { StrataProfileId } from '../tabby/llamaSidecar.js';

export interface AdaptiveThinkingConfig {
  budget: ThinkingBudget;
  stepIndex: number;
  enableThinking: boolean;
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  reasoningBudgetTokens: number;
  prefillClosedThink: boolean;
  modeLabel: string;
}

export interface OrchestratorStepConfig {
  tier: ModelTier;
  stepIndex: number;
  hadToolError: boolean;
  enableThinking: boolean;
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  reasoningBudgetTokens: number;
  prefillClosedThink: boolean;
  targetStrataProfile: StrataProfileId;
  executionDirective: string;
  modeLabel: string;
}

/**
 * Computes per-step config for Strata Orchestrator tiers:
 * - 'medium' (Orchestrator - Swift 1.5): Think-Once (Step 1) + Execute-Fast w/ Thinking OFF (Step 2+),
 *   re-enabling Thinking if the prior step encountered a tool error.
 * - 'low' (Orchestrator - Qwen 3.6 35B MoE - Swift 1.5): Plans & recovers from errors on Swift 1.5
 *   with Thinking ON, then hands fast buildout/edits (Step 2+) to Qwen 3.6 35B-A3B with Thinking OFF.
 */
export function computeOrchestratorStepConfig(
  tier: ModelTier,
  stepIndex = 1,
  hadToolError = false
): OrchestratorStepConfig {
  const step = Math.max(1, Math.floor(stepIndex));
  const isDualModel = tier === 'low';

  if (step === 1) {
    return {
      tier,
      stepIndex: step,
      hadToolError: false,
      enableThinking: true,
      reasoningEffort: 'high',
      reasoningBudgetTokens: 2560,
      prefillClosedThink: false,
      targetStrataProfile: 'swift-1.5-iq2_xs',
      executionDirective:
        '[STRATA ORCHESTRATOR — PLAN STEP]: Think concisely once to map out target files, symbols, edge cases, and verification steps, then IMMEDIATELY invoke the first tool(s).',
      modeLabel: isDualModel
        ? 'Orchestrator Plan (Swift 1.5 → Qwen 3.6 35B • Thinking ON • Step 1)'
        : 'Orchestrator Plan (Swift 1.5 • Thinking ON • Step 1)',
    };
  }

  if (hadToolError) {
    return {
      tier,
      stepIndex: step,
      hadToolError: true,
      enableThinking: true,
      reasoningEffort: 'medium',
      reasoningBudgetTokens: 1024,
      prefillClosedThink: false,
      targetStrataProfile: 'swift-1.5-iq2_xs',
      executionDirective:
        '[STRATA ORCHESTRATOR — ERROR RECOVERY]: Previous tool execution reported an error. Diagnose the failure concisely and issue corrective surgical edits or checks.',
      modeLabel: isDualModel
        ? `Orchestrator Error Recovery (Swift 1.5 • Thinking ON • Step ${step})`
        : `Orchestrator Error Recovery (Swift 1.5 • Thinking ON • Step ${step})`,
    };
  }

  if (isDualModel) {
    return {
      tier,
      stepIndex: step,
      hadToolError: false,
      enableThinking: false,
      reasoningEffort: 'none',
      reasoningBudgetTokens: 0,
      prefillClosedThink: true,
      targetStrataProfile: 'qwen36-ud-q4_k_xl',
      executionDirective:
        '[STRATA FAST BUILDER — QWEN 3.6 35B-A3B • THINKING OFF]: Execute the plan rapidly. Emit tool calls directly with zero deliberation. Prefer surgical edit_file / apply_diff patches over rewriting whole files.',
      modeLabel: `Fast Builder Execute (Qwen 3.6 35B-A3B • Thinking OFF • Step ${step})`,
    };
  }

  return {
    tier,
    stepIndex: step,
    hadToolError: false,
    enableThinking: false,
    reasoningEffort: 'none',
    reasoningBudgetTokens: 0,
    prefillClosedThink: true,
    targetStrataProfile: 'swift-1.5-iq2_xs',
    executionDirective:
      '[STRATA FAST BUILDER — SWIFT 1.5 • THINKING OFF]: Execute the plan rapidly. Emit tool calls directly with zero deliberation. Prefer surgical edit_file / apply_diff patches over rewriting whole files.',
    modeLabel: `Fast Builder Execute (Swift 1.5 • Thinking OFF • Step ${step})`,
  };
}

/**
 * Computes the per-step Adaptive Chain-of-Thought configuration.
 * - Step 1 (Initial Planning): Uses the user's selected thinking budget to plan cleanly.
 * - Step 2+ (Follow-up Tool Loops): Dynamically throttles thinking tokens so tool iterations
 *   (read_file -> apply_diff -> run_terminal) execute in 1-2 seconds instead of 30+ seconds.
 */
export function computeAdaptiveThinkingConfig(
  thinkingBudget: ThinkingBudget,
  stepIndex = 1
): AdaptiveThinkingConfig {
  const step = Math.max(1, Math.floor(stepIndex));

  if (thinkingBudget === 'off') {
    return {
      budget: 'off',
      stepIndex: step,
      enableThinking: false,
      reasoningEffort: 'none',
      reasoningBudgetTokens: 0,
      prefillClosedThink: true,
      modeLabel: `Direct Execution (0 tok • Step ${step})`,
    };
  }

  if (thinkingBudget === 'fast') {
    if (step === 1) {
      return {
        budget: 'fast',
        stepIndex: 1,
        enableThinking: true,
        reasoningEffort: 'medium',
        reasoningBudgetTokens: 1024,
        prefillClosedThink: false,
        modeLabel: 'Fast Plan (1024 tok budget • Step 1)',
      };
    }
    return {
      budget: 'fast',
      stepIndex: step,
      enableThinking: true,
      reasoningEffort: 'low',
      reasoningBudgetTokens: 640,
      prefillClosedThink: false,
      modeLabel: `Fast Tool Loop (640 tok throttle • Step ${step})`,
    };
  }

  // 'deep' thinking budget
  if (step === 1) {
    return {
      budget: 'deep',
      stepIndex: 1,
      enableThinking: true,
      reasoningEffort: 'high',
      reasoningBudgetTokens: 2560,
      prefillClosedThink: false,
      modeLabel: 'Deep Architecture Plan (2560 tok budget • Step 1)',
    };
  }

  if (step === 2) {
    return {
      budget: 'deep',
      stepIndex: 2,
      enableThinking: true,
      reasoningEffort: 'medium',
      reasoningBudgetTokens: 1024,
      prefillClosedThink: false,
      modeLabel: 'Adaptive Verification (1024 tok budget • Step 2)',
    };
  }

  return {
    budget: 'deep',
    stepIndex: step,
    enableThinking: true,
    reasoningEffort: 'low',
    reasoningBudgetTokens: 1024,
    prefillClosedThink: false,
    modeLabel: `Rapid Tool Loop (1024 tok budget • Step ${step})`,
  };
}
