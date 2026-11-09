import type { ThinkingBudget } from '../db/database.js';

export interface AdaptiveThinkingConfig {
  budget: ThinkingBudget;
  stepIndex: number;
  enableThinking: boolean;
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  reasoningBudgetTokens: number;
  prefillClosedThink: boolean;
  modeLabel: string;
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
        reasoningEffort: 'low',
        reasoningBudgetTokens: 180,
        prefillClosedThink: false,
        modeLabel: 'Fast Plan (180 tok budget • Step 1)',
      };
    }
    return {
      budget: 'fast',
      stepIndex: step,
      enableThinking: true,
      reasoningEffort: 'low',
      reasoningBudgetTokens: 64,
      prefillClosedThink: false,
      modeLabel: `Fast Tool Loop (64 tok throttle • Step ${step})`,
    };
  }

  // 'deep' thinking budget
  if (step === 1) {
    return {
      budget: 'deep',
      stepIndex: 1,
      enableThinking: true,
      reasoningEffort: 'high',
      reasoningBudgetTokens: 768,
      prefillClosedThink: false,
      modeLabel: 'Deep Architecture Plan (768 tok budget • Step 1)',
    };
  }

  if (step === 2) {
    return {
      budget: 'deep',
      stepIndex: 2,
      enableThinking: true,
      reasoningEffort: 'low',
      reasoningBudgetTokens: 192,
      prefillClosedThink: false,
      modeLabel: 'Adaptive Verification (192 tok throttle • Step 2)',
    };
  }

  return {
    budget: 'deep',
    stepIndex: step,
    enableThinking: true,
    reasoningEffort: 'low',
    reasoningBudgetTokens: 80,
    prefillClosedThink: false,
    modeLabel: `Rapid Tool Loop (80 tok throttle • Step ${step})`,
  };
}
