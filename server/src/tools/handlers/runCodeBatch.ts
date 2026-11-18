import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import type { BuiltinToolHandler } from './types.js';

export const name = 'run_code_batch';

function truncateBatchOutput(output: string, maxChars = 16000): string {
  if (!output || output.length <= maxChars) return output;
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  const omitted = output.length - (headChars + tailChars);
  return `${output.slice(0, headChars)}\n\n... [Output truncated: ${omitted.toLocaleString()} characters omitted to preserve context window] ...\n\n${output.slice(-tailChars)}`;
}

export const execute: BuiltinToolHandler = async (args, ctx, execCtx) => {
  const startMs = performance.now();
  const code = typeof args.code === 'string' ? args.code : '';
  if (!code.trim()) {
    return {
      stdout: '',
      stderr: 'run_code_batch requires a non-empty "code" string.',
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  const resolvedCwd = args.cwd
    ? execCtx.resolveSafePath(ctx.workspaceRoot, String(args.cwd))
    : ctx.workspaceRoot;
  const rawTimeout = Number(args.timeout_ms ?? 30000);
  const timeoutMs = Math.max(1000, Math.min(120000, Number.isFinite(rawTimeout) ? rawTimeout : 30000));

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = os.tmpdir();
  const runnerPath = path.join(tmpDir, `localgravity-batch-${id}.mjs`);
  const checkpointsPath = path.join(tmpDir, `localgravity-batch-${id}-checkpoints.json`);

  const prelude = `
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const __workspaceRoot = ${JSON.stringify(resolvedCwd)};
const __checkpointsPath = ${JSON.stringify(checkpointsPath)};
const __checkpoints = [];

const __resolve = (p) => {
  if (!p || p === '.') return __workspaceRoot;
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(__workspaceRoot, p);
};

const __ignoreDirs = new Set(['node_modules', '.git', 'dist', 'target', '.runtime']);

globalThis.lg = {
  workspaceRoot: __workspaceRoot.replace(/\\\\/g, '/'),
  resolve: (p) => __resolve(p),
  readFile: (p, startLine, endLine) => {
    const abs = __resolve(p);
    const content = fs.readFileSync(abs, 'utf-8');
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split(/\\r?\\n/);
      const s = Math.max(1, Number(startLine || 1));
      const e = Math.min(lines.length, Number(endLine || lines.length));
      return lines.slice(s - 1, e).join('\\n');
    }
    return content;
  },
  writeFile: (p, content) => {
    const abs = __resolve(p);
    const prev = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const nextContent = String(content);
    fs.writeFileSync(abs, nextContent, 'utf-8');
    __checkpoints.push({
      file_path: abs.replace(/\\\\/g, '/'),
      previous_content_blob: prev,
      new_content_blob: nextContent,
    });
    return { path: abs.replace(/\\\\/g, '/'), bytes: Buffer.byteLength(nextContent, 'utf-8') };
  },
  editFile: (p, target, replacement) => {
    const abs = __resolve(p);
    const prev = fs.readFileSync(abs, 'utf-8');
    const tgt = String(target);
    const rep = String(replacement);
    if (!prev.includes(tgt)) {
      throw new Error(\`lg.editFile: target string not found in \${abs}\`);
    }
    const nextContent = prev.replace(tgt, () => rep);
    fs.writeFileSync(abs, nextContent, 'utf-8');
    __checkpoints.push({
      file_path: abs.replace(/\\\\/g, '/'),
      previous_content_blob: prev,
      new_content_blob: nextContent,
    });
    return { path: abs.replace(/\\\\/g, '/'), updated: true };
  },
  listFiles: (dir = '.', maxResults = 100) => {
    const startDir = __resolve(dir);
    const out = [];
    const walk = (d) => {
      if (out.length >= maxResults) return;
      let entries = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (out.length >= maxResults) break;
        if (__ignoreDirs.has(entry.name)) continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          out.push(path.relative(startDir, full).replace(/\\\\/g, '/'));
        }
      }
    };
    walk(startDir);
    return out;
  },
  search: (query, dir = '.') => {
    const files = globalThis.lg.listFiles(dir, 500);
    const startDir = __resolve(dir);
    const results = [];
    const isRegex = query instanceof RegExp;
    const needle = isRegex ? query : String(query);
    for (const rel of files) {
      const full = path.join(startDir, rel);
      let raw = '';
      try {
        const stat = fs.statSync(full);
        if (stat.size > 1024 * 1024) continue;
        raw = fs.readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      const lines = raw.split(/\\r?\\n/);
      for (let i = 0; i < lines.length; i++) {
        const matched = isRegex ? needle.test(lines[i]) : lines[i].includes(needle);
        if (matched) {
          results.push({ file: rel, line: i + 1, text: lines[i].slice(0, 240) });
          if (results.length >= 200) return results;
        }
      }
    }
    return results;
  },
  sh: (cmd) => {
    return execSync(String(cmd), {
      cwd: __workspaceRoot,
      encoding: 'utf-8',
      windowsHide: true,
    });
  },
};

try {
  await (async () => {
${code}
  })();
} finally {
  try {
    fs.writeFileSync(__checkpointsPath, JSON.stringify(__checkpoints), 'utf-8');
  } catch {}
}
`;

  try {
    fs.writeFileSync(runnerPath, prelude, 'utf-8');

    const execResult = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      exec(
        `node "${runnerPath}"`,
        {
          cwd: resolvedCwd,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (stdout && ctx.onStdoutChunk) ctx.onStdoutChunk(stdout);
          if (stderr && ctx.onStderrChunk) ctx.onStderrChunk(stderr);
          if (error) {
            resolve({
              stdout: stdout || '',
              stderr: stderr || error.message,
              exitCode: typeof error.code === 'number' ? error.code : 1,
            });
          } else {
            resolve({
              stdout: stdout || '',
              stderr: stderr || '',
              exitCode: 0,
            });
          }
        }
      );
    });

    if (fs.existsSync(checkpointsPath)) {
      try {
        const rawCps = JSON.parse(fs.readFileSync(checkpointsPath, 'utf-8'));
        if (Array.isArray(rawCps)) {
          for (const entry of rawCps) {
            if (!entry?.file_path || typeof entry.new_content_blob !== 'string') continue;
            const cp = execCtx.db.createFileCheckpoint({
              thread_id: ctx.threadId,
              message_id: ctx.messageId,
              file_path: entry.file_path,
              previous_content_blob:
                typeof entry.previous_content_blob === 'string' ? entry.previous_content_blob : null,
              new_content_blob: entry.new_content_blob,
            });
            ctx.onFileCheckpointCreated?.(cp);
          }
        }
      } catch (cpErr) {
        console.warn('[run_code_batch] Failed to record batch checkpoints:', cpErr);
      }
    }

    return {
      stdout: truncateBatchOutput(execResult.stdout),
      stderr: truncateBatchOutput(execResult.stderr),
      exitCode: execResult.exitCode,
      durationMs: Math.round(performance.now() - startMs),
    };
  } finally {
    try {
      if (fs.existsSync(runnerPath)) fs.unlinkSync(runnerPath);
    } catch {}
    try {
      if (fs.existsSync(checkpointsPath)) fs.unlinkSync(checkpointsPath);
    } catch {}
  }
};
