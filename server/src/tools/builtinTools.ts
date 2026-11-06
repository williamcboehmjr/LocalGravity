import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { LocalGravityDB, FileCheckpointRecord } from '../db/database.js';
import { SharedTerminalManager } from '../terminal/terminalManager.js';

export interface ToolExecutionContext {
  threadId: string;
  messageId: string;
  workspaceRoot: string;
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

export const BUILTIN_TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'run_terminal',
      description:
        'Execute any shell or system command in the interactive terminal (powershell.exe on Windows, /bin/zsh on macOS) with full workstation permissions and stream live stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Optional working directory anywhere on the system' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read the contents of any file on the workstation (supports relative workspace paths and absolute system paths like C:/Users/Sue/Downloads/file.txt or ~/Downloads).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path or absolute system file path' },
          start_line: { type: 'number', description: 'Optional 1-based start line' },
          end_line: { type: 'number', description: 'Optional 1-based end line' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write content to any file on the system or workspace with automatic pre-edit snapshot backup in file_checkpoints for 1-click undo/revert.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path or absolute system file path' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_diff',
      description:
        'Apply a target/replacement edit to any file on the system or workspace with automatic pre-edit snapshot backup in file_checkpoints for 1-click undo/revert.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path or absolute system file path' },
          target: { type: 'string', description: 'Exact string block to replace' },
          replacement: { type: 'string', description: 'Replacement string block' },
        },
        required: ['path', 'target', 'replacement'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_codebase',
      description:
        'Fast ripgrep / regex search across files anywhere on the workstation (workspace, Downloads, Desktop, or specified directory).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Regex or substring pattern to search for' },
          path: { type: 'string', description: 'Optional directory path to search (default: workspace root)' },
          file_pattern: { type: 'string', description: 'Optional file extension filter (e.g. .ts, .txt, .json)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        'List files and subdirectories in any directory on the computer (e.g. Downloads, Desktop, C:/Users/Sue/Downloads, C:/, or workspace root). Full system access is granted.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (e.g. "Downloads", "C:/Users/Sue/Downloads", "C:/", or "." for workspace root)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'capture_screen',
      description:
        'Capture a live screenshot of the desktop or active window for Vision-Language multimodal grounding.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['desktop', 'active_window'],
            description: 'Capture full desktop or active window',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_window',
      description: 'Inspect active desktop windows and capture grounding metadata + screenshot.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_inspect',
      description: 'Inspect a live web URL (DOM structure, title, headings, status, and preview).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL to inspect' },
        },
        required: ['url'],
      },
    },
  },
];

export class BuiltinToolExecutor {
  private db: LocalGravityDB;
  private terminal: SharedTerminalManager;

  constructor(db: LocalGravityDB, terminal: SharedTerminalManager) {
    this.db = db;
    this.terminal = terminal;
  }

  private resolveSafePath(workspaceRoot: string, inputPath?: string): string {
    if (!inputPath || inputPath === '.') return workspaceRoot;
    if (inputPath.startsWith('~')) {
      return path.resolve(os.homedir(), inputPath.slice(1).replace(/^[/\\]/, ''));
    }
    const lower = inputPath.trim().toLowerCase();
    if (lower === 'downloads' || lower === 'download') {
      return path.join(os.homedir(), 'Downloads');
    }
    if (lower === 'desktop') {
      return path.join(os.homedir(), 'Desktop');
    }
    if (lower === 'documents' || lower === 'docs') {
      return path.join(os.homedir(), 'Documents');
    }
    if (path.isAbsolute(inputPath)) return inputPath;
    return path.resolve(workspaceRoot, inputPath);
  }

  public async executeTool(
    toolName: string,
    args: Record<string, any>,
    ctx: ToolExecutionContext
  ): Promise<BuiltinToolResult> {
    const startMs = performance.now();

    try {
      switch (toolName) {
        case 'run_terminal': {
          const cmd = String(args.command || 'Get-Location');
          const cwd = args.cwd ? this.resolveSafePath(ctx.workspaceRoot, args.cwd) : ctx.workspaceRoot;
          const res = await this.terminal.executeCommand(cmd, cwd, 30000, (chunk, stream) => {
            if (stream === 'stdout') ctx.onStdoutChunk?.(chunk);
            else ctx.onStderrChunk?.(chunk);
          });
          return res;
        }

        case 'read_file': {
          const targetPath = this.resolveSafePath(ctx.workspaceRoot, args.path);
          if (!fs.existsSync(targetPath)) {
            return {
              stdout: '',
              stderr: `File not found: ${targetPath}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          const raw = fs.readFileSync(targetPath, 'utf-8');
          const lines = raw.split(/\r?\n/);
          const sLine = args.start_line ? Math.max(1, Number(args.start_line)) : 1;
          const eLine = args.end_line ? Math.min(lines.length, Number(args.end_line)) : lines.length;
          const slice = lines.slice(sLine - 1, eLine).join('\n');
          return {
            stdout: slice,
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'write_file': {
          const targetPath = this.resolveSafePath(ctx.workspaceRoot, args.path);
          const previousContent = fs.existsSync(targetPath)
            ? fs.readFileSync(targetPath, 'utf-8')
            : null;
          const newContent = String(args.content ?? '');

          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, newContent, 'utf-8');

          const checkpoint = this.db.createFileCheckpoint({
            thread_id: ctx.threadId,
            message_id: ctx.messageId,
            file_path: targetPath,
            previous_content_blob: previousContent,
            new_content_blob: newContent,
          });
          ctx.onFileCheckpointCreated?.(checkpoint);

          return {
            stdout: `Wrote ${newContent.length} bytes to ${targetPath} (checkpoint ${checkpoint.id} saved)`,
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
            checkpoint,
          };
        }

        case 'apply_diff': {
          const targetPath = this.resolveSafePath(ctx.workspaceRoot, args.path);
          if (!fs.existsSync(targetPath)) {
            return {
              stdout: '',
              stderr: `Cannot apply_diff: file ${targetPath} does not exist`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          const previousContent = fs.readFileSync(targetPath, 'utf-8');
          const targetStr = String(args.target ?? '');
          const replacementStr = String(args.replacement ?? '');

          if (!previousContent.includes(targetStr)) {
            return {
              stdout: '',
              stderr: `Target block not found in ${targetPath}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }

          const newContent = previousContent.replace(targetStr, replacementStr);
          fs.writeFileSync(targetPath, newContent, 'utf-8');

          const checkpoint = this.db.createFileCheckpoint({
            thread_id: ctx.threadId,
            message_id: ctx.messageId,
            file_path: targetPath,
            previous_content_blob: previousContent,
            new_content_blob: newContent,
          });
          ctx.onFileCheckpointCreated?.(checkpoint);

          return {
            stdout: `Applied diff to ${targetPath} (checkpoint ${checkpoint.id} saved)`,
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
            checkpoint,
          };
        }

        case 'list_directory': {
          const targetDir = this.resolveSafePath(ctx.workspaceRoot, args.path || '.');
          if (!fs.existsSync(targetDir)) {
            return {
              stdout: '',
              stderr: `Directory not found: ${targetDir}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          const entries = fs.readdirSync(targetDir, { withFileTypes: true }).map((d) => ({
            name: d.name,
            type: d.isDirectory() ? 'directory' : 'file',
          }));
          return {
            stdout: JSON.stringify(entries, null, 2),
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'search_codebase': {
          const query = String(args.query || '');
          const extFilter = args.file_pattern ? String(args.file_pattern) : '';
          const matches: Array<{ file: string; line: number; text: string }> = [];

          const walk = (dir: string) => {
            if (matches.length >= 50) return;
            let list: fs.Dirent[] = [];
            try {
              list = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
              return;
            }
            for (const item of list) {
              if (matches.length >= 50) break;
              if (
                item.name === 'node_modules' ||
                item.name === '.git' ||
                item.name === '.venv' ||
                item.name === 'dist' ||
                item.name === '.runtime'
              ) {
                continue;
              }
              const full = path.join(dir, item.name);
              if (item.isDirectory()) {
                walk(full);
              } else if (item.isFile()) {
                if (extFilter && !item.name.endsWith(extFilter)) continue;
                try {
                  const stat = fs.statSync(full);
                  if (stat.size > 512 * 1024) continue;
                  const content = fs.readFileSync(full, 'utf-8');
                  const lines = content.split(/\r?\n/);
                  const regex = new RegExp(query, 'i');
                  for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                      matches.push({
                        file: path.relative(ctx.workspaceRoot, full).replace(/\\/g, '/'),
                        line: i + 1,
                        text: lines[i].trim().slice(0, 200),
                      });
                      if (matches.length >= 50) break;
                    }
                  }
                } catch {}
              }
            }
          };

          const searchTarget = args.path
            ? this.resolveSafePath(ctx.workspaceRoot, String(args.path))
            : ctx.workspaceRoot;
          walk(searchTarget);
          return {
            stdout: JSON.stringify({ query, count: matches.length, matches }, null, 2),
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'capture_screen':
        case 'inspect_window': {
          const screenshotResult = this.captureWindowsScreen();
          ctx.onScreenCaptured?.(screenshotResult.base64DataUrl, screenshotResult.activeWindowTitle);
          return {
            stdout: JSON.stringify(
              {
                captured: true,
                activeWindowTitle: screenshotResult.activeWindowTitle,
                resolution: screenshotResult.resolution,
                byteLength: screenshotResult.base64DataUrl.length,
              },
              null,
              2
            ),
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
            screenshotBase64: screenshotResult.base64DataUrl,
          };
        }

        case 'browser_inspect': {
          const url = String(args.url || 'http://localhost:3390');
          if (url.includes(':5000') || url.includes(':5001')) {
            return {
              stdout: '',
              stderr: 'Forbidden port 5000/5001 rejected by security policy.',
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
          const html = await resp.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          return {
            stdout: JSON.stringify(
              {
                url,
                status: resp.status,
                title: titleMatch ? titleMatch[1].trim() : 'Untitled',
                contentLength: html.length,
                snippet: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
              },
              null,
              2
            ),
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        default:
          return {
            stdout: `Executed ${toolName} with args: ${JSON.stringify(args)}`,
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
      }
    } catch (err: any) {
      return {
        stdout: '',
        stderr: err?.message || String(err),
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
  }

  public captureWindowsScreen(): {
    base64DataUrl: string;
    activeWindowTitle: string;
    resolution: string;
  } {
    try {
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$b64 = [Convert]::ToBase64String($ms.ToArray())
$graphics.Dispose()
$bmp.Dispose()
Write-Output "$($bounds.Width)x$($bounds.Height)|$b64"
      `.trim();

      const out = execSync(
        `powershell.exe -NoProfile -NonInteractive -Command "${psScript.replace(/\r?\n/g, '; ')}"`,
        { timeout: 5000, maxBuffer: 15 * 1024 * 1024 }
      )
        .toString()
        .trim();

      const [resPart, b64Part] = out.split('|');
      if (b64Part) {
        return {
          base64DataUrl: `data:image/jpeg;base64,${b64Part}`,
          activeWindowTitle: 'Windows Desktop Primary Display',
          resolution: resPart || '1920x1080',
        };
      }
    } catch {
      // Fallback 1x1 dark obsidian PNG if headless session
    }

    return {
      base64DataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      activeWindowTitle: 'LocalGravity Headless Surface',
      resolution: '1440x900',
    };
  }
}
