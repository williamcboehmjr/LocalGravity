// Migrated handler: call_mcp_tool (Strangler-Fig extraction from BuiltinToolExecutor).
import type { BuiltinToolHandler } from './types.js';

export const name = 'call_mcp_tool';

export const execute: BuiltinToolHandler = async (args, _ctx, exec) => {
  const startMs = performance.now();

  if (!exec.mcp) {
    return {
      stdout: '',
      stderr: 'MCP Client Manager is not available on this server.',
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  const serverName = String(args.ServerName || '');
  const tName = String(args.ToolName || '');
  const tArgs = (args.Arguments || {}) as Record<string, any>;

  const res = await exec.mcp.callMcpTool(serverName, tName, tArgs);

  return {
    stdout: res.outputText,
    stderr: res.isError ? res.outputText : '',
    exitCode: res.isError ? 1 : 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};
