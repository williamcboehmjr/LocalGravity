import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalGravityDB } from '../db/database.js';
import { SharedTerminalManager } from '../terminal/terminalManager.js';
import { BuiltinToolExecutor } from '../tools/builtinTools.js';
import { BUILTIN_TOOLS_SCHEMA, SWARM_TOOLS_SCHEMA } from '../tools/builtinToolsSchema.js';
import {
  DEFAULT_CORE_TOOL_NAMES,
  PI_CORE_TOOL_NAMES,
  selectScopedTools,
} from '../tools/toolScoper.js';
import { SKILL_TOOLS_SCHEMA } from '../skills/skillManager.js';
import { parseAntigravitySlashCommand } from '../agent/slashCommands.js';
import { detectPrematureStop, READ_ONLY_INSPECTION_TOOLS } from '../agent/prematureStop.js';
import { computeAdaptiveThinkingConfig } from '../agent/adaptiveCot.js';
import { autoCompactMessages, measureMessageLength } from '../utils/autoCompactor.js';
import type { PrunableMessage } from '../utils/messagePruning.js';
import { createPromptTurnHandler, formatToolExecutionOutput } from '../agent/promptTurn.js';
import * as invokeSubagentHandler from '../tools/handlers/invokeSubagent.js';

async function runAgentTurnReliabilityTests() {
  console.log('🧪 Running Wave 2 Agent, Compaction, Tools & Slash Commands Reliability Tests...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-agent-rel-'));
  const db = new LocalGravityDB(path.join(tmpDir, 'test.sqlite'));
  const terminal = new SharedTerminalManager(tmpDir);
  const executor = new BuiltinToolExecutor(db, terminal, undefined, undefined, undefined, tmpDir);

  try {
    // 1. Unknown tool returns exitCode: 1 with informative stderr
    const unknownRes = await executor.executeTool(
      'non_existent_hallucinated_tool',
      { foo: 'bar' },
      { threadId: 't1', messageId: 'm1', workspaceRoot: tmpDir }
    );
    assert.equal(unknownRes.exitCode, 1);
    assert.equal(unknownRes.stdout, '');
    assert.equal(
      unknownRes.stderr,
      'Unknown tool "non_existent_hallucinated_tool". Verify the exact tool name from your active tool list.'
    );

    // 2. manage_files(action="delete") blocks empty, ".", and workspaceRoot source
    const sampleFile = path.join(tmpDir, 'keep-alive.txt');
    fs.writeFileSync(sampleFile, 'important data', 'utf-8');

    const delEmpty = await executor.executeTool(
      'manage_files',
      { action: 'delete', source: '' },
      { threadId: 't1', messageId: 'm1', workspaceRoot: tmpDir }
    );
    assert.equal(delEmpty.exitCode, 1);
    assert.ok(delEmpty.stderr.length > 0);
    assert.equal(fs.existsSync(sampleFile), true);

    const delDot = await executor.executeTool(
      'manage_files',
      { action: 'delete', source: '.' },
      { threadId: 't1', messageId: 'm1', workspaceRoot: tmpDir }
    );
    assert.equal(delDot.exitCode, 1);
    assert.ok(delDot.stderr.length > 0);
    assert.equal(fs.existsSync(sampleFile), true);

    const delRoot = await executor.executeTool(
      'manage_files',
      { action: 'delete', source: tmpDir },
      { threadId: 't1', messageId: 'm1', workspaceRoot: tmpDir }
    );
    assert.equal(delRoot.exitCode, 1);
    assert.ok(delRoot.stderr.length > 0);
    assert.equal(fs.existsSync(sampleFile), true);

    // Deleting a valid nested child file still works
    const tempVictim = path.join(tmpDir, 'victim.txt');
    fs.writeFileSync(tempVictim, 'bye', 'utf-8');
    const delChild = await executor.executeTool(
      'manage_files',
      { action: 'delete', source: 'victim.txt' },
      { threadId: 't1', messageId: 'm1', workspaceRoot: tmpDir }
    );
    assert.equal(delChild.exitCode, 0);
    assert.equal(fs.existsSync(tempVictim), false);

    // 3. toolScoper & builtinToolsSchema checks
    assert.ok(
      BUILTIN_TOOLS_SCHEMA.some((t) => t.function.name === 'lsp_diagnostics'),
      'BUILTIN_TOOLS_SCHEMA must include lsp_diagnostics'
    );
    assert.ok(PI_CORE_TOOL_NAMES.includes('list_directory' as any));
    assert.ok(DEFAULT_CORE_TOOL_NAMES.includes('lsp_diagnostics' as any));
    assert.ok(DEFAULT_CORE_TOOL_NAMES.includes('list_directory' as any));
    assert.ok(DEFAULT_CORE_TOOL_NAMES.includes('ask_question' as any));

    const defaultScoped = selectScopedTools({
      prompt: 'Inspect the project',
      builtinTools: BUILTIN_TOOLS_SCHEMA,
      skillTools: SKILL_TOOLS_SCHEMA,
      mcpTools: [],
    });
    const defaultNames = new Set(defaultScoped.map((t) => t.function.name));
    assert.ok(defaultNames.has('lsp_diagnostics'));
    assert.ok(defaultNames.has('list_directory'));
    assert.ok(defaultNames.has('ask_question'));
    assert.ok(!defaultNames.has('browse_url'));

    const browserScoped = selectScopedTools({
      prompt: 'Check the webpage',
      slashCommand: '/browser',
      builtinTools: BUILTIN_TOOLS_SCHEMA,
      skillTools: SKILL_TOOLS_SCHEMA,
      mcpTools: [],
    });
    const browserNames = new Set(browserScoped.map((t) => t.function.name));
    assert.ok(browserNames.has('browser_inspect'));
    assert.ok(!browserNames.has('browse_url'));

    const swarmScoped = selectScopedTools({
      prompt: 'Coordinate workers',
      slashCommand: '/swarm',
      includeSwarmBoardTools: true,
      builtinTools: BUILTIN_TOOLS_SCHEMA,
      skillTools: SKILL_TOOLS_SCHEMA,
      mcpTools: [],
      swarmTools: SWARM_TOOLS_SCHEMA,
    });
    const swarmNames = new Set(swarmScoped.map((t) => t.function.name));
    assert.ok(swarmNames.has('swarm'), '/swarm must unlock swarm tool');
    assert.ok(swarmNames.has('post_message'));

    const grillScoped = selectScopedTools({
      prompt: 'Ask me design questions',
      slashCommand: '/grill-me',
      forceLean: true,
      builtinTools: BUILTIN_TOOLS_SCHEMA,
      skillTools: SKILL_TOOLS_SCHEMA,
      mcpTools: [],
    });
    assert.ok(
      grillScoped.some((t) => t.function.name === 'ask_question'),
      '/grill-me must unlock ask_question even in lean mode'
    );

    // 4. Slash commands directives
    const browserCmd = parseAntigravitySlashCommand('/browser https://example.com');
    assert.ok(browserCmd.modeDirective.includes('browser_inspect'));
    assert.ok(!browserCmd.modeDirective.includes('browse_url'));

    const restartCmd = parseAntigravitySlashCommand('/restart');
    assert.ok(restartCmd.modeDirective.includes('restart_brain'));

    const scheduleCmd = parseAntigravitySlashCommand('/schedule build every night');
    assert.ok(scheduleCmd.modeDirective.includes('schedule'));

    const learnCmd = parseAntigravitySlashCommand('/learn always run tsc');
    assert.ok(learnCmd.modeDirective.includes('memory.md'));
    assert.ok(learnCmd.modeDirective.includes('skills/<name>.md'));

    const visionCmd = parseAntigravitySlashCommand('/vision');
    assert.ok(
      visionCmd.modeDirective.toLowerCase().includes('provider') ||
        visionCmd.modeDirective.toLowerCase().includes('gemini')
    );

    // 5. detectPrematureStop: finishReason 'length' vs 'content_filter', /plan and /grill-me exemptions, READ_ONLY_INSPECTION_TOOLS
    for (const roTool of [
      'search_web',
      'search_models',
      'browser_inspect',
      'capture_screen',
      'inspect_window',
      'lsp_diagnostics',
      'read_board',
      'ask_question',
    ]) {
      assert.ok(READ_ONLY_INSPECTION_TOOLS.has(roTool), `READ_ONLY_INSPECTION_TOOLS must include ${roTool}`);
    }

    const filterStop = detectPrematureStop('Let me read foo.ts:', false, 0, {
      finishReason: 'content_filter',
    });
    assert.equal(filterStop.isPremature, false);
    assert.equal(filterStop.shouldContinue, false);

    const lenStop = detectPrematureStop('Partial answer that got cut off', false, 0, {
      finishReason: 'length',
    });
    assert.equal(lenStop.isPremature, true);
    assert.equal(lenStop.shouldContinue, true);
    assert.equal(lenStop.reason, 'output_truncated_length');
    assert.equal(
      lenStop.retryInstruction,
      'Your previous response was truncated due to the token limit (finish_reason=length). Continue directly from where you left off without repeating earlier text.'
    );

    // /plan and /grill-me exempt from Rule 4 (no-mutation) and Rule 3c (permission hedging)
    const planStop = detectPrematureStop(
      'Here is the plan for `server/src/index.ts`:\n```ts\nconsole.log(1);\n```\nWould you like me to proceed?',
      true,
      0,
      5,
      '/plan refactor server/src/index.ts',
      ['read_file'],
      { slashCommand: '/plan' }
    );
    assert.equal(planStop.shouldContinue, false);
    assert.equal(planStop.isPremature, false);

    const grillStop = detectPrematureStop(
      '1. Which database should we use? Would you like me to implement option A?',
      true,
      0,
      5,
      '/grill-me build the new auth module',
      ['read_file'],
      { slashCommand: '/grill-me' }
    );
    assert.equal(grillStop.shouldContinue, false);

    const pureQuestionStop = detectPrematureStop(
      'Here is how `server/src/index.ts` works:\n```ts\nexport function main() {}\n```',
      true,
      0,
      5,
      'How does the build pipeline in server/src/index.ts work?',
      ['read_file']
    );
    assert.equal(pureQuestionStop.shouldContinue, false);

    // 6. adaptiveCot handles 'low', 'medium', 'high', 'xhigh'
    const cotLow = computeAdaptiveThinkingConfig('low', 1);
    assert.equal(cotLow.enableThinking, true);
    assert.equal(cotLow.maxThinkingTokens, 512);
    assert.equal(cotLow.reasoningBudgetTokens, 512);
    assert.equal(cotLow.reasoningEffort, 'low');

    const cotMed = computeAdaptiveThinkingConfig('medium', 1);
    assert.equal(cotMed.enableThinking, true);
    assert.equal(cotMed.maxThinkingTokens, 1024);
    assert.equal(cotMed.reasoningBudgetTokens, 1024);
    assert.equal(cotMed.reasoningEffort, 'medium');

    const cotHigh = computeAdaptiveThinkingConfig('high', 1);
    assert.equal(cotHigh.enableThinking, true);
    assert.equal(cotHigh.maxThinkingTokens, 2560);
    assert.equal(cotHigh.reasoningBudgetTokens, 2560);
    assert.equal(cotHigh.reasoningEffort, 'high');

    const cotXHigh = computeAdaptiveThinkingConfig('xhigh', 1);
    assert.equal(cotXHigh.enableThinking, true);
    assert.equal(cotXHigh.maxThinkingTokens, 4096);
    assert.equal(cotXHigh.reasoningBudgetTokens, 4096);
    assert.equal(cotXHigh.reasoningEffort, 'xhigh');

    // 7. autoCompactMessages returns distilledMemory, measures tool_calls JSON args & image_url, and forceCompact preserves recent turns
    const msgWithToolsAndImg: PrunableMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
      tool_calls: [
        {
          id: 'tc_big',
          type: 'function',
          function: { name: 'write_file', arguments: JSON.stringify({ path: 'a.ts', content: 'X'.repeat(5000) }) },
        },
      ],
    };
    const measuredLen = measureMessageLength(msgWithToolsAndImg);
    assert.ok(measuredLen >= 5 + 2000 + 5000, `Expected measured length >= 7005, got ${measuredLen}`);

    const forceHistory: PrunableMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Real user objective: build feature Z' },
      { role: 'assistant', content: 'Step 1 done' },
      { role: 'user', content: '[System Auto-Continue • Context Compacted (Window 2/4)]: continue' },
      { role: 'assistant', content: 'Step 2 done' },
      { role: 'user', content: '[Visual Capture from capture_screen]: screenshot' },
      { role: 'assistant', content: 'Recent assistant turn 1 with details ' + 'R'.repeat(300) },
      { role: 'user', content: 'Recent user turn 2 with details ' + 'U'.repeat(300) },
      { role: 'assistant', content: 'Recent assistant turn 3 with details ' + 'A'.repeat(300) },
      { role: 'user', content: 'Recent user turn 4 with details ' + 'F'.repeat(300) },
    ];
    const forcedRes = autoCompactMessages(forceHistory, 42000, 4, {
      forceCompact: true,
      pruneBudgetChars: 42000,
    });
    assert.equal(forcedRes.didCompact, true);
    assert.ok(forcedRes.distilledMemory.includes('[CONTEXT AUTO-COMPACTED'));
    assert.ok(forcedRes.distilledMemory.includes('Real user objective: build feature Z'));
    assert.ok(!forcedRes.distilledMemory.includes('[System Auto-Continue'));
    assert.ok(!forcedRes.distilledMemory.includes('[Visual Capture'));
    // Recent 4 turns must be preserved verbatim (not pruned down to 100 chars!)
    assert.equal(forcedRes.messages.length, 6); // system + distilled + 4 recent
    assert.ok(String(forcedRes.messages[5].content).includes('F'.repeat(300)));

    // 8. Tool output formatting (stdout + stderr + non-zero exit_code) & invokeSubagent abort handling
    const combinedOut = formatToolExecutionOutput('Build output line 1', 'Warning: deprecated flag', 2);
    assert.ok(combinedOut.includes('Build output line 1'));
    assert.ok(combinedOut.includes('[stderr]\nWarning: deprecated flag'));
    assert.ok(combinedOut.includes('[exit_code: 2]'));

    const abortCtrl = new AbortController();
    abortCtrl.abort();
    const abortedSubRes = await invokeSubagentHandler.execute(
      { role: 'Scanner', prompt: 'Scan everything' },
      {
        threadId: 't1',
        messageId: 'm1',
        workspaceRoot: tmpDir,
        abortSignal: abortCtrl.signal,
      },
      executor.asExec()
    );
    assert.equal(abortedSubRes.exitCode, 130);

    // 9. promptTurn malformed tool call self-correction & contiguous tool messages before screenshot user message
    const events: Array<{ type: string; payload: any }> = [];
    let turnStepCalls = 0;
    let observedSecondStepMessages: any[] = [];
    const fakeTabby: any = {
      getTelemetry: () => ({ tokensPerSec: 60, activeTier: 'high' }),
      getBrainProviderConfig: () => ({ provider: 'google_ai_studio' }),
      streamChatCompletion: async (p: any) => {
        turnStepCalls++;
        if (turnStepCalls === 1) {
          p.onToolCallParseError?.({
            callId: 'bad_call_1',
            toolName: 'edit_file',
            rawArguments: '{"path": "broken',
            error: 'Unexpected end of JSON input',
          });
          await p.onToolCallRequest?.('capture_screen', {});
          await p.onToolCallRequest?.('read_file', { path: 'keep-alive.txt' });
          return {
            content: 'Interim tool note',
            thinkingContent: '',
            thinkingDurationMs: 5,
            thinkingTokens: 0,
            outputTokens: 3,
          };
        }
        observedSecondStepMessages = p.messages;
        return {
          content: 'Self-corrected and finished.',
          thinkingContent: '',
          thinkingDurationMs: 5,
          thinkingTokens: 0,
          outputTokens: 5,
        };
      },
    };

    const handleTurn = createPromptTurnHandler({
      db,
      tabby: fakeTabby,
      mcp: { exportOpenAiTools: () => [] } as any,
      skills: { buildSkillsPromptSection: () => '' } as any,
      tools: {
        executeTool: async (name: string) => {
          if (name === 'capture_screen') {
            return {
              exitCode: 0,
              stdout: 'captured',
              stderr: '',
              durationMs: 2,
              screenshotBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            };
          }
          return { exitCode: 0, stdout: 'file ok', stderr: 'minor notice', durationMs: 2 };
        },
      } as any,
      harness: {
        buildCompiledHarnessPrompt: () => '',
        recordToolOutcomeAndMaybeRunPPC: async () => {
          throw new Error('Simulated non-fatal PPC error');
        },
        listHarnessComponents: () => [],
      } as any,
      terminal,
      attachmentManager: { saveAttachment: async () => ({}) } as any,
      broadcastSync: (ev) => events.push(ev as any),
      activeAbortControllers: new Map(),
      activeTurns: new Map(),
      repoRoot: tmpDir,
    });

    await handleTurn({
      threadId: 'thread-rel-1',
      prompt: 'Capture screen and read file',
      tier: 'medium',
      thinkingBudget: 'low',
    });

    assert.equal(turnStepCalls, 2);
    const assistantToolIdx = observedSecondStepMessages.findIndex(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls)
    );
    assert.ok(assistantToolIdx !== -1, 'Assistant tool_calls message must be present');
    // Next 3 messages must all be role === 'tool' contiguously (bad_call_1, capture_screen, read_file)
    assert.equal(observedSecondStepMessages[assistantToolIdx + 1]?.role, 'tool');
    assert.equal(observedSecondStepMessages[assistantToolIdx + 2]?.role, 'tool');
    assert.equal(observedSecondStepMessages[assistantToolIdx + 3]?.role, 'tool');
    // And the screenshot user message comes AFTER all 3 tool messages
    assert.equal(observedSecondStepMessages[assistantToolIdx + 4]?.role, 'user');
    assert.ok(
      observedSecondStepMessages[assistantToolIdx + 3]?.content.includes('[stderr]\nminor notice'),
      'Both stdout and stderr must be preserved in tool output'
    );

    console.log('✅ All Wave 2 Agent, Compaction, Tools & Slash Commands Reliability Tests PASSED');
  } finally {
    terminal.dispose();
    db.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

runAgentTurnReliabilityTests().catch((err) => {
  console.error('❌ Agent Turn Reliability Tests FAILED:', err);
  process.exit(1);
});
