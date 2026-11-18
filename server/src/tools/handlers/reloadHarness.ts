import type { BuiltinToolHandler } from './types.js';

export const name = 'reload_harness';

export const execute: BuiltinToolHandler = async (_args, _ctx, execCtx) => {
  const startMs = performance.now();
  const discoveredSkills = execCtx.skills ? execCtx.skills.discoverSkills() : [];
  const mcpServers = execCtx.mcp ? execCtx.mcp.loadConfig() : [];
  const permRules = execCtx.permissions ? execCtx.permissions.reloadRules() : [];

  const summary = {
    reloaded: true,
    skillsCount: discoveredSkills.length,
    skillNames: discoveredSkills.map((s) => s.name),
    mcpServerCount: mcpServers.length,
    enabledMcpServers: mcpServers.filter((s) => s.enabled).map((s) => s.name),
    permissionRuleCount: permRules.length,
  };

  return {
    stdout: JSON.stringify(summary, null, 2),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};
