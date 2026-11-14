import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface FileDiagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface SymbolOutlineItem {
  name: string;
  kind: string;
  line: number;
}

function loadTypeScriptCompiler(): any | null {
  try {
    return require('typescript');
  } catch {
    return null;
  }
}

export class LspDiagnosticsManager {
  private tsCompiler: any | null;

  constructor() {
    this.tsCompiler = loadTypeScriptCompiler();
  }

  public extractSymbols(filePath: string): SymbolOutlineItem[] {
    if (!fs.existsSync(filePath)) return [];
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }

    const ext = path.extname(filePath).toLowerCase();
    const lines = content.split(/\r?\n/);
    const out: SymbolOutlineItem[] = [];

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const lineNum = idx + 1;

      if (ext === '.py') {
        const m = line.match(/^\s*(?:async\s+)?(def|class)\s+([A-Za-z0-9_]+)/);
        if (m) out.push({ kind: m[1], name: m[2], line: lineNum });
        continue;
      }

      if (ext === '.rs') {
        const m = line.match(/^\s*(?:pub\s+)?(?:async\s+)?(fn|struct|enum|trait|type)\s+([A-Za-z0-9_]+)/);
        if (m) out.push({ kind: m[1], name: m[2], line: lineNum });
        continue;
      }

      const tsMatch = line.match(
        /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/
      );
      if (tsMatch) {
        out.push({ kind: tsMatch[1], name: tsMatch[2], line: lineNum });
        continue;
      }

      const constFnMatch = line.match(/^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/);
      if (constFnMatch) {
        out.push({ kind: 'function', name: constFnMatch[1], line: lineNum });
      }
    }

    return out;
  }

  public checkFileDiagnostics(filePath: string): FileDiagnostic[] {
    if (!filePath || !fs.existsSync(filePath)) return [];
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }

    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.json') {
      try {
        JSON.parse(content);
        return [];
      } catch (err: any) {
        const msg = String(err?.message || 'Invalid JSON');
        const posMatch = msg.match(/position\s+(\d+)/i);
        let line = 1;
        let column = 1;
        if (posMatch) {
          const pos = Number(posMatch[1]);
          const prefix = content.slice(0, pos);
          const parts = prefix.split('\n');
          line = parts.length;
          column = parts[parts.length - 1].length + 1;
        }
        return [{ line, column, severity: 'error', message: msg }];
      }
    }

    if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
      const ts = this.tsCompiler;
      if (ts && typeof ts.transpileModule === 'function' && ts.ScriptTarget) {
        const result = ts.transpileModule(content, {
          fileName: filePath,
          reportDiagnostics: true,
          compilerOptions: {
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            jsx: ext === '.tsx' || ext === '.jsx' ? ts.JsxEmit.ReactJSX : ts.JsxEmit.None,
            allowJs: true,
          },
        });

        const diagnostics: any[] = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
        return diagnostics.slice(0, 12).map((d) => {
          const start = typeof d.start === 'number' && d.file ? d.file.getLineAndCharacterOfPosition(d.start) : null;
          return {
            line: start ? start.line + 1 : 1,
            column: start ? start.character + 1 : 1,
            severity: d.category === ts.DiagnosticCategory?.Warning ? 'warning' : 'error',
            message: ts.flattenDiagnosticMessageText ? ts.flattenDiagnosticMessageText(d.messageText, ' ') : String(d.messageText),
          };
        });
      }

      return this.validateJsTsSyntax(content);
    }

    return [];
  }

  private validateJsTsSyntax(content: string): FileDiagnostic[] {
    const diags: FileDiagnostic[] = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const noLineComment = rawLine.replace(/\/\/.*$/, '');
      const assignSemiMatch = noLineComment.match(/=\s*;/);
      if (assignSemiMatch && assignSemiMatch.index !== undefined) {
        diags.push({
          line: i + 1,
          column: assignSemiMatch.index + 1,
          severity: 'error',
          message: 'Expression expected before semicolon',
        });
      }
      const importEmptyMatch = noLineComment.match(/\bfrom\s*;/);
      if (importEmptyMatch && importEmptyMatch.index !== undefined) {
        diags.push({
          line: i + 1,
          column: importEmptyMatch.index + 1,
          severity: 'error',
          message: 'Module specifier expected before semicolon',
        });
      }
    }

    // Balance check for (), {}, [] skipping strings & comments
    const stack: Array<{ ch: string; line: number; col: number }> = [];
    const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
    const closingToOpen: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
    let line = 1;
    let col = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let idx = 0; idx < content.length; idx++) {
      const ch = content[idx];
      const next = content[idx + 1];
      if (ch === '\n') {
        line++;
        col = 0;
        inLineComment = false;
        continue;
      }
      col++;

      if (inLineComment) continue;
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          idx++;
          col++;
        }
        continue;
      }
      if (inSingle) {
        if (ch === '\\') { idx++; col++; continue; }
        if (ch === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (ch === '\\') { idx++; col++; continue; }
        if (ch === '"') inDouble = false;
        continue;
      }
      if (inTemplate) {
        if (ch === '\\') { idx++; col++; continue; }
        if (ch === '`') inTemplate = false;
        continue;
      }

      if (ch === '/' && next === '/') { inLineComment = true; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; idx++; col++; continue; }
      if (ch === "'") { inSingle = true; continue; }
      if (ch === '"') { inDouble = true; continue; }
      if (ch === '`') { inTemplate = true; continue; }

      if (pairs[ch]) {
        stack.push({ ch, line, col });
      } else if (closingToOpen[ch]) {
        const expected = closingToOpen[ch];
        const top = stack[stack.length - 1];
        if (!top || top.ch !== expected) {
          diags.push({ line, column: col, severity: 'error', message: `Unexpected closing '${ch}'` });
        } else {
          stack.pop();
        }
      }
    }

    for (const unclosed of stack.slice(-3)) {
      diags.push({ line: unclosed.line, column: unclosed.col, severity: 'error', message: `Unclosed '${unclosed.ch}'` });
    }

    return diags.slice(0, 12);
  }

  public formatPostEditDiagnosticNote(filePath: string): string {
    const diags = this.checkFileDiagnostics(filePath);
    if (diags.length === 0) return '';
    const lines = diags.map((d) => `- Line ${d.line}:${d.column} [${d.severity}] ${d.message}`);
    return `\n\n[LSP Auto-Check: ${diags.length} syntax/parse issue(s) detected in ${path.basename(filePath)}]\n${lines.join('\n')}`;
  }

  public getWorkspaceDiagnostics(workspaceRoot: string, maxFiles = 60): Array<{ file: string; diagnostics: FileDiagnostic[] }> {
    const issues: Array<{ file: string; diagnostics: FileDiagnostic[] }> = [];
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return issues;

    const skip = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.runtime']);
    let scanned = 0;

    const walk = (dir: string, depth: number) => {
      if (depth > 4 || scanned >= maxFiles || issues.length >= 15) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (scanned >= maxFiles || issues.length >= 15) break;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skip.has(entry.name) && !entry.name.startsWith('.')) {
            walk(full, depth + 1);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.ts', '.tsx', '.js', '.jsx', '.json'].includes(ext)) {
            scanned++;
            const diags = this.checkFileDiagnostics(full);
            if (diags.length > 0) {
              issues.push({
                file: path.relative(workspaceRoot, full).replace(/\\/g, '/'),
                diagnostics: diags,
              });
            }
          }
        }
      }
    };

    walk(workspaceRoot, 0);
    return issues;
  }
}
