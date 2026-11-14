import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  '.runtime',
  '.localgravity',
  '.next',
  'coverage',
]);

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.rs', '.go']);

interface RepoFileEntry {
  relPath: string;
  symbols: string[];
  importCount: number;
}

function collectSourceFiles(rootDir: string, currentDir: string, depth: number, out: string[]): void {
  if (depth > 5 || out.length >= 120) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= 120) break;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') {
      if (SKIP_DIRS.has(entry.name) || entry.isDirectory()) continue;
    }
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectSourceFiles(rootDir, fullPath, depth + 1, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SOURCE_EXTS.has(ext)) {
        out.push(fullPath);
      }
    }
  }
}

function extractTopLevelSymbols(content: string, ext: string): string[] {
  const symbols: string[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);

  const pushSym = (name?: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    symbols.push(name);
  };

  for (const line of lines) {
    if (ext === '.py') {
      const m = line.match(/^(?:async\s+)?(?:def|class)\s+([A-Za-z0-9_]+)/);
      if (m) pushSym(m[1]);
    } else if (ext === '.rs') {
      const m = line.match(/^\s*pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type)\s+([A-Za-z0-9_]+)/);
      if (m) pushSym(m[1]);
    } else if (ext === '.go') {
      const m = line.match(/^(?:func|type)\s+(?:\([^)]+\)\s*)?([A-Z][A-Za-z0-9_]*)/);
      if (m) pushSym(m[1]);
    } else {
      const m = line.match(
        /^\s*export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|type|const|enum)\s+([A-Za-z0-9_]+)/
      );
      if (m) pushSym(m[1]);
    }
    if (symbols.length >= 16) break;
  }

  return symbols;
}

/**
 * Generates a compact Aider-style repository map of exported symbols ranked by cross-file references.
 */
export function buildCompactRepoMap(workspaceRoot: string, maxChars = 4800): string {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    return '(Workspace root unavailable for repo map)';
  }

  const fullPaths: string[] = [];
  collectSourceFiles(workspaceRoot, workspaceRoot, 0, fullPaths);
  if (fullPaths.length === 0) {
    return '(No source files discovered in workspace)';
  }

  const importRefCounts = new Map<string, number>();
  const fileContents = new Map<string, string>();

  for (const fp of fullPaths) {
    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      fileContents.set(fp, raw);
      const importMatches = raw.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g);
      for (const m of importMatches) {
        const spec = m[1];
        if (!spec.startsWith('.')) continue;
        const base = path.basename(spec).replace(/\.[a-z]+$/i, '');
        importRefCounts.set(base, (importRefCounts.get(base) || 0) + 1);
      }
    } catch {}
  }

  const entries: RepoFileEntry[] = fullPaths.map((fp) => {
    const relPath = path.relative(workspaceRoot, fp).replace(/\\/g, '/');
    const ext = path.extname(fp).toLowerCase();
    const content = fileContents.get(fp) || '';
    const symbols = extractTopLevelSymbols(content, ext);
    const baseName = path.basename(fp, ext);
    const importCount = importRefCounts.get(baseName) || 0;
    return { relPath, symbols, importCount };
  });

  entries.sort((a, b) => {
    if (b.importCount !== a.importCount) return b.importCount - a.importCount;
    if (b.symbols.length !== a.symbols.length) return b.symbols.length - a.symbols.length;
    return a.relPath.localeCompare(b.relPath);
  });

  const lines: string[] = [`Repo Map (${entries.length} source files):`];
  let totalChars = lines[0].length;

  for (const e of entries) {
    const symText = e.symbols.length > 0 ? `: ${e.symbols.join(', ')}` : '';
    const line = `${e.relPath}${symText}`;
    if (totalChars + line.length + 1 > maxChars) {
      lines.push('... [repo map truncated to fit token budget]');
      break;
    }
    lines.push(line);
    totalChars += line.length + 1;
  }

  return lines.join('\n');
}
