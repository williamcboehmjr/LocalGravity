// Migrated handler: list_skills (Strangler-Fig extraction from BuiltinToolExecutor).
import type { BuiltinToolHandler } from './types.js';

export const name = 'list_skills';

export const execute: BuiltinToolHandler = async (_args, _ctx, exec) => {
  const startMs = performance.now();
  const list = exec.skills?.listSkills() || [];

  return {
    stdout: JSON.stringify(list, null, 2),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};
