import assert from 'node:assert';
import { detectPrematureStop } from '../prematureStop.js';

console.log('🧪 Testing Premature Stop Detection...');

// Case 1: The user's exact issue: summary paragraph followed by trailing "Let me verify..."
const userCase = `Batch 2 complete and green ( EXIT=0 ). Let me verify the asExec() bridge actually exposes the manager deps my handlers use at runtime (compile-check alone can't prove this).`;
const res1 = detectPrematureStop(userCase, false, 0, 2, 'do the next batch');
assert.strictEqual(res1.shouldContinue, true, 'User case must trigger auto-continue');
assert(res1.continuationPrompt.includes('asExec() bridge'), 'Continuation prompt must reference the promised action');
console.log('✅ Case 1 Passed: Trailing action intent after status summary triggers auto-continue.');

// Case 2: Multiline output ending in "I will now check..."
const multilineCase = `Refactored the files cleanly.\nAll tests compile.\n\nNow let me check the runtime outputs.`;
const res2 = detectPrematureStop(multilineCase, true, 0, 2);
assert.strictEqual(res2.shouldContinue, true, 'Multiline trailing intent must trigger auto-continue');
console.log('✅ Case 2 Passed: Multiline trailing intent triggers auto-continue.');

// Case 3: Empty content
const emptyCase = '';
const res3 = detectPrematureStop(emptyCase, false, 0, 2);
assert.strictEqual(res3.shouldContinue, true, 'Empty content must trigger auto-continue');
console.log('✅ Case 3 Passed: Empty output triggers auto-continue.');

// Case 4: Output ending in colon
const colonCase = 'Here are the next steps to execute:';
const res4 = detectPrematureStop(colonCase, false, 0, 2);
assert.strictEqual(res4.shouldContinue, true, 'Trailing colon must trigger auto-continue');
console.log('✅ Case 4 Passed: Trailing colon triggers auto-continue.');

// Case 5: Normal completed response without trailing promise
const normalCase = 'All 15 tests have passed cleanly with exit code 0. Here is the final summary of changes.';
const res5 = detectPrematureStop(normalCase, true, 0, 2);
assert.strictEqual(res5.shouldContinue, false, 'Completed response must NOT continue');
console.log('✅ Case 5 Passed: Normal completed response correctly ends turn.');

// Case 6: Max auto-continues reached
const res6 = detectPrematureStop(userCase, false, 2, 2);
assert.strictEqual(res6.shouldContinue, false, 'Max auto-continues must be respected');
console.log('✅ Case 6 Passed: Auto-continue count limit enforced.');

console.log('🎉 All Premature Stop Detection tests passed cleanly!');
