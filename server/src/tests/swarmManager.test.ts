import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { LocalGravityDB } from '../db/database.js';
import { SwarmTurnScheduler } from '../swarm/swarmScheduler.js';
import { SwarmManager } from '../swarm/swarmManager.js';
import { ArtifactManager } from '../tools/artifactManager.js';

async function runSwarmAndPhase4Tests() {
  console.log('Running Phase 3 & 4 Swarm Scheduler, Board & Artifact Tests...');

  // 1. SwarmTurnScheduler: maxConcurrentGpuTurns === 1 & priority ordering
  const scheduler = SwarmTurnScheduler.getInstance();
  assert.equal(scheduler.maxConcurrentGpuTurns, 1);

  let active = 0;
  let maxActive = 0;
  const order: string[] = [];

  const runJob = (prio: 0 | 1 | 2, name: string, delayMs: number) =>
    scheduler.acquireGpuTurn(prio, name, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(name);
      await new Promise((r) => setTimeout(r, delayMs));
      active--;
    });

  // First job occupies the GPU slot; remaining 3 queue by priority (0 -> 1 -> 2)
  const p0 = runJob(1, 'holder', 35);
  const pLow = runJob(2, 'monitor', 5);
  const pPeer = runJob(1, 'peer', 5);
  const pCoord = runJob(0, 'coordinator', 5);
  await Promise.all([p0, pLow, pPeer, pCoord]);

  assert.equal(maxActive, 1, 'Scheduler must strictly serialize GPU turns');
  assert.deepEqual(order, ['holder', 'coordinator', 'peer', 'monitor']);

  // 2. SwarmManager + SQLite persistence + worker turn wakeup via mock TabbyEngine
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-swarm-test-'));
  const dbPath = path.join(tmpDir, 'swarm.db');
  const db = new LocalGravityDB(dbPath);
  const events: Array<{ type: string; payload: any }> = [];
  const mgr = SwarmManager.getInstance();

  const fakeTools: any = {
    executeTool: async (toolName: string, args: any, ctx: any) => {
      if (toolName === 'post_message') {
        const msg = mgr.postMessage(ctx.threadId, ctx.swarmAgentName || 'coordinator', args.text, {
          triggerWakeups: false,
        });
        return { stdout: JSON.stringify({ seq: msg.seq }), stderr: '', exitCode: 0, durationMs: 1 };
      }
      if (toolName === 'swarm_wait') {
        const res = mgr.waitBoard(ctx.threadId, ctx.swarmAgentName || 'worker', args.since ?? 0, true);
        return { stdout: JSON.stringify(res), stderr: '', exitCode: 0, durationMs: 1 };
      }
      return { stdout: 'ok', stderr: '', exitCode: 0, durationMs: 1 };
    },
  };

  let workerCalled = false;
  const fakeTabby: any = {
    streamChatCompletion: async (params: any) => {
      workerCalled = true;
      await params.onToolCallRequest?.('post_message', {
        text: '@coordinator Worker finished slice cleanly.',
      });
      await params.onToolCallRequest?.('swarm_wait', { since: 1 });
      return { content: 'done', thinkingContent: '', thinkingDurationMs: 10, thinkingTokens: 2, outputTokens: 2 };
    },
  };

  mgr.configure({
    db,
    broadcastSync: (ev) => events.push(ev as any),
    runtimeDeps: { tabby: fakeTabby, tools: fakeTools, repoRoot: tmpDir },
  });

  const addRes = mgr.handleSwarmTool('thread-swarm-1', 'coordinator', tmpDir, {
    action: 'add',
    name: 'researcher',
    brief: 'Inspect server/src and report back.',
    workspace: 'inherit',
  });
  assert.equal(addRes.ok, true);
  assert.equal(addRes.added.length, 1);

  // Give the async queued worker turn a moment to execute
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(workerCalled, true, 'Mentioned worker must wake via SwarmTurnScheduler');

  const snap = mgr.getSwarmSnapshot('thread-swarm-1');
  assert.ok(snap);
  assert.ok(snap.messages.length >= 2, 'Board should contain brief + worker reply');
  assert.equal(snap.members.find((m) => m.name === 'researcher')?.state, 'waiting');

  const readRes = mgr.readBoard('thread-swarm-1', 'coordinator', { since: 0 });
  assert.equal(readRes.messages.length, snap.messages.length);

  const killRes = mgr.killMember('thread-swarm-1', 'researcher', 'coordinator');
  assert.equal(killRes.killed, true);
  assert.equal(mgr.getSwarmSnapshot('thread-swarm-1')?.members.find((m) => m.name === 'researcher')?.state, 'killed');

  assert.ok(events.some((e) => e.type === 'SWARM_STATE' && e.payload.thread_id === 'thread-swarm-1'));
  assert.ok(events.some((e) => e.type === 'SWARM_MESSAGE' && e.payload.message.agent === 'researcher'));
  assert.ok(events.some((e) => e.type === 'SWARM_MEMBER_UPDATED' && e.payload.member.name === 'researcher'));

  // 3. Phase 4 ArtifactManager: .html persistence + requestFeedback + clearArtifactFeedback
  const artDir = path.join(tmpDir, 'artifacts');
  const artMgr = new ArtifactManager(artDir);
  const htmlArt = artMgr.upsertArtifact({
    threadId: 'thread-swarm-1',
    title: 'Latency Chart',
    type: 'html',
    content: '<div>Hello Widget</div>',
    requestFeedback: true,
    userFacing: true,
  });
  assert.ok(htmlArt.filePath.endsWith('.html'), 'HTML artifact must save with .html extension');
  assert.equal(htmlArt.requestFeedback, true);
  assert.equal(htmlArt.userFacing, true);
  assert.ok(fs.existsSync(htmlArt.filePath));

  const cleared = artMgr.clearArtifactFeedback(htmlArt.id);
  assert.ok(cleared);
  assert.equal(cleared.requestFeedback, false);

  db.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  console.log('✅ Phase 3 & 4 Swarm Scheduler, Board & Artifact Tests PASSED');
}

runSwarmAndPhase4Tests().catch((err) => {
  console.error('❌ Swarm & Phase 4 test failed:', err);
  process.exit(1);
});
