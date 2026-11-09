import fs from 'node:fs';
import path from 'node:path';
import type { BuiltinToolHandler } from './types.js';
import { SubagentManager } from '../subagentManager.js';

export const name = 'invoke_subagent';

export const execute: BuiltinToolHandler = async (args, ctx) => {
  const startMs = Date.now();
  const manager = SubagentManager.getInstance();
  const role = String(args.role || 'Codebase Researcher').trim();
  const prompt = String(args.prompt || '').trim();
  const targetDir = String(args.directory || ctx.workspaceRoot).trim();

  if (!prompt) {
    return {
      stdout: '',
      stderr: 'invoke_subagent requires a non-empty "prompt" describing the subagent task.',
      exitCode: 1,
      durationMs: Date.now() - startMs,
    };
  }

  const task = manager.createSubagentTask({
    threadId: ctx.threadId,
    role,
    prompt,
    maxSteps: 3,
  });

  try {
    // Step 1: Extract search keywords from the prompt and scan workspace files
    manager.updateSubagentStep(task.id, 1, `[${role}] Scanning workspace files...`);
    const keywords = prompt
      .replace(/[^\w\s./-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !['that', 'this', 'with', 'from', 'into', 'what', 'where', 'find', 'check'].includes(w.toLowerCase()))
      .slice(0, 6);

    const matchedFiles: string[] = [];
    const snippets: string[] = [];

    const walk = (dir: string, depth = 0) => {
      if (depth > 4 || matchedFiles.length >= 25) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'target'
        ) {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (/\.(ts|tsx|js|mjs|json|md|cs)$/i.test(entry.name)) {
          const rel = path.relative(ctx.workspaceRoot, full).replace(/\\/g, '/');
          const lowerName = rel.toLowerCase();
          if (keywords.some((k) => lowerName.includes(k.toLowerCase()))) {
            matchedFiles.push(rel);
          }
          if (snippets.length < 8) {
            try {
              const stat = fs.statSync(full);
              if (stat.size < 200000) {
                const text = fs.readFileSync(full, 'utf8');
                for (const kw of keywords) {
                  const idx = text.toLowerCase().indexOf(kw.toLowerCase());
                  if (idx !== -1) {
                    const lineNum = text.slice(0, idx).split(/\r?\n/).length;
                    const lines = text.split(/\r?\n/);
                    const excerpt = lines
                      .slice(Math.max(0, lineNum - 2), Math.min(lines.length, lineNum + 4))
                      .join('\n');
                    snippets.push(`### ${rel} (line ${lineNum}, matched "${kw}")\n\`\`\`\n${excerpt}\n\`\`\``);
                    if (!matchedFiles.includes(rel)) matchedFiles.push(rel);
                    break;
                  }
                }
              }
            } catch {}
          }
        }
      }
    };

    walk(path.isAbsolute(targetDir) ? targetDir : path.join(ctx.workspaceRoot, targetDir));

    manager.updateSubagentStep(task.id, 2, `[${role}] Synthesizing distilled findings...`);

    const reportLines: string[] = [
      `=== SUBAGENT REPORT (${role}) ===`,
      `Task: ${prompt}`,
      `Keywords Investigated: ${keywords.join(', ') || 'workspace scan'}`,
      `Matched Files (${matchedFiles.length}):`,
      ...(matchedFiles.length > 0 ? matchedFiles.map((f) => `  - ${f}`) : ['  - (No direct filename matches)']),
    ];

    if (snippets.length > 0) {
      reportLines.push(`\nKey Code Excerpts:\n${snippets.join('\n\n')}`);
    }

    const report = reportLines.join('\n');
    manager.completeSubagentTask(task.id, report, 'completed');

    return {
      stdout: report,
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - startMs,
    };
  } catch (err: any) {
    manager.completeSubagentTask(task.id, err?.message || 'Subagent error', 'failed');
    return {
      stdout: '',
      stderr: `Subagent failed: ${err?.message || String(err)}`,
      exitCode: 1,
      durationMs: Date.now() - startMs,
    };
  }
};
