import assert from 'node:assert/strict';
import { computeAdaptiveThinkingConfig, computeOrchestratorStepConfig } from '../agent/adaptiveCot.js';
import { isStrataOrchestratorTier } from '../tabby/modelSpecs.js';

function runAdaptiveCotTests() {
  console.log('Running Piece 1 Unit Tests: Adaptive Chain-of-Thought...');

  // 1. Budget 'off' should always disable thinking on every step
  const offStep1 = computeAdaptiveThinkingConfig('off', 1);
  assert.equal(offStep1.enableThinking, false);
  assert.equal(offStep1.reasoningEffort, 'none');
  assert.equal(offStep1.reasoningBudgetTokens, 0);

  const offStep3 = computeAdaptiveThinkingConfig('off', 3);
  assert.equal(offStep3.enableThinking, false);
  assert.equal(offStep3.reasoningBudgetTokens, 0);

  // 2. Budget 'fast' should use 1024 tokens on Step 1, and throttle to 640 tokens on Step 2+
  const fastStep1 = computeAdaptiveThinkingConfig('fast', 1);
  assert.equal(fastStep1.enableThinking, true);
  assert.equal(fastStep1.reasoningEffort, 'medium');
  assert.equal(fastStep1.reasoningBudgetTokens, 1024);

  const fastStep2 = computeAdaptiveThinkingConfig('fast', 2);
  assert.equal(fastStep2.enableThinking, true);
  assert.equal(fastStep2.reasoningEffort, 'low');
  assert.equal(fastStep2.reasoningBudgetTokens, 640);

  const fastStep5 = computeAdaptiveThinkingConfig('fast', 5);
  assert.equal(fastStep5.reasoningBudgetTokens, 640);

  // 3. Budget 'deep' should use 2560 on Step 1, and 1024 on Step 2+
  const deepStep1 = computeAdaptiveThinkingConfig('deep', 1);
  assert.equal(deepStep1.enableThinking, true);
  assert.equal(deepStep1.reasoningEffort, 'high');
  assert.equal(deepStep1.reasoningBudgetTokens, 2560);

  const deepStep2 = computeAdaptiveThinkingConfig('deep', 2);
  assert.equal(deepStep2.reasoningEffort, 'medium');
  assert.equal(deepStep2.reasoningBudgetTokens, 1024);

  const deepStep3 = computeAdaptiveThinkingConfig('deep', 3);
  assert.equal(deepStep3.reasoningEffort, 'low');
  assert.equal(deepStep3.reasoningBudgetTokens, 1024);

  // 4. Strata Orchestrator helper tier detection
  assert.equal(isStrataOrchestratorTier('high'), false);
  assert.equal(isStrataOrchestratorTier('medium'), true);
  assert.equal(isStrataOrchestratorTier('low'), true);

  // 5. Orchestrator - Swift 1.5 ('medium'): Think Once (Step 1) -> Execute Fast (Step 2+) -> Recover on Error
  const medStep1 = computeOrchestratorStepConfig('medium', 1, false);
  assert.equal(medStep1.enableThinking, true);
  assert.equal(medStep1.reasoningEffort, 'high');
  assert.equal(medStep1.reasoningBudgetTokens, 2560);
  assert.equal(medStep1.prefillClosedThink, false);
  assert.equal(medStep1.targetStrataProfile, 'swift-1.5-iq2_xs');

  const medStep2 = computeOrchestratorStepConfig('medium', 2, false);
  assert.equal(medStep2.enableThinking, false);
  assert.equal(medStep2.reasoningEffort, 'none');
  assert.equal(medStep2.reasoningBudgetTokens, 0);
  assert.equal(medStep2.prefillClosedThink, true);
  assert.equal(medStep2.targetStrataProfile, 'swift-1.5-iq2_xs');

  const medRecover = computeOrchestratorStepConfig('medium', 3, true);
  assert.equal(medRecover.hadToolError, true);
  assert.equal(medRecover.enableThinking, true);
  assert.equal(medRecover.reasoningEffort, 'medium');
  assert.equal(medRecover.reasoningBudgetTokens, 1024);
  assert.equal(medRecover.targetStrataProfile, 'swift-1.5-iq2_xs');

  // 6. Orchestrator - Qwen 3.6 35B MoE - Swift 1.5 ('low'): Swift Plan -> Qwen 3.6 Fast Build -> Swift Recover
  const lowStep1 = computeOrchestratorStepConfig('low', 1, false);
  assert.equal(lowStep1.enableThinking, true);
  assert.equal(lowStep1.reasoningEffort, 'high');
  assert.equal(lowStep1.reasoningBudgetTokens, 2560);
  assert.equal(lowStep1.targetStrataProfile, 'swift-1.5-iq2_xs');

  const lowStep2 = computeOrchestratorStepConfig('low', 2, false);
  assert.equal(lowStep2.enableThinking, false);
  assert.equal(lowStep2.reasoningEffort, 'none');
  assert.equal(lowStep2.reasoningBudgetTokens, 0);
  assert.equal(lowStep2.prefillClosedThink, true);
  assert.equal(lowStep2.targetStrataProfile, 'qwen36-ud-q4_k_xl');

  const lowRecover = computeOrchestratorStepConfig('low', 4, true);
  assert.equal(lowRecover.hadToolError, true);
  assert.equal(lowRecover.enableThinking, true);
  assert.equal(lowRecover.reasoningEffort, 'medium');
  assert.equal(lowRecover.reasoningBudgetTokens, 1024);
  assert.equal(lowRecover.targetStrataProfile, 'swift-1.5-iq2_xs');

  console.log('✅ Piece 1 Unit Tests PASSED (15/15 assertions & Orchestrator checks)');
}

runAdaptiveCotTests();
