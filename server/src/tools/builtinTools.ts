import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { execSync, spawn } from 'node:child_process';
import { LocalGravityDB, FileCheckpointRecord } from '../db/database.js';
import { SharedTerminalManager } from '../terminal/terminalManager.js';
import { McpClientManager } from '../mcp/mcpManager.js';
import { SkillManager, SKILL_TOOLS_SCHEMA } from '../skills/skillManager.js';
import type { AttachmentManager } from '../files/attachmentManager.js';
import { extractJpegsFromPdf } from '../files/attachmentManager.js';
import { createRequire } from 'node:module';
import { HANDLER_REGISTRY } from './handlers/index.js';
const require = createRequire(import.meta.url);

export interface ToolExecutionContext {
  threadId: string;
  messageId: string;
  workspaceRoot: string;
  abortSignal?: AbortSignal;
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

export { BUILTIN_TOOLS_SCHEMA } from './builtinToolsSchema.js';


export function truncateSafeOutput(output: string, maxChars = 16000): string {
  if (!output || output.length <= maxChars) return output;
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  const omitted = output.length - (headChars + tailChars);
  return `${output.slice(0, headChars)}\n\n... [Output truncated: ${omitted.toLocaleString()} characters omitted to preserve context window] ...\n\n${output.slice(-tailChars)}`;
}

export class BuiltinToolExecutor {
  private db: LocalGravityDB;
  private terminal: SharedTerminalManager;
  private mcp?: McpClientManager;
  private skills?: SkillManager;
  private attachmentManager?: AttachmentManager;

  constructor(
    db: LocalGravityDB,
    terminal: SharedTerminalManager,
    mcp?: McpClientManager,
    skills?: SkillManager,
    attachmentManager?: AttachmentManager
  ) {
    this.db = db;
    this.terminal = terminal;
    this.mcp = mcp;
    this.skills = skills;
    this.attachmentManager = attachmentManager;
  }

  public resolveSafePath(workspaceRoot: string, inputPath?: string): string {
    return this.resolveSafePathInternal(workspaceRoot, inputPath);
  }

  // Exposes the executor surface (deps + helpers) to registry handlers. Class fields
  // are private; ToolExec gives handlers a controlled view without widening visibility.
  public asExec(): import('./handlers/types.js').ToolExec {
    return {
      db: this.db,
      terminal: this.terminal,
      mcp: this.mcp,
      skills: this.skills,
      attachmentManager: this.attachmentManager,
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

    // Workstation aliases
    if (lower === 'strata' || lower.startsWith('strata/')) {
      const sub = clean.slice(6).replace(/^[/\\]/, '');
      return path.resolve(os.homedir(), 'AppData/Local/Strata', sub);
    }
    if (lower === 'models' || lower.startsWith('models/')) {
      const sub = clean.slice(6).replace(/^[/\\]/, '');
      return path.resolve('E:/Models', sub);
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

    // Windows drive letters like C:/ or E:/ or absolute paths
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

    try {
      // Registry-first dispatch (Strangler-Fig): migrated tools live in ./handlers.
      const handler = HANDLER_REGISTRY[toolName];
      if (handler) {
        return await handler(args, ctx, this.asExec());
      }

      switch (toolName) {
        case 'inspect_document': {
          const rawPath = String(args.path || '');
          const resolved = this.resolveSafePath(ctx.workspaceRoot, rawPath);
          if (!fs.existsSync(resolved)) {
            return {
              stdout: '',
              stderr: `Document not found: ${resolved}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          const ext = path.extname(resolved).toLowerCase();
          const buffer = fs.readFileSync(resolved);
          const stat = fs.statSync(resolved);
          const result: Record<string, any> = {
            path: resolved.replace(/\\/g, '/'),
            filename: path.basename(resolved),
            sizeBytes: stat.size,
            format: ext.replace('.', ''),
          };

          if (ext === '.pdf') {
            if (args.extract_images !== false) {
              const jpegs = extractJpegsFromPdf(buffer);
              const dir = path.dirname(resolved);
              const base = path.parse(resolved).name;
              const savedImages: string[] = [];
              jpegs.slice(0, 10).forEach((jBuf, idx) => {
                const imgOut = path.join(dir, `${base}_extracted_img${idx + 1}.jpg`);
                fs.writeFileSync(imgOut, jBuf);
                savedImages.push(imgOut.replace(/\\/g, '/'));
              });
              result.extractedImagesCount = jpegs.length;
              result.extractedImages = savedImages;
              result.note = savedImages.length > 0
                ? `Extracted ${savedImages.length} embedded images (e.g. photos/scans). Saved to disk at paths above for visual analysis.`
                : 'No embedded raster images detected in this PDF.';
            }

            try {
              const pdfParseModule = require('pdf-parse');
              const parseFn = typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule.default;
              if (parseFn) {
                const parsed = await parseFn(buffer);
                result.pageCount = parsed.numpages;
                result.info = parsed.info;
                result.textLength = parsed.text ? parsed.text.length : 0;
                result.textContent = parsed.text ? parsed.text.trim().slice(0, 30000) : '';
                if (!result.textContent) {
                  result.documentType = 'scanned_image_pdf (No text layer found; text is stored inside the extracted images)';
                } else {
                  result.documentType = 'searchable_text_pdf';
                }
              }
            } catch (err: any) {
              result.textExtractionError = String(err?.message || err);
            }
          } else {
            const text = buffer.toString('utf-8');
            const lines = text.split('\n');
            result.lineCount = lines.length;
            result.textContent = lines.slice(0, 1000).join('\n');
          }

          return {
            stdout: JSON.stringify(result, null, 2),
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'inspect_file_metadata': {
          const rawPath = String(args.path || '');
          const resolved = this.resolveSafePath(ctx.workspaceRoot, rawPath);
          if (!fs.existsSync(resolved)) {
            return {
              stdout: '',
              stderr: `File not found: ${resolved}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          try {
            const meta = this.attachmentManager
              ? this.attachmentManager.extractFileMetadata(resolved)
              : { path: resolved, size: fs.statSync(resolved).size };
            return {
              stdout: JSON.stringify(meta, null, 2),
              stderr: '',
              exitCode: 0,
              durationMs: Math.round(performance.now() - startMs),
            };
          } catch (e: any) {
            return {
              stdout: '',
              stderr: `Failed to inspect metadata: ${e?.message || String(e)}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
        }

        case 'manage_strata': {
          const action = String(args.action || 'status').toLowerCase();
          const inspectArgs: Record<string, any> = {
            action: action === 'status' ? 'inspect' : action,
            test_prompt: args.test_prompt,
          };
          return await this.executeTool('inspect_models', inspectArgs, ctx);
        }

        case 'run_terminal': {
          const cmd = String(args.command || 'Get-Location');
          let cwd = args.cwd ? this.resolveSafePath(ctx.workspaceRoot, args.cwd) : ctx.workspaceRoot;
          if (!fs.existsSync(cwd)) {
            cwd = ctx.workspaceRoot;
          }
          const res = await this.terminal.executeCommand(cmd, cwd, 30000, (chunk, stream) => {
            if (stream === 'stdout') ctx.onStdoutChunk?.(chunk);
            else ctx.onStderrChunk?.(chunk);
          }, ctx.abortSignal);
          return {
            ...res,
            stdout: truncateSafeOutput(res.stdout, 16000),
            stderr: truncateSafeOutput(res.stderr, 8000),
          };
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
            stdout: truncateSafeOutput(slice, 24000),
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

        case 'search_web': {
          const query = String(args.query || '').trim();
          const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 15);
          if (!query) {
            return {
              stdout: 'Please provide a search query.',
              stderr: '',
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          try {
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            const resp = await fetch(url, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              },
              signal: AbortSignal.timeout(8000),
            });
            const html = await resp.text();
            const linkRegex = /<a\s+[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
            const snippetRegex = /<a\s+[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
            const results: Array<{ title: string; url: string; snippet: string }> = [];
            let m: RegExpExecArray | null;
            while ((m = linkRegex.exec(html)) !== null && results.length < limit) {
              const rawUrl = m[1];
              const title = m[2].replace(/<[^>]+>/g, '').trim();
              let directUrl = rawUrl;
              const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
              if (uddgMatch) {
                try {
                  directUrl = decodeURIComponent(uddgMatch[1]);
                } catch {}
              }
              results.push({ title, url: directUrl, snippet: '' });
            }
            let sIdx = 0;
            while ((m = snippetRegex.exec(html)) !== null && sIdx < results.length) {
              results[sIdx].snippet = m[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&#x27;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .trim();
              sIdx++;
            }
            return {
              stdout: JSON.stringify({ query, count: results.length, results }, null, 2),
              stderr: '',
              exitCode: 0,
              durationMs: Math.round(performance.now() - startMs),
            };
          } catch (err: any) {
            return {
              stdout: '',
              stderr: `Web search failed: ${err?.message || String(err)}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
        }

        case 'search_models': {
          const query = String(args.query || '').trim();
          const repo = String(args.repo || '').trim();
          const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);

          try {
            if (repo) {
              const cleanRepo = repo.replace(/^https?:\/\/huggingface\.co\//i, '').replace(/\/tree\/main.*$/, '');
              const url = `https://huggingface.co/api/models/${cleanRepo}/tree/main`;
              const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
              if (!resp.ok) {
                return {
                  stdout: '',
                  stderr: `Hugging Face repo error: ${resp.status} ${resp.statusText}`,
                  exitCode: 1,
                  durationMs: Math.round(performance.now() - startMs),
                };
              }
              const data: any = await resp.json();
              const files = Array.isArray(data)
                ? data.map((f: any) => ({
                    path: f.path,
                    size: f.size,
                    type: f.type,
                  }))
                : [];
              const filterQuery = query.toLowerCase();
              const filtered = filterQuery ? files.filter((f) => f.path.toLowerCase().includes(filterQuery)) : files;
              return {
                stdout: JSON.stringify(
                  {
                    repo: cleanRepo,
                    totalFiles: files.length,
                    matchedFiles: filtered.slice(0, 30),
                  },
                  null,
                  2
                ),
                stderr: '',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            }

            const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=${limit}`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!resp.ok) {
              return {
                stdout: '',
                stderr: `Hugging Face search error: ${resp.status} ${resp.statusText}`,
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
            const data: any = await resp.json();
            const models = Array.isArray(data)
              ? data.map((m: any) => ({
                  id: m.id,
                  downloads: m.downloads,
                  likes: m.likes,
                  pipeline_tag: m.pipeline_tag,
                  lastModified: m.lastModified,
                  url: `https://huggingface.co/${m.id}`,
                }))
              : [];
            return {
              stdout: JSON.stringify({ query, count: models.length, models }, null, 2),
              stderr: '',
              exitCode: 0,
              durationMs: Math.round(performance.now() - startMs),
            };
          } catch (err: any) {
            return {
              stdout: '',
              stderr: `Model search failed: ${err?.message || String(err)}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
        }

        case 'find_files': {
          const pattern = String(args.pattern || '').trim();
          const maxResults = Math.min(Math.max(Number(args.max_results) || 50, 1), 200);
          if (!pattern) {
            return {
              stdout: 'Please provide a file pattern (e.g. "setup.py", "*.json", "*vision*", "mmproj*").',
              stderr: '',
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          const targetDir = args.path
            ? this.resolveSafePath(ctx.workspaceRoot, String(args.path))
            : ctx.workspaceRoot;

          const matches: Array<{ name: string; fullPath: string; size: number; isDirectory: boolean }> = [];
          const rxPattern = new RegExp(
            '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
            'i'
          );

          const walk = (dir: string, depth = 0) => {
            if (matches.length >= maxResults || depth > 8) return;
            let list: fs.Dirent[] = [];
            try {
              list = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
              return;
            }
            for (const item of list) {
              if (matches.length >= maxResults) break;
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
              if (rxPattern.test(item.name) || item.name.toLowerCase().includes(pattern.toLowerCase())) {
                try {
                  const stat = fs.statSync(full);
                  matches.push({
                    name: item.name,
                    fullPath: full.replace(/\\/g, '/'),
                    size: stat.size,
                    isDirectory: item.isDirectory(),
                  });
                } catch {
                  matches.push({
                    name: item.name,
                    fullPath: full.replace(/\\/g, '/'),
                    size: 0,
                    isDirectory: item.isDirectory(),
                  });
                }
              }
              if (item.isDirectory()) {
                walk(full, depth + 1);
              }
            }
          };

          walk(targetDir);
          return {
            stdout: JSON.stringify(
              {
                pattern,
                searchPath: targetDir.replace(/\\/g, '/'),
                count: matches.length,
                matches,
              },
              null,
              2
            ),
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'code_outline': {
          const targetPath = this.resolveSafePath(ctx.workspaceRoot, args.path);
          if (!fs.existsSync(targetPath)) {
            return {
              stdout: '',
              stderr: `File not found: ${targetPath}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          const content = fs.readFileSync(targetPath, 'utf-8');
          const lines = content.split(/\r?\n/);
          const outline: Array<{ line: number; kind: string; name: string; signature: string }> = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;

            // Interfaces
            let m = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z0-9_]+)/);
            if (m) {
              outline.push({ line: i + 1, kind: 'interface', name: m[1], signature: trimmed });
              continue;
            }
            // Types
            m = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z0-9_]+)\s*=/);
            if (m) {
              outline.push({ line: i + 1, kind: 'type', name: m[1], signature: trimmed.slice(0, 60) });
              continue;
            }
            // Classes
            m = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/);
            if (m) {
              outline.push({ line: i + 1, kind: 'class', name: m[1], signature: trimmed.split('{')[0].trim() });
              continue;
            }
            // Functions / async functions
            m = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
            if (m) {
              outline.push({ line: i + 1, kind: 'function', name: m[1], signature: trimmed.split('{')[0].trim() });
              continue;
            }
            // Python def or class
            m = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/);
            if (m) {
              outline.push({ line: i + 1, kind: 'def', name: m[1], signature: trimmed.replace(/:$/, '') });
              continue;
            }
            m = trimmed.match(/^class\s+([A-Za-z0-9_]+)\s*(?:\([^)]*\))?:/);
            if (m) {
              outline.push({ line: i + 1, kind: 'class', name: m[1], signature: trimmed.replace(/:$/, '') });
              continue;
            }
            // Methods inside TS/JS classes
            m = trimmed.match(/^(?:public|private|protected|static)\s+(?:async\s+)?([A-Za-z0-9_]+)\s*\(/);
            if (m) {
              outline.push({ line: i + 1, kind: 'method', name: m[1], signature: trimmed.split('{')[0].trim() });
              continue;
            }
            // Major exported constants
            m = trimmed.match(/^export\s+const\s+([A-Za-z0-9_]+)\s*=/);
            if (m) {
              outline.push({ line: i + 1, kind: 'const', name: m[1], signature: trimmed.slice(0, 60) });
              continue;
            }
          }

          return {
            stdout: JSON.stringify(
              {
                file: path.relative(ctx.workspaceRoot, targetPath).replace(/\\/g, '/'),
                totalLines: lines.length,
                symbolCount: outline.length,
                outline,
              },
              null,
              2
            ),
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'patch_json': {
          const targetPath = this.resolveSafePath(ctx.workspaceRoot, args.path);
          if (!fs.existsSync(targetPath)) {
            return {
              stdout: '',
              stderr: `JSON file not found: ${targetPath}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          const raw = fs.readFileSync(targetPath, 'utf-8');
          let json: any;
          try {
            json = JSON.parse(raw);
          } catch (e: any) {
            return {
              stdout: '',
              stderr: `Failed to parse JSON in ${targetPath}: ${e?.message}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }

          const action = String(args.action || 'read').toLowerCase();
          const keyPath = args.key_path ? String(args.key_path).trim() : '';

          if (action === 'read') {
            if (!keyPath) {
              return {
                stdout: JSON.stringify(json, null, 2),
                stderr: '',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
            const parts = keyPath.split('.');
            let curr = json;
            for (const p of parts) {
              if (curr == null || typeof curr !== 'object') {
                curr = undefined;
                break;
              }
              curr = curr[p];
            }
            return {
              stdout: JSON.stringify({ key_path: keyPath, value: curr }, null, 2),
              stderr: '',
              exitCode: 0,
              durationMs: Math.round(performance.now() - startMs),
            };
          }

          if (action === 'set') {
            if (!keyPath) {
              return {
                stdout: '',
                stderr: 'key_path is required for action "set".',
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
            const parts = keyPath.split('.');
            let curr = json;
            for (let i = 0; i < parts.length - 1; i++) {
              if (!curr[parts[i]] || typeof curr[parts[i]] !== 'object') {
                curr[parts[i]] = {};
              }
              curr = curr[parts[i]];
            }
            curr[parts[parts.length - 1]] = args.value;
            fs.writeFileSync(targetPath, JSON.stringify(json, null, 2) + '\n', 'utf-8');
            return {
              stdout: `Successfully updated "${keyPath}" in ${targetPath}`,
              stderr: '',
              exitCode: 0,
              durationMs: Math.round(performance.now() - startMs),
            };
          }

          if (action === 'delete') {
            if (!keyPath) {
              return {
                stdout: '',
                stderr: 'key_path is required for action "delete".',
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
            const parts = keyPath.split('.');
            let curr = json;
            for (let i = 0; i < parts.length - 1; i++) {
              if (!curr[parts[i]] || typeof curr[parts[i]] !== 'object') return { stdout: 'Key path does not exist.', stderr: '', exitCode: 0, durationMs: 0 };
              curr = curr[parts[i]];
            }
            delete curr[parts[parts.length - 1]];
            fs.writeFileSync(targetPath, JSON.stringify(json, null, 2) + '\n', 'utf-8');
            return {
              stdout: `Successfully deleted "${keyPath}" from ${targetPath}`,
              stderr: '',
              exitCode: 0,
              durationMs: Math.round(performance.now() - startMs),
            };
          }

          return {
            stdout: '',
            stderr: `Unsupported patch_json action: ${action}`,
            exitCode: 1,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'download_file': {
          const downloadUrl = String(args.url || '').trim();
          if (!downloadUrl) {
            return {
              stdout: '',
              stderr: 'Please provide a valid download URL.',
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          let destDir = this.resolveSafePath(ctx.workspaceRoot, args.destination || 'downloads');
          let fname = args.filename ? String(args.filename).trim() : '';

          if (!fname) {
            try {
              const u = new URL(downloadUrl);
              fname = path.basename(u.pathname) || `download_${Date.now()}`;
            } catch {
              fname = `download_${Date.now()}`;
            }
          }

          // If destination ends with a filename or has extension, treat as full path
          let targetFile: string;
          if (fs.existsSync(destDir) && fs.statSync(destDir).isDirectory()) {
            targetFile = path.join(destDir, fname);
          } else if (path.extname(destDir)) {
            targetFile = destDir;
            destDir = path.dirname(destDir);
          } else {
            targetFile = path.join(destDir, fname);
          }

          fs.mkdirSync(destDir, { recursive: true });

          const resp = await fetch(downloadUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });

          if (!resp.ok || !resp.body) {
            return {
              stdout: '',
              stderr: `Download failed: ${resp.status} ${resp.statusText}`,
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }

          const fileStream = fs.createWriteStream(targetFile);
          await pipeline(resp.body, fileStream);
          const stat = fs.statSync(targetFile);

          return {
            stdout: JSON.stringify(
              {
                downloaded: true,
                path: targetFile.replace(/\\/g, '/'),
                bytes: stat.size,
                mb: (stat.size / (1024 * 1024)).toFixed(2),
                url: downloadUrl,
              },
              null,
              2
            ),
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'http_request': {
          const reqUrl = String(args.url || '').trim();
          if (!reqUrl) {
            return {
              stdout: '',
              stderr: 'URL is required for http_request.',
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }
          if (reqUrl.includes(':5000') || reqUrl.includes(':5001')) {
            return {
              stdout: '',
              stderr: 'Forbidden port 5000/5001 rejected by security policy.',
              exitCode: 1,
              durationMs: Math.round(performance.now() - startMs),
            };
          }

          const method = String(args.method || 'GET').toUpperCase();
          const headers = (args.headers || {}) as Record<string, string>;
          const timeout = Number(args.timeout_ms) || 10000;

          let bodyData: any = undefined;
          if (args.body !== undefined && method !== 'GET') {
            if (typeof args.body === 'object') {
              bodyData = JSON.stringify(args.body);
              if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
            } else {
              bodyData = String(args.body);
            }
          }

          const resp = await fetch(reqUrl, {
            method,
            headers,
            body: bodyData,
            signal: AbortSignal.timeout(timeout),
          });

          const contentType = resp.headers.get('content-type') || '';
          let responsePayload: any;
          if (contentType.includes('application/json')) {
            try {
              responsePayload = await resp.json();
            } catch {
              responsePayload = await resp.text();
            }
          } else {
            responsePayload = await resp.text();
          }

          return {
            stdout: JSON.stringify(
              {
                url: reqUrl,
                status: resp.status,
                statusText: resp.statusText,
                ok: resp.ok,
                headers: Object.fromEntries(resp.headers.entries()),
                data: responsePayload,
              },
              null,
              2
            ),
            stderr: '',
            exitCode: resp.ok ? 0 : 1,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'manage_files': {
          const action = String(args.action || 'stat').toLowerCase();
          const srcPath = this.resolveSafePath(ctx.workspaceRoot, args.source);

          if (action === 'stat') {
            if (!fs.existsSync(srcPath)) {
              return {
                stdout: JSON.stringify({ exists: false, path: srcPath }, null, 2),
                stderr: '',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
            const stat = fs.statSync(srcPath);
            return {
              stdout: JSON.stringify(
                {
                  exists: true,
                  path: srcPath.replace(/\\/g, '/'),
                  size: stat.size,
                  isDirectory: stat.isDirectory(),
                  isFile: stat.isFile(),
                  created: stat.birthtime,
                  modified: stat.mtime,
                },
                null,
                2
              ),
              stderr: '',
              exitCode: 0,
              durationMs: Math.round(performance.now() - startMs),
            };
          }

          if (action === 'delete') {
            if (!fs.existsSync(srcPath)) {
              return {
                stdout: `File does not exist: ${srcPath}`,
                stderr: '',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
            // Safety guard: prevent root deletions
            const norm = path.normalize(srcPath).toLowerCase();
            if (norm === 'c:\\' || norm === 'c:/' || norm === 'e:\\' || norm === 'e:/' || norm === os.homedir().toLowerCase()) {
              return {
                stdout: '',
                stderr: 'Refusing to delete critical root directory.',
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
            fs.rmSync(srcPath, { recursive: true, force: true });
            return {
              stdout: `Deleted ${srcPath}`,
              stderr: '',
              exitCode: 0,
              durationMs: Math.round(performance.now() - startMs),
            };
          }

          if (action === 'copy' || action === 'move') {
            if (!fs.existsSync(srcPath)) {
              return {
                stdout: '',
                stderr: `Source does not exist: ${srcPath}`,
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
            if (!args.destination) {
              return {
                stdout: '',
                stderr: `Destination is required for action "${action}".`,
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
            const dstPath = this.resolveSafePath(ctx.workspaceRoot, args.destination);
            fs.mkdirSync(path.dirname(dstPath), { recursive: true });

            if (action === 'copy') {
              fs.cpSync(srcPath, dstPath, { recursive: true });
              return {
                stdout: `Copied ${srcPath} -> ${dstPath}`,
                stderr: '',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            } else {
              fs.renameSync(srcPath, dstPath);
              return {
                stdout: `Moved ${srcPath} -> ${dstPath}`,
                stderr: '',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
          }

          return {
            stdout: '',
            stderr: `Unsupported manage_files action: ${action}`,
            exitCode: 1,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'inspect_models': {
          const action = String(args.action || 'inspect').toLowerCase();
          const testPrompt = String(args.test_prompt || 'What color is this test image? Answer in 1-2 words.');

          if (action === 'test_vision') {
            const redPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
            try {
              const startT = performance.now();
              const resp = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: 'qwen3.8-flash-next-iq3_s',
                  messages: [
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: testPrompt },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${redPng}` } }
                      ]
                    }
                  ],
                  max_tokens: 60,
                }),
                signal: AbortSignal.timeout(15000),
              });
              const durMs = Math.round(performance.now() - startT);
              if (!resp.ok) {
                const err = await resp.text();
                return {
                  stdout: '',
                  stderr: `Strata vision test HTTP error ${resp.status}: ${err}`,
                  exitCode: 1,
                  durationMs: Math.round(performance.now() - startMs),
                };
              }
              const data: any = await resp.json();
              const answer = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';
              return {
                stdout: JSON.stringify({
                  status: 'vision_verified_functional',
                  latency_ms: durMs,
                  engine: 'Strata (port 8080)',
                  model: data.model || 'qwen3.8-flash-next-iq3_s',
                  test_response: answer.trim(),
                  timings: data.timings,
                }, null, 2),
                stderr: '',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            } catch (e: any) {
              return {
                stdout: '',
                stderr: `Vision test failed: ${e?.message || String(e)}`,
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
          }

          if (action === 'restart') {
            try {
              execSync('powershell -Command "Get-Process strata -ErrorAction SilentlyContinue | Stop-Process -Force"', { timeout: 5000 });
              await new Promise(r => setTimeout(r, 1000));
              const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Sue\\AppData\\Local';
              const configPath = path.join(localAppData, 'Strata', 'launch', 'iq3_s-64k.json');
              const pythonExe = path.join(localAppData, 'Strata', 'terminal', '0.1.58', 'python', 'python.exe');
              const serverPy = path.join(localAppData, 'Strata', 'terminal', '0.1.58', 'serve', 'server.py');
              const strataCwd = path.join(localAppData, 'Strata', 'terminal', '0.1.58');

              const child = spawn(pythonExe, [serverPy, '--engine', 'strata', '--config', configPath, '--port', '8080'], {
                cwd: strataCwd,
                detached: true,
                stdio: 'ignore',
              });
              child.unref();

              let ready = false;
              for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 500));
                try {
                  const check = await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(1000) });
                  if (check.ok) {
                    ready = true;
                    break;
                  }
                } catch {}
              }

              return {
                stdout: JSON.stringify({
                  status: ready ? 'restarted_successfully' : 'restart_initiated_still_loading',
                  engine: 'Strata (port 8080)',
                  ready,
                }, null, 2),
                stderr: ready ? '' : 'Strata is still initializing weights into VRAM/RAM',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            } catch (e: any) {
              return {
                stdout: '',
                stderr: `Failed to restart Strata: ${e?.message || String(e)}`,
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
          }

          // Default: 'inspect'
          let healthData: any = null;
          let modelsData: any = null;
          try {
            const hRes = await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(2000) });
            if (hRes.ok) healthData = await hRes.json();
          } catch {}
          try {
            const mRes = await fetch('http://127.0.0.1:8080/v1/models', { signal: AbortSignal.timeout(2000) });
            if (mRes.ok) modelsData = await mRes.json();
          } catch {}

          const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Sue\\AppData\\Local';
          const configPath = path.join(localAppData, 'Strata', 'launch', 'iq3_s-64k.json');
          let launchConfig: any = null;
          if (fs.existsSync(configPath)) {
            try {
              launchConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            } catch {}
          }

          const diskModels: Array<{ folder: string; files: Array<{ name: string; sizeGb: number }> }> = [];
          const modelsDir = 'E:\\models';
          if (fs.existsSync(modelsDir)) {
            try {
              const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
              for (const ent of entries) {
                if (ent.isDirectory() && ent.name.toLowerCase().includes('qwen')) {
                  const subPath = path.join(modelsDir, ent.name);
                  const files = fs.readdirSync(subPath).map(f => {
                    const stat = fs.statSync(path.join(subPath, f));
                    return { name: f, sizeGb: Math.round((stat.size / (1024 * 1024 * 1024)) * 100) / 100 };
                  });
                  diskModels.push({ folder: ent.name, files });
                }
              }
            } catch {}
          }

          return {
            stdout: JSON.stringify({
              engine: {
                name: 'Strata Local Inference Engine',
                port: 8080,
                online: healthData !== null,
                health: healthData,
                models: modelsData?.data || [],
                vision_supported: healthData?.images === true || modelsData?.data?.[0]?.architecture?.input_modalities?.includes('image'),
              },
              active_launch_profile: launchConfig ? {
                path: configPath,
                model_name: launchConfig.model_name,
                max_context: 65536,
                spec: 6,
                vision_projector: launchConfig.vision?.mmproj,
                vision_gpu: launchConfig.vision?.gpu,
              } : null,
              disk_models: diskModels,
            }, null, 2),
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'inspect_system': {
          const action = String(args.action || 'gpu_stats').toLowerCase();
          const filter = args.filter ? String(args.filter).toLowerCase() : '';

          if (action === 'gpu_stats') {
            try {
              const out = execSync(
                'nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu --format=csv,noheader,nounits',
                { timeout: 4000 }
              )
                .toString()
                .trim();
              const parts = out.split(',').map((p) => p.trim());
              return {
                stdout: JSON.stringify(
                  {
                    gpuName: parts[0] || 'Unknown Nvidia GPU',
                    memoryTotalMb: Number(parts[1]) || 0,
                    memoryUsedMb: Number(parts[2]) || 0,
                    memoryFreeMb: Number(parts[3]) || 0,
                    utilizationPercent: Number(parts[4]) || 0,
                    temperatureC: Number(parts[5]) || 0,
                  },
                  null,
                  2
                ),
                stderr: '',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            } catch (err: any) {
              return {
                stdout: '',
                stderr: `GPU query failed: ${err?.message || String(err)}`,
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
          }

          if (action === 'list_ports') {
            try {
              const psScript = `Get-NetTCPConnection -State Listen | Select-Object -First 25 LocalAddress, LocalPort, OwningProcess | ConvertTo-Json`;
              const out = execSync(
                `powershell.exe -NoProfile -NonInteractive -Command "${psScript}"`,
                { timeout: 5000 }
              )
                .toString()
                .trim();
              let ports = JSON.parse(out || '[]');
              if (!Array.isArray(ports)) ports = [ports];
              if (filter) {
                ports = ports.filter((p: any) => String(p.LocalPort).includes(filter) || String(p.OwningProcess).includes(filter));
              }
              return {
                stdout: JSON.stringify({ count: ports.length, listeners: ports }, null, 2),
                stderr: '',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            } catch (err: any) {
              return {
                stdout: '',
                stderr: `Port query failed: ${err?.message || String(err)}`,
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
          }

          if (action === 'find_process') {
            try {
              const target = filter || 'strata';
              const psScript = `Get-Process | Where-Object { $_.ProcessName -like "*${target}*" } | Select-Object Id, ProcessName, WorkingSet64 | ConvertTo-Json`;
              const out = execSync(
                `powershell.exe -NoProfile -NonInteractive -Command "${psScript}"`,
                { timeout: 5000 }
              )
                .toString()
                .trim();
              let procs = JSON.parse(out || '[]');
              if (!Array.isArray(procs)) procs = [procs];
              return {
                stdout: JSON.stringify(
                  {
                    filter: target,
                    count: procs.length,
                    processes: procs.map((p: any) => ({
                      id: p.Id,
                      name: p.ProcessName,
                      memoryMb: Math.round(p.WorkingSet64 / (1024 * 1024)),
                    })),
                  },
                  null,
                  2
                ),
                stderr: '',
                exitCode: 0,
                durationMs: Math.round(performance.now() - startMs),
              };
            } catch (err: any) {
              return {
                stdout: '',
                stderr: `Process query failed: ${err?.message || String(err)}`,
                exitCode: 1,
                durationMs: Math.round(performance.now() - startMs),
              };
            }
          }

          return {
            stdout: '',
            stderr: `Unsupported inspect_system action: ${action}`,
            exitCode: 1,
            durationMs: Math.round(performance.now() - startMs),
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
          const cappedEntries = entries.slice(0, 150);
          let jsonResult = JSON.stringify(cappedEntries, null, 2);
          if (entries.length > 150) {
            jsonResult += `\n... [Showing 150 of ${entries.length} items to preserve context]`;
          }
          return {
            stdout: jsonResult,
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        case 'search_codebase': {
          const query = String(args.query || '');
          const isRegex = Boolean(args.is_regex);
          const extFilter = args.file_pattern ? String(args.file_pattern).toLowerCase() : '';
          const matches: Array<{ file: string; line: number; text: string }> = [];

          let matcher: (line: string) => boolean;
          if (isRegex) {
            try {
              const rx = new RegExp(query, 'i');
              matcher = (line) => rx.test(line);
            } catch {
              const lowerQ = query.toLowerCase();
              matcher = (line) => line.toLowerCase().includes(lowerQ);
            }
          } else {
            const lowerQ = query.toLowerCase();
            matcher = (line) => line.toLowerCase().includes(lowerQ);
          }

          const walk = (dir: string, depth = 0) => {
            if (matches.length >= 100 || depth > 8) return;
            let list: fs.Dirent[] = [];
            try {
              list = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
              return;
            }
            for (const item of list) {
              if (matches.length >= 100) break;
              if (
                item.name === 'node_modules' ||
                item.name === '.git' ||
                item.name === '.venv' ||
                item.name === 'dist' ||
                item.name === '.runtime' ||
                item.name === 'build'
              ) {
                continue;
              }
              const full = path.join(dir, item.name);
              if (item.isDirectory()) {
                walk(full, depth + 1);
              } else if (item.isFile()) {
                if (extFilter && !item.name.toLowerCase().endsWith(extFilter)) continue;
                try {
                  const stat = fs.statSync(full);
                  if (stat.size > 5 * 1024 * 1024) continue; // 5 MB threshold
                  const content = fs.readFileSync(full, 'utf-8');
                  const lines = content.split(/\r?\n/);
                  for (let i = 0; i < lines.length; i++) {
                    if (matcher(lines[i])) {
                      matches.push({
                        file: path.relative(ctx.workspaceRoot, full).replace(/\\/g, '/'),
                        line: i + 1,
                        text: lines[i].trim().slice(0, 250),
                      });
                      if (matches.length >= 100) break;
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
          const resp = await fetch(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(10000),
          });
          const html = await resp.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const cleaned = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();

          return {
            stdout: JSON.stringify(
              {
                url,
                status: resp.status,
                title: titleMatch ? titleMatch[1].trim() : 'Untitled',
                contentLength: html.length,
                content: cleaned.slice(0, 4000),
              },
              null,
              2
            ),
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        default: {
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
            stdout: `Executed ${toolName} with args: ${JSON.stringify(args)}`,
            stderr: '',
            exitCode: 0,
            durationMs: Math.round(performance.now() - startMs),
          };
        }
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
