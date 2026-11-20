import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalGravityDB, FileCheckpointRecord } from '../db/database.js';
import { SharedTerminalManager } from '../terminal/terminalManager.js';
import { McpClientManager } from '../mcp/mcpManager.js';
import { SkillManager } from '../skills/skillManager.js';
import type { AttachmentManager } from '../files/attachmentManager.js';
import { HANDLER_REGISTRY } from './handlers/index.js';
import { EdgeBridgeManager } from '../bridge/edgeBridge.js';
import { LspDiagnosticsManager } from './lspManager.js';
import { PermissionEngine } from './permissionEngine.js';
import { getPathsConfig } from '../core/pathsConfig.js';
import { captureWindowsScreen } from './handlers/visionTools.js';
import {
  truncateSafeOutput,
  type ToolExecutionContext,
  type BuiltinToolResult,
  type ToolExec,
} from './handlers/types.js';

export type { ToolExecutionContext, BuiltinToolResult, ToolExec };
export { truncateSafeOutput };
export { BUILTIN_TOOLS_SCHEMA } from './builtinToolsSchema.js';

export class BuiltinToolExecutor {
  private db: LocalGravityDB;
  private terminal: SharedTerminalManager;
  private mcp?: McpClientManager;
  private skills?: SkillManager;
  private attachmentManager?: AttachmentManager;
  private lsp = new LspDiagnosticsManager();
  private permissions: PermissionEngine;

  constructor(
    db: LocalGravityDB,
    terminal: SharedTerminalManager,
    mcp?: McpClientManager,
    skills?: SkillManager,
    attachmentManager?: AttachmentManager,
    repoRoot?: string
  ) {
    this.db = db;
    this.terminal = terminal;
    this.mcp = mcp;
    this.skills = skills;
    this.attachmentManager = attachmentManager;
    this.permissions = new PermissionEngine(repoRoot || process.cwd());
  }

  public getPermissionEngine(): PermissionEngine {
    return this.permissions;
  }

  public resolveSafePath(workspaceRoot: string, inputPath?: string): string {
    return this.resolveSafePathInternal(workspaceRoot, inputPath);
  }

  public asExec(): ToolExec {
    return {
      db: this.db,
      terminal: this.terminal,
      mcp: this.mcp,
      skills: this.skills,
      attachmentManager: this.attachmentManager,
      permissions: this.permissions,
      lsp: this.lsp,
      resolveSafePath: (w, p) => this.resolveSafePath(w, p),
      executeTool: (t, a, c) => this.executeTool(t, a, c),
    };
  }

  private resolveSafePathInternal(workspaceRoot: string, inputPath?: string): string {
    if (!inputPath || inputPath === '.') return workspaceRoot;
    if (inputPath.startsWith('~')) {
      return path.resolve(os.homedir(), inputPath.slice(1).replace(/^[/\\]/, ''));
    }
    const clean = inputPath.replace(/\\/g, '/').trim();
    const lower = clean.toLowerCase();
    const paths = getPathsConfig();

    if (lower === 'strata' || lower.startsWith('strata/')) {
      const sub = clean.slice(6).replace(/^[/\\]/, '');
      return path.resolve(paths.strataDir, sub);
    }
    if (lower === 'models' || lower.startsWith('models/')) {
      const sub = clean.slice(6).replace(/^[/\\]/, '');
      const primaryModelsDir =
        paths.modelsDirs.find((d) => fs.existsSync(d)) ||
        (process.platform === 'win32' ? 'E:/Models' : path.join(os.homedir(), 'models'));
      return path.resolve(primaryModelsDir, sub);
    }
    if (lower === 'downloads' || lower.startsWith('downloads/')) {
      const sub = clean.slice(9).replace(/^[/\\]/, '');
      return path.resolve(os.homedir(), 'Downloads', sub);
    }
    if (lower === 'desktop' || lower.startsWith('desktop/')) {
      const sub = clean.slice(7).replace(/^[/\\]/, '');
      return path.resolve(os.homedir(), 'Desktop', sub);
    }
    if (lower === 'documents' || lower.startsWith('documents/') || lower === 'docs' || lower.startsWith('docs/')) {
      const prefix = lower.startsWith('docs') ? 'docs' : 'documents';
      const sub = clean.slice(prefix.length).replace(/^[/\\]/, '');
      return path.resolve(os.homedir(), 'Documents', sub);
    }
    if (lower === 'localappdata' || lower.startsWith('localappdata/')) {
      const sub = clean.slice(12).replace(/^[/\\]/, '');
      return path.resolve(os.homedir(), 'AppData/Local', sub);
    }
    if (lower === 'appdata' || lower.startsWith('appdata/')) {
      const sub = clean.slice(7).replace(/^[/\\]/, '');
      return path.resolve(os.homedir(), 'AppData/Roaming', sub);
    }

    if (/^[a-zA-Z]:/i.test(clean) || path.isAbsolute(clean)) {
      return path.normalize(clean);
    }
    return path.resolve(workspaceRoot, clean);
  }

  public async executeTool(
    toolName: string,
    args: Record<string, any>,
    ctx: ToolExecutionContext
  ): Promise<BuiltinToolResult> {
    const startMs = performance.now();

    if (ctx.abortSignal?.aborted) {
      return {
        stdout: '',
        stderr: 'Tool execution aborted by user.',
        exitCode: 130,
        durationMs: 0,
      };
    }

    const perm = this.permissions.evaluate(toolName, args);
    if (perm.decision === 'deny') {
      return {
        stdout: '',
        stderr: `Blocked by PermissionEngine rule (${perm.matchedRule?.id || 'deny'}): ${perm.reason || toolName}`,
        exitCode: 1,
        durationMs: 0,
      };
    }

    try {
      const edgeBridge = EdgeBridgeManager.getInstance();
      if (edgeBridge.isHostTool(toolName)) {
        const targetClient =
          ctx.projectHost && edgeBridge.isRemoteHost(ctx.projectHost)
            ? edgeBridge.getClientByHost(ctx.projectHost)
            : !ctx.projectHost
              ? edgeBridge.getRemoteClientForThread(ctx.threadId)
              : null;

        if (ctx.projectHost && edgeBridge.isRemoteHost(ctx.projectHost) && !targetClient) {
          return {
            stdout: '',
            stderr: `Host "${ctx.projectHost}" is currently offline. Open LocalGravity on "${ctx.projectHost}" to run tools on this project.`,
            exitCode: 1,
            durationMs: 0,
          };
        }

        if (targetClient) {
          const isRemoteNonWin = !targetClient.platform.toLowerCase().includes('win');
          const rawPath = String(args?.path || args?.file_path || args?.directory || args?.cwd || '');
          const rawCmd = String(args?.command || '');
          const targetsWinBrain =
            isRemoteNonWin &&
            (/^[A-Za-z]:[\\/]/.test(rawPath) || /^\s*powershell(\.exe)?\b/i.test(rawCmd));

          if (!targetsWinBrain) {
            return await edgeBridge.executeRemoteTool(
              targetClient,
              toolName,
              args,
              ctx.workspaceRoot,
              ctx.abortSignal
            );
          }
        }
      }

      const handler = HANDLER_REGISTRY[toolName];
      if (handler) {
        return await handler(args, ctx, this.asExec());
      }

      if (toolName.startsWith('mcp_') && this.mcp) {
        const activeTools = this.mcp.listActiveTools();
        const matchingTool = activeTools.find(
          (t) => t.name === toolName || `mcp_${t.serverName}_${t.name}` === toolName
        );
        const targetServer = matchingTool ? matchingTool.serverName : toolName.split('_')[1];
        const targetTool = matchingTool ? matchingTool.name : toolName.replace(new RegExp(`^mcp_${targetServer}_`), '');

        const res = await this.mcp.callMcpTool(targetServer, targetTool, args);
        return {
          stdout: res.outputText,
          stderr: res.isError ? res.outputText : '',
          exitCode: res.isError ? 1 : 0,
          durationMs: Math.round(performance.now() - startMs),
        };
      }

      return {
        stdout: '',
        stderr: `Unknown tool "${toolName}". Verify the exact tool name from your active tool list.`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    } catch (err: any) {
      return {
        stdout: '',
        stderr: err?.message || String(err),
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
  }

  public captureWindowsScreen() {
    return captureWindowsScreen();
  }
}
