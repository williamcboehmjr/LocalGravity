import type { BuiltinToolHandler } from './types.js';
import { BackgroundTaskManager } from '../taskManager.js';

export const name = 'schedule';

export const execute: BuiltinToolHandler = async (args) => {
  const startMs = Date.now();
  const manager = BackgroundTaskManager.getInstance();
  const durationSeconds = Number(args.duration_seconds ?? args.durationSeconds ?? 10);
  const prompt = String(args.prompt || 'Scheduled timer notification').trim();
  const title = args.title ? String(args.title) : undefined;

  if (isNaN(durationSeconds) || durationSeconds <= 0) {
    return {
      stdout: '',
      stderr: 'schedule requires a positive "duration_seconds" number.',
      exitCode: 1,
      durationMs: Date.now() - startMs,
    };
  }

  const timerTask = manager.scheduleTimer({
    durationSeconds,
    prompt,
    title,
  });

  return {
    stdout: JSON.stringify(
      {
        message: `Scheduled timer ${timerTask.taskId} for ${timerTask.durationSeconds}s. A live countdown badge is now visible in the GUI.`,
        timer: timerTask,
      },
      null,
      2
    ),
    stderr: '',
    exitCode: 0,
    durationMs: Date.now() - startMs,
  };
};
