import fs from 'node:fs';
import path from 'node:path';
import type { BuiltinToolHandler } from './types.js';
import { SubagentManager } from '../subagentManager.js';
import { BUILTIN_TOOLS_SCHEMA } from '../builtinToolsSchema.js';
import { SwarmTurnScheduler } from '../../swarm/swarmScheduler.js';

export const name = 'invoke_subagent';

function fallbackKeywordScan(prompt: string, role: string, workspaceRoot: string, targetDir: string): string {
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
        const rel = path.relative(workspaceRoot, full).replace(/\\/g, '/');
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

  walk(path.isAbsolute(targetDir) ? targetDir : path.join(workspaceRoot, targetDir));

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
  return reportLines.join('\n');
}

export const execute: BuiltinToolHandler = async (args, ctx, exec) => {
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

  const maxSteps = 5;
  const task = manager.createSubagentTask({
    threadId: ctx.threadId,
    role,
    prompt,
    maxSteps,
  });

  try {
    const engine = manager.getLlmEngine();
    let report = '';

    if (engine) {
      try {
        const isLive = await engine.checkConnection('high');
        if (isLive) {
          const researchTools = manager.filterToolsForSubagent(BUILTIN_TOOLS_SCHEMA, 'research');
          const scopedRoot = path.isAbsolute(targetDir) ? targetDir : path.join(ctx.workspaceRoot, targetDir);
          const messages: Array<{ role: string; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [
            {
              role: 'system',
              content:
                `You are an isolated LocalGravity Subagent (${role}).\n` +
                `Workspace Scope: ${scopedRoot}\n` +
                `Use the read-only investigation tools to answer the delegated task concisely with exact file paths, symbol names, and line numbers.`,
            },
            { role: 'user', content: prompt },
          ];
          const syncMessages = () => {
            manager.setSubagentMessages(
              task.id,
              messages.map((m) => ({
                role: m.role as 'system' | 'user' | 'assistant' | 'tool',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                name: m.name,
                tool_calls: m.tool_calls,
                timestamp: Date.now(),
              }))
            );
          };
          syncMessages();

          report = await SwarmTurnScheduler.getInstance().acquireGpuTurn(2, `subagent:${role}`, async () => {
            let finalText = '';
            for (let step = 1; step <= maxSteps; step++) {
              if (ctx.abortSignal?.aborted) break;
              manager.updateSubagentStep(task.id, step, `[${role}] Step ${step}/${maxSteps}: Investigating...`);
              const executed: Array<{ id: string; name: string; args: any; output: string }> = [];
              const isFinal = step === maxSteps;
              const res = await engine.streamChatCompletion({
                tier: 'high',
                thinkingBudget: 'fast',
                stepIndex: step,
                messages,
                tools: isFinal ? undefined : researchTools,
                abortSignal: ctx.abortSignal,
                skipGpuLock: true,
                onThoughtDelta: () => {},
                onTokenDelta: () => {},
                onToolCallRequest: isFinal
                  ? undefined
                  : async (toolName, toolArgs) => {
                      const toolRes = await exec.executeTool(toolName, toolArgs, {
                        threadId: ctx.threadId,
                        messageId: `${ctx.messageId}:${task.id}:${step}`,
                        workspaceRoot: scopedRoot,
                        projectHost: ctx.projectHost,
                        abortSignal: ctx.abortSignal,
                      });
                      executed.push({
                        id: `sub-${step}-${executed.length + 1}`,
                        name: toolName,
                        args: toolArgs,
                        output: toolRes.stdout || toolRes.stderr || 'ok',
                      });
                    },
              });

              finalText = (res.content || '').trim();
              if (executed.length === 0) {
                if (finalText) {
                  messages.push({ role: 'assistant', content: finalText });
                  syncMessages();
                }
                break;
              }

              messages.push({
                role: 'assistant',
                content: res.content || '',
                tool_calls: executed.map((e) => ({
                  id: e.id,
                  type: 'function',
                  function: { name: e.name, arguments: JSON.stringify(e.args) },
                })),
              });
              for (const e of executed) {
                messages.push({
                  role: 'tool',
                  tool_call_id: e.id,
                  name: e.name,
                  content: e.output,
                });
              }
              syncMessages();
            }
            return finalText;
          });
        }
      } catch (llmErr) {
        console.warn('[invoke_subagent] Live LLM loop failed, falling back to static scan:', llmErr);
      }
    }

    if (!report) {
      manager.updateSubagentStep(task.id, 1, `[${role}] Scanning workspace files...`);
      report = fallbackKeywordScan(prompt, role, ctx.workspaceRoot, targetDir);
      manager.updateSubagentStep(task.id, 2, `[${role}] Synthesizing distilled findings...`);
      manager.setSubagentMessages(task.id, [
        { role: 'user', content: prompt, timestamp: startMs },
        { role: 'assistant', content: report, timestamp: Date.now() },
      ]);
    }

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
