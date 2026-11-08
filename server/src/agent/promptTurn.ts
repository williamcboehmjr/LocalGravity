import type { LocalGravityDB, ModelTier, ThinkingBudget } from '../db/database.js';
import type { TabbyEngine } from '../tabby/tabbyEngine.js';
import { deduplicateRepeatedSequences } from '../tabby/tabbyEngine.js';
import type { McpClientManager } from '../mcp/mcpManager.js';
import type { SkillManager } from '../skills/skillManager.js';
import type { SharedTerminalManager } from '../terminal/terminalManager.js';
import type { BuiltinToolExecutor } from '../tools/builtinTools.js';
import type { Harness2Manager } from '../harness/harnessManager.js';
import { pruneChatMessages } from '../utils/messagePruning.js';
import { detectPrematureStop } from './prematureStop.js';
import { parseAntigravitySlashCommand } from './slashCommands.js';
import os from 'node:os';
import path from 'node:path';
import { BUILTIN_TOOLS_SCHEMA } from '../tools/builtinTools.js';
import { SKILL_TOOLS_SCHEMA } from '../skills/skillManager.js';

export interface PromptTurnDeps {
  db: LocalGravityDB;
  tabby: TabbyEngine;
  mcp: McpClientManager;
  skills: SkillManager;
  tools: BuiltinToolExecutor;
  harness: Harness2Manager;
  terminal: SharedTerminalManager;
  broadcastSync: (event: Record<string, any>) => void;
  activeAbortControllers: Map<string, AbortController>;
  repoRoot: string;
}

export function createPromptTurnHandler(deps: PromptTurnDeps) {
  const { db, tabby, mcp, skills, tools, harness, broadcastSync, activeAbortControllers, repoRoot } = deps;

  return async function handlePromptTurn(params: {
    threadId: string;
    prompt: string;
    tier: ModelTier;
    thinkingBudget: ThinkingBudget;
    attachments?: any[];
  }) {
    const promptStr = typeof params.prompt === 'string' ? params.prompt : '';
    let thread = db.getThread(params.threadId);
    if (!thread) {
      const defaultProj = db.ensureDefaultProject(repoRoot);
      thread = db.createThread({
        id: params.threadId,
        project_id: defaultProj.id,
        title: promptStr.slice(0, 42) || 'New Thread',
        active_model_tier: params.tier,
        active_thinking_budget: params.thinkingBudget,
      });
    } else if (thread.title === 'New Thread' || thread.title === 'Initial Thread') {
      const cleanTitle = promptStr.replace(/\s+/g, ' ').trim().slice(0, 44);
      if (cleanTitle) {
        thread = db.updateThread(thread.id, { title: cleanTitle }) || thread;
      }
    }

    const project = db.getProject(thread.project_id) || db.ensureDefaultProject(repoRoot);
    const compiledHarness = harness.buildCompiledHarnessPrompt(project.root_path);

    // 1. Persist User Message
    const userMsg = db.createMessage({
      thread_id: thread.id,
      role: 'user',
      content: params.prompt,
      attachments: params.attachments || [],
    });

    // 2. Create Placeholder Assistant Message & Register 250ms Rehydration Stream Buffer
    const assistantMsg = db.createMessage({
      thread_id: thread.id,
      role: 'assistant',
      content: '',
      thinking_content: '',
    });
    db.beginStreamingMessage(assistantMsg.id, thread.id);
    db.updateThread(thread.id, {
      status: params.thinkingBudget === 'off' ? 'executing_tool' : 'thinking',
      active_model_tier: params.tier,
      active_thinking_budget: params.thinkingBudget,
    });

    broadcastSync({
      type: 'TURN_STARTED',
      payload: {
        threadId: thread.id,
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        tier: params.tier,
        thinkingBudget: params.thinkingBudget,
      },
    });

    const abortController = new AbortController();
    activeAbortControllers.set(thread.id, abortController);

    try {
      const history = db.listMessages(thread.id);
      const userHome = os.homedir().replace(/\\/g, '/');
      const downloadsDir = path.join(os.homedir(), 'Downloads').replace(/\\/g, '/');
      const desktopDir = path.join(os.homedir(), 'Desktop').replace(/\\/g, '/');
      const documentsDir = path.join(os.homedir(), 'Documents').replace(/\\/g, '/');

      // Parse Antigravity Slash Commands (/goal, /plan, /boost, /grill-me, /teamwork, /browser, /learn, /compact, /schedule)
      const slashInfo = parseAntigravitySlashCommand(params.prompt);
      const effectiveThinkingBudget: ThinkingBudget = slashInfo.forceThinkingBudget || params.thinkingBudget;

      // Special fast-path for /compact command
      if (params.prompt.trim().toLowerCase().startsWith('/compact')) {
        const msgCount = history.length;
        const summaryNote =
          `✅ **Context Compacted (/compact)**\n\n` +
          `Compacted ${msgCount} historical messages in thread **${thread.title}**. ` +
          `Older intermediate tool outputs and verbose turns have been distilled so the full **${params.tier.toUpperCase()}** context window is fresh and ready.`;
        db.appendTokenDelta(assistantMsg.id, thread.id, summaryNote, Math.ceil(summaryNote.length / 4));
        broadcastSync({
          type: 'TOKEN_STREAM',
          payload: {
            session_id: thread.id,
            thread_id: thread.id,
            message_id: assistantMsg.id,
            chunk: summaryNote,
            output_tokens: Math.ceil(summaryNote.length / 4),
            is_finished: true,
          },
        });
        db.finalizeStreamingMessage(assistantMsg.id);
        const updatedThread = db.updateThread(thread.id, { status: 'idle' });
        broadcastSync({
          type: 'TURN_COMPLETED',
          payload: { threadId: thread.id, messageId: assistantMsg.id, thread: updatedThread },
        });
        return;
      }

      const systemDirective =
        `You are LocalGravity (Google Antigravity 2.0 Local Architecture), running directly on the user's workstation with TabbyAPI EXL2/EXL3.\n` +
        `Active Workspace: ${project.name} (${project.root_path}) [branch: ${project.git_branch}]\n` +
        `Workstation Paths: Home="${userHome}", Downloads="${downloadsDir}", Desktop="${desktopDir}", Documents="${documentsDir}".\n\n` +
        `=== UNRESTRICTED SYSTEM ACCESS & AUTONOMOUS EXECUTION ===\n` +
        `1. FULL ACCESS: You have complete, unrestricted access to the entire computer and local filesystem, granted directly by the user.\n` +
        `2. NO GUARDRAIL REFUSALS: You CAN access, inspect, list, read, search, and manage files anywhere on the machine (including Downloads, Desktop, Documents, C:/, E:/, etc.). NEVER claim that you lack permission or are confined to the workspace.\n` +
        `3. EFFICIENT FILE READING: ` +
        `` + `read_file` + `` + ` returns up to 24,000 characters (~650 lines) per call completely intact. Read files in 300–500 line ranges (or full files) rather than tiny chunks. Do NOT waste steps testing truncation thresholds.\n` +
        `4. NEVER STOP MID-TASK: Never output a sentence like "Let me read X" or "I will now check Y" and stop without actually emitting the tool call in the same turn. Always follow through until you deliver the complete, thorough answer or code implementation.\n` +
        `5. GOAL-DIRECTED EXECUTION: Keep intermediate tool-step commentary brief (1 sentence max) or invoke the tool directly, saving your detailed prose and code blocks for the final synthesis.\n6. NEVER SIMULATE TOOL EXECUTION IN PROSE: You MUST NEVER write sentences like "Reading index.ts now...", "Now writing file X...", "Running npm run build...", "Fixing compile errors..." without actually invoking the corresponding tool (read_file, write_file, apply_diff, run_terminal). If you describe taking an action, you MUST emit the real structured tool call in the same turn. Fabricating execution in text is strictly forbidden.\n\n` +
        skills.buildSkillsPromptSection() + '\n\n' +
        (slashInfo.modeDirective ? `${slashInfo.modeDirective}\n\n` : '') +
        `=== HARNESS² 8-COMPONENT CONTEXT ===\n${compiledHarness}\n` +
        (project.custom_instructions ? `Custom Instructions: ${project.custom_instructions}\n` : '');

      const historyMessages = history
        .filter((m) => m.id !== assistantMsg.id)
        .slice(-14)
        .map((m, idx, arr) => ({
          role: m.role,
          content: idx === arr.length - 1 && m.role === 'user' && slashInfo.command ? slashInfo.cleanPrompt : m.content,
        }));

      const chatMessages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [
        {
          role: 'system',
          content: systemDirective,
        },
        ...historyMessages,
      ];

      const MAX_TOOL_STEPS = slashInfo.maxToolSteps;
      const MAX_AUTO_CONTINUES = slashInfo.maxAutoContinues;
      let step = 0;
      let autoContinueCount = 0;
      let cumulativeOutputTokens = 0;
      let cumulativeThinkingTokens = 0;
      let lastThinkingMs = 0;
      let hasExecutedTools = false;
      let committedFinalContent = '';
      const collectedStepNotes: string[] = [];

      // Broadcast active subagent start to Overview drawer
      const subagentId = `subagent-${assistantMsg.id.slice(0, 8)}`;
      broadcastSync({
        type: 'SUBAGENT_EVENT',
        payload: {
          id: subagentId,
          thread_id: thread.id,
          message_id: assistantMsg.id,
          role: slashInfo.subagentRole,
          command: slashInfo.command || 'autonomous',
          status: 'running',
          step: 1,
          maxSteps: MAX_TOOL_STEPS,
          summary: `Starting ${slashInfo.subagentRole} (${params.tier.toUpperCase()} • ${effectiveThinkingBudget.toUpperCase()})`,
          timestamp: Date.now(),
        },
      });

      while (step < MAX_TOOL_STEPS) {
        step++;
        const isFinalStep = step === MAX_TOOL_STEPS;
        const executedToolsThisStep: Array<{
          id: string;
          toolName: string;
          arguments: any;
          output: string;
        }> = [];

        // On the final step, omit tools so the model must provide its final text synthesis
        const activeTools = isFinalStep
          ? undefined
          : [
              ...BUILTIN_TOOLS_SCHEMA,
              ...SKILL_TOOLS_SCHEMA,
              ...mcp.exportOpenAiTools(),
            ];
        if (isFinalStep && hasExecutedTools && chatMessages.length > 0) {
          chatMessages[0] = {
            ...chatMessages[0],
            content:
              chatMessages[0].content +
              '\n\n[FINAL SYNTHESIS STEP]: You have gathered all needed information from tools. Now write your complete, detailed analysis, code refactoring, and actionable solution for the user.',
          };
        }

        const result = await tabby.streamChatCompletion({
          tier: params.tier,
          thinkingBudget: effectiveThinkingBudget,
          stepIndex: step,
          messages: pruneChatMessages(chatMessages, params.tier === 'high' ? 58000 : 78000),
          tools: activeTools,
          abortSignal: abortController.signal,
          onThoughtDelta: (delta, elapsedMs, tokenCount) => {
            cumulativeThinkingTokens += Math.max(1, Math.ceil(delta.length / 4));
            lastThinkingMs = elapsedMs;
            db.appendThoughtDelta(assistantMsg.id, thread!.id, delta, elapsedMs, cumulativeThinkingTokens);
            broadcastSync({
              type: 'THOUGHT_STREAM',
              payload: {
                session_id: thread!.id,
                thread_id: thread!.id,
                message_id: assistantMsg.id,
                chunk: delta,
                elapsed_ms: elapsedMs,
                token_count: cumulativeThinkingTokens,
                is_finished: false,
              },
            });
          },
          onTokenDelta: (delta, tokenCount) => {
            cumulativeOutputTokens += Math.max(1, Math.ceil(delta.length / 4));
            db.appendTokenDelta(assistantMsg.id, thread!.id, delta, cumulativeOutputTokens);
            broadcastSync({
              type: 'TOKEN_STREAM',
              payload: {
                session_id: thread!.id,
                thread_id: thread!.id,
                message_id: assistantMsg.id,
                chunk: delta,
                output_tokens: cumulativeOutputTokens,
                is_finished: false,
              },
            });
          },
          onToolCallRequest: async (toolName, toolArgs) => {
            hasExecutedTools = true;
            db.updateThread(thread!.id, { status: 'executing_tool' });
            const cmdFormatted = `${toolName}(${JSON.stringify(toolArgs)})`;
            const toolExec = db.createToolExecution({
              message_id: assistantMsg.id,
              thread_id: thread!.id,
              tool_name: toolName,
              mcp_server: toolName.startsWith('mcp_') ? 'mcp' : null,
              arguments_json: JSON.stringify(toolArgs),
            });

            broadcastSync({
              type: 'TOOL_EVENT',
              payload: {
                session_id: thread!.id,
                thread_id: thread!.id,
                message_id: assistantMsg.id,
                tool_execution_id: toolExec.id,
                tool_name: toolName,
                command: cmdFormatted,
                arguments: toolArgs,
                output: '',
                status: 'running',
              },
            });

            broadcastSync({
              type: 'SUBAGENT_EVENT',
              payload: {
                id: subagentId,
                thread_id: thread!.id,
                message_id: assistantMsg.id,
                role: slashInfo.subagentRole,
                command: slashInfo.command || 'autonomous',
                status: 'running',
                step,
                maxSteps: MAX_TOOL_STEPS,
                summary: `Step ${step}: ${toolName}(${ toolArgs.path || toolArgs.command || toolArgs.url || '' })`.slice(0, 90),
                timestamp: Date.now(),
              },
            });

            const execResult = await tools.executeTool(toolName, toolArgs, {
              threadId: thread!.id,
              messageId: assistantMsg.id,
              workspaceRoot: project.root_path,
              onStdoutChunk: (chunk) => {
                broadcastSync({
                  type: 'TOOL_STREAM',
                  payload: {
                    thread_id: thread!.id,
                    message_id: assistantMsg.id,
                    tool_execution_id: toolExec.id,
                    stream: 'stdout',
                    chunk,
                  },
                });
              },
              onStderrChunk: (chunk) => {
                broadcastSync({
                  type: 'TOOL_STREAM',
                  payload: {
                    thread_id: thread!.id,
                    message_id: assistantMsg.id,
                    tool_execution_id: toolExec.id,
                    stream: 'stderr',
                    chunk,
                  },
                });
              },
              onFileCheckpointCreated: (checkpoint) => {
                broadcastSync({
                  type: 'CHECKPOINT_CREATED',
                  payload: { thread_id: thread!.id, checkpoint },
                });
              },
              onScreenCaptured: (base64Image, windowTitle) => {
                broadcastSync({
                  type: 'VISION_CAPTURE',
                  payload: {
                    base64DataUrl: base64Image,
                    activeWindowTitle: windowTitle,
                  },
                });
              },
            });

            // Check Harness² Recursive Propose-Probe-Compose Loop on Tool Failure
            const ppcCycle = await harness.recordToolOutcomeAndMaybeRunPPC({
              workspaceRoot: project.root_path,
              toolName,
              command: cmdFormatted,
              exitCode: execResult.exitCode,
              stdout: execResult.stdout,
              stderr: execResult.stderr,
            });

            if (ppcCycle) {
              broadcastSync({
                type: 'HARNESS_PPC_COMPLETED',
                payload: {
                  cycle: ppcCycle,
                  components: harness.listHarnessComponents(project.root_path),
                },
              });
            }

            const finalStatus = execResult.exitCode === 0 ? 'success' : 'error';
            db.updateToolExecution(toolExec.id, {
              stdout_stream: execResult.stdout,
              stderr_stream: execResult.stderr,
              exit_code: execResult.exitCode,
              status: finalStatus,
              duration_ms: execResult.durationMs,
            });

            broadcastSync({
              type: 'TOOL_EVENT',
              payload: {
                session_id: thread!.id,
                thread_id: thread!.id,
                message_id: assistantMsg.id,
                tool_execution_id: toolExec.id,
                tool_name: toolName,
                command: cmdFormatted,
                arguments: toolArgs,
                output: execResult.stdout || execResult.stderr,
                exit_code: execResult.exitCode,
                duration_ms: execResult.durationMs,
                status: finalStatus,
              },
            });

            executedToolsThisStep.push({
              id: toolExec.id,
              toolName,
              arguments: toolArgs,
              output: execResult.stdout || execResult.stderr || 'Success (no output)',
            });
          },
        });

        if (abortController.signal.aborted) {
          break;
        }

        const stepText = deduplicateRepeatedSequences((result.content || '').trim());

        // Check if no tools were executed in this step
        if (executedToolsThisStep.length === 0) {
          // Did the model stop prematurely with an unfulfilled intention ("Let me read...", empty output, etc.)?
          if (!isFinalStep) {
            const autoCheck = detectPrematureStop(
              stepText,
              hasExecutedTools,
              autoContinueCount,
              MAX_AUTO_CONTINUES,
              params.prompt
            );
            if (autoCheck.shouldContinue) {
              autoContinueCount++;
              if (stepText) {
                collectedStepNotes.push(stepText);
              }
              // Move the transient status note into the collapsible activity log and keep main message buffer clean
              db.resetStreamingMessageContent(assistantMsg.id, committedFinalContent);
              broadcastSync({
                type: 'STEP_NOTE_COMMITTED',
                payload: {
                  session_id: thread.id,
                  thread_id: thread.id,
                  message_id: assistantMsg.id,
                  step,
                  note: stepText || 'Continuing multi-step execution...',
                  committed_content: committedFinalContent,
                  is_auto_continue: true,
                },
              });
              broadcastSync({
                type: 'SUBAGENT_EVENT',
                payload: {
                  id: subagentId,
                  thread_id: thread.id,
                  message_id: assistantMsg.id,
                  role: slashInfo.subagentRole,
                  command: slashInfo.command || 'autonomous',
                  status: 'running',
                  step,
                  maxSteps: MAX_TOOL_STEPS,
                  summary: `Auto-continuing (#${autoContinueCount}): ${(stepText || 'proceeding to next action').slice(0, 75)}`,
                  timestamp: Date.now(),
                },
              });

              chatMessages.push({
                role: 'assistant',
                content: stepText || 'Proceeding to next action.',
              });
              chatMessages.push({
                role: 'user',
                content: autoCheck.continuationPrompt,
              });
              continue;
            }
          }

          // Model genuinely completed its final response!
          committedFinalContent = committedFinalContent
            ? `${committedFinalContent}\n\n${stepText}`
            : stepText;
          break;
        }

        // Tools were executed in this step!
        // If the model emitted a short transitional preamble (< 650 chars, e.g., "Let me read index.ts..."),
        // move it into the collapsible activity window (STEP_NOTE_COMMITTED) instead of polluting the final answer!
        if (stepText) {
          if (stepText.length < 650) {
            collectedStepNotes.push(stepText);
            db.resetStreamingMessageContent(assistantMsg.id, committedFinalContent);
            broadcastSync({
              type: 'STEP_NOTE_COMMITTED',
              payload: {
                session_id: thread.id,
                thread_id: thread.id,
                message_id: assistantMsg.id,
                step,
                note: stepText,
                committed_content: committedFinalContent,
                is_auto_continue: false,
              },
            });
          } else {
            // Substantial output emitted alongside tools: keep it in the main answer
            committedFinalContent = committedFinalContent
              ? `${committedFinalContent}\n\n${stepText}`
              : stepText;
            db.resetStreamingMessageContent(assistantMsg.id, committedFinalContent + '\n\n');
          }
        }

        // Feed tool outputs back to the model for next turn reasoning
        db.updateThread(thread.id, { status: 'thinking' });

        const toolCallsArray = executedToolsThisStep.map((t) => ({
          id: t.id,
          type: 'function',
          function: {
            name: t.toolName,
            arguments: JSON.stringify(t.arguments),
          },
        }));

        chatMessages.push({
          role: 'assistant',
          content: result.content || '',
          tool_calls: toolCallsArray,
        });

        for (const t of executedToolsThisStep) {
          chatMessages.push({
            role: 'tool',
            tool_call_id: t.id,
            name: t.toolName,
            content: t.output,
          });
        }
      }

      // If /plan was used, automatically sync the generated plan to the Plan Workbench
      if (slashInfo.command === '/plan' && committedFinalContent.trim().length > 40) {
        broadcastSync({
          type: 'ARTIFACT_SYNC',
          payload: {
            session_id: thread.id,
            artifact_name: 'plan.md',
            content: committedFinalContent,
            version: Date.now(),
          },
        });
      }

      broadcastSync({
        type: 'SUBAGENT_EVENT',
        payload: {
          id: subagentId,
          thread_id: thread.id,
          message_id: assistantMsg.id,
          role: slashInfo.subagentRole,
          command: slashInfo.command || 'autonomous',
          status: 'completed',
          step,
          maxSteps: MAX_TOOL_STEPS,
          summary: `Completed in ${step} step${step === 1 ? '' : 's'}${autoContinueCount > 0 ? ` (${autoContinueCount} self-catches)` : ''}`,
          timestamp: Date.now(),
        },
      });

      // Fallback summary if model executed actions but ended its turn with empty user-facing prose
      if (!committedFinalContent.trim()) {
        if (collectedStepNotes.length > 0) {
          committedFinalContent = collectedStepNotes[collectedStepNotes.length - 1];
        } else {
          committedFinalContent = `Completed all actions across ${step} autonomous step${step === 1 ? '' : 's'}.`;
        }
        db.resetStreamingMessageContent(assistantMsg.id, committedFinalContent);
      }

      db.finalizeStreamingMessage(assistantMsg.id);
      const updatedThread = db.updateThread(thread.id, { status: 'idle' });

      broadcastSync({
        type: 'THOUGHT_STREAM',
        payload: {
          session_id: thread.id,
          thread_id: thread.id,
          message_id: assistantMsg.id,
          chunk: '',
          elapsed_ms: lastThinkingMs,
          token_count: cumulativeThinkingTokens,
          is_finished: true,
        },
      });

      broadcastSync({
        type: 'TOKEN_STREAM',
        payload: {
          session_id: thread.id,
          thread_id: thread.id,
          message_id: assistantMsg.id,
          chunk: '',
          output_tokens: cumulativeOutputTokens,
          is_finished: true,
        },
      });

      broadcastSync({
        type: 'TURN_COMPLETED',
        payload: {
          threadId: thread.id,
          messageId: assistantMsg.id,
          thread: updatedThread,
        },
      });
    } catch (err: any) {

      db.finalizeStreamingMessage(assistantMsg.id);
      db.updateThread(thread.id, { status: 'error' });
      broadcastSync({
        type: 'TURN_ERROR',
        payload: {
          threadId: thread.id,
          messageId: assistantMsg.id,
          error: err?.message || String(err),
        },
      });
    } finally {
      activeAbortControllers.delete(thread.id);
    }
  
  };
}
