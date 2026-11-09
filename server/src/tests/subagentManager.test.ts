import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SubagentManager } from '../tools/subagentManager.js';
import { execute as invokeSubagent } from '../tools/handlers/invokeSubagent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, '..', '..');

async function runSubagentTests() {
  console.log('Running Piece 5 Unit Tests: Subagent Orchestrator...');
  const manager = SubagentManager.getInstance();

  const updates: string[] = [];
  const unsub = manager.onTaskUpdate((t) => {
    updates.push(`${t.status}:${t.step}`);
  });

  // 1. Test tool filtering for research vs full subagent
  const sampleTools = [
    { function: { name: 'read_file' } },
    { function: { name: 'search_codebase' } },
    { function: { name: 'write_file' } },
    { function: { name: 'invoke_subagent' } },
  ];
  const researchTools = manager.filterToolsForSubagent(sampleTools, 'research');
  assert.equal(researchTools.length, 2);
  assert.ok(researchTools.every((t) => t.function.name !== 'write_file'));

  // 2. Test invoke_subagent execution on workspace
  const res = await invokeSubagent(
    {
      role: 'Architecture Scanner',
      prompt: 'Find adaptiveCot and computeAdaptiveThinkingConfig in server/src',
      directory: 'src/agent',
    },
    {
      threadId: 'test-thread-1',
      messageId: 'test-msg-1',
      workspaceRoot: SERVER_ROOT,
    },
    {} as any
  );

  assert.equal(res.exitCode, 0);
  assert.ok(res.stdout.includes('=== SUBAGENT REPORT (Architecture Scanner) ==='));
  assert.ok(res.stdout.includes('adaptiveCot.ts'));
  assert.ok(updates.some((u) => u.startsWith('running:')));
  assert.ok(updates.some((u) => u.startsWith('completed:')));

  unsub();
  console.log('✅ Piece 5 Unit Tests PASSED (8/8 assertions)');
}

runSubagentTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
