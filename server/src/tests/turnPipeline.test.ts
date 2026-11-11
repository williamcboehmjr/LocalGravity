import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { LocalGravityDB } from '../db/database.js';
import { autoCompactMessages } from '../utils/autoCompactor.js';
import { measureMessageTextLength, pruneChatMessages, type PrunableMessage } from '../utils/messagePruning.js';
import { createPromptTurnHandler, type ActiveTurnSnapshot } from '../agent/promptTurn.js';

async function runTurnPipelineTests() {
  console.log('Running Phase 1 Turn Pipeline & Compaction Safety Unit Tests...');

  // 1. autoCompactor + messagePruning: never orphan role:'tool' at recentBoundary
  const toolChainHistory: PrunableMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'First task ' + 'x'.repeat(1200) },
    {
      role: 'assistant',
      content: 'Calling tool A',
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'tc1', content: 'R'.repeat(1500) },
    {
      role: 'assistant',
      content: 'Calling tool B',
      tool_calls: [{ id: 'tc2', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'tc2', content: 'S'.repeat(1500) },
    { role: 'user', content: 'Final follow-up' },
  ];
  // keepRecentCount = 2 would normally slice right onto role:'tool' (tc2)!
  const compacted = autoCompactMessages(toolChainHistory, 2200, 2);
  assert.equal(compacted.didCompact, true);
  // First message after [system, distilled-user] must NOT be role:'tool'
  const firstRecent = compacted.messages[2];
  assert.ok(firstRecent, 'Expected recent messages to be retained');
  assert.notEqual(firstRecent.role, 'tool', 'Compaction must never leave an orphaned tool message at recentBoundary');
  assert.equal(firstRecent.role, 'assistant');
  for (let i = 0; i < compacted.messages.length; i++) {
    if (compacted.messages[i].role === 'tool') {
      assert.ok(i > 0 && compacted.messages[i - 1].role === 'assistant', 'No orphaned tool messages after compaction');
    }
  }

  // 2. Multimodal array content & base64 stripping length measurement
  const hugeBase64 = 'data:image/png;base64,' + 'A'.repeat(200000);
  const mmLen = measureMessageTextLength([
    { type: 'text', text: 'Inspect this image' },
    { type: 'image_url', image_url: { url: hugeBase64 } },
  ]);
  assert.equal(mmLen, 'Inspect this image'.length);

  // Stage 4 pruning with sole user message must drop assistant+tool pairs atomically
  const stage4History: PrunableMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'Sole user query' },
    {
      role: 'assistant',
      content: 'Step 1',
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'a', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 't1', content: 'Z'.repeat(500) },
    { role: 'assistant', content: 'Recent step' },
    { role: 'user', content: 'Wait — second user' },
  ];
  const pruned = pruneChatMessages(stage4History, 200);
  for (let i = 0; i < pruned.length; i++) {
    if (pruned[i].role === 'tool') {
      assert.ok(i > 0 && pruned[i - 1].role === 'assistant', 'pruneChatMessages must never orphan tool messages');
    }
  }

  // 3. Full handlePromptTurn lifecycle: TURN_PHASE contract, THOUGHT_STREAM close, empty-prose fallback broadcast
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-turn-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new LocalGravityDB(dbPath);
  const events: Array<{ type: string; payload: any }> = [];
  const activeAbortControllers = new Map<string, AbortController>();
  const activeTurns = new Map<string, ActiveTurnSnapshot>();

  let callNum = 0;
  const fakeTabby: any = {
    getTelemetry: () => ({ tokensPerSec: 42.0, activeTier: 'high' }),
    streamChatCompletion: async (params: any) => {
      callNum++;
      if (callNum === 1) {
        params.onThoughtDelta('Checking files...', 50, 4);
        params.onTokenDelta('Checking now.', 3, 42);
        params.onToolCallPreparing?.('read_file');
        await params.onToolCallRequest('read_file', { path: 'foo.ts' });
        return {
          content: 'Checking now.', // < 200 chars unstructured -> step note
          thinkingContent: 'Checking files...',
          thinkingDurationMs: 50,
          thinkingTokens: 4,
          outputTokens: 3,
        };
      }
      // Step 2 returns empty text with no tools (simulates silent final step)
      params.onThoughtDelta('All done.', 20, 2);
      return {
        content: '',
        thinkingContent: 'All done.',
        thinkingDurationMs: 20,
        thinkingTokens: 2,
        outputTokens: 0,
      };
    },
  };

  const handleTurn = createPromptTurnHandler({
    db,
    tabby: fakeTabby,
    mcp: { exportOpenAiTools: () => [] } as any,
    skills: { buildSkillsPromptSection: () => '' } as any,
    tools: {
      executeTool: async () => ({ exitCode: 0, stdout: 'file contents', stderr: '', durationMs: 5 }),
    } as any,
    harness: {
      buildCompiledHarnessPrompt: () => '',
      recordToolOutcomeAndMaybeRunPPC: async () => null,
      listHarnessComponents: () => [],
    } as any,
    terminal: {} as any,
    attachmentManager: { saveAttachment: async () => ({}) } as any,
    broadcastSync: (ev) => events.push(ev as any),
    activeAbortControllers,
    activeTurns,
    repoRoot: tmpDir,
  });

  await handleTurn({
    threadId: 'thread-test-1',
    prompt: 'Inspect foo.ts',
    tier: 'high',
    thinkingBudget: 'fast',
  });

  const phaseEvents = events.filter((e) => e.type === 'TURN_PHASE');
  assert.ok(phaseEvents.length >= 5, 'Should emit multiple TURN_PHASE transitions');
  let prevSeq = 0;
  for (const pe of phaseEvents) {
    assert.ok(pe.payload.seq > prevSeq, 'TURN_PHASE seq must be strictly monotonic');
    prevSeq = pe.payload.seq;
    assert.equal(pe.payload.thread_id, 'thread-test-1');
    assert.equal(pe.payload.threadId, 'thread-test-1');
    assert.ok(pe.payload.turn_id);
    assert.equal(pe.payload.turn_id, pe.payload.message_id);
    assert.ok(!String(pe.payload.status_label).includes('${'), `status_label must be interpolated: ${pe.payload.status_label}`);
  }
  const phases = phaseEvents.map((e) => e.payload.phase);
  assert.equal(phases[0], 'queued');
  assert.ok(phases.includes('prefilling'));
  assert.ok(phases.includes('thinking'));
  assert.ok(phases.includes('preparing_tool_call'));
  assert.ok(phases.includes('executing_tools'));
  assert.equal(phases[phases.length - 1], 'completed');
  assert.equal(phaseEvents[phaseEvents.length - 1].payload.is_active, false);

  const thoughtClosed = events.some((e) => e.type === 'THOUGHT_STREAM' && e.payload.is_finished === true);
  assert.ok(thoughtClosed, 'Should emit THOUGHT_STREAM { is_finished: true }');

  const subagentDone = events.find((e) => e.type === 'SUBAGENT_EVENT' && e.payload.status === 'completed');
  assert.ok(subagentDone, 'Should emit SUBAGENT_EVENT status=completed');

  const tokenChunks = events.filter((e) => e.type === 'TOKEN_STREAM' && !e.payload.is_finished);
  assert.ok(tokenChunks.some((e) => String(e.payload.chunk).trim().length > 0), 'Fallback prose must be broadcast via TOKEN_STREAM');

  const completedEv = events.find((e) => e.type === 'TURN_COMPLETED');
  assert.ok(completedEv && String(completedEv.payload.final_content || '').trim().length > 0, 'TURN_COMPLETED must include final_content');
  assert.equal(activeTurns.size, 0);
  assert.equal(activeAbortControllers.size, 0);

  db.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  console.log('✅ Phase 1 Turn Pipeline & Compaction Safety Unit Tests PASSED');
}

runTurnPipelineTests().catch((err) => {
  console.error('❌ Turn Pipeline test failed:', err);
  process.exit(1);
});
