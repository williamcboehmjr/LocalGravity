import { exec } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuiltinToolHandler } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..', '..');

export const name = 'publish_release';

export const execute: BuiltinToolHandler = async (args, ctx) => {
  const bump = String(args.bump || 'patch').trim();
  const notes = String(args.notes || 'Autonomous updates and enhancements.').trim();

  const scriptPath = path.join(rootDir, 'scripts', 'publish_release.mjs');
  const safeNotes = notes.replace(/"/g, '\\"');
  const cmd = `node "${scriptPath}" --bump "${bump}" --notes "${safeNotes}"`;

  return new Promise((resolve) => {
    const start = Date.now();
    exec(cmd, { cwd: rootDir, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      if (error) {
        resolve({
          stdout: stdout || '',
          stderr: stderr || error.message,
          exitCode: error.code || 1,
          durationMs,
        });
      } else {
        resolve({
          stdout: stdout || 'Release published successfully.',
          stderr: stderr || '',
          exitCode: 0,
          durationMs,
        });
      }
    });
  });
};
