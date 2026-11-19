import fs from 'node:fs';
import os from 'node:os';
import type { LocalGravityDB, ModelTier, ThinkingBudget } from '../db/database.js';
import type { TabbyEngine } from '../tabby/tabbyEngine.js';
import { deduplicateRepeatedSequences, isStrataOrchestratorTier } from '../tabby/tabbyEngine.js';
import type { McpClientManager } from '../mcp/mcpManager.js';
import type { SkillManager } from '../skills/skillManager.js';
import type { SharedTerminalManager } from '../terminal/terminalManager.js';
import type { BuiltinToolExecutor } from '../tools/builtinTools.js';
import type { Harness2Manager } from '../harness/harnessManager.js';
import type { AttachmentManager, SavedAttachment } from '../files/attachmentManager.js';
import { autoCompactMessages } from '../utils/autoCompactor.js';
import { computeAdaptiveThinkingConfig, computeOrchestratorStepConfig } from './adaptiveCot.js';
import { detectPrematureStop } from './prematureStop.js';
import { parseAntigravitySlashCommand } from './slashCommands.js';
import { buildTurnSystemDirective } from './systemPrompt.js';
import { buildChatHistoryMessages } from './messageBuilder.js';
import { TurnPhaseEmitter } from './turnStateMachine.js';
import { BUILTIN_TOOLS_SCHEMA } from '../tools/builtinTools.js';
import { SWARM_TOOLS_SCHEMA } from '../tools/builtinToolsSchema.js';
import { SwarmManager } from '../swarm/swarmManager.js';
import { EdgeBridgeManager } from '../bridge/edgeBridge.js';
import { SKILL_TOOLS_SCHEMA } from '../skills/skillManager.js';
import { selectScopedTools } from '../tools/toolScoper.js';
import { ComfyCompanionManager } from '../tools/handlers/comfyui/comfyCompanion.js';

export type TurnPhaseName =
  | 'queued'
  | 'prefilling'
  | 'thinking'
  | 'streaming_prose'
  | 'preparing_tool_call'
  | 'executing_tools'
  | 'synthesizing_final_prose'
  | 'completed'
  | 'aborted'
  | 'error';

export interface ActiveTurnSnapshot {
  seq: number;
  thread_id: string;
  threadId: string;
  turn_id: string;
  message_id: string;
  phase: TurnPhaseName;
  is_active: boolean;
  step: number;
  max_steps: number;
  status_label: string;
  thinking_finished: boolean;
  active_tool_id?: string;
  error?: string;
  timestamp: number;
}

export interface PromptTurnDeps {
  db: LocalGravityDB;
  tabby: TabbyEngine;
  mcp: McpClientManager;
  skills: SkillManager;
  tools: BuiltinToolExecutor;
  harness: Harness2Manager;
  terminal: SharedTerminalManager;
  attachmentManager: AttachmentManager;
  broadcastSync: (event: Record<string, any>) => void;
  activeAbortControllers: Map<string, AbortController>;
  activeTurns?: Map<string, ActiveTurnSnapshot>;
  repoRoot: string;
}

function isAbortLikeError(err: any): boolean {
  return (
    err?.name === 'AbortError' ||
    err?.code === 'ABORT_ERR' ||
    Boolean(err?.message?.toLowerCase().includes('abort'))
  );
}

export function createPromptTurnHandler(deps: PromptTurnDeps) {
  const { db, tabby, mcp, skills, tools, harness, attachmentManager, broadcastSync, activeAbortControllers, activeTurns, repoRoot } = deps;

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

    const savedAttachments: SavedAttachment[] = [];
    const slashInfo = parseAntigravitySlashCommand(promptStr);
    const effectiveThinkingBudget: ThinkingBudget = slashInfo.forceThinkingBudget || params.thinkingBudget;

    const companionMgr = ComfyCompanionManager.getInstance();
    const studioCfg = companionMgr.getConfig();
    const effectiveCompanionBrain = companionMgr.resolveEffectiveBrain(studioCfg);
    const effectiveOllamaModel = companionMgr.resolveOllamaModel(studioCfg);
    const isComfyStudioTurn =
      slashInfo.command === '/comfy' || (studioCfg.studioMode && !slashInfo.command);

    const userMsg = db.createMessage({
      thread_id: thread.id,
      role: 'user',
      content: promptStr,
      attachments: [],
    });
    const assistantMsg = db.createMessage({
      thread_id: thread.id,
      role: 'assistant',
      content: '',
      thinking_content: '',
    });
    db.beginStreamingMessage(assistantMsg.id, thread.id);
    db.updateThread(thread.id, {
      status: effectiveThinkingBudget === 'off' ? 'executing_tool' : 'thinking',
      active_model_tier: params.tier,
      active_thinking_budget: params.thinkingBudget,
    });
    const abortController = new AbortController();
    activeAbortControllers.set(thread.id, abortController);

    const send = (event: Record<string, any>) =>
      broadcastSync({
        ...event,
        payload: {
          thread_id: thread!.id,
          threadId: thread!.id,
          message_id: assistantMsg.id,
          ...(event.payload || {}),
        },
      });

    const phaseEmitter = new TurnPhaseEmitter({
      threadId: thread.id,
      turnId: assistantMsg.id,
      initialMaxSteps: slashInfo.maxToolSteps,
      activeTurns,
      send,
    });
    const emitPhase = phaseEmitter.emit.bind(phaseEmitter);

    const brainProviderCfg = tabby.getBrainProviderConfig?.() || { provider: 'strata' as const };
    const resolvedModelDisplayName = isComfyStudioTurn
      ? effectiveCompanionBrain === 'ollama_vision'
        ? `ComfyUI Vision (${effectiveOllamaModel} → ${studioCfg.defaultWorkflow})`
        : `ComfyUI Studio (${studioCfg.defaultWorkflow})`
      : tabby.resolveDiskModelName?.(params.tier) || 'swift-1.5-iq2_xs';

    send({
      type: 'TURN_STARTED',
      payload: {
        turn_id: assistantMsg.id,
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        tier: params.tier,
        thinkingBudget: params.thinkingBudget,
        active_model: resolvedModelDisplayName,
        brain_provider: brainProviderCfg.provider,
      },
    });
    emitPhase('queued', 'Starting turn...');

    const subagentId = `subagent-${assistantMsg.id.slice(0, 8)}`;
    let emitSubagentEvents = false;
    let turnOutcome: 'completed' | 'aborted' | 'error' = 'completed';
    let turnErrorMsg = '';
    let turnStep = 0;

    try {
      if (Array.isArray(params.attachments) && params.attachments.length > 0) {
        for (const rawAtt of params.attachments) {
          try {
            if (typeof rawAtt === 'string') {
              const saved = await attachmentManager.saveAttachment(thread.id, {
                dataUrl: rawAtt,
                name: rawAtt.startsWith('data:image/') ? `image_${Date.now()}.jpg` : `upload_${Date.now()}.bin`,
              });
              savedAttachments.push(saved);
            } else if (rawAtt && typeof rawAtt === 'object') {
              const saved = await attachmentManager.saveAttachment(thread.id, {
                id: rawAtt.id,
                name: rawAtt.name,
                type: rawAtt.type,
                size: rawAtt.size,
                dataUrl: rawAtt.base64DataUrl || rawAtt.dataUrl || rawAtt.url,
                savedPath: rawAtt.savedPath,
              });
              savedAttachments.push(saved);
            }
          } catch (attErr) {
            console.error('[PromptTurn] Error saving attachment:', attErr);
          }
        }
        const attToPersist = savedAttachments.length > 0 ? savedAttachments : params.attachments || [];
        db.updateMessageAttachments(userMsg.id, attToPersist);
        userMsg.attachments = JSON.stringify(attToPersist);
      }

      const history = db.listMessages(thread.id);

      // Fast-path for /compact
      if (promptStr.trim().toLowerCase().startsWith('/compact')) {
        const msgCount = history.length;
        const mockMsgs = history.map((m) => ({
          role: m.role,
          content:
            m.content +
            (Array.isArray(m.tool_executions) && m.tool_executions.length > 0
              ? '\n' +
                m.tool_executions
                  .map((t) => `[Tool ${t.tool_name}]: ${(t.stdout_stream || t.stderr_stream || '').slice(0, 600)}`)
                  .join('\n')
              : ''),
        }));
        const cRes = autoCompactMessages(mockMsgs, 100, 4);
        const prunedCount = db.compactThreadMessages(thread.id, 6, cRes.summary);
        const summaryNote =
          `✅ **Context Compacted (/compact)**\n\n` +
          `Compacted **${msgCount}** historical messages in thread **${thread.title}** (${cRes.previousTokens} → ${cRes.compactedTokens} est. tokens, pruned ${prunedCount} older turns into Working Memory).\n` +
          `Older intermediate tool outputs and verbose turns have been distilled into a compact Working Memory Snapshot.`;
        send({
          type: 'CONTEXT_COMPACTED',
          payload: {
            threadId: thread.id,
            previousTokens: cRes.previousTokens,
            compactedTokens: cRes.compactedTokens,
            compactedTurnCount: cRes.compactedTurnCount,
            summary: cRes.summary,
            timestamp: Date.now(),
          },
        });
        db.appendTokenDelta(assistantMsg.id, thread.id, summaryNote, Math.ceil(summaryNote.length / 4));
        send({
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
        emitPhase('completed', 'Completed');
        send({
          type: 'TURN_COMPLETED',
          payload: { threadId: thread.id, messageId: assistantMsg.id, thread: updatedThread, final_content: summaryNote },
        });
        return;
      }

      // Fast-path for /reload
      if (promptStr.trim().toLowerCase().startsWith('/reload')) {
        const discoveredSkills = skills.discoverSkills?.() || [];
        harness.ensureWorkspaceHarness(project.root_path);
        const components = harness.listHarnessComponents(project.root_path);
        const mcpServers = mcp.loadConfig?.() || [];
        const permRules = tools.getPermissionEngine?.()?.reloadRules?.() || [];
        const reloadPayload = {
          reloaded: true,
          skillsCount: discoveredSkills.length,
          skills: discoveredSkills,
          componentsCount: components.length,
          mcpServersCount: mcpServers.length,
          permissionRulesCount: permRules.length,
          timestamp: Date.now(),
        };
        send({ type: 'HARNESS_RELOADED', payload: reloadPayload });
        const reloadNote =
          `🔄 **Harness Hot-Reloaded (/reload)**\n\n` +
          `- **Skills:** ${discoveredSkills.length} discovered (${discoveredSkills.slice(0, 8).map((s) => `\`${s.name}\``).join(', ') || 'none'})\n` +
          `- **Harness² Components:** ${components.length} active in \`.localgravity/harness/\`\n` +
          `- **MCP Servers:** ${mcpServers.filter((s) => s.enabled).length} enabled / ${mcpServers.length} configured\n` +
          `- **Permission Rules:** ${permRules.length} rules loaded`;
        db.appendTokenDelta(assistantMsg.id, thread.id, reloadNote, Math.ceil(reloadNote.length / 4));
        send({
          type: 'TOKEN_STREAM',
          payload: {
            session_id: thread.id,
            thread_id: thread.id,
            message_id: assistantMsg.id,
            chunk: reloadNote,
            output_tokens: Math.ceil(reloadNote.length / 4),
            is_finished: true,
          },
        });
        db.finalizeStreamingMessage(assistantMsg.id);
        const updatedThread = db.updateThread(thread.id, { status: 'idle' });
        emitPhase('completed', 'Completed');
        send({
          type: 'TURN_COMPLETED',
          payload: { threadId: thread.id, messageId: assistantMsg.id, thread: updatedThread, final_content: reloadNote },
        });
        return;
      }

      const edgeBridge = EdgeBridgeManager.getInstance();
      const remoteClient = project.host_name
        ? edgeBridge.getClientByHost(project.host_name)
        : edgeBridge.getRemoteClientForThread(thread.id);
      const remoteHostNote = remoteClient
        ? `\n[REMOTE HOST BRIDGE ACTIVE]: File and terminal tools execute on "${remoteClient.hostname}" (${remoteClient.platform}${remoteClient.homeDir ? `, home: "${remoteClient.homeDir}"` : ''}).\n`
        : project.host_name && edgeBridge.isRemoteHost(project.host_name)
          ? `\n[REMOTE HOST OFFLINE]: This project belongs to "${project.host_name}", which is currently offline.\n`
          : '';

      const expandedSystemDirective = buildTurnSystemDirective({
        projectName: project.name,
        projectRoot: project.root_path,
        gitBranch: project.git_branch,
        customInstructions: project.custom_instructions,
        remoteHostNote,
        slashCommand: slashInfo.command,
        modeDirective: slashInfo.modeDirective,
        compiledHarness,
        skillsSection: skills.buildSkillsPromptSection?.() || '',
        mcpInstructions: mcp.getServerInstructionsBlock?.() || '',
        brainProvider: brainProviderCfg.provider,
        resolvedModelDisplayName,
        isComfyStudio: isComfyStudioTurn,
        comfyDefaultWorkflow: studioCfg.defaultWorkflow,
        comfyCompanionBrain: effectiveCompanionBrain,
        comfyOllamaModel: effectiveOllamaModel,
        promptStr,
      });

      const historyMessages = buildChatHistoryMessages({
        history,
        assistantMsgId: assistantMsg.id,
        savedAttachments,
        slashCommand: slashInfo.command,
        slashCleanPrompt: slashInfo.cleanPrompt,
        limit: isComfyStudioTurn ? 6 : 14,
      });

      const chatMessages: Array<{ role: string; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [
        { role: 'system', content: expandedSystemDirective },
        ...historyMessages,
      ];

      const MAX_TOOL_STEPS = slashInfo.maxToolSteps;
      const MAX_AUTO_CONTINUES = slashInfo.maxAutoContinues;
      let step = 0;
      let autoContinueCount = 0;
      let cumulativeOutputTokens = 0;
      let cumulativeThinkingTokens = 0;
      let lastThinkingMs = 0;
      const turnStartMs = Date.now();
      let hasExecutedTools = false;
      let committedFinalContent = '';
      const collectedStepNotes: string[] = [];
      let lastStepHadToolError = false;
      const MAX_STEP_WINDOWS = 4;
      let stepWindowCount = 0;
      let hitWindowCap = false;
      let consecutiveErrorSteps = 0;
      let lastToolSignature = '';
      let repeatedSignatureCount = 0;
      let hitStuckLoop = false;
      const usedToolsInTurn = new Set<string>();
      emitSubagentEvents = ['/goal', '/teamwork', '/swarm'].includes(slashInfo.command || '');

      if (emitSubagentEvents) {
        send({
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
            summary: `Starting ${slashInfo.subagentRole} (${
              brainProviderCfg.provider === 'google_ai_studio'
                ? resolvedModelDisplayName
                : params.tier.toUpperCase()
            } • ${effectiveThinkingBudget.toUpperCase()})`,
            timestamp: Date.now(),
          },
        });
      }

      const runInferenceStep = async (infParams: Parameters<TabbyEngine['streamChatCompletion']>[0]) => {
        if (isComfyStudioTurn && typeof tabby.getGoogleEngine === 'function') {
          return await ComfyCompanionManager.getInstance().streamStudioTurn(
            infParams,
            tabby.getGoogleEngine(),
            (p) => tabby.streamChatCompletion(p)
          );
        }
        return await tabby.streamChatCompletion(infParams);
      };

      while (step < MAX_TOOL_STEPS) {
        step++;
        turnStep = step;
        const isLastWindow = stepWindowCount + 1 >= MAX_STEP_WINDOWS;
        const isFinalStep = isLastWindow && step === MAX_TOOL_STEPS;
        phaseEmitter.setStepState(step, MAX_TOOL_STEPS, false);

        let stepThinkingClosed = false;
        const closeThinking = () => {
          if (stepThinkingClosed) return;
          stepThinkingClosed = true;
          phaseEmitter.setThinkingFinished(true);
          send({
            type: 'THOUGHT_STREAM',
            payload: {
              session_id: thread!.id,
              chunk: '',
              elapsed_ms: lastThinkingMs,
              token_count: cumulativeThinkingTokens,
              is_finished: true,
            },
          });
        };

        const executedToolsThisStep: Array<{
          id: string;
          toolName: string;
          arguments: any;
          output: string;
          screenshotBase64?: string;
          hadError?: boolean;
        }> = [];

        const includeSwarmBoardTools =
          slashInfo.command === '/swarm' || SwarmManager.getInstance().hasActiveSwarm(thread.id);
        const activeTools = isFinalStep
          ? undefined
          : selectScopedTools({
              prompt: slashInfo.cleanPrompt || promptStr,
              slashCommand: slashInfo.command,
              forceLean: slashInfo.command === '/lean',
              forceComfyStudio: isComfyStudioTurn,
              builtinTools: BUILTIN_TOOLS_SCHEMA,
              skillTools: SKILL_TOOLS_SCHEMA,
              mcpTools: mcp.exportOpenAiTools(),
              swarmTools: includeSwarmBoardTools ? SWARM_TOOLS_SCHEMA : undefined,
              previouslyUsedTools: usedToolsInTurn,
            });

        if (isFinalStep && hasExecutedTools && chatMessages.length > 0) {
          chatMessages[0] = {
            ...chatMessages[0],
            content:
              chatMessages[0].content +
              '\n\n[FINAL SYNTHESIS STEP]: You have gathered all needed information from tools. Now write your complete, detailed analysis, code refactoring, and actionable solution for the user.',
          };
        }

        const isLocalOrchestrator =
          !isComfyStudioTurn &&
          brainProviderCfg.provider !== 'google_ai_studio' &&
          isStrataOrchestratorTier(params.tier);
        const orchestratorStep = isLocalOrchestrator
          ? computeOrchestratorStepConfig(params.tier, step, lastStepHadToolError)
          : null;
        const adaptiveCot = computeAdaptiveThinkingConfig(effectiveThinkingBudget, step);
        send({
          type: 'ADAPTIVE_COT_STATE',
          payload: {
            threadId: thread!.id,
            stepIndex: step,
            budget: effectiveThinkingBudget,
            reasoningEffort: orchestratorStep ? orchestratorStep.reasoningEffort : adaptiveCot.reasoningEffort,
            reasoningBudgetTokens: orchestratorStep
              ? orchestratorStep.reasoningBudgetTokens
              : adaptiveCot.reasoningBudgetTokens,
            modeLabel: isComfyStudioTurn
              ? effectiveCompanionBrain === 'ollama_vision'
                ? `ComfyUI Studio • ollama:${effectiveOllamaModel}`
                : `ComfyUI Studio • ${effectiveCompanionBrain}`
              : orchestratorStep
                ? orchestratorStep.modeLabel
                : adaptiveCot.modeLabel,
            timestamp: Date.now(),
          },
        });
        send({
          type: 'THOUGHT_STREAM',
          payload: {
            session_id: thread!.id,
            thread_id: thread!.id,
            message_id: assistantMsg.id,
            chunk: step > 1 ? `\n\n[Step ${step} (${adaptiveCot.modeLabel})]: ` : '',
            elapsed_ms: Date.now() - turnStartMs,
            token_count: cumulativeThinkingTokens,
            is_finished: false,
          },
        });

        const compactThreshold =
          brainProviderCfg.provider === 'google_ai_studio' && params.tier === 'high' ? 140000 : 42000;
        const compactRes = autoCompactMessages(chatMessages, compactThreshold, 6);
        if (compactRes.didCompact) {
          chatMessages.splice(0, chatMessages.length, ...compactRes.messages);
          send({
            type: 'CONTEXT_COMPACTED',
            payload: {
              threadId: thread!.id,
              previousTokens: compactRes.previousTokens,
              compactedTokens: compactRes.compactedTokens,
              compactedTurnCount: compactRes.compactedTurnCount,
              summary: compactRes.summary,
              timestamp: Date.now(),
            },
          });
        }

        emitPhase(
          'prefilling',
          step === 1 ? 'Processing prompt...' : `Evaluating tool outputs (Step ${step}/${MAX_TOOL_STEPS})...`
        );
        const result = await runInferenceStep({
          tier: params.tier,
          thinkingBudget: effectiveThinkingBudget,
          stepIndex: step,
          hadToolError: lastStepHadToolError,
          messages: compactRes.messages,
          tools: activeTools,
          abortSignal: abortController.signal,
          onToolCallPreparing: (toolName) => {
            closeThinking();
            emitPhase('preparing_tool_call', toolName ? `Preparing tool call: ${toolName}...` : 'Preparing tool call...');
          },
          onThoughtDelta: (delta, elapsedMs) => {
            emitPhase('thinking', `Thinking (Step ${step}/${MAX_TOOL_STEPS})...`);
            cumulativeThinkingTokens += Math.max(1, Math.ceil(delta.length / 4));
            lastThinkingMs = elapsedMs;
            const liveTokPerSec =
              tabby.getTelemetry().tokensPerSec ||
              Number((cumulativeThinkingTokens / Math.max(0.08, elapsedMs / 1000)).toFixed(1));
            db.appendThoughtDelta(assistantMsg.id, thread!.id, delta, elapsedMs, cumulativeThinkingTokens);
            send({
              type: 'THOUGHT_STREAM',
              payload: {
                session_id: thread!.id,
                thread_id: thread!.id,
                message_id: assistantMsg.id,
                chunk: delta,
                elapsed_ms: elapsedMs,
                token_count: cumulativeThinkingTokens,
                tokens_per_sec: liveTokPerSec,
                is_finished: false,
              },
            });
          },
          onTokenDelta: (delta, _tokenCount, measuredTokPerSec) => {
            closeThinking();
            if (isFinalStep && hasExecutedTools) emitPhase('synthesizing_final_prose', 'Synthesizing final response...');
            else emitPhase('streaming_prose', 'Writing response...');
            cumulativeOutputTokens += Math.max(1, Math.ceil(delta.length / 4));
            const liveTokPerSec =
              measuredTokPerSec ||
              tabby.getTelemetry().tokensPerSec ||
              Number((cumulativeOutputTokens / Math.max(0.08, (Date.now() - turnStartMs) / 1000)).toFixed(1));
            db.appendTokenDelta(assistantMsg.id, thread!.id, delta, cumulativeOutputTokens);
            send({
              type: 'TOKEN_STREAM',
              payload: {
                session_id: thread!.id,
                thread_id: thread!.id,
                message_id: assistantMsg.id,
                chunk: delta,
                output_tokens: cumulativeOutputTokens,
                tokens_per_sec: liveTokPerSec,
                is_finished: false,
              },
            });
          },
          onToolCallRequest: isFinalStep
            ? undefined
            : async (toolName, toolArgs) => {
                closeThinking();
                hasExecutedTools = true;
                usedToolsInTurn.add(toolName);
                db.updateThread(thread!.id, { status: 'executing_tool' });
                const cmdFormatted = `${toolName}(${JSON.stringify(toolArgs)})`;
                const toolExec = db.createToolExecution({
                  message_id: assistantMsg.id,
                  thread_id: thread!.id,
                  tool_name: toolName,
                  mcp_server: toolName.startsWith('mcp_') ? 'mcp' : null,
                  arguments_json: JSON.stringify(toolArgs),
                });

                emitPhase('executing_tools', `Running ${toolName}...`, { active_tool_id: toolExec.id });
                send({
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

                if (emitSubagentEvents) {
                  send({
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
                      summary: `Step ${step}: ${toolName}(${toolArgs.path || toolArgs.command || toolArgs.url || ''})`.slice(0, 90),
                      timestamp: Date.now(),
                    },
                  });
                }

                try {
                  const execResult = await tools.executeTool(toolName, toolArgs, {
                    abortSignal: abortController.signal,
                    threadId: thread!.id,
                    messageId: assistantMsg.id,
                    workspaceRoot: project.root_path,
                    projectHost: project.host_name || undefined,
                    onStdoutChunk: (chunk) => {
                      send({
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
                      send({
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
                      send({
                        type: 'CHECKPOINT_CREATED',
                        payload: { thread_id: thread!.id, checkpoint },
                      });
                    },
                    onScreenCaptured: (base64Image, windowTitle) => {
                      send({
                        type: 'VISION_CAPTURE',
                        payload: { base64DataUrl: base64Image, activeWindowTitle: windowTitle },
                      });
                    },
                  });

                  const ppcCycle = await harness.recordToolOutcomeAndMaybeRunPPC({
                    workspaceRoot: project.root_path,
                    toolName,
                    command: cmdFormatted,
                    exitCode: execResult.exitCode,
                    stdout: execResult.stdout,
                    stderr: execResult.stderr,
                  });

                  if (ppcCycle) {
                    send({
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

                  send({
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

                  if (abortController.signal.aborted) return;
                  executedToolsThisStep.push({
                    id: toolExec.id,
                    toolName,
                    arguments: toolArgs,
                    output: execResult.stdout || execResult.stderr || 'Success (no output)',
                    screenshotBase64: execResult.screenshotBase64,
                    hadError: finalStatus === 'error',
                  });
                } catch (toolErr: any) {
                  const errStr = toolErr?.message || String(toolErr);
                  db.updateToolExecution(toolExec.id, {
                    stdout_stream: '',
                    stderr_stream: `Tool execution failed: ${errStr}`,
                    exit_code: 1,
                    status: 'error',
                    duration_ms: 0,
                  });
                  send({
                    type: 'TOOL_EVENT',
                    payload: {
                      session_id: thread!.id,
                      thread_id: thread!.id,
                      message_id: assistantMsg.id,
                      tool_execution_id: toolExec.id,
                      tool_name: toolName,
                      command: cmdFormatted,
                      arguments: toolArgs,
                      output: `Tool execution failed: ${errStr}`,
                      exit_code: 1,
                      duration_ms: 0,
                      status: 'error',
                    },
                  });
                  executedToolsThisStep.push({
                    id: toolExec.id,
                    toolName,
                    arguments: toolArgs,
                    output: `Tool error: ${errStr}`,
                    hadError: true,
                  });
                }
              },
        });

        if (abortController.signal.aborted) {
          break;
        }

        const stepText = deduplicateRepeatedSequences((result.content || '').trim());

        if (executedToolsThisStep.length === 0) {
          if (!isFinalStep) {
            const autoCheck = detectPrematureStop(
              stepText,
              hasExecutedTools,
              autoContinueCount,
              MAX_AUTO_CONTINUES,
              promptStr,
              Array.from(usedToolsInTurn)
            );
            if (autoCheck.shouldContinue) {
              autoContinueCount++;
              if (stepText) {
                collectedStepNotes.push(stepText);
              }
              db.resetStreamingMessageContent(assistantMsg.id, committedFinalContent);
              send({
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
              if (emitSubagentEvents) {
                send({
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
              }
              lastStepHadToolError = false;
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

          committedFinalContent = committedFinalContent
            ? `${committedFinalContent}\n\n${stepText}`
            : stepText;
          break;
        }

        if (stepText) {
          collectedStepNotes.push(stepText);
          db.resetStreamingMessageContent(assistantMsg.id, committedFinalContent);
          send({
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
        }

        lastStepHadToolError = executedToolsThisStep.some((t) => Boolean(t.hadError));
        if (executedToolsThisStep.length > 0 && executedToolsThisStep.every((t) => Boolean(t.hadError))) {
          consecutiveErrorSteps++;
        } else {
          consecutiveErrorSteps = 0;
        }
        const currentSig = executedToolsThisStep
          .map((t) => `${t.toolName}:${JSON.stringify(t.arguments)}`)
          .join('|');
        if (currentSig && currentSig === lastToolSignature) {
          repeatedSignatureCount++;
        } else {
          lastToolSignature = currentSig;
          repeatedSignatureCount = 1;
        }

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
          if (t.screenshotBase64) {
            chatMessages.push({
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `[Visual Capture from ${t.toolName}]: Screen captured successfully. Here is the screenshot:`,
                },
                {
                  type: 'image_url',
                  image_url: { url: t.screenshotBase64 },
                },
              ],
            });
          }
        }

        if (!abortController.signal.aborted && step >= MAX_TOOL_STEPS) {
          if (consecutiveErrorSteps >= 4 || repeatedSignatureCount >= 4) {
            hitStuckLoop = true;
            break;
          }
          if (!isLastWindow) {
            stepWindowCount++;
            const windowCompact = autoCompactMessages(chatMessages, 100, 6);
            if (windowCompact.didCompact) {
              chatMessages.splice(0, chatMessages.length, ...windowCompact.messages);
              send({
                type: 'CONTEXT_COMPACTED',
                payload: {
                  threadId: thread!.id,
                  previousTokens: windowCompact.previousTokens,
                  compactedTokens: windowCompact.compactedTokens,
                  compactedTurnCount: windowCompact.compactedTurnCount,
                  summary: windowCompact.summary,
                  timestamp: Date.now(),
                },
              });
            }
            chatMessages.push({
              role: 'user',
              content:
                `[System Auto-Continue • Context Compacted (Window ${stepWindowCount + 1}/${MAX_STEP_WINDOWS})]: ` +
                `Earlier tool outputs were distilled to keep inference fast. Continue executing the remaining steps to complete the user's request.`,
            });
            emitPhase(
              'thinking',
              `Compacted context — continuing automatically (Window ${stepWindowCount + 1}/${MAX_STEP_WINDOWS})...`
            );
            step = 0;
            continue;
          } else {
            hitWindowCap = true;
          }
        }
      }

      if (!abortController.signal.aborted && (hitStuckLoop || (hitWindowCap && hasExecutedTools))) {
        const limitNotice = hitStuckLoop
          ? `\n\n---\n*Paused because the last few tool calls kept repeating or failing. Let me know how you'd like me to proceed or adjust the approach.*`
          : `\n\n---\n*Paused after ${MAX_STEP_WINDOWS} compacted ${MAX_TOOL_STEPS}-step windows (${MAX_STEP_WINDOWS * MAX_TOOL_STEPS} total steps). Send a follow-up message or use \`/goal\` to keep going.*`;
        const cleanBase = committedFinalContent.trim();
        const finalText = cleanBase ? `${cleanBase}${limitNotice}` : limitNotice.trim();
        committedFinalContent = finalText;
        db.resetStreamingMessageContent(assistantMsg.id, finalText);
        send({
          type: 'STEP_NOTE_COMMITTED',
          payload: {
            session_id: thread.id,
            thread_id: thread.id,
            message_id: assistantMsg.id,
            step,
            note: limitNotice.trim(),
            committed_content: finalText,
            is_auto_continue: false,
          },
        });
      }

      if (abortController.signal.aborted) {
        turnOutcome = 'aborted';
        db.finalizeRunningToolExecutions(assistantMsg.id);
        db.finalizeStreamingMessage(assistantMsg.id);
        db.updateThread(thread.id, { status: 'idle' });
        emitPhase('aborted', 'Stopped');
        send({
          type: 'TURN_ABORTED',
          payload: { thread_id: thread.id, session_id: thread.id, turn_id: assistantMsg.id, message_id: assistantMsg.id },
        });
        send({
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
        return;
      }

      if (slashInfo.command === '/plan' && committedFinalContent.trim().length > 40) {
        send({
          type: 'ARTIFACT_SYNC',
          payload: {
            session_id: thread.id,
            artifact_name: 'plan.md',
            content: committedFinalContent,
            version: Date.now(),
          },
        });
      }

      if (!committedFinalContent.trim()) {
        const substantialNote = [...collectedStepNotes].reverse().find((n) => n.trim().length >= 40);
        let fallbackText = substantialNote || '';

        if (!fallbackText && hasExecutedTools && !abortController.signal.aborted) {
          emitPhase('synthesizing_final_prose', 'Synthesizing final response...');
          try {
            const synthMessages = [
              ...chatMessages,
              {
                role: 'user',
                content:
                  'Please summarize the results and provide your complete, clear final answer for the user based on the tool outputs above. Do not call any tools.',
              },
            ];
            const synthResult = await runInferenceStep({
              tier: params.tier,
              thinkingBudget: effectiveThinkingBudget,
              stepIndex: step + 1,
              messages: synthMessages,
              tools: undefined,
              abortSignal: abortController.signal,
              onThoughtDelta: () => {},
              onTokenDelta: (delta) => {
                if (!delta) return;
                cumulativeOutputTokens += Math.max(1, Math.ceil(delta.length / 4));
                db.appendTokenDelta(assistantMsg.id, thread!.id, delta, cumulativeOutputTokens);
                send({
                  type: 'TOKEN_STREAM',
                  payload: {
                    session_id: thread!.id,
                    thread_id: thread!.id,
                    message_id: assistantMsg.id,
                    chunk: delta,
                    output_tokens: cumulativeOutputTokens,
                    tokens_per_sec: tabby.getTelemetry().tokensPerSec,
                    is_finished: false,
                  },
                });
              },
            });
            const synthClean = deduplicateRepeatedSequences((synthResult.content || '').trim());
            if (synthClean) {
              committedFinalContent = synthClean;
            }
          } catch (synthErr) {
            if (!isAbortLikeError(synthErr)) {
              console.error('[PromptTurn] Final synthesis step failed:', synthErr);
            }
          }
        }

        if (!committedFinalContent.trim()) {
          if (!fallbackText && collectedStepNotes.length > 0) {
            fallbackText = collectedStepNotes[collectedStepNotes.length - 1];
          }
          committedFinalContent =
            fallbackText ||
            `Completed all actions across ${step} autonomous step${step === 1 ? '' : 's'}.`;
          cumulativeOutputTokens += Math.max(1, Math.ceil(committedFinalContent.length / 4));
          db.resetStreamingMessageContent(assistantMsg.id, committedFinalContent);
          send({
            type: 'TOKEN_STREAM',
            payload: {
              session_id: thread.id,
              thread_id: thread.id,
              message_id: assistantMsg.id,
              chunk: committedFinalContent,
              output_tokens: cumulativeOutputTokens,
              tokens_per_sec: tabby.getTelemetry().tokensPerSec,
              is_finished: false,
            },
          });
        } else {
          db.resetStreamingMessageContent(assistantMsg.id, committedFinalContent);
        }
      }

      db.finalizeRunningToolExecutions(assistantMsg.id);
      db.finalizeStreamingMessage(assistantMsg.id);
      const updatedThread = db.updateThread(thread.id, { status: 'idle' });

      phaseEmitter.setThinkingFinished(true);
      send({
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

      send({
        type: 'TOKEN_STREAM',
        payload: {
          session_id: thread.id,
          thread_id: thread.id,
          message_id: assistantMsg.id,
          chunk: '',
          output_tokens: cumulativeOutputTokens,
          tokens_per_sec: tabby.getTelemetry().tokensPerSec,
          is_finished: true,
        },
      });

      emitPhase('completed', 'Completed');
      send({
        type: 'TURN_COMPLETED',
        payload: {
          threadId: thread.id,
          turn_id: assistantMsg.id,
          messageId: assistantMsg.id,
          message_id: assistantMsg.id,
          final_content: committedFinalContent,
          active_model: resolvedModelDisplayName,
          brain_provider: brainProviderCfg.provider,
          thread: updatedThread,
        },
      });
    } catch (err: any) {
      if (abortController.signal.aborted || isAbortLikeError(err)) {
        turnOutcome = 'aborted';
        db.finalizeRunningToolExecutions(assistantMsg.id);
        db.finalizeStreamingMessage(assistantMsg.id);
        db.updateThread(thread.id, { status: 'idle' });
        emitPhase('aborted', 'Stopped');
        send({
          type: 'TURN_ABORTED',
          payload: { thread_id: thread.id, session_id: thread.id, turn_id: assistantMsg.id, message_id: assistantMsg.id },
        });
        send({
          type: 'TOKEN_STREAM',
          payload: {
            session_id: thread.id,
            thread_id: thread.id,
            message_id: assistantMsg.id,
            chunk: '',
            output_tokens: 0,
            is_finished: true,
          },
        });
        return;
      }

      turnOutcome = 'error';
      turnErrorMsg = err?.message || String(err);
      db.finalizeRunningToolExecutions(assistantMsg.id);
      db.finalizeStreamingMessage(assistantMsg.id);
      db.updateThread(thread.id, { status: 'error' });
      emitPhase('error', 'Error', { error: turnErrorMsg });
      send({
        type: 'TURN_ERROR',
        payload: {
          threadId: thread.id,
          turn_id: assistantMsg.id,
          messageId: assistantMsg.id,
          error: turnErrorMsg,
        },
      });
    } finally {
      if (emitSubagentEvents) {
        send({
          type: 'SUBAGENT_EVENT',
          payload: {
            id: subagentId,
            role: slashInfo.subagentRole,
            command: slashInfo.command || 'autonomous',
            status: turnOutcome === 'error' ? 'error' : 'completed',
            step: turnStep,
            maxSteps: slashInfo.maxToolSteps,
            summary:
              turnOutcome === 'error'
                ? `Failed: ${turnErrorMsg.slice(0, 120)}`
                : turnOutcome === 'aborted'
                  ? `Stopped at step ${turnStep}`
                  : `Completed in ${turnStep} step${turnStep === 1 ? '' : 's'}`,
            timestamp: Date.now(),
          },
        });
      }
      if (activeAbortControllers.get(thread.id) === abortController) {
        activeAbortControllers.delete(thread.id);
      }
      if (activeTurns?.get(thread.id)?.turn_id === assistantMsg.id) {
        activeTurns.delete(thread.id);
      }
    }
  };
}
