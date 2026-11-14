import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { createDaemonServer, REPO_ROOT } from './index.js';
import { isPortForbidden, isPortAvailable } from './portAllocator.js';
import { TIER_SPECS } from './tabby/modelSpecs.js';

async function runSelfTest() {
  console.log('==================================================================');
  console.log('🧪 Running LocalGravity 2.0 End-to-End Verification Suite');
  console.log('==================================================================');

  // 1. Verify Port Constraints (NEVER 5000 or 5001)
  assert.strictEqual(isPortForbidden(5000), true, 'Port 5000 must be forbidden');
  assert.strictEqual(isPortForbidden(5001), true, 'Port 5001 must be forbidden');
  assert.strictEqual(await isPortAvailable(5000), false, 'Port 5000 must never be available');
  assert.strictEqual(await isPortAvailable(5001), false, 'Port 5001 must never be available');
  console.log('✅ [1/7] Port Guard Verified: Ports 5000 & 5001 strictly blocked.');

  // Isolated mode: dedicated temp DB + ephemeral OS-assigned ports, so this run
  // never clobbers the live daemon's .runtime/ports.json / client runtime discovery
  // files and never races with the running Central Brain on its allocated port.
  const testDbPath = path.join(os.tmpdir(), `localgravity-selftest-${Date.now()}.sqlite`);
  const ctx = await createDaemonServer({ dbPath: testDbPath, isolated: true });

  // Listen on the ephemeral daemonPort (0) and read back the real OS-assigned port.
  const addr = await ctx.app.listen({ port: ctx.ports.daemonPort, host: '127.0.0.1' });
  const boundInfo = ctx.app.server.address();
  const daemonPort = typeof boundInfo === 'object' && boundInfo ? boundInfo.port : ctx.ports.daemonPort;
  // Reflect the real port in config so downstream WS/HTTP URLs are correct.
  ctx.ports.daemonPort = daemonPort;
  ctx.ports.localUrl = `http://localhost:${daemonPort}`;
  ctx.ports.wsSyncUrl = `ws://127.0.0.1:${daemonPort}/ws/sync`;

  const baseUrl = `http://127.0.0.1:${daemonPort}`;

  try {
    assert(daemonPort !== 5000 && daemonPort !== 5001, 'Bound daemon port must not be forbidden');
    assert(ctx.ports.tabbyPort !== 5000 && ctx.ports.tabbyPort !== 5001);
    assert(ctx.ports.vitePort !== 5000 && ctx.ports.vitePort !== 5001);

    // 2. Verify Health & SQLite WAL Pragmas
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200);
    const health = (await healthRes.json()) as any;
    assert.strictEqual(health.sqlitePragmas.journal_mode.toLowerCase(), 'wal');
    assert.strictEqual(health.sqlitePragmas.foreign_keys, 1);
    console.log(
      `✅ [2/7] SQLite WAL Pragmas Verified: journal_mode=${health.sqlitePragmas.journal_mode}, foreign_keys=${health.sqlitePragmas.foreign_keys}`
    );

    // 3. Verify 5-Table Hierarchy (Projects -> Threads -> Messages -> ToolExecutions -> FileCheckpoints) + 250ms Stream Rehydration
    const createProjRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Verification Project',
        root_path: REPO_ROOT,
        default_model_tier: 'medium',
        default_thinking_budget: 'fast',
      }),
    });
    const { project, initialThread } = (await createProjRes.json()) as any;
    assert(project.id && initialThread.id);

    // Test 250ms Stream Rehydration buffer
    const streamMsg = ctx.db.createMessage({
      thread_id: initialThread.id,
      role: 'assistant',
      content: '',
      thinking_content: '',
    });
    ctx.db.beginStreamingMessage(streamMsg.id, initialThread.id);
    ctx.db.appendThoughtDelta(streamMsg.id, initialThread.id, 'Verifying step 1...', 120, 5);
    ctx.db.appendTokenDelta(streamMsg.id, initialThread.id, 'Hello live rehydration!', 4);

    // Before flush, listMessages should already overlay the in-flight buffer
    const midStreamMsgs = ctx.db.listMessages(initialThread.id);
    const foundMid = midStreamMsgs.find((m) => m.id === streamMsg.id);
    assert.strictEqual(foundMid?.content, 'Hello live rehydration!');
    assert.strictEqual(foundMid?.thinking_content, 'Verifying step 1...');

    // Wait 300ms for the 250ms automatic SQLite WAL flush loop
    await new Promise((r) => setTimeout(r, 300));
    ctx.db.finalizeStreamingMessage(streamMsg.id);

    // Test File Checkpoint creation & 1-click Revert
    const tempFilePath = path.join(REPO_ROOT, '.runtime', 'checkpoint_test.txt');
    fs.writeFileSync(tempFilePath, 'ORIGINAL_CONTENT_V1', 'utf-8');
    await ctx.tools.executeTool(
      'write_file',
      { path: tempFilePath, content: 'MODIFIED_CONTENT_V2' },
      {
        threadId: initialThread.id,
        messageId: streamMsg.id,
        workspaceRoot: REPO_ROOT,
      }
    );
    assert.strictEqual(fs.readFileSync(tempFilePath, 'utf-8'), 'MODIFIED_CONTENT_V2');

    const checkpoints = ctx.db.listFileCheckpoints(initialThread.id);
    assert(checkpoints.length > 0, 'Checkpoint should be recorded');
    const revertRes = await fetch(`${baseUrl}/api/checkpoints/${checkpoints[0].id}/revert`, {
      method: 'POST',
    });
    assert.strictEqual(revertRes.status, 200);
    assert.strictEqual(fs.readFileSync(tempFilePath, 'utf-8'), 'ORIGINAL_CONTENT_V1');
    fs.unlinkSync(tempFilePath);
    console.log(
      '✅ [3/7] 5-Table Hierarchy, 250ms Stream Rehydration, and File Checkpoint Undo Verified.'
    );

    // 4. Verify Pure-Strata tier spec enforcement, SysRAM Weight Pre-Warmer, and 3x3 Tier × Thinking Matrix
    // (TabbyAPI config.yml was purged in v2.2.4 — KV/draft settings are now enforced structurally via TIER_SPECS.)
    for (const t of ['low', 'medium', 'high'] as const) {
      assert.strictEqual(TIER_SPECS[t].cacheMode, 'Q4', `${t} tier must enforce cache_mode Q4`);
      assert.strictEqual(TIER_SPECS[t].draftMode, 'ngram', `${t} tier must enforce draft_mode ngram`);
      assert.strictEqual(
        TIER_SPECS[t].hybridDraftTokens,
        4,
        `${t} tier must enforce hybrid_draft_tokens: 4`
      );
    }

    const prewarmRes = await fetch(`${baseUrl}/api/tabby/prewarm`, { method: 'POST' });
    const prewarmData = (await prewarmRes.json()) as any;
    assert(prewarmData.sysramCache.low && prewarmData.sysramCache.high);

    // Test single-model Thinking OFF (High+Off), Orchestrator Step 2 Fast Execution (Medium Step 2), and Deep Reasoning (High+Deep)
    const highOff = await ctx.tabby.streamChatCompletion({
      tier: 'high',
      thinkingBudget: 'off',
      messages: [{ role: 'user', content: 'Quick ping' }],
      onThoughtDelta: () => {},
      onTokenDelta: () => {},
    });
    assert.strictEqual(highOff.thinkingTokens, 0, 'Thinking budget OFF must emit 0 thinking tokens');

    const medStep2 = await ctx.tabby.streamChatCompletion({
      tier: 'medium',
      thinkingBudget: 'deep',
      stepIndex: 2,
      hadToolError: false,
      messages: [{ role: 'user', content: 'Quick ping' }],
      onThoughtDelta: () => {},
      onTokenDelta: () => {},
    });
    assert.strictEqual(
      medStep2.thinkingTokens,
      0,
      'Orchestrator Step 2+ fast execution must emit 0 thinking tokens'
    );

    const highDeep = await ctx.tabby.streamChatCompletion({
      tier: 'high',
      thinkingBudget: 'deep',
      messages: [{ role: 'user', content: 'Design architecture' }],
      onThoughtDelta: () => {},
      onTokenDelta: () => {},
    });
    assert(highDeep.thinkingTokens > 0, 'Thinking budget DEEP must emit reasoning tokens');
    console.log(
      '✅ [4/7] TabbyAPI EXL3 Config (Q4 KV, N-gram x4), SysRAM Cache Warmer & 3×3 Matrix Verified.'
    );

    // 5. Verify MCP Tool Discovery & Decoupled Client AppData
    const mcpRes = await fetch(`${baseUrl}/api/mcp/servers`);
    const mcpData = (await mcpRes.json()) as any;
    assert(mcpData.servers.length >= 2, 'MCP servers from mcp_config.json must be loaded');
    assert(mcpData.activeTools.length >= 2, 'MCP tools must be discovered');

    const appDataRes = await fetch(`${baseUrl}/api/client/appdata`);
    const appData = (await appDataRes.json()) as any;
    assert(fs.existsSync(appData.mcpConfigPath), 'Client AppData mcp_config.json must exist');
    assert(fs.existsSync(appData.projectsConfigPath), 'Client AppData projects.json must exist');
    assert(fs.existsSync(appData.agentMdPath), 'Client AppData agent.md must exist');
    console.log(
      `✅ [5/7] Native MCP Host & Decoupled Client AppData Verified (${appData.appDataDir}).`
    );

    // 6. Verify 8-Component Harness² & Recursive Propose-Probe-Compose Loop
    const harnessRes = await fetch(`${baseUrl}/api/harness/components`);
    const harnessData = (await harnessRes.json()) as any;
    assert(harnessData.components.length >= 8, 'All 8 Harness² components must be initialized');

    // Trigger double failure to test automatic Propose-Probe-Compose
    const fail1 = await ctx.harness.recordToolOutcomeAndMaybeRunPPC({
      workspaceRoot: REPO_ROOT,
      toolName: 'run_terminal',
      command: 'bad-flag-cmd --fail',
      exitCode: 1,
      stdout: '',
      stderr: 'Error: unrecognized flag --fail',
    });
    assert.strictEqual(fail1, null, 'First failure should not yet trigger PPC');

    const ppcReport = await ctx.harness.recordToolOutcomeAndMaybeRunPPC({
      workspaceRoot: REPO_ROOT,
      toolName: 'run_terminal',
      command: 'bad-flag-cmd --fail',
      exitCode: 1,
      stdout: '',
      stderr: 'Error: unrecognized flag --fail',
      probeRunner: async () => ({
        exitCode: 0,
        stdout: 'Probe fallback succeeded',
        stderr: '',
      }),
    });
    assert(ppcReport !== null, 'Second failure must trigger Propose-Probe-Compose cycle');
    assert.strictEqual(ppcReport?.probeExitCode, 0);

    const expPath = path.join(REPO_ROOT, '.localgravity', 'harness', 'EXPERIENCE.md');
    const expContent = fs.readFileSync(expPath, 'utf-8');
    assert(
      expContent.includes('PPC Composed Fix'),
      'EXPERIENCE.md must contain composed procedural fix'
    );
    console.log(
      '✅ [6/7] 8-Component Harness² & Recursive Propose-Probe-Compose Loop Verified.'
    );

    // 7. Verify Multi-Client WebSocket Synchronization (/ws/sync)
    const wsUrl = `ws://127.0.0.1:${ctx.ports.daemonPort}/ws/sync`;
    const clientA = new WebSocket(wsUrl);
    const clientB = new WebSocket(wsUrl);

    const clientBEvents: string[] = [];
    await new Promise<void>((resolve, reject) => {
      let openCount = 0;
      const onOpen = () => {
        openCount++;
        if (openCount === 2) {
          // Submit prompt from Client A
          clientA.send(
            JSON.stringify({
              id: 'e2e-prompt',
              type: 'PROMPT_SUBMIT',
              payload: {
                thread_id: initialThread.id,
                prompt: 'List files in workspace',
                tier: 'high',
                thinking_budget: 'off',
              },
            })
          );
        }
      };

      clientA.on('open', onOpen);
      clientB.on('open', onOpen);

      clientB.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        clientBEvents.push(msg.type);
        if (msg.type === 'TURN_COMPLETED') {
          resolve();
        }
      });

      setTimeout(() => reject(new Error('WebSocket sync timeout')), 30000);
    });

    assert(clientBEvents.includes('SYNC_STATE'), 'Client B must receive SYNC_STATE');
    assert(clientBEvents.includes('TURN_STARTED'), 'Client B must receive TURN_STARTED');
    assert(clientBEvents.includes('THOUGHT_STREAM'), 'Client B must receive THOUGHT_STREAM');
    assert(clientBEvents.includes('TOKEN_STREAM'), 'Client B must receive TOKEN_STREAM');
    assert(clientBEvents.includes('TURN_COMPLETED'), 'Client B must receive TURN_COMPLETED');

    clientA.close();
    clientB.close();
    console.log(
      '✅ [7/7] Multi-Client Live WebSocket Synchronization (Desktop + Remote Web) Verified.'
    );
  } finally {
    await ctx.app.close();
    ctx.terminal.dispose();
    ctx.db.close();
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
      if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
    } catch {}
  }

  console.log('==================================================================');
  console.log('🎉 ALL 7/7 END-TO-END VERIFICATION CHECKS PASSED!');
  console.log('==================================================================');
  process.exit(0);
}

runSelfTest().catch((err) => {
  console.error('Self-test failed:', err);
  process.exit(1);
});
