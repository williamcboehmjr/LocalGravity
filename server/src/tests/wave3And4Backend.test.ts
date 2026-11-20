import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { LocalGravityDB } from '../db/database.js';
import { buildChatHistoryMessages } from '../agent/messageBuilder.js';
import { McpClientManager } from '../mcp/mcpManager.js';
import { SwarmManager } from '../swarm/swarmManager.js';
import { BuiltinToolExecutor } from '../tools/builtinTools.js';
import { SharedTerminalManager } from '../terminal/terminalManager.js';
import { BackgroundTaskManager } from '../tools/taskManager.js';
import { execute as executeManageTask } from '../tools/handlers/manageTask.js';
import { EdgeBridgeManager } from '../bridge/edgeBridge.js';

async function runWave3And4BackendTests() {
  console.log('Running Wave 3 & Wave 4 Backend Reliability Unit Tests...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-wave34-test-'));
  const dbPath = path.join(tmpDir, 'wave34.db');
  const db = new LocalGravityDB(dbPath);
  const project = db.ensureDefaultProject(tmpDir);

  // 1. StreamBufferManager finalized tombstone + discardForThread
  {
    const thread = db.createThread({ project_id: project.id, title: 'Stream Test' });
    const msg = db.createMessage({
      thread_id: thread.id,
      role: 'assistant',
      content: '',
    });

    db.beginStreamingMessage(msg.id, thread.id);
    db.appendThoughtDelta(msg.id, thread.id, 'Thinking step 1...', 45, 5);
    db.appendTokenDelta(msg.id, thread.id, 'Final saved prose.', 4);
    db.finalizeStreamingMessage(msg.id);

    // Late abort chunks arriving AFTER finalizeStreamingMessage must be ignored and never wipe SQLite
    db.appendThoughtDelta(msg.id, thread.id, 'LATE THOUGHT', 99, 99);
    db.appendTokenDelta(msg.id, thread.id, 'LATE TOKEN', 99);
    db.flushStreamBuffersNow();

    const persisted = db.listMessages(thread.id).find((m) => m.id === msg.id);
    assert.ok(persisted);
    assert.equal(persisted.content, 'Final saved prose.', 'Finalized tombstone must block late token delta');
    assert.equal(persisted.thinking_content, 'Thinking step 1...', 'Finalized tombstone must block late thought delta');

    // Also test discardStreamsForThread
    const msg2 = db.createMessage({
      thread_id: thread.id,
      role: 'assistant',
      content: 'Initial DB text',
    });
    db.beginStreamingMessage(msg2.id, thread.id);
    db.appendTokenDelta(msg2.id, thread.id, 'In-flight buffer text', 3);
    db.discardStreamsForThread(thread.id);
    db.appendTokenDelta(msg2.id, thread.id, 'Post-discard late chunk', 5);
    db.flushStreamBuffersNow();
    const afterDiscard = db.listMessages(thread.id).find((m) => m.id === msg2.id);
    assert.equal(afterDiscard?.content, 'Initial DB text', 'discardForThread must tombstone in-flight buffers');
  }

  // 2. rewindThreadToMessage target checkpoint preservation
  {
    const thread = db.createThread({ project_id: project.id, title: 'Rewind Target CP Test' });
    const targetFile = path.join(tmpDir, 'target_cp.txt');
    const laterFile = path.join(tmpDir, 'later_cp.txt');

    const m1 = db.createMessage({ thread_id: thread.id, role: 'assistant', content: 'Turn 1' });
    fs.writeFileSync(targetFile, 'turn-1-new', 'utf-8');
    const cp1 = db.createFileCheckpoint({
      thread_id: thread.id,
      message_id: m1.id,
      file_path: targetFile,
      previous_content_blob: 'turn-1-old',
      new_content_blob: 'turn-1-new',
    });

    const m2 = db.createMessage({ thread_id: thread.id, role: 'assistant', content: 'Turn 2' });
    fs.writeFileSync(laterFile, 'turn-2-new', 'utf-8');
    const cp2 = db.createFileCheckpoint({
      thread_id: thread.id,
      message_id: m2.id,
      file_path: laterFile,
      previous_content_blob: 'turn-2-old',
      new_content_blob: 'turn-2-new',
    });

    // Rewinding TO m1 must revert m2's checkpoint (cp2) while preserving m1's own checkpoint (cp1)
    const res = db.rewindThreadToMessage(thread.id, m1.id, true);
    assert.equal(res.prunedMessageCount, 1);
    assert.equal(fs.readFileSync(targetFile, 'utf-8'), 'turn-1-new', 'Target message file edit must NOT be reverted');
    assert.equal(fs.readFileSync(laterFile, 'utf-8'), 'turn-2-old', 'Pruned message file edit MUST be reverted');
    const remainingCps = db.listFileCheckpoints(thread.id);
    assert.ok(remainingCps.some((c) => c.id === cp1.id), 'Target message checkpoint must remain in DB');
    assert.ok(!remainingCps.some((c) => c.id === cp2.id), 'Pruned message checkpoint must be deleted from DB');
  }

  // 3. revertCheckpointAndRewindThread same-ms ordering
  {
    const thread = db.createThread({ project_id: project.id, title: 'Same-ms Checkpoint Rewind' });
    const sharedFile = path.join(tmpDir, 'same_ms.txt');
    const fixedIso = '2026-11-19T12:00:00.000Z';

    const m1 = db.createMessage({ thread_id: thread.id, role: 'assistant', content: 'Step 1' });
    const m2 = db.createMessage({ thread_id: thread.id, role: 'assistant', content: 'Step 2' });
    db.db.prepare('UPDATE messages SET created_at = ? WHERE id IN (?, ?)').run(fixedIso, m1.id, m2.id);

    const cp1 = db.createFileCheckpoint({
      thread_id: thread.id,
      message_id: m1.id,
      file_path: sharedFile,
      previous_content_blob: 'v0',
      new_content_blob: 'v1',
    });
    const cp2 = db.createFileCheckpoint({
      thread_id: thread.id,
      message_id: m2.id,
      file_path: sharedFile,
      previous_content_blob: 'v1',
      new_content_blob: 'v2',
    });
    db.db.prepare('UPDATE file_checkpoints SET created_at = ? WHERE id IN (?, ?)').run(fixedIso, cp1.id, cp2.id);
    fs.writeFileSync(sharedFile, 'v2', 'utf-8');

    db.updateThread(thread.id, { status: 'executing_tool' });
    const res = db.revertCheckpointAndRewindThread(cp1.id);
    assert.equal(res.reverted, true);
    assert.equal(fs.readFileSync(sharedFile, 'utf-8'), 'v0', 'Must revert cp2 (v2->v1) then cp1 (v1->v0) in reverse rowid order');
    assert.equal(db.listFileCheckpoints(thread.id).length, 0);
    assert.equal(db.getThread(thread.id)?.status, 'idle');
    const keptMsgs = db.listMessages(thread.id);
    assert.equal(keptMsgs.length, 1);
    assert.equal(keptMsgs[0].id, m1.id);
  }

  // 4. buildChatHistoryMessages tool execution reload & compaction preservation
  {
    const history: any[] = [
      {
        id: 'msg-compact',
        thread_id: 't1',
        role: 'system',
        content: '[CONTEXT AUTO-COMPACTED: Summarized 8 earlier turns]',
        thinking_content: '',
        thinking_duration_ms: 0,
        thinking_tokens: 0,
        output_tokens: 0,
        attachments: '[]',
        created_at: '2026-11-19T10:00:00.000Z',
        tool_executions: [],
      },
      {
        id: 'msg-u1',
        thread_id: 't1',
        role: 'user',
        content: 'Run tests',
        thinking_content: '',
        thinking_duration_ms: 0,
        thinking_tokens: 0,
        output_tokens: 0,
        attachments: '[]',
        created_at: '2026-11-19T10:01:00.000Z',
        tool_executions: [],
      },
      {
        id: 'msg-a1',
        thread_id: 't1',
        role: 'assistant',
        content: 'Checked files.',
        thinking_content: '',
        thinking_duration_ms: 0,
        thinking_tokens: 0,
        output_tokens: 0,
        attachments: '[]',
        created_at: '2026-11-19T10:02:00.000Z',
        tool_executions: [
          {
            id: 'te-1',
            message_id: 'msg-a1',
            thread_id: 't1',
            tool_name: 'read_file',
            mcp_server: null,
            arguments_json: '{"path":"index.ts"}',
            stdout_stream: 'export const ok = true;',
            stderr_stream: '',
            exit_code: 0,
            status: 'success',
            duration_ms: 4,
          },
        ],
      },
      {
        id: 'msg-empty-aborted',
        thread_id: 't1',
        role: 'assistant',
        content: '   ',
        thinking_content: '',
        thinking_duration_ms: 0,
        thinking_tokens: 0,
        output_tokens: 0,
        attachments: '[]',
        created_at: '2026-11-19T10:03:00.000Z',
        tool_executions: [],
      },
      {
        id: 'msg-u2',
        thread_id: 't1',
        role: 'user',
        content: 'What did read_file return?',
        thinking_content: '',
        thinking_duration_ms: 0,
        thinking_tokens: 0,
        output_tokens: 0,
        attachments: '[]',
        created_at: '2026-11-19T10:04:00.000Z',
        tool_executions: [],
      },
    ];

    // With limit=3, msg-compact is outside the last 3 items, but must still be preserved!
    const built = buildChatHistoryMessages({
      history,
      assistantMsgId: 'msg-current',
      savedAttachments: [],
      slashCommand: null,
      slashCleanPrompt: 'What did read_file return?',
      limit: 3,
    });

    assert.ok(
      built.some((m) => typeof m.content === 'string' && m.content.includes('[CONTEXT AUTO-COMPACTED')),
      'Latest auto-compacted summary message must be preserved even when outside limit'
    );
    const assistantMsg = built.find((m) => m.role === 'assistant');
    assert.ok(assistantMsg, 'Assistant message with tool executions must be present');
    assert.ok(
      String(assistantMsg.content).includes('[Prior Tool Executions]:') &&
        String(assistantMsg.content).includes('read_file(success, exit=0)'),
      'Assistant message must include [Prior Tool Executions] summary'
    );
    assert.equal(
      built.filter((m) => m.role === 'assistant').length,
      1,
      'Empty aborted assistant message with no content and no tools must be skipped'
    );
  }

  // 5. McpClientManager stderr drain & failed init eviction
  {
    const mcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-mcp-test-'));
    const noisyScript = path.join(mcpDir, 'noisy-mcp.js');
    const failingScript = path.join(mcpDir, 'fail-mcp.js');

    // Writes 256KB to stderr on startup and responds to initialize + tools/call
    fs.writeFileSync(
      noisyScript,
      `
      const readline = require('node:readline');
      for (let i = 0; i < 500; i++) {
        process.stderr.write('VERBOSE_STDERR_LINE_' + i + '_' + 'X'.repeat(512) + '\\n');
      }
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        const msg = JSON.parse(line);
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
        } else if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'ping_tool', description: 'ping', inputSchema: { type: 'object' } }] } }) + '\\n');
        } else if (msg.method === 'tools/call') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'pong-from-noisy' }] } }) + '\\n');
        }
      });
      `,
      'utf-8'
    );

    // Returns a JSON-RPC error on initialize
    fs.writeFileSync(
      failingScript,
      `
      const readline = require('node:readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        const msg = JSON.parse(line);
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Simulated init failure' } }) + '\\n');
        }
      });
      `,
      'utf-8'
    );

    fs.writeFileSync(
      path.join(mcpDir, 'mcp_config.json'),
      JSON.stringify({
        mcpServers: {
          'noisy-srv': { command: process.execPath, args: [noisyScript], transport: 'stdio', enabled: true },
          'fail-srv': { command: process.execPath, args: [failingScript], transport: 'stdio', enabled: true },
          playwright: { command: 'npx', args: [], transport: 'stdio', enabled: true },
          memory: { command: 'npx', args: [], transport: 'stdio', enabled: true },
        },
      }),
      'utf-8'
    );

    const mcp = new McpClientManager(mcpDir);
    const pwTools = mcp.listServers().find((s) => s.name === 'playwright')?.tools || [];
    assert.ok(pwTools.some((t) => t.name === 'browser_navigate'), 'Playwright default tools must use browser_navigate');
    const memTools = mcp.listServers().find((s) => s.name === 'memory')?.tools || [];
    const addObs = memTools.find((t) => t.name === 'add_observations');
    assert.equal(
      addObs?.inputSchema?.properties?.observations?.type,
      'array',
      'memory add_observations schema must use observations array'
    );

    const noisyRes = await mcp.callMcpTool('noisy-srv', 'ping_tool', {}, 10000);
    assert.equal(noisyRes.isError, false);
    assert.ok(noisyRes.outputText.includes('pong-from-noisy'));

    const failRes = await mcp.callMcpTool('fail-srv', 'any_tool', {}, 5000);
    assert.equal(failRes.isError, true);
    assert.ok(failRes.outputText.includes('Simulated init failure'));
    assert.equal(
      mcp.listServers().find((s) => s.name === 'fail-srv')?.status,
      'error',
      'Failed initialize must mark server status as error and evict session'
    );

    mcp.dispose();
    try {
      fs.rmSync(mcpDir, { recursive: true, force: true });
    } catch {}
  }

  // 6. SwarmManager file edit without FK crash & workerTools filter
  {
    const terminal = new SharedTerminalManager(tmpDir);
    const tools = new BuiltinToolExecutor(db, terminal, undefined, undefined, undefined, tmpDir);
    const swarmMgr = SwarmManager.getInstance();
    const swarmThread = db.createThread({ project_id: project.id, title: 'Swarm FK Test' });

    let sawToolsList: any[] = [];
    let editResult: any = null;
    const workerEditedFile = path.join(tmpDir, 'swarm_worker_output.txt');

    const fakeTabby: any = {
      streamChatCompletion: async (params: any) => {
        if (Array.isArray(params.tools)) {
          sawToolsList = params.tools;
        }
        await params.onToolCallRequest?.('write_file', {
          path: workerEditedFile,
          content: 'Written by swarm worker without FK error!',
        });
        await params.onToolCallRequest?.('swarm_wait', { since: 1 });
        return {
          content: 'Completed file write.',
          thinkingContent: '',
          thinkingDurationMs: 5,
          thinkingTokens: 1,
          outputTokens: 3,
        };
      },
    };

    const wrappedTools: any = {
      executeTool: async (toolName: string, toolArgs: any, ctx: any) => {
        const res = await tools.executeTool(toolName, toolArgs, ctx);
        if (toolName === 'write_file') {
          editResult = res;
        }
        return res;
      },
    };

    swarmMgr.configure({
      db,
      broadcastSync: () => {},
      runtimeDeps: { tabby: fakeTabby, tools: wrappedTools, repoRoot: tmpDir },
    });

    const addRes = swarmMgr.handleSwarmTool(swarmThread.id, 'coordinator', tmpDir, {
      action: 'add',
      name: 'editor',
      brief: 'Write swarm_worker_output.txt',
      workspace: 'inherit',
    });
    assert.equal(addRes.ok, true);

    for (let i = 0; i < 30; i++) {
      if (editResult) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.ok(editResult, 'Swarm worker should have executed write_file');
    assert.equal(editResult.exitCode, 0, `Swarm worker write_file failed: ${editResult.stderr}`);
    assert.equal(fs.readFileSync(workerEditedFile, 'utf-8'), 'Written by swarm worker without FK error!');
    assert.ok(
      !sawToolsList.some((t) => t.function?.name === 'invoke_subagent'),
      'workerTools must exclude invoke_subagent'
    );

    terminal.dispose();
  }

  // 7. BackgroundTaskManager running task retention & killTask guard + manage_task send_input
  {
    const taskMgr = BackgroundTaskManager.getInstance();
    const longTimer = taskMgr.scheduleTimer({
      durationSeconds: 600,
      prompt: 'Long running timer that must stay visible',
      title: 'Long Timer',
    });

    // Push >25 completed tasks after the running timer
    for (let i = 0; i < 30; i++) {
      const t = taskMgr.scheduleTimer({
        durationSeconds: 60,
        prompt: `Short timer ${i}`,
      });
      taskMgr.killTask(t.taskId);
    }

    const listed = taskMgr.listTasks();
    assert.ok(
      listed.some((t) => t.taskId === longTimer.taskId),
      'listTasks() must retain all running tasks even when >25 total tasks exist'
    );

    const killedFirst = taskMgr.killTask(longTimer.taskId);
    assert.equal(killedFirst, true, 'Killing a running task must return true');
    const killedAgain = taskMgr.killTask(longTimer.taskId);
    assert.equal(killedAgain, false, 'Killing an already cancelled/completed task must return false');

    // Verify manage_task send_input handler action
    const sendRes = await executeManageTask(
      { action: 'send_input', task_id: longTimer.taskId, input: 'hello' },
      { threadId: 't1', messageId: 'm1', workspaceRoot: tmpDir },
      {} as any
    );
    assert.equal(sendRes.exitCode, 1);
    assert.ok(sendRes.stderr.includes('Failed to send input'));
    taskMgr.disposeAll();
  }

  // 8. EdgeBridgeManager immediate disconnect rejection
  {
    const bridge = EdgeBridgeManager.getInstance();
    const fakeSocket: any = {
      send() {
        // Intentionally do not respond — simulate disconnect while tool is in flight
      },
    };
    const client = bridge.registerClient('client-disconnect-test', fakeSocket, {
      hostname: 'REMOTE-BOX',
      platform: 'linux',
    });

    const t0 = Date.now();
    const pendingPromise = bridge.executeRemoteTool(
      client,
      'run_terminal',
      { command: 'sleep 60' },
      '/tmp',
      undefined,
      60_000
    );

    // Unregister socket immediately
    const wasRemoved = bridge.unregisterSocket(fakeSocket);
    assert.equal(wasRemoved, true, 'unregisterSocket must return true when removing a registered edge host');
    assert.equal(bridge.unregisterSocket(fakeSocket), false, 'Second unregisterSocket call must return false');

    const res = await pendingPromise;
    const elapsed = Date.now() - t0;
    assert.equal(res.exitCode, 1);
    assert.ok(res.stderr.includes('disconnected'), 'Disconnected client must immediately fail pending tool calls');
    assert.ok(elapsed < 2000, `Expected immediate rejection on socket disconnect, took ${elapsed}ms`);
  }

  db.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  console.log('✅ All Wave 3 & Wave 4 Backend Reliability Unit Tests PASSED (100% GREEN)');
}

runWave3And4BackendTests().catch((err) => {
  console.error('❌ Wave 3 & 4 Backend test failed:', err);
  process.exit(1);
});
