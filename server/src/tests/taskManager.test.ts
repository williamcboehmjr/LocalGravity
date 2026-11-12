import assert from 'node:assert/strict';
import { BackgroundTaskManager } from '../tools/taskManager.js';

async function runTaskManagerTests() {
  console.log('Running Piece 4 Unit Tests: Background Tasks & Reactive Wakeup...');
  const manager = BackgroundTaskManager.getInstance();

  const receivedEvents: Array<{ type: string; payload: any }> = [];
  const unsubscribe = manager.onEvent((evt) => {
    receivedEvents.push(evt);
  });

  // 1. Schedule a 1-second timer and verify COUNTDOWN + TIMER_FIRED events
  const timer = manager.scheduleTimer({
    durationSeconds: 1,
    prompt: 'Wake up and check status',
    title: 'Unit Test Timer',
  });
  assert.equal(timer.type, 'timer');
  assert.equal(timer.status, 'running');
  assert.ok(receivedEvents.some((e) => e.type === 'COUNTDOWN' && e.payload.taskId === timer.taskId));

  // Wait 1.25s for timer to fire
  await new Promise((r) => setTimeout(r, 1250));
  const updatedTimer = manager.getTask(timer.taskId);
  assert.equal(updatedTimer?.status, 'completed');
  assert.ok(receivedEvents.some((e) => e.type === 'TIMER_FIRED' && e.payload.taskId === timer.taskId));

  // 2. Start a background shell command and verify completion
  const cmdTask = manager.startBackgroundCommand({
    command: 'Write-Output "Background hello 123"',
    title: 'Echo Test',
  });
  assert.equal(cmdTask.type, 'command');

  // Poll up to 3s for background command to finish
  for (let i = 0; i < 30; i++) {
    const cur = manager.getTask(cmdTask.taskId);
    if (cur?.status === 'completed' || cur?.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const finishedCmd = manager.getTask(cmdTask.taskId);
  assert.equal(finishedCmd?.status, 'completed');
  assert.equal(finishedCmd?.exitCode, 0);
  assert.ok(finishedCmd?.recentLogs.some((l) => l.includes('Background hello 123')));

  unsubscribe();
  console.log('✅ Piece 4 Unit Tests PASSED (9/9 assertions)');
}

runTaskManagerTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
