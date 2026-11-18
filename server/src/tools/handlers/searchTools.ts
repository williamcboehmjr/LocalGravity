import fs from 'node:fs';
import path from 'node:path';
import { LspDiagnosticsManager } from '../lspManager.js';
import { buildCompactRepoMap } from '../repoMap.js';
import type { BuiltinToolHandler } from './types.js';

const getLsp = (exec: { lsp?: LspDiagnosticsManager }) => exec.lsp || new LspDiagnosticsManager();

const handleFindFiles: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
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
  const targetDir = args.path ? exec.resolveSafePath(ctx.workspaceRoot, String(args.path)) : ctx.workspaceRoot;

  const matches: Array<{ name: string; fullPath: string; size: number; isDirectory: boolean }> = [];
  const isExactPattern = pattern.includes('*') || pattern.includes('?') || pattern.includes('.');
  const globRegex = isExactPattern
    ? '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    : pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const rxPattern = new RegExp(globRegex, 'i');

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
      { pattern, searchPath: targetDir.replace(/\\/g, '/'), count: matches.length, matches },
      null,
      2
    ),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};

const handleSearchCodebase: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const query = String(args.query || '');
  const isRegex = Boolean(args.is_regex);
  let extFilter = args.file_pattern ? String(args.file_pattern).toLowerCase().trim() : '';
  if (extFilter.startsWith('*')) extFilter = extFilter.replace(/^\*+/, '');
  if (extFilter && !extFilter.startsWith('.')) extFilter = '.' + extFilter;
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
          if (stat.size > 5 * 1024 * 1024) continue;
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

  const searchTarget = args.path ? exec.resolveSafePath(ctx.workspaceRoot, String(args.path)) : ctx.workspaceRoot;
  walk(searchTarget);
  return {
    stdout: JSON.stringify({ query, count: matches.length, matches }, null, 2),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};

const handleCodeOutline: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const targetPath = exec.resolveSafePath(ctx.workspaceRoot, args.path);
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

    let m = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z0-9_]+)/);
    if (m) {
      outline.push({ line: i + 1, kind: 'interface', name: m[1], signature: trimmed });
      continue;
    }
    m = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z0-9_]+)\s*=/);
    if (m) {
      outline.push({ line: i + 1, kind: 'type', name: m[1], signature: trimmed.slice(0, 60) });
      continue;
    }
    m = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/);
    if (m) {
      outline.push({ line: i + 1, kind: 'class', name: m[1], signature: trimmed.split('{')[0].trim() });
      continue;
    }
    m = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
    if (m) {
      outline.push({ line: i + 1, kind: 'function', name: m[1], signature: trimmed.split('{')[0].trim() });
      continue;
    }
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
    m = trimmed.match(/^(?:public|private|protected|static)\s+(?:async\s+)?([A-Za-z0-9_]+)\s*\(/);
    if (m) {
      outline.push({ line: i + 1, kind: 'method', name: m[1], signature: trimmed.split('{')[0].trim() });
      continue;
    }
    m = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z0-9_]+)(?:\s*:[^=]+)?\s*=/);
    if (m) {
      outline.push({ line: i + 1, kind: 'const', name: m[1], signature: trimmed.split('=>')[0].trim().slice(0, 75) });
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
};

const handleLspDiagnostics: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const lsp = getLsp(exec);
  const action = String(args.action || 'diagnostics').toLowerCase();
  if (action === 'repo_map') {
    return {
      stdout: buildCompactRepoMap(ctx.workspaceRoot),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  if (action === 'symbols') {
    const targetPath = exec.resolveSafePath(ctx.workspaceRoot, String(args.path || ''));
    if (!fs.existsSync(targetPath)) {
      return {
        stdout: '',
        stderr: `File not found: ${targetPath}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const symbols = lsp.extractSymbols(targetPath);
    return {
      stdout: JSON.stringify({ file: targetPath, symbols }, null, 2),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  if (args.path) {
    const targetPath = exec.resolveSafePath(ctx.workspaceRoot, String(args.path));
    const diagnostics = lsp.checkFileDiagnostics(targetPath);
    return {
      stdout: JSON.stringify({ file: targetPath, count: diagnostics.length, diagnostics }, null, 2),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  const wsIssues = lsp.getWorkspaceDiagnostics(ctx.workspaceRoot);
  return {
    stdout: JSON.stringify({ filesWithIssues: wsIssues.length, issues: wsIssues }, null, 2),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};

export const SEARCH_TOOL_HANDLERS: Record<string, BuiltinToolHandler> = {
  find_files: handleFindFiles,
  search_codebase: handleSearchCodebase,
  code_outline: handleCodeOutline,
  lsp_diagnostics: handleLspDiagnostics,
};
