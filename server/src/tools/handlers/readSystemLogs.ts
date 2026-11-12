// Migrated handler: read_system_logs (Strangler-Fig extraction from BuiltinToolExecutor).
import fs from 'fs';
import path from 'path';

import type { BuiltinToolHandler } from './types.js';

export const name = 'read_system_logs';

export const execute: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const target = String(args.target || 'strata').toLowerCase();
  const maxLines = Math.min(200, Math.max(1, Number(args.lines) || 50));

  let logPath = '';
  if (target === 'strata') {
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Sue\\AppData\\Local';
    logPath = path.join(localAppData, 'Strata', 'launch', 'iq3_s-64k.engine.log');
  } else if (target === 'tray') {
    logPath = path.resolve(ctx.workspaceRoot, '.runtime', 'tray.log');
  } else {
    logPath = path.resolve(ctx.workspaceRoot, '.runtime', 'tray.log');
  }

  if (!fs.existsSync(logPath)) {
    return {
      stdout: '',
      stderr: `Log file not found at ${logPath}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.split('\n');
  const tail = lines.slice(-maxLines).join('\n');

  return {
    stdout: tail,
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};
