import type { BuiltinToolHandler } from './types.js';
import { BackgroundTaskManager } from '../taskManager.js';

export const name = 'manage_task';

export const execute: BuiltinToolHandler = async (args, ctx) => {
  const startMs = Date.now();
  const manager = BackgroundTaskManager.getInstance();
  const action = String(args.action || 'list').toLowerCase();

  if (action === 'start') {
    const command = String(args.command || '').trim();
    if (!command) {
      return {
        stdout: '',
        stderr: 'manage_task(action="start") requires a non-empty "command" argument.',
        exitCode: 1,
        durationMs: Date.now() - startMs,
      };
    }
    const task = manager.startBackgroundCommand({
      command,
      title: args.title ? String(args.title) : undefined,
      cwd: ctx.workspaceRoot,
    });
    return {
      stdout: JSON.stringify(
        {
          message: `Background task ${task.taskId} started asynchronously.`,
          task,
        },
        null,
        2
      ),
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - startMs,
    };
  }

  if (action === 'status') {
    const taskId = String(args.task_id || args.taskId || '').trim();
    const task = manager.getTask(taskId);
    if (!task) {
      return {
        stdout: '',
        stderr: `Task "${taskId}" not found.`,
        exitCode: 1,
        durationMs: Date.now() - startMs,
      };
    }
    return {
      stdout: JSON.stringify(task, null, 2),
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - startMs,
    };
  }

  if (action === 'kill') {
    const taskId = String(args.task_id || args.taskId || '').trim();
    const ok = manager.killTask(taskId);
    return {
      stdout: ok ? `Task ${taskId} cancelled.` : '',
      stderr: ok ? '' : `Task "${taskId}" not found.`,
      exitCode: ok ? 0 : 1,
      durationMs: Date.now() - startMs,
    };
  }

  // Default: 'list'
  const tasks = manager.listTasks();
  return {
    stdout: JSON.stringify({ count: tasks.length, tasks }, null, 2),
    stderr: '',
    exitCode: 0,
    durationMs: Date.now() - startMs,
  };
};
