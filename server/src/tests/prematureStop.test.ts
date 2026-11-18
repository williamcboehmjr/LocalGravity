import assert from 'node:assert/strict';
import { detectPrematureStop } from '../agent/prematureStop.js';

function runPrematureStopTests() {
  console.log('🧪 Running Premature Stop Guard Unit Tests...');

  // 1. Empty output after <think>
  const r1 = detectPrematureStop('   ', false, 0, 5);
  assert.equal(r1.shouldContinue, true);

  // 1b. Leaked raw XML / JSON <tool_call>
  const r1bXml = detectPrematureStop('<tool_call><function=read_file><parameter=path>foo.ts</parameter></function></tool_call>', false, 0, 5);
  assert.equal(r1bXml.shouldContinue, true);
  assert.match(r1bXml.continuationPrompt, /NOT executed/);

  const r1bJson = detectPrematureStop('{"name": "comfyui", "arguments": {"prompt": "cat"}}', false, 0, 5);
  assert.equal(r1bJson.shouldContinue, true);

  // 2. Colon preamble
  const r2 = detectPrematureStop('Let me run the tests directly:', false, 0, 5);
  assert.equal(r2.shouldContinue, true);

  // 3. Action intent trailing & before short filler sentence
  const r3a = detectPrematureStop("Everything built cleanly. Next, I'll edit `ChatFeed.tsx` to add memoization. One moment.", true, 0, 5);
  assert.equal(r3a.shouldContinue, true, 'Prev sentence action intent should trigger continuation');

  // 3b. Fixed helplessClaimRegex ending with punctuation (no trailing space typo!)
  const r3b = detectPrematureStop('I cannot browse the web. Please check it manually.', false, 0, 5);
  assert.equal(r3b.shouldContinue, true, 'Helpless claim ending in period must match');

  const r3bComma = detectPrematureStop('As an AI language model, I lack access.', false, 0, 5);
  assert.equal(r3bComma.shouldContinue, true, 'Helpless claim ending in comma must match');

  // 3c. Unnecessary permission hedging
  const r3c = detectPrematureStop('I inspected the route. Would you like me to implement the fix?', true, 0, 5, 'fix the route');
  assert.equal(r3c.shouldContinue, true);

  // 4. Hallucinated edits after read-only inspection
  const r4Fake = detectPrematureStop(
    'Refactor #1 complete! All diffs applied cleanly and npm run build succeeded.',
    true,
    0,
    5,
    'refactor index.ts',
    ['read_file', 'find_files']
  );
  assert.equal(r4Fake.shouldContinue, true, 'Read-only tools followed by fake build claim must trigger continuation');

  const r4Real = detectPrematureStop(
    'Refactor complete. npm run build passed cleanly.',
    true,
    0,
    5,
    'refactor index.ts',
    ['read_file', 'edit_file', 'run_terminal']
  );
  assert.equal(r4Real.shouldContinue, false, 'Real mutation + build tool allows clean completion');

  // 4b. Unexecuted ComfyUI promise vs genuine Q&A question
  const r4bFake = detectPrematureStop(
    '[MCP Image saved to: C:/fake/cat.png](/api/mcp-outputs/cat.png)',
    true,
    0,
    5,
    'generate an image of a cat with moss',
    ['read_file']
  );
  assert.equal(r4bFake.shouldContinue, true, 'Fake image output without comfyui tool call must retry');

  const r4bQa = detectPrematureStop(
    'You can use MOSS for balanced quality, or Z-Image Turbo / Krea 2 for 8-9 step speed.',
    false,
    0,
    5,
    'should I only be using moss for fast turns?',
    []
  );
  assert.equal(r4bQa.shouldContinue, false, 'Genuine Q&A about MOSS should not force comfyui call');

  // Respect maxAutoContinues cap
  const rMax = detectPrematureStop('', false, 5, 5);
  assert.equal(rMax.shouldContinue, false);

  console.log('✅ All Premature Stop Guard Unit Tests PASSED');
}

runPrematureStopTests();
