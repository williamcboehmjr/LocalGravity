import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectScopedTools, buildLeanSystemDirective, PI_CORE_TOOL_NAMES } from '../tools/toolScoper.js';
import { BUILTIN_TOOLS_SCHEMA } from '../tools/builtinToolsSchema.js';
import { SKILL_TOOLS_SCHEMA, SkillManager } from '../skills/skillManager.js';
import { parseAntigravitySlashCommand } from '../agent/slashCommands.js';
import { LocalGravityDB } from '../db/database.js';
import { BuiltinToolExecutor } from '../tools/builtinTools.js';
import { McpClientManager } from '../mcp/mcpManager.js';
import { autoCompactMessages } from '../utils/autoCompactor.js';
import type { PrunableMessage } from '../utils/messagePruning.js';

async function runPiHarnessUpgradeTests() {
  console.log('Running Pi Harness Upgrades Unit Tests...');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-pi-upgrades-'));
  const dbPath = path.join(tmpRoot, 'test.sqlite');
  let db: LocalGravityDB | null = null;

  try {
    // 1. Dynamic tool scoping & lean system directive
    const fakeMcpTools = [
      { type: 'function', function: { name: 'mcp_demo_ping', description: 'demo', parameters: { type: 'object', properties: {} } } },
    ];
    const leanTools = selectScopedTools({
      prompt: 'Fix a typo in app.ts',
      slashCommand: '/lean',
      forceLean: true,
      builtinTools: BUILTIN_TOOLS_SCHEMA,
      skillTools: SKILL_TOOLS_SCHEMA,
      mcpTools: fakeMcpTools,
    });
    const leanNames = new Set(leanTools.map((t) => t.function.name));
    for (const coreName of PI_CORE_TOOL_NAMES) {
      assert.ok(leanNames.has(coreName), `Lean tools should include core tool ${coreName}`);
    }
    assert.ok(!leanNames.has('comfyui'), 'Lean tools should omit comfyui when unmentioned');
    assert.ok(!leanNames.has('mcp_demo_ping'), 'Lean tools should omit MCP tools');

    const adaptivePlain = selectScopedTools({
      prompt: 'Update hello.ts',
      builtinTools: BUILTIN_TOOLS_SCHEMA,
      skillTools: SKILL_TOOLS_SCHEMA,
      mcpTools: fakeMcpTools,
    });
    const plainNames = new Set(adaptivePlain.map((t) => t.function.name));
    assert.ok(!plainNames.has('comfyui'), 'Adaptive plain prompt should omit comfyui');
    assert.ok(!plainNames.has('capture_screen'), 'Adaptive plain prompt should omit capture_screen');
    assert.ok(plainNames.has('mcp_demo_ping'), 'Adaptive mode should include MCP tools');

    const adaptiveComfy = selectScopedTools({
      prompt: 'Generate an image with ComfyUI using Moss Image.json',
      builtinTools: BUILTIN_TOOLS_SCHEMA,
      skillTools: SKILL_TOOLS_SCHEMA,
      mcpTools: fakeMcpTools,
    });
    const comfyNames = new Set(adaptiveComfy.map((t) => t.function.name));
    assert.ok(comfyNames.has('comfyui'), 'Comfy prompt should unlock comfyui');
    assert.ok(comfyNames.has('download_file'), 'Comfy prompt should unlock download_file');

    const unlockedPrev = selectScopedTools({
      prompt: 'Now summarize',
      forceLean: true,
      builtinTools: BUILTIN_TOOLS_SCHEMA,
      skillTools: SKILL_TOOLS_SCHEMA,
      mcpTools: [],
      previouslyUsedTools: ['patch_json'],
    });
    assert.ok(
      unlockedPrev.some((t) => t.function.name === 'patch_json'),
      'previouslyUsedTools must keep unlocked tools active across steps'
    );

    const leanPrompt = buildLeanSystemDirective({
      projectName: 'LocalGravity',
      projectRoot: tmpRoot,
      gitBranch: 'main',
      userHome: os.homedir(),
      engineLine: '- Strata Engine active',
      skillsSection: '',
      compiledHarness: 'Keep it clean and verified.',
    });
    const approxTokens = Math.ceil(leanPrompt.length / 4);
    assert.ok(approxTokens < 800, `Expected lean directive < 800 tokens, got ${approxTokens}`);

    // 2. Slash commands: /lean and /reload
    const leanCmd = parseAntigravitySlashCommand('/lean Refactor foo.ts');
    assert.equal(leanCmd.command, '/lean');
    assert.equal(leanCmd.cleanPrompt, 'Refactor foo.ts');
    assert.equal(leanCmd.subagentRole, 'Lean Engineer');

    const reloadCmd = parseAntigravitySlashCommand('/reload');
    assert.equal(reloadCmd.command, '/reload');
    assert.equal(reloadCmd.subagentRole, 'Harness Reloader');

    // 3. Session Tree Branching
    db = new LocalGravityDB(dbPath);
    const proj = db.createProject({ name: 'TestProj', root_path: tmpRoot });
    const rootThread = db.createThread({ project_id: proj.id, title: 'Main Session' });

    const m1 = db.createMessage({ thread_id: rootThread.id, role: 'user', content: 'Step 1' });
    const m2 = db.createMessage({ thread_id: rootThread.id, role: 'assistant', content: 'Step 1 done' });
    const te1 = db.createToolExecution({
      message_id: m2.id,
      thread_id: rootThread.id,
      tool_name: 'read_file',
      arguments_json: '{"path":"a.txt"}',
    });
    db.updateToolExecution(te1.id, { stdout_stream: 'hello', exit_code: 0, status: 'success' });
    const m3 = db.createMessage({ thread_id: rootThread.id, role: 'user', content: 'Step 2 (future)' });
    const m4 = db.createMessage({ thread_id: rootThread.id, role: 'assistant', content: 'Step 2 done' });

    const branchRes = db.branchThreadFromMessage(rootThread.id, m2.id);
    assert.equal(branchRes.thread.parent_thread_id, rootThread.id);
    assert.equal(branchRes.thread.branched_from_message_id, m2.id);
    assert.equal(branchRes.messages.length, 2, 'Branch should copy messages only up to m2');
    assert.equal(branchRes.messages[1].content, 'Step 1 done');
    assert.equal(branchRes.messages[1].tool_executions.length, 1);
    assert.equal(branchRes.messages[1].tool_executions[0].tool_name, 'read_file');
    assert.equal(db.listMessages(rootThread.id).length, 4, 'Original thread must remain intact');

    // 4 & 5. run_code_batch + file checkpointing + rewindThreadToMessage
    const targetFile = path.join(tmpRoot, 'sample.txt');
    fs.writeFileSync(targetFile, 'line1\nhello world\nline3\n', 'utf-8');

    const cpBefore = db.createFileCheckpoint({
      thread_id: rootThread.id,
      message_id: m4.id,
      file_path: targetFile,
      previous_content_blob: 'line1\nhello world\nline3\n',
      new_content_blob: 'line1\nhello universe\nline3\n',
    });
    assert.ok(cpBefore.id);

    const mcp = new McpClientManager(tmpRoot);
    const skills = new SkillManager(tmpRoot);
    const executor = new BuiltinToolExecutor(db, {} as any, mcp, skills, undefined, tmpRoot);

    let checkpointCallbackFired = false;
    const batchResult = await executor.executeTool(
      'run_code_batch',
      {
        code: `
          const raw = lg.readFile('sample.txt');
          lg.editFile('sample.txt', 'hello world', 'hello pi-batch');
          const after = lg.readFile('sample.txt');
          console.log(JSON.stringify({ hadHello: raw.includes('hello world'), updated: after.includes('hello pi-batch') }));
        `,
      },
      {
        threadId: rootThread.id,
        messageId: m4.id,
        workspaceRoot: tmpRoot,
        onFileCheckpointCreated: () => {
          checkpointCallbackFired = true;
        },
      }
    );
    assert.equal(batchResult.exitCode, 0, `run_code_batch failed: ${batchResult.stderr}`);
    const parsedOut = JSON.parse(batchResult.stdout.trim());
    assert.equal(parsedOut.hadHello, true);
    assert.equal(parsedOut.updated, true);
    assert.equal(checkpointCallbackFired, true, 'run_code_batch should emit checkpoint callback');
    assert.ok(fs.readFileSync(targetFile, 'utf-8').includes('hello pi-batch'));

    // Also verify reload_harness tool handler runs cleanly
    const reloadRes = await executor.executeTool(
      'reload_harness',
      {},
      { threadId: rootThread.id, messageId: m2.id, workspaceRoot: tmpRoot }
    );
    assert.equal(reloadRes.exitCode, 0);
    const reloadJson = JSON.parse(reloadRes.stdout);
    assert.equal(reloadJson.reloaded, true);

    // Now rewind rootThread back to m2: should prune m3 & m4 and revert sample.txt back to original!
    const rewindRes = db.rewindThreadToMessage(rootThread.id, m2.id, true);
    assert.equal(rewindRes.rewound, true);
    assert.equal(rewindRes.prunedMessageCount, 2);
    assert.equal(rewindRes.messages.length, 2);
    assert.ok(rewindRes.revertedFiles.some((p) => p.endsWith('sample.txt')));
    assert.equal(
      fs.readFileSync(targetFile, 'utf-8'),
      'line1\nhello world\nline3\n',
      'Rewind should revert sample.txt back to pre-m3/m4 content'
    );
    assert.equal(m1.role, 'user');
    assert.equal(m3.role, 'user');

    // 6. Auto-compactor File & Decision Ledger (including carry-forward on re-compaction)
    const compactMsgs: PrunableMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Inspect and update server config' },
      {
        role: 'assistant',
        content: 'Reading config',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'server/src/index.ts' }) },
          },
        ],
      },
      { role: 'tool', content: 'X'.repeat(16000) },
      {
        role: 'assistant',
        content: 'Editing scoper',
        tool_calls: [
          {
            id: 'c2',
            type: 'function',
            function: { name: 'edit_file', arguments: JSON.stringify({ path: 'server/src/tools/toolScoper.ts' }) },
          },
        ],
      },
      { role: 'tool', content: 'Y'.repeat(16000) },
      { role: 'user', content: 'Next step' },
      { role: 'assistant', content: 'Done' },
      { role: 'user', content: 'Verify tests' },
      { role: 'assistant', content: 'Running tests' },
    ];
    const compacted1 = autoCompactMessages(compactMsgs, 18000, 4);
    assert.equal(compacted1.didCompact, true);
    assert.ok(
      compacted1.messages[1].content.includes('• Files Modified: server/src/tools/toolScoper.ts'),
      `Expected Files Modified ledger, got:\n${compacted1.messages[1].content}`
    );
    assert.ok(
      compacted1.messages[1].content.includes('• Files Inspected: server/src/index.ts'),
      `Expected Files Inspected ledger, got:\n${compacted1.messages[1].content}`
    );

    // Re-compaction carry-forward check
    const secondWave: PrunableMessage[] = [
      ...compacted1.messages,
      { role: 'tool', content: 'Z'.repeat(20000) },
      { role: 'user', content: 'Tail 1' },
      { role: 'assistant', content: 'Tail 2' },
      { role: 'user', content: 'Tail 3' },
      { role: 'assistant', content: 'Tail 4' },
    ];
    const compacted2 = autoCompactMessages(secondWave, 18000, 4);
    assert.equal(compacted2.didCompact, true);
    assert.ok(
      compacted2.messages[1].content.includes('server/src/tools/toolScoper.ts'),
      'Re-compaction must carry forward Files Modified ledger'
    );

    console.log('✅ Pi Harness Upgrades Unit Tests PASSED (All 6 test groups GREEN)');
  } finally {
    try {
      db?.close();
    } catch {}
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

runPiHarnessUpgradeTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
