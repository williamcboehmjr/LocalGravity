import type { LocalGravityDB, ModelTier, ThinkingBudget } from '../db/database.js';
import type { TabbyEngine } from '../tabby/tabbyEngine.js';
import { deduplicateRepeatedSequences } from '../tabby/tabbyEngine.js';
import type { McpClientManager } from '../mcp/mcpManager.js';
import type { SkillManager } from '../skills/skillManager.js';
import type { SharedTerminalManager } from '../terminal/terminalManager.js';
import type { BuiltinToolExecutor } from '../tools/builtinTools.js';
import type { Harness2Manager } from '../harness/harnessManager.js';
import { pruneChatMessages } from '../utils/messagePruning.js';
import { autoCompactMessages } from '../utils/autoCompactor.js';
import { computeAdaptiveThinkingConfig } from './adaptiveCot.js';
import { detectPrematureStop } from './prematureStop.js';
import { parseAntigravitySlashCommand } from './slashCommands.js';
import os from 'node:os';
import path from 'node:path';
import { BUILTIN_TOOLS_SCHEMA } from '../tools/builtinTools.js';
import { SWARM_TOOLS_SCHEMA } from '../tools/builtinToolsSchema.js';
import { SwarmManager } from '../swarm/swarmManager.js';
import { EdgeBridgeManager } from '../bridge/edgeBridge.js';
import { SKILL_TOOLS_SCHEMA } from '../skills/skillManager.js';
import type { AttachmentManager, SavedAttachment } from '../files/attachmentManager.js';
import fs from 'node:fs';

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

export function createPromptTurnHandler(deps: PromptTurnDeps) {
  const { db, tabby, mcp, skills, tools, harness, terminal, attachmentManager, broadcastSync, activeAbortControllers, activeTurns, repoRoot } = deps;

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

    // 1. ARM THE TURN FIRST: persist messages, register the stream buffer, mark the thread active and
    //    register the abort controller BEFORE any slow work (attachment saving) so SYNC_STATE / Stop
    //    always see an active turn.
    const savedAttachments: SavedAttachment[] = [];
    const slashInfo = parseAntigravitySlashCommand(params.prompt);
    const effectiveThinkingBudget: ThinkingBudget = slashInfo.forceThinkingBudget || params.thinkingBudget;

    const userMsg = db.createMessage({
      thread_id: thread.id,
      role: 'user',
      content: params.prompt,
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
      status: params.thinkingBudget === 'off' ? 'executing_tool' : 'thinking',
      active_model_tier: params.tier,
      active_thinking_budget: params.thinkingBudget,
    });
    const abortController = new AbortController();
    activeAbortControllers.set(thread.id, abortController);

    // Every broadcast carries thread_id + message_id so clients can filter stale events.
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

    // Canonical server-driven turn phase state machine.
    let phaseSeq = 0;
    let turnStep = 0;
    let turnMaxSteps = slashInfo.maxToolSteps;
    let thinkingFinished = false;
    let lastPhase: TurnPhaseName | null = null;
    let lastPhaseLabel = '';
    let terminalPhaseSent = false;
    const emitPhase = (
      phase: TurnPhaseName,
      statusLabel: string,
      extra: { active_tool_id?: string; error?: string } = {}
    ) => {
      const isActive = !(phase === 'completed' || phase === 'aborted' || phase === 'error');
      if (!isActive) {
        if (terminalPhaseSent) return;
        terminalPhaseSent = true;
      } else if (terminalPhaseSent) {
        return;
      }
      if (phase === lastPhase && statusLabel === lastPhaseLabel && !extra.active_tool_id) return;
      lastPhase = phase;
      lastPhaseLabel = statusLabel;
      const payload: ActiveTurnSnapshot = {
        seq: ++phaseSeq,
        thread_id: thread!.id,
        threadId: thread!.id,
        turn_id: assistantMsg.id,
        message_id: assistantMsg.id,
        phase,
        is_active: isActive,
        step: turnStep,
        max_steps: turnMaxSteps,
        status_label: statusLabel,
        thinking_finished: thinkingFinished,
        ...(extra.active_tool_id ? { active_tool_id: extra.active_tool_id } : {}),
        ...(extra.error ? { error: extra.error } : {}),
        timestamp: Date.now(),
      };
      if (isActive) {
        activeTurns?.set(thread!.id, payload);
      } else if (activeTurns?.get(thread!.id)?.turn_id === assistantMsg.id) {
        activeTurns.delete(thread!.id);
      }
      send({
        type: 'TURN_PHASE',
        payload,
      });
    };

    const brainProviderCfg = tabby.getBrainProviderConfig();
    const resolvedModelDisplayName = tabby.resolveDiskModelName(params.tier);

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
    let turnOutcome: 'completed' | 'aborted' | 'error' = 'completed';
    let turnErrorMsg = '';

    try {
      // Save and ground incoming attachments of any type (images, documents, archives, databases, code)
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
        const attToPersist = savedAttachments.length > 0 ? savedAttachments : (params.attachments || []);
        db.updateMessageAttachments(userMsg.id, attToPersist);
        userMsg.attachments = JSON.stringify(attToPersist);
      }
      const history = db.listMessages(thread.id);
      const userHome = os.homedir().replace(/\\/g, '/');
      const downloadsDir = path.join(os.homedir(), 'Downloads').replace(/\\/g, '/');
      const desktopDir = path.join(os.homedir(), 'Desktop').replace(/\\/g, '/');
      const documentsDir = path.join(os.homedir(), 'Documents').replace(/\\/g, '/');

      // Parse LocalGravity Slash Commands (/goal, /plan, /boost, /grill-me, /teamwork, /browser, /learn, /compact, /schedule)
      // LocalGravity Slash Commands are parsed at the top of the turn (slashInfo / effectiveThinkingBudget).

      // Special fast-path for /compact command
      if (params.prompt.trim().toLowerCase().startsWith('/compact')) {
        const msgCount = history.length;
        const mockMsgs = history.map((m) => ({
          role: m.role,
          content:
            m.content +
            (Array.isArray(m.tool_executions) && m.tool_executions.length > 0
              ? "\n" + m.tool_executions.map((t) => `[Tool ${t.tool_name}]: ${(t.stdout_stream || t.stderr_stream || "").slice(0, 600)}`).join("\n")
              : ""),
        }));
        const cRes = autoCompactMessages(mockMsgs, 100, 4);
        const prunedCount = db.compactThreadMessages(thread.id, 6, cRes.summary);
        const summaryNote =
          `✅ **Context Compacted (/compact)**\n\n` +
          `Compacted **${msgCount}** historical messages in thread **${thread.title}** (${cRes.previousTokens} → ${cRes.compactedTokens} est. tokens, pruned ${prunedCount} older turns into Working Memory).\n` +
          `Older intermediate tool outputs and verbose turns have been distilled into a compact Working Memory Snapshot so the full **${params.tier.toUpperCase()}** context window is fresh and ready.`;
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

      const edgeBridge = EdgeBridgeManager.getInstance();
      const remoteClient = project.host_name
        ? edgeBridge.getClientByHost(project.host_name)
        : edgeBridge.getRemoteClientForThread(thread.id);
      const remoteHostNote = remoteClient
        ? `\n[REMOTE HOST BRIDGE ACTIVE]: File and terminal tools in this turn execute natively on the connected client host "${remoteClient.hostname}" (${remoteClient.platform}${remoteClient.homeDir ? `, home: "${remoteClient.homeDir}"` : ''}). Any local paths or run_terminal commands (including Python, Node, PowerShell, etc.) run directly on "${remoteClient.hostname}".` +
          (remoteClient.platform.toLowerCase().includes('android')
            ? `\n[ANDROID HOST NOTE]: Shared storage (~ and default workspace root) is "/storage/emulated/0" ("/sdcard"), containing DCIM, Pictures, Download, Documents, etc. The true Android OS version is already reported above via getprop ro.build.version.release (do not confuse "uname -r" GKI kernel branch names like "android15" with the Android OS release).`
            : '') +
          `\n`
        : project.host_name && edgeBridge.isRemoteHost(project.host_name)
          ? `\n[REMOTE HOST OFFLINE]: This project belongs to "${project.host_name}", which is currently offline. Do not attempt local file or terminal operations on the Central Brain host.\n`
          : '';

      const engineDirectiveLine =
        brainProviderCfg.provider === 'google_ai_studio'
          ? `- Active Brain Inference Provider: Google AI Studio API (${resolvedModelDisplayName}) — orchestrated by LocalGravity Central Brain without local Strata GPU.`
          : `- Strata Engine: Active on port 8080 serving "Swift 1.5 Flash-Next" (IQ2_XS + Vision) with 65,536 context, spec=6, and multimodal vision projector mmproj-Qwen3.8-Flash-Next-BF16.gguf! Input modalities: ["text", "image"].\n` +
            `- Strata Root: "${path.join(process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local'), 'Strata').replace(/\\/g, '/')}" (engine binaries in components/engine/, launch profiles in install/, serve/server.py)\n` +
            `- Local Models Directory: "E:/Models/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS" (holds main GGUFs and mmproj projector)`;

      const systemDirective =
        `You are LocalGravity, an autonomous AI engineering assistant running directly on the user's workstation.\n` +
        `Active Workspace: ${project.name} (${project.root_path}) [branch: ${project.git_branch}]\n` +
        remoteHostNote +
        `Workstation Paths:\n` +
        `- User Folders: Home="${userHome}", Downloads="${downloadsDir}", Desktop="${desktopDir}", Documents="${documentsDir}"\n` +
        `${engineDirectiveLine}\n\n` +
        `=== UNRESTRICTED SYSTEM ACCESS & AUTONOMOUS TOOL SUITE ===
=== WEB SEARCH MANDATE: NEVER BE SHY ABOUT SEARCHING ===
1. SEARCH THE WEB FIRST: Never be shy about searching! The live internet is your fastest and most reliable path whenever you do not know something, are not 100% certain of exact details, need current documentation, or encounter an unfamiliar problem.
2. EMPIRICAL KNOWLEDGE OVER GUESSING: If asked about any question, command, API, library, menu item, price, error code, or topic you aren't completely certain about, IMMEDIATELY call "search_web". A fast search eliminates hallucinations and gives you exact, authoritative real-world facts in under a second.
3. NO ARTIFICIAL BOUNDARIES: You have full, unrestricted live web access via search_web. Never apologize, never claim lack of real-time info, and never claim you cannot browse. Call "search_web" proactively on any turn!
=== AUTONOMOUS SEARCH & DOCUMENT INVESTIGATION MANDATE ===
1. PROACTIVE WEB SEARCH: Do not hesitate to call "search_web"! When the user asks about how to scan, convert, extract, or parse unfamiliar file types, or when an error or missing tool is encountered, IMMEDIATELY call "search_web" to find the best CLI, Python package, or technique. As an elite coding agent, you ALWAYS search first rather than guessing or claiming inability.
2. SCANNED DOCUMENTS & PDF MENUS: When a PDF contains scanned photos or images (like a drink menu, receipt, or screenshot), standard text extraction will be empty or incomplete because the text is in pixels. ALWAYS call "inspect_document" to extract the embedded raster images to disk. Once extracted, you or Strata Vision can analyze every drink, price, and word on the image!
3. EMPIRICAL FIRST: Proactively investigate using search_web, find_files, inspect_document, and run_terminal before reporting back to the user.\n` +
        `1. FULL WORKSTATION ACCESS: You have complete, unrestricted access to the entire computer and local filesystem. NEVER claim lack of permission.\n` +
        `2. MULTIMODAL VISION IS FULLY ACTIVE: Strata has the vision projector loaded right now. You CAN analyze images, screenshots, and visual inputs. NEVER claim vision is missing or that you lack a vision tower!\n` +
        `3. VISION VERIFICATION: When the user asks about vision, fixing vision, or testing vision, IMMEDIATELY call inspect_models(action="test_vision") or manage_strata(action="test_vision") to demonstrate live multimodal perception on port 8080.
4. SELF-RESTART: When asked to restart, reload, or recycle LocalGravity after code edits or configuration changes, call the "restart_brain" tool. The Windows Tray supervisor will immediately reboot the Central Brain in 500ms.
5. AUTONOMOUS DIAGNOSTICS: To inspect system, engine, or supervisor logs, use "read_system_logs" (target="strata" or "tray") to diagnose issues empirically without guessing.
6. RICH TOOL BELT: You have 22 native workstation tools:
   - Models & Engine: inspect_models (query Strata health/models, active launch config, test vision live, or restart Strata), manage_strata, restart_brain, read_system_logs, inspect_system (Nvidia GPU VRAM/temp, listening ports, process finder)\n` +
        `   - Models & Engine: inspect_models (query Strata health/models, active launch config, test vision live, or restart Strata), inspect_system (Nvidia GPU VRAM/temp, listening ports, process finder)\n` +
        `   - Code & Navigation: code_outline (rapid symbol map), read_file (full context), write_file, apply_diff, search_codebase, find_files (wildcard file finder)\n` +
        `   - Web & Models: search_web (live DuckDuckGo), search_models (Hugging Face Hub & repo tree), download_file (streaming file/model downloader), browser_inspect\n` +
        `   - Configuration & System: patch_json (safe deep JSON updater), manage_files (stat, copy, move, delete), http_request (REST API client), run_terminal (interactive shell)\n` +
        `   - Vision Grounding: capture_screen, inspect_window\n` +
        `4. EMPIRICAL VERIFICATION BEFORE CLAIMING: Before claiming any file, model, or vision feature is missing or broken, ALWAYS run inspect_models, find_files, or manage_files to check actual disk state and engine status. NEVER guess or hallucinate.\n` +
        `5. AUTONOMOUS INVESTIGATION: When asked to fix, configure, or enhance local models, vision, tools, or workstation services, DO NOT stall, ask for repo names, or ask the user for technical inputs that you can discover yourself. Autonomously research missing files or errors, inspect local configs, apply necessary edits or downloads, and verify end-to-end before delivering your response.\n` +
        `6. EXECUTE END-TO-END WITHOUT ASKING PERMISSION: When the user's prompt already asks you to fix, implement, build, finish, or release something, DO NOT stop midway to ask "Want me to implement this?", "Should I proceed?", or "Would you like me to fix it?". Execute the full workflow autonomously, verify builds/tests, and only then present your concise final summary.\n\n` +
        `=== NATIVE COUNTDOWN TIMERS, BACKGROUND TASKS, SUBAGENTS & ARTIFACTS (v2.2) ===\n` +
    `- SCHEDULED TIMERS: When the user asks to test or set a timer or countdown, IMMEDIATELY call the "schedule" tool (e.g. schedule(durationSeconds=15, prompt="Timer test complete!", title="Test Timer")). NEVER try to spin up a Python HTTP server or write HTML to test a timer — the "schedule" tool automatically renders a live animated SVG countdown ring in the top header bar over WebSocket!\n` +
    `- BACKGROUND TASKS: Use "manage_task" (action="start" | "list" | "status" | "kill") to run or inspect long-running background commands.\n` +
    `- SUBAGENTS: Use "invoke_subagent" to delegate codebase research or file scanning to an isolated subagent worker.\n` +
    `- ARTIFACTS: Use "write_artifact" (type="plan" | "walkthrough" | "report") to publish structured markdown directly into the Right Rail Artifacts drawer.\n\n` +
    `=== AUTONOMOUS SELF-BUILDING & SELF-EVOLUTION PLAYBOOK ===\n` +
        `You are LocalGravity: an autonomous self-evolving AI engineering platform. You have FULL permission, capability, and tools to build new features, enhance UI/UX, fix bugs, and publish releases directly to GitHub so the user can hit "Check for Updates" to install your new features immediately!\n\n` +
        `1. THE LAW OF SELF-PRESERVATION (ZERO ENGINE DISRUPTION):\n` +
        `   - NEVER call "manage_strata" with restart or terminate ports 8080/3390 while writing or testing code. Strata is your active inference brain. Restarting it dumps 33GB of VRAM and halts your thought process. Only use manage_strata if the user explicitly asks to restart the engine.\n\n` +
        `2. ARCHITECTURE MAP (WHERE FEATURES LIVE):\n` +
        `   - Frontend / GUI / UX ("client/src/"):\n` +
        `     * "client/src/components/center-canvas/PromptBar.tsx" -> Prompt input, model selectors, action buttons, thinking toggles.\n` +
        `     * "client/src/components/left-rail/NodeStatusBadge.tsx" -> Header status pills, VRAM badge, connection status, latency, auto-reconnect timers.\n` +
        `     * "client/src/components/left-rail/SettingsModal.tsx" -> Settings modal, updates, endpoints, keyboard shortcuts.\n` +
        `     * "client/src/components/center-canvas/ChatCanvas.tsx" -> Message feed, chat turns, code blocks, diff views.\n` +
        `     * "client/src/App.tsx" -> Main layout, connection recovery, global state wiring.\n` +
        `     * Vite HMR: When you edit any file in "client/src/", Vite hot-reloads it instantly in the user's browser without restarting the server!\n` +
        `   - Backend / Central Brain ("server/src/"):\n` +
        `     * "server/src/tools/" -> Native workstation tools and tool registry.\n` +
        `     * "server/src/agent/promptTurn.ts" -> Agent turns, system prompts, tool loop execution.\n` +
        `     * "server/src/index.ts" -> Fastify routes, WebSocket multiplexer, telemetry.\n\n` +
        `3. THE 4-STEP SELF-BUILD PROTOCOL:\n` +
        `   - Step 1: Read the target component using "read_file" to inspect existing props, JSX, and imports.\n` +
        `   - Step 2: Make the precise edit using "write_file" or "apply_diff".\n` +
        `   - Step 3: MANDATORY BUILD CHECK: Run "run_terminal" with "npm --prefix client run build" (for UI) or "npm --prefix server run build" (for backend). Confirm compilation exits with code 0! If it errors, inspect the error and fix it.\n` +
        `   - Step 4: AUTONOMOUS RELEASE & PUBLISH: When you complete a requested feature or fix and the user wants a release/update, call the "publish_release" tool (e.g. bump="patch", notes="Added feature X to UI"). It automates Windows MSI building, macOS DMG signing, latest.json generation, Git push, and GitHub Release creation!\n` +
        `   - Step 5: ANNOUNCE: Once published, announce to the user: "Release vX.Y.Z is live on GitHub! You can now hit 'Check for Updates' in your macOS or Windows app to auto-install it right now!"\n\n` +
        skills.buildSkillsPromptSection() + '\n\n' +
        (mcp.getServerInstructionsBlock() ? `${mcp.getServerInstructionsBlock()}\n\n` : '') +
        (slashInfo.modeDirective ? `${slashInfo.modeDirective}\n\n` : '') +
        `=== HARNESS² 8-COMPONENT CONTEXT ===\n${compiledHarness}\n` +
        (project.custom_instructions ? `Custom Instructions: ${project.custom_instructions}\n` : '');

      const historyMessages = history
        .filter((m) => m.id !== assistantMsg.id)
        .slice(-14)
        .map((m, idx, arr) => {
          const rawContent =
            idx === arr.length - 1 && m.role === 'user' && slashInfo.command ? slashInfo.cleanPrompt : m.content;
          let attachments: any[] = [];
          if (m.attachments) {
            try {
              attachments = typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments;
            } catch {}
          }
          if (idx === arr.length - 1 && (!attachments || attachments.length === 0) && savedAttachments.length > 0) {
            attachments = savedAttachments;
          }

          if (m.role === 'user' && Array.isArray(attachments) && attachments.length > 0) {
            // Build rich workstation file grounding section
            let fileGrounding = '\n\n=== ATTACHED WORKSTATION FILES & METADATA ===\n';
            attachments.forEach((att: any, fIdx: number) => {
              const fNum = fIdx + 1;
              const fName = att.name || `file_${fNum}`;
              const fPath = (att.savedPath || '').replace(/\\/g, '/');
              const fSize = att.sizeHuman || (att.size ? `${att.size} bytes` : 'unknown size');
              const fType = att.type || 'unknown type';
              const fSha = att.sha256 ? ` (SHA-256: ${att.sha256})` : '';
              const meta = att.metadata || {};

              fileGrounding += `[File ${fNum}] ${fName}\n`;
              if (fPath) fileGrounding += `- Workstation Local Path: "${fPath}"\n`;
              fileGrounding += `- Size: ${fSize}${fSha}\n`;
              fileGrounding += `- MIME Type: ${fType}\n`;
              if (meta.width && meta.height) {
                fileGrounding += `- Dimensions: ${meta.width} x ${meta.height} px\n`;
              }
              if (meta.exif && Object.keys(meta.exif).length > 0) {
                fileGrounding += `- EXIF Camera/Capture Metadata: ${JSON.stringify(meta.exif)}\n`;
              }
              if (meta.lineCount !== undefined) {
                fileGrounding += `- Text Lines: ${meta.lineCount}, Characters: ${meta.characterCount}\n`;
              }
              if (meta.previewSnippet) {
                fileGrounding += `- Text Preview Snippet:\n[PREVIEW START]\n` + String(meta.previewSnippet || "").slice(0, 400) + `\n[PREVIEW END]\n`;
              }
              fileGrounding += `(Saved on workstation disk. You can read, inspect with inspect_file_metadata, or execute tools on this file directly.)\n\n`;
            });

            const fullUserText = (rawContent || 'Please analyze the attached files.').trim() + fileGrounding;

            // Multimodal vision parts (for Strata port 8080)
            const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
              { type: 'text', text: fullUserText },
            ];

            for (const att of attachments) {
              // Also check for embedded images extracted from PDFs (e.g. photos of drink menus)
              if (att.metadata?.extractedImages && Array.isArray(att.metadata.extractedImages)) {
                for (const emb of att.metadata.extractedImages) {
                  const embUrl = emb.url || (emb.savedPath && fs.existsSync(emb.savedPath)
                    ? `data:image/jpeg;base64,${fs.readFileSync(emb.savedPath).toString('base64')}`
                    : undefined);
                  if (embUrl) {
                    contentParts.push({
                      type: 'image_url',
                      image_url: { url: embUrl },
                    });
                  }
                }
              }

              const isImg =
                att.isImage ||
                (typeof att === 'string' && att.startsWith('data:image/')) ||
                (typeof att?.type === 'string' && att.type.startsWith('image/'));

              if (isImg) {
                let imgUrl = typeof att === 'string' ? att : att.base64DataUrl || att.dataUrl;
                if (!imgUrl && att.savedPath && fs.existsSync(att.savedPath)) {
                  try {
                    const buf = fs.readFileSync(att.savedPath);
                    const ext = (path.extname(att.savedPath) || '.jpg').toLowerCase();
                    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
                    imgUrl = `data:${mime};base64,${buf.toString('base64')}`;
                  } catch {}
                }
                if (typeof imgUrl === 'string' && (imgUrl.startsWith('data:image/') || imgUrl.startsWith('http://') || imgUrl.startsWith('https://'))) {
                  contentParts.push({
                    type: 'image_url',
                    image_url: { url: imgUrl },
                  });
                }
              }
            }

            if (contentParts.length > 1) {
              return {
                role: m.role,
                content: contentParts,
              };
            }
            return {
              role: m.role,
              content: fullUserText,
            };
          }

          return {
            role: m.role,
            content: rawContent,
          };
        });

      const chatMessages: Array<{ role: string; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [
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
      const turnStartMs = Date.now();
      let hasExecutedTools = false;
      let committedFinalContent = '';
      const collectedStepNotes: string[] = [];

      // Broadcast active subagent start to Overview drawer
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

      while (step < MAX_TOOL_STEPS) {
        step++;
        turnStep = step;
        turnMaxSteps = MAX_TOOL_STEPS;
        thinkingFinished = false;
        let stepThinkingClosed = false;
        const closeThinking = () => {
          if (stepThinkingClosed) return;
          stepThinkingClosed = true;
          thinkingFinished = true;
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
        const isFinalStep = step === MAX_TOOL_STEPS;
        const executedToolsThisStep: Array<{
          id: string;
          toolName: string;
          arguments: any;
          output: string;
          screenshotBase64?: string;
        }> = [];

        // On the final step, omit tools so the model must provide its final text synthesis
        const includeSwarmBoardTools =
          slashInfo.command === '/swarm' || SwarmManager.getInstance().hasActiveSwarm(thread.id);
        const activeTools = isFinalStep
          ? undefined
          : [
              ...BUILTIN_TOOLS_SCHEMA,
              ...(includeSwarmBoardTools ? SWARM_TOOLS_SCHEMA : []),
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

        const adaptiveCot = computeAdaptiveThinkingConfig(effectiveThinkingBudget, step);
        send({
          type: 'ADAPTIVE_COT_STATE',
          payload: {
            threadId: thread!.id,
            stepIndex: step,
            budget: effectiveThinkingBudget,
            reasoningEffort: adaptiveCot.reasoningEffort,
            reasoningBudgetTokens: adaptiveCot.reasoningBudgetTokens,
            modeLabel: adaptiveCot.modeLabel,
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

        const compactThreshold = params.tier === 'high' ? 140000 : 54000;
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
        const result = await tabby.streamChatCompletion({
          tier: params.tier,
          thinkingBudget: effectiveThinkingBudget,
          stepIndex: step,
          messages: compactRes.messages,
          tools: activeTools,
          abortSignal: abortController.signal,
          onToolCallPreparing: (toolName) => {
            closeThinking();
            emitPhase('preparing_tool_call', toolName ? `Preparing tool call: ${toolName}...` : 'Preparing tool call...');
          },
          onThoughtDelta: (delta, elapsedMs, tokenCount) => {
            emitPhase('thinking', `Thinking (Step ${step}/${MAX_TOOL_STEPS})...`);
            cumulativeThinkingTokens += Math.max(1, Math.ceil(delta.length / 4));
            lastThinkingMs = elapsedMs;
            const liveTokPerSec = tabby.getTelemetry().tokensPerSec || Number((cumulativeThinkingTokens / Math.max(0.08, elapsedMs / 1000)).toFixed(1));
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
          onTokenDelta: (delta, tokenCount, measuredTokPerSec) => {
            closeThinking();
            if (isFinalStep && hasExecutedTools) emitPhase('synthesizing_final_prose', 'Synthesizing final response...');
            else emitPhase('streaming_prose', 'Writing response...');
            cumulativeOutputTokens += Math.max(1, Math.ceil(delta.length / 4));
            const liveTokPerSec = measuredTokPerSec || tabby.getTelemetry().tokensPerSec || Number((cumulativeOutputTokens / Math.max(0.08, (Date.now() - turnStartMs) / 1000)).toFixed(1));
            db.appendTokenDelta(assistantMsg.id, thread!.id, delta, cumulativeOutputTokens);
            // If this is step > 1 and no thoughts arrived yet, mark thinking as finished once text tokens start
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
          onToolCallRequest: isFinalStep ? undefined : async (toolName, toolArgs) => {
            closeThinking();
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
                summary: `Step ${step}: ${toolName}(${ toolArgs.path || toolArgs.command || toolArgs.url || '' })`.slice(0, 90),
                timestamp: Date.now(),
              },
            });

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
              });
            }
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
        // Always commit intermediate step prose as a step segment boundary so the client can render
        // Antigravity's interleaved Working -> Prose -> Working -> Prose layout cleanly.
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
                  image_url: {
                    url: t.screenshotBase64,
                  },
                },
              ],
            });
          }
        }
      }

      // Early exit if aborted during tool execution or token generation
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

      // If /plan was used, automatically sync the generated plan to the Plan Workbench
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

      // Fallback / synthesis if loop ended with empty user-facing prose
      if (!committedFinalContent.trim()) {
        // Prefer promoting the last substantial step note if available
        const substantialNote = [...collectedStepNotes].reverse().find((n) => n.trim().length >= 40);
        let fallbackText = substantialNote || '';

        // If tools ran but we have no substantial prose yet, run a 1-step tool-free synthesis
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
            const synthResult = await tabby.streamChatCompletion({
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
            console.error('[PromptTurn] Final synthesis step failed:', synthErr);
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

      thinkingFinished = true;
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
      if (
        abortController.signal.aborted ||
        err?.name === 'AbortError' ||
        err?.message?.toLowerCase().includes('abort')
      ) {
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
      send({
        type: 'SUBAGENT_EVENT',
        payload: {
          id: subagentId,
          role: slashInfo.subagentRole,
          command: slashInfo.command || 'autonomous',
          status: turnOutcome === 'error' ? 'error' : 'completed',
          step: turnStep,
          maxSteps: turnMaxSteps,
          summary:
            turnOutcome === 'error'
              ? `Failed: ${turnErrorMsg.slice(0, 120)}`
              : turnOutcome === 'aborted'
              ? `Stopped at step ${turnStep}`
              : `Completed in ${turnStep} step${turnStep === 1 ? '' : 's'}`,
          timestamp: Date.now(),
        },
      });
      if (activeAbortControllers.get(thread.id) === abortController) {
        activeAbortControllers.delete(thread.id);
      }
      if (activeTurns?.get(thread.id)?.turn_id === assistantMsg.id) {
        activeTurns.delete(thread.id);
      }
    }
  };
}

