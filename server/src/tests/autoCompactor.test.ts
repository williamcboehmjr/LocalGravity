import assert from 'node:assert/strict';
import { autoCompactMessages } from '../utils/autoCompactor.js';
import type { PrunableMessage } from '../utils/messagePruning.js';

function runAutoCompactorTests() {
  console.log('Running Piece 2 Unit Tests: Auto-Compaction Engine & Distilled Working Memory...');

  // 1. Small conversation under threshold should NOT trigger compaction
  const smallHistory: PrunableMessage[] = [
    { role: 'system', content: 'You are LocalGravity.' },
    { role: 'user', content: 'Hello world' },
    { role: 'assistant', content: 'Hi! How can I help?' },
  ];
  const res1 = autoCompactMessages(smallHistory, 36000);
  assert.equal(res1.didCompact, false);
  assert.equal(res1.messages.length, 3);

  // 2. Large multi-turn conversation crossing threshold should auto-compact middle turns
  const largeHistory: PrunableMessage[] = [
    { role: 'system', content: 'System Directive: Keep intact.' },
    { role: 'user', content: 'Build the ReconnectBadge component in client/src/components/' },
    {
      role: 'assistant',
      content: 'I will read App.tsx first.',
      tool_calls: [
        {
          id: 'tc1',
          type: 'function',
          function: { name: 'read_file', arguments: JSON.stringify({ path: 'client/src/App.tsx' }) },
        },
      ],
    },
    { role: 'tool', content: 'A'.repeat(18000) },
    {
      role: 'assistant',
      content: 'Now writing ReconnectBadge.tsx.',
      tool_calls: [
        {
          id: 'tc2',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: 'client/src/components/ReconnectBadge.tsx' }),
          },
        },
      ],
    },
    { role: 'tool', content: 'B'.repeat(18000) },
    { role: 'user', content: 'Now run the build and verify.' },
    { role: 'assistant', content: 'Running npm run build...' },
    { role: 'tool', content: '✓ built in 4.88s (EXIT=0)' },
    { role: 'user', content: 'Great, what is next?' },
    { role: 'assistant', content: 'Ready for release.' },
    { role: 'user', content: 'Publish the release.' },
  ];

  const res2 = autoCompactMessages(largeHistory, 20000, 4);
  assert.equal(res2.didCompact, true);
  assert.ok(res2.compactedTokens < res2.previousTokens, 'Compacted tokens must be significantly smaller');
  assert.equal(res2.messages[0].role, 'system');
  assert.equal(res2.messages[0].content, 'System Directive: Keep intact.');

  // Verify the distilled block contains the user objective and tool names
  const distilledMsg = res2.messages[1];
  assert.ok(distilledMsg.content.includes('[CONTEXT AUTO-COMPACTED'));
  assert.ok(distilledMsg.content.includes('Build the ReconnectBadge component'));
  assert.ok(distilledMsg.content.includes('read_file'));
  assert.ok(distilledMsg.content.includes('write_file'));

  // Verify recent 4 messages are preserved at the tail
  const lastMsg = res2.messages[res2.messages.length - 1];
  assert.equal(lastMsg.content, 'Publish the release.');

  console.log(
    `✅ Piece 2 Unit Tests PASSED (Compacted ${res2.previousTokens} tok -> ${res2.compactedTokens} tok)`
  );
}

runAutoCompactorTests();
