// Handler contract for the builtin tool registry (Strangler-Fig refactor of BuiltinToolExecutor).
// Each migrated case becomes a standalone module exporting { name, execute }.

import type { LocalGravityDB, FileCheckpointRecord } from '../../db/database.js';
import type { SharedTerminalManager } from '../../terminal/terminalManager.js';
import type { McpClientManager } from '../../mcp/mcpManager.js';
import type { SkillManager } from '../../skills/skillManager.js';
import type { AttachmentManager } from '../../files/attachmentManager.js';

// Re-declared here to avoid a circular import with builtinTools.ts. These structural
// types must stay in sync with the originals exported from ../builtinTools.js.
export interface ToolExecutionContext {
  threadId: string;
  messageId: string;
  workspaceRoot: string;
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

// The executor surface handed to every handler. Handlers call back into the shared
// instance for helpers (resolveSafePath), recursion (executeTool), and manager deps.
export interface ToolExec {
  db: LocalGravityDB;
  terminal: SharedTerminalManager;
  mcp?: McpClientManager;
  skills?: SkillManager;
  attachmentManager?: AttachmentManager;

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
  exec: ToolExec,
) => Promise<BuiltinToolResult>;
