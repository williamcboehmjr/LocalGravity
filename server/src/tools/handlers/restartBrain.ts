import type { BuiltinToolHandler } from './types.js';

export const name = 'restart_brain';

export const execute: BuiltinToolHandler = async (args, _ctx, exec) => {
  const startMs = performance.now();
  const reason = String(args.reason || 'User requested restart via chat');
  setTimeout(() => {
    process.exit(42);
  }, 600);
  return {
    stdout: JSON.stringify(
      {
        status: 'restarting',
        supervisor_signal: 42,
        message: `Central Brain reboot initiated (${reason}). Windows Tray supervisor will recycle the brain process in 500ms.`,
      },
      null,
      2,
    ),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};
