// Handler contract for the builtin tool registry (Strangler-Fig refactor of BuiltinToolExecutor).

import type { LocalGravityDB, FileCheckpointRecord } from '../../db/database.js';
import type { SharedTerminalManager } from '../../terminal/terminalManager.js';
import type { McpClientManager } from '../../mcp/mcpManager.js';
import type { SkillManager } from '../../skills/skillManager.js';
import type { AttachmentManager } from '../../files/attachmentManager.js';
import type { PermissionEngine } from '../permissionEngine.js';
import type { LspDiagnosticsManager } from '../lspManager.js';

export interface ToolExecutionContext {
  threadId: string;
  messageId: string;
  workspaceRoot: string;
  projectHost?: string;
  abortSignal?: AbortSignal;
  swarmAgentName?: string;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
  onFileCheckpointCreated?: (checkpoint: FileCheckpointRecord) => void;
  onScreenCaptured?: (base64Image: string, windowTitle: string) => void;
}

export interface BuiltinToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  checkpoint?: FileCheckpointRecord;
  screenshotBase64?: string;
}

export interface ToolExec {
  db: LocalGravityDB;
  terminal: SharedTerminalManager;
  mcp?: McpClientManager;
  skills?: SkillManager;
  attachmentManager?: AttachmentManager;
  permissions?: PermissionEngine;
  lsp?: LspDiagnosticsManager;

  resolveSafePath(workspaceRoot: string, inputPath?: string): string;
  executeTool(
    toolName: string,
    args: Record<string, any>,
    ctx: ToolExecutionContext
  ): Promise<BuiltinToolResult>;
}

export type BuiltinToolHandler = (
  args: Record<string, any>,
  ctx: ToolExecutionContext,
  exec: ToolExec
) => Promise<BuiltinToolResult>;

export function truncateSafeOutput(output: string, maxChars = 16000): string {
  if (!output || output.length <= maxChars) return output;
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  const omitted = output.length - (headChars + tailChars);
  return `${output.slice(0, headChars)}\n\n... [Output truncated: ${omitted.toLocaleString()} characters omitted to preserve context window] ...\n\n${output.slice(-tailChars)}`;
}
