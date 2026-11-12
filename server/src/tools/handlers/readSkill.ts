// Migrated handler: read_skill (Strangler-Fig extraction from BuiltinToolExecutor).
import type { BuiltinToolHandler } from './types.js';

export const name = 'read_skill';

export const execute: BuiltinToolHandler = async (args, _ctx, exec) => {
  const startMs = performance.now();
  const skillName = String(args.name || '');
  const skill = exec.skills?.readSkill(skillName);

  if (!skill) {
    return {
      stdout: '',
      stderr: `Skill "${skillName}" not found. Available skills: ${(exec.skills?.listSkills() || []).map((s) => s.name).join(', ')}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  return {
    stdout: `# Skill: ${skill.name} (${skill.path})\n\n${skill.content}`,
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};
