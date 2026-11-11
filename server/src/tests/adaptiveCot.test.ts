import assert from 'node:assert/strict';
import { computeAdaptiveThinkingConfig } from '../agent/adaptiveCot.js';

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

  // 2. Budget 'fast' should use 180 tokens on Step 1, and throttle to 256 tokens on Step 2+
  const fastStep1 = computeAdaptiveThinkingConfig('fast', 1);
  assert.equal(fastStep1.enableThinking, true);
  assert.equal(fastStep1.reasoningEffort, 'low');
  assert.equal(fastStep1.reasoningBudgetTokens, 180);

  const fastStep2 = computeAdaptiveThinkingConfig('fast', 2);
  assert.equal(fastStep2.enableThinking, true);
  assert.equal(fastStep2.reasoningEffort, 'low');
  assert.equal(fastStep2.reasoningBudgetTokens, 256);

  const fastStep5 = computeAdaptiveThinkingConfig('fast', 5);
  assert.equal(fastStep5.reasoningBudgetTokens, 256);

  // 3. Budget 'deep' should use 768 on Step 1, 192 on Step 2, and 384 on Step 3+
  const deepStep1 = computeAdaptiveThinkingConfig('deep', 1);
  assert.equal(deepStep1.enableThinking, true);
  assert.equal(deepStep1.reasoningEffort, 'high');
  assert.equal(deepStep1.reasoningBudgetTokens, 768);

  const deepStep2 = computeAdaptiveThinkingConfig('deep', 2);
  assert.equal(deepStep2.reasoningEffort, 'low');
  assert.equal(deepStep2.reasoningBudgetTokens, 192);

  const deepStep3 = computeAdaptiveThinkingConfig('deep', 3);
  assert.equal(deepStep3.reasoningEffort, 'low');
  assert.equal(deepStep3.reasoningBudgetTokens, 384);

  console.log('✅ Piece 1 Unit Tests PASSED (8/8 assertions)');
}

runAdaptiveCotTests();
