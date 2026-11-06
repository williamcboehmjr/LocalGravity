import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';

import {
  allocateRuntimePorts,
  RuntimePortsConfig,
  isPortForbidden,
} from './portAllocator.js';
import {
  LocalGravityDB,
  ModelTier,
  ThinkingBudget,
} from './db/database.js';
import {
  TabbyEngine,
  TIER_SPECS,
} from './tabby/tabbyEngine.js';
import { McpClientManager } from './mcp/mcpManager.js';
import { SharedTerminalManager } from './terminal/terminalManager.js';
import {
  BuiltinToolExecutor,
  BUILTIN_TOOLS_SCHEMA,
} from './tools/builtinTools.js';
import {
  Harness2Manager,
  getClientAppDataDir,
} from './harness/harnessManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export interface DaemonContext {
  app: FastifyInstance;
  ports: RuntimePortsConfig;
  db: LocalGravityDB;
  tabby: TabbyEngine;
  mcp: McpClientManager;
  terminal: SharedTerminalManager;
  tools: BuiltinToolExecutor;
  harness: Harness2Manager;
  broadcastSync: (event: Record<string, any>) => void;
}

function queryHostHardwareTelemetry(activeTier: ModelTier): {
  vramUsedGb: number;
  vramTotalGb: number;
  vramPercent: number;
  hostRamUsedGb: number;
  hostRamTotalGb: number;
  hostRamPercent: number;
  gpuUtilization: number;
  cpuUtilization: number;
} {
  const totalMemGb = Number((os.totalmem() / 1024 ** 3).toFixed(1));
  const freeMemGb = Number((os.freemem() / 1024 ** 3).toFixed(1));
  const usedMemGb = Number((totalMemGb - freeMemGb).toFixed(1));
  const hostRamPercent = Math.round((usedMemGb / Math.max(1, totalMemGb)) * 100);

  let vramTotalGb = 16.0;
  let vramUsedGb = TIER_SPECS[activeTier].estimatedVramGb;
  let gpuUtil = 12;

  try {
    const smi = execSync(
      'nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits',
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 800 }
    )
      .toString()
      .trim()
      .split('\n')[0];
    if (smi) {
      const [usedMb, totalMb, util] = smi.split(',').map((s) => Number(s.trim()));
      if (!Number.isNaN(usedMb) && !Number.isNaN(totalMb) && totalMb > 0) {
        vramUsedGb = Number((usedMb / 1024).toFixed(1));
        vramTotalGb = Number((totalMb / 1024).toFixed(1));
        gpuUtil = Number.isNaN(util) ? 12 : util;
      }
    }
  } catch {
    // Use estimated tier VRAM on systems where nvidia-smi isn't in PATH
  }

  return {
    vramUsedGb,
    vramTotalGb,
    vramPercent: Math.round((vramUsedGb / Math.max(1, vramTotalGb)) * 100),
    hostRamUsedGb: usedMemGb,
    hostRamTotalGb: totalMemGb,
    hostRamPercent,
    gpuUtilization: gpuUtil,
    cpuUtilization: Math.min(100, Math.max(4, Math.round(os.loadavg()[0] * 10) || 14)),
  };
}

function pruneChatMessages(messages: Array<{ role: string; content: string; [k: string]: any }>, maxTotalChars = 65000) {
  const pruned = messages.map(m => ({ ...m }));

  // Strict Jinja / ChatML normalization:
  // Ensure that ONLY index 0 can be role === 'system'. If any other message has role: 'system', merge it into pruned[0]
  if (pruned.length > 0 && pruned[0].role !== 'system') {
    for (let i = 1; i < pruned.length; i++) {
      if (pruned[i].role === 'system') {
        pruned[i].role = 'user';
      }
    }
  } else if (pruned.length > 0) {
    for (let i = 1; i < pruned.length; i++) {
      if (pruned[i].role === 'system') {
        pruned[0].content += '\n\n' + pruned[i].content;
        pruned.splice(i, 1);
        i--;
      }
    }
  }

  // Protect the most recent step's tool outputs (last 4 messages) so the model ALWAYS sees the full output of tools it just called!
  const recentProtectedBoundary = Math.max(1, pruned.length - 4);

  let total = pruned.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  if (total <= maxTotalChars) return pruned;

  // Stage 1: Compact older historical tool outputs (from 2+ steps ago)
  for (let i = 1; i < recentProtectedBoundary && total > maxTotalChars; i++) {
    if (pruned[i].role === 'tool' && pruned[i].content && pruned[i].content.length > 1800) {
      const reduction = pruned[i].content.length - 1400;
      pruned[i].content =
        pruned[i].content.slice(0, 1000) +
        '\n... [Historical step output compacted after analysis] ...\n' +
        pruned[i].content.slice(-400);
      total -= reduction;
    }
  }

  if (total <= maxTotalChars) return pruned;

  // Stage 2: More aggressive compaction on older historical tool outputs (3+ steps ago)
  for (let i = 1; i < recentProtectedBoundary && total > maxTotalChars; i++) {
    if (pruned[i].role === 'tool' && pruned[i].content && pruned[i].content.length > 600) {
      const reduction = pruned[i].content.length - 500;
      pruned[i].content =
        pruned[i].content.slice(0, 350) +
        '\n... [Completed historical step compacted] ...\n' +
        pruned[i].content.slice(-150);
      total -= reduction;
    }
  }

  if (total <= maxTotalChars) return pruned;

  // Stage 3: Only if even the protected recent tool outputs alone exceed budget (e.g., 4 parallel 24k reads), cap individual protected tool outputs at 18,000 chars
  for (let i = recentProtectedBoundary; i < pruned.length && total > maxTotalChars; i++) {
    if (pruned[i].role === 'tool' && pruned[i].content && pruned[i].content.length > 18000) {
      const reduction = pruned[i].content.length - 16000;
      pruned[i].content =
        pruned[i].content.slice(0, 11500) +
        '\n... [Middle lines omitted for context budget] ...\n' +
        pruned[i].content.slice(-4500);
      total -= reduction;
    }
  }

  if (total <= maxTotalChars) return pruned;

  // Stage 4: Drop oldest historical turns from index 1 while preserving valid assistant/tool pairs
  while (pruned.length > 4 && total > maxTotalChars) {
    const item = pruned[1];
    if (item.role === 'user' || (item.role === 'assistant' && !item.tool_calls)) {
      const dropped = pruned.splice(1, 1)[0];
      total -= (dropped.content?.length || 0);
    } else if (item.role === 'assistant' && item.tool_calls) {
      const dropped = pruned.splice(1, 1)[0];
      total -= (dropped.content?.length || 0);
      while (pruned.length > 1 && (pruned[1] as any).role === 'tool') {
        const droppedTool = pruned.splice(1, 1)[0];
        total -= (droppedTool.content?.length || 0);
      }
    } else {
      const dropped = pruned.splice(1, 1)[0];
      total -= (dropped.content?.length || 0);
    }
  }

  return pruned;
}

interface SlashCommandParseResult {
  command: string | null;
  cleanPrompt: string;
  modeDirective: string;
  maxToolSteps: number;
  maxAutoContinues: number;
  forceThinkingBudget?: ThinkingBudget;
  subagentRole: string;
}

function parseAntigravitySlashCommand(rawPrompt: string): SlashCommandParseResult {
  const trimmed = rawPrompt.trim();
  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return {
      command: null,
      cleanPrompt: rawPrompt,
      modeDirective: '',
      maxToolSteps: 32,
      maxAutoContinues: 6,
      subagentRole: 'Autonomous Engineer',
    };
  }

  const cmd = match[1].toLowerCase();
  const body = (match[2] || '').trim();

  switch (cmd) {
    case 'goal':
      return {
        command: '/goal',
        cleanPrompt: body || 'Complete the active workspace objective thoroughly from end to end.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /goal (RELENTLESS AUTONOMOUS GOAL EXECUTION) ===\n' +
          'You are operating in /goal mode. Do NOT stop until the goal is 100% achieved, implemented, and verified.\n' +
          '1. Decompose the goal into concrete phases.\n' +
          '2. Execute all required file inspections, edits, and terminal verifications.\n' +
          '3. Never stop after merely reading files—follow through all the way to the finished deliverable.',
        maxToolSteps: 50,
        maxAutoContinues: 10,
        subagentRole: 'Goal Executor',
      };
    case 'plan':
      return {
        command: '/plan',
        cleanPrompt: body || 'Create a comprehensive step-by-step architectural implementation plan for this workspace.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /plan (ARCHITECTURAL IMPLEMENTATION PLANNER) ===\n' +
          'Inspect the relevant files in the workspace first, then produce a structured, production-grade Markdown Implementation Plan containing:\n' +
          '1. Objective & Architectural Overview\n' +
          '2. Proposed File Changes (with exact file paths & responsibilities)\n' +
          '3. Step-by-Step Execution Checklist\n' +
          '4. Verification & Testing Strategy',
        maxToolSteps: 25,
        maxAutoContinues: 5,
        subagentRole: 'System Architect',
      };
    case 'boost':
      return {
        command: '/boost',
        cleanPrompt: body || 'Perform a deep, multi-perspective architectural analysis and verification.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /boost (DEEP MULTI-PERSPECTIVE REASONING & VERIFICATION) ===\n' +
          'Engage maximum analytical rigor: evaluate correctness, edge cases, concurrency/state bugs, and maintainability.\n' +
          'Cross-check assumptions against the real source files before delivering a comprehensive, verified solution.',
        maxToolSteps: 38,
        maxAutoContinues: 8,
        forceThinkingBudget: 'deep',
        subagentRole: 'Principal Verifier',
      };
    case 'grill-me':
      return {
        command: '/grill-me',
        cleanPrompt: body || 'Interview me to align on design decisions and requirements for our next feature or refactor.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /grill-me (INTERACTIVE DESIGN INTERVIEW) ===\n' +
          'Briefly inspect the workspace context if helpful, then ask the user 3 to 5 high-leverage architectural/design questions.\n' +
          'For each question, provide clear options with a "(Recommended)" default and explain the trade-off concisely.',
        maxToolSteps: 15,
        maxAutoContinues: 3,
        subagentRole: 'Design Interviewer',
      };
    case 'teamwork':
      return {
        command: '/teamwork',
        cleanPrompt: body || 'Coordinate a multi-agent team to analyze, architect, and improve this project.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /teamwork (AUTONOMOUS MULTI-AGENT TEAMWORK) ===\n' +
          'Execute this task by coordinating four specialized subagent phases sequentially:\n' +
          '- [Subagent 1: Codebase Researcher] — Map relevant files and dependencies.\n' +
          '- [Subagent 2: Lead Architect] — Formulate the modular design.\n' +
          '- [Subagent 3: Implementation Specialist] — Write or refactor the code.\n' +
          '- [Subagent 4: QA Verifier] — Validate build & runtime integrity.\n' +
          'Present the final output clearly organized by team findings and actions.',
        maxToolSteps: 45,
        maxAutoContinues: 8,
        subagentRole: 'Team Coordinator',
      };
    case 'browser':
      return {
        command: '/browser',
        cleanPrompt: body || 'Use headless Playwright browser automation to inspect or research the target.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /browser (PLAYWRIGHT WEB AUTOMATION AGENT) ===\n' +
          'Immediately use the `browse_url` tool (Playwright headless browser) to navigate to the URL or search target, extract the live DOM text, and synthesize the findings.',
        maxToolSteps: 25,
        maxAutoContinues: 5,
        subagentRole: 'Browser Agent',
      };
    case 'learn':
      return {
        command: '/learn',
        cleanPrompt: body || 'Persist the key lessons and architectural rules from our session into Harness² memory.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /learn (PERSIST TO HARNESS² MEMORY) ===\n' +
          'Read `.localgravity/harness/memory.md` (or `skills.md`), distill the user\'s instruction or lesson into a clear, permanent engineering rule, write the updated file back to disk using `write_file`, and confirm what was learned.',
        maxToolSteps: 20,
        maxAutoContinues: 4,
        subagentRole: 'Harness² Learner',
      };
    case 'schedule':
      return {
        command: '/schedule',
        cleanPrompt: body || 'Design and configure a scheduled background automation task.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /schedule (BACKGROUND AUTOMATION DESIGNER) ===\n' +
          'Design a scheduled automation workflow for the user\'s request, specifying the cron schedule, execution command, and persistence in `.localgravity/harness/scripts.md`.',
        maxToolSteps: 20,
        maxAutoContinues: 4,
        subagentRole: 'Automation Scheduler',
      };
    default:
      return {
        command: null,
        cleanPrompt: rawPrompt,
        modeDirective: '',
        maxToolSteps: 32,
        maxAutoContinues: 6,
        subagentRole: 'Autonomous Engineer',
      };
  }
}

function detectPrematureStop(
  stepContent: string,
  hasExecutedTools: boolean,
  autoContinueCount: number,
  maxAutoContinues: number
): { shouldContinue: boolean; continuationPrompt: string } {
  if (autoContinueCount >= maxAutoContinues) {
    return { shouldContinue: false, continuationPrompt: '' };
  }

  const trimmed = (stepContent || '').trim();

  // 1. Model finished <think> but emitted 0 characters of output and 0 tool calls
  if (trimmed.length === 0) {
    return {
      shouldContinue: true,
      continuationPrompt:
        '[SELF-CATCH CONTINUATION]: You finished thinking without invoking a tool or writing your response. Proceed immediately: either call the next tool you need OR write out your complete, thorough final answer now.',
    };
  }

  // 2. Output ends with a colon ":" and is relatively short (< 650 chars), indicating it was about to call a tool or list findings
  if (trimmed.endsWith(':') && trimmed.length < 650) {
    return {
      shouldContinue: true,
      continuationPrompt:
        '[SELF-CATCH CONTINUATION]: You stopped right after a colon ("' +
        trimmed.slice(-100).replace(/\s+/g, ' ') +
        '") without invoking the tool or writing the content. Keep going immediately—invoke the tool call now or write the complete response.',
    };
  }

  // 3. Short transitional "promise to act" (< 480 chars) where the model says "Let me read...", "I'll check...", "Let me dump...", etc. and stops
  if (trimmed.length < 480) {
    const actionIntentRegex =
      /\b(let me|i will|i'll|let's|now i'll|now let me|next,? i|i am going to|i'm going to|i need to|time to)\s+(read|check|inspect|dump|run|test|split|refactor|create|write|edit|update|look|examine|verify|continue|pull|fetch|search|analyze|map|list|explore|open|review|implement|fix|build|proceed|grab|get|use|try|see|find|scan)\b/i;
    if (actionIntentRegex.test(trimmed)) {
      return {
        shouldContinue: true,
        continuationPrompt:
          '[SELF-CATCH CONTINUATION]: You stated your next action ("' +
          trimmed.slice(-140).replace(/\s+/g, ' ') +
          '") and stopped without emitting the tool call or completing the task. Do not stop—immediately invoke the tool call or provide the full final deliverable now.',
      };
    }
  }

  // 4. Even in a slightly longer message (< 800 chars), if the very last sentence is a "Let me ..." promise to act after having used tools
  if (hasExecutedTools && trimmed.length < 800) {
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lastLine = lines[lines.length - 1] || '';
    if (
      lastLine.length < 220 &&
      /^(let me|now let me|i'll|i will|next,? i'll|let's)\s+(read|check|inspect|dump|run|test|split|refactor|create|write|edit|update|look|examine|verify|continue|pull|fetch|search|analyze|map)\b/i.test(
        lastLine
      )
    ) {
      return {
        shouldContinue: true,
        continuationPrompt:
          '[SELF-CATCH CONTINUATION]: Your last line stated an unexecuted action ("' +
          lastLine +
          '"). Keep going: execute that tool call now, or if you already have enough context, deliver the complete final solution.',
      };
    }
  }

  return { shouldContinue: false, continuationPrompt: '' };
}

export async function createDaemonServer(options?: {
  dbPath?: string;
  preferredDaemonPort?: number;
  preferredTabbyPort?: number;
}): Promise<DaemonContext> {
  const ports = await allocateRuntimePorts(REPO_ROOT, {
    preferredDaemonPort: options?.preferredDaemonPort,
    preferredTabbyPort: options?.preferredTabbyPort,
  });

  if (isPortForbidden(ports.daemonPort) || isPortForbidden(ports.tabbyPort)) {
    throw new Error('CRITICAL: Forbidden port 5000/5001 detected! Aborting startup.');
  }

  const harness = new Harness2Manager();
  harness.ensureWorkspaceHarness(REPO_ROOT);

  const db = new LocalGravityDB(
    options?.dbPath || path.join(REPO_ROOT, '.runtime', 'localgravity.sqlite')
  );
  const defaultProject = db.ensureDefaultProject(REPO_ROOT);
  const existingThreads = db.listThreads(defaultProject.id);
  if (existingThreads.length === 0) {
    db.createThread({
      project_id: defaultProject.id,
      title: 'Welcome to LocalGravity 2.0 (Harness²)',
      active_model_tier: defaultProject.default_model_tier,
      active_thinking_budget: defaultProject.default_thinking_budget,
    });
  }

  const tabby = new TabbyEngine({
    repoRoot: REPO_ROOT,
    tabbyPort: ports.tabbyPort,
    tabbyBaseUrl: ports.tabbyBaseUrl,
  });

  // Trigger non-blocking SysRAM pre-warming of inactive EXL2/EXL3 tiers
  void tabby.prewarmInactiveTiersInSysRam();

  const mcp = new McpClientManager(REPO_ROOT);
  const terminal = new SharedTerminalManager(REPO_ROOT);
  const tools = new BuiltinToolExecutor(db, terminal);

  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  await app.register(fastifyCors, { origin: '*' });
  await app.register(fastifyWebsocket);

  const syncClients = new Set<WebSocket>();
  const terminalClients = new Set<WebSocket>();
  const activeAbortControllers = new Map<string, AbortController>();
  const pendingEdgeRpc = new Map<
    string,
    {
      resolve: (res: any) => void;
      stdout: string;
      stderr: string;
    }
  >();

  const broadcastSync = (event: Record<string, any>) => {
    const payload = JSON.stringify(event);
    for (const client of syncClients) {
      if (client.readyState === 1) {
        try {
          client.send(payload);
        } catch {}
      }
    }
  };

  // Forward live interactive terminal output to all connected terminal WebSockets
  terminal.onOutput((chunk, stream) => {
    const msg = JSON.stringify({ type: 'TERMINAL_OUTPUT', stream, chunk });
    for (const client of terminalClients) {
      if (client.readyState === 1) {
        try {
          client.send(msg);
        } catch {}
      }
    }
  });

  // ==================== HEALTH & RUNTIME DISCOVERY ====================
  app.get('/health', async () => {
    const pragmas = db.getPragmas();
    return {
      status: 'ok',
      version: '2.0.0',
      engine: 'Fastify Headless Core + TabbyAPI EXL2/EXL3 + Harness²',
      ports,
      sqlitePragmas: pragmas,
      tabby: tabby.getTelemetry(),
      mcpServers: mcp.listServers(),
      clientAppDataDir: getClientAppDataDir().replace(/\\/g, '/'),
    };
  });

  app.get('/api/health', async () => {
    return {
      status: 'ok',
      activeTier: tabby.getTelemetry().activeTier,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });

  app.get('/api/system/summary', async () => {
    const heapUsedMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    return {
      nodeVersion: process.version,
      platform: process.platform,
      memoryUsageMb: heapUsedMb,
    };
  });

  app.get('/api/runtime/ports', async () => ports);

  app.get('/api/client/appdata', async () => {
    return harness.ensureClientAppDataInitialized();
  });

  app.get('/api/telemetry', async () => {
    const tabbyTel = tabby.getTelemetry();
    const hw = queryHostHardwareTelemetry(tabbyTel.activeTier);
    return {
      ...hw,
      tabby: tabbyTel,
      mcpServers: mcp.listServers(),
      ports,
    };
  });

  // ==================== HEADLESS BRAIN PROXY ENDPOINTS (`/v1/model/load`, `/v1/chat/completions`) ====================
  app.post('/v1/model/load', async (req) => {
    const body = (req.body || {}) as { tier?: ModelTier; model_name?: string };
    const tier: ModelTier =
      body.tier ||
      (body.model_name?.includes('27B')
        ? 'high'
        : body.model_name?.includes('4B')
        ? 'low'
        : 'medium');
    const swapRes = await tabby.switchModelTier(tier);
    broadcastSync({
      type: 'MODEL_STATE',
      payload: {
        status: 'ready',
        active_tier: swapRes.tier,
        active_model: swapRes.modelName,
        swap_duration_ms: swapRes.swapDurationMs,
        sysram_cache: swapRes.sysramCache,
      },
    });
    return swapRes;
  });

  app.post('/v1/chat/completions', async (req) => {
    const body = (req.body || {}) as {
      tier?: ModelTier;
      thinking_budget?: ThinkingBudget;
      messages?: Array<{ role: string; content: any }>;
    };
    const tier: ModelTier = body.tier || 'medium';
    const budget: ThinkingBudget = body.thinking_budget || 'fast';
    const res = await tabby.streamChatCompletion({
      tier,
      thinkingBudget: budget,
      messages: body.messages || [{ role: 'user', content: 'Hello' }],
      onThoughtDelta: () => {},
      onTokenDelta: () => {},
    });
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      model: tabby.resolveDiskModelName(tier),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: res.content,
            reasoning_content: res.thinkingContent,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        reasoning_tokens: res.thinkingTokens,
        completion_tokens: res.outputTokens,
        total_tokens: res.thinkingTokens + res.outputTokens,
      },
    };
  });

  // ==================== HARNESS² 8-COMPONENT & PROPOSE-PROBE-COMPOSE API ====================
  app.get('/api/harness/components', async (req) => {
    const { root_path } = (req.query || {}) as { root_path?: string };
    const targetRoot = root_path && root_path !== '.' ? root_path : REPO_ROOT;
    return {
      workspaceRoot: targetRoot.replace(/\\/g, '/'),
      components: harness.listHarnessComponents(targetRoot),
      ppcHistory: harness.getPpcHistory(),
    };
  });

  app.put('/api/harness/component', async (req) => {
    const body = (req.body || {}) as {
      root_path?: string;
      relative_path: string;
      content: string;
    };
    const targetRoot = body.root_path && body.root_path !== '.' ? body.root_path : REPO_ROOT;
    const components = harness.updateHarnessFile(
      targetRoot,
      body.relative_path,
      body.content
    );
    broadcastSync({
      type: 'HARNESS_UPDATED',
      payload: { workspaceRoot: targetRoot.replace(/\\/g, '/'), components },
    });
    return { components };
  });

  app.post('/api/harness/ppc', async (req) => {
    const body = (req.body || {}) as {
      root_path?: string;
      tool_name?: string;
      command?: string;
      stderr?: string;
    };
    const targetRoot = body.root_path && body.root_path !== '.' ? body.root_path : REPO_ROOT;
    const toolName = body.tool_name || 'run_terminal';
    const command = body.command || 'Get-ChildItem -Path .';
    const stderr = body.stderr || 'Simulated double failure: command flag incompatible with shell';

    const cycle = await harness.runProposeProbeComposeCycle({
      workspaceRoot: targetRoot,
      failedToolName: toolName,
      failedCommand: command,
      failureCount: 2,
      stderrBefore: stderr,
      probeRunner: async () => {
        const res = await tools.executeTool(
          'list_directory',
          { path: '.' },
          {
            threadId: 'ppc-probe',
            messageId: 'ppc-msg',
            workspaceRoot: targetRoot,
          }
        );
        return {
          exitCode: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
        };
      },
    });

    broadcastSync({
      type: 'HARNESS_PPC_COMPLETED',
      payload: {
        cycle,
        components: harness.listHarnessComponents(targetRoot),
      },
    });

    return {
      cycle,
      components: harness.listHarnessComponents(targetRoot),
    };
  });

  // ==================== PROJECTS API ====================
  app.get('/api/projects', async () => {
    return { projects: db.listProjects() };
  });

  app.post('/api/projects', async (req) => {
    const body = (req.body || {}) as any;
    const resolvedRoot =
      body.root_path && body.root_path !== '.' ? body.root_path : REPO_ROOT;
    harness.ensureWorkspaceHarness(resolvedRoot);
    const project = db.createProject({
      name: body.name || path.basename(resolvedRoot) || 'Workspace',
      root_path: resolvedRoot,
      default_model_tier: body.default_model_tier || 'medium',
      default_thinking_budget: body.default_thinking_budget || 'fast',
      custom_instructions: body.custom_instructions || '',
      enabled_mcp_servers: body.enabled_mcp_servers || ['local-fetch', 'filesystem'],
      pinned_files: body.pinned_files || [],
    });
    const initialThread = db.createThread({
      project_id: project.id,
      title: 'Initial Thread',
      active_model_tier: project.default_model_tier,
      active_thinking_budget: project.default_thinking_budget,
    });
    broadcastSync({ type: 'PROJECT_CREATED', payload: { project, initialThread } });
    return { project, initialThread };
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as any;
    const project = db.updateProject(id, body);
    if (project && body.root_path) {
      terminal.setCwd(project.root_path);
      harness.ensureWorkspaceHarness(project.root_path);
    }
    broadcastSync({ type: 'PROJECT_UPDATED', payload: { project } });
    return { project };
  });

  app.delete('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    db.deleteProject(id);
    broadcastSync({ type: 'PROJECT_DELETED', payload: { projectId: id } });
    return { deleted: true };
  });

  // ==================== THREADS API ====================
  app.get('/api/threads', async (req) => {
    const { project_id } = (req.query || {}) as { project_id?: string };
    return { threads: db.listThreads(project_id) };
  });

  app.post('/api/threads', async (req) => {
    const body = (req.body || {}) as any;
    const projectId = body.project_id || db.ensureDefaultProject(REPO_ROOT).id;
    const thread = db.createThread({
      project_id: projectId,
      title: body.title || 'New Thread',
      active_model_tier: body.active_model_tier || 'medium',
      active_thinking_budget: body.active_thinking_budget || 'fast',
    });
    broadcastSync({ type: 'THREAD_CREATED', payload: { thread } });
    return { thread };
  });

  app.patch('/api/threads/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as any;
    const thread = db.updateThread(id, body);
    broadcastSync({ type: 'THREAD_UPDATED', payload: { thread } });
    return { thread };
  });

  app.delete('/api/threads/:id', async (req) => {
    const { id } = req.params as { id: string };
    db.deleteThread(id);
    broadcastSync({ type: 'THREAD_DELETED', payload: { threadId: id } });
    return { deleted: true };
  });

  app.post('/api/threads/:id/clear', async (req) => {
    const { id } = req.params as { id: string };
    db.clearThreadMessages(id);
    broadcastSync({ type: 'THREAD_CLEARED', payload: { threadId: id } });
    return { cleared: true };
  });

  // ==================== MESSAGES, TOOLS & CHECKPOINTS API ====================
  app.get('/api/threads/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    const messages = db.listMessages(id);
    const activeStreams = db.getActiveStreamsForThread(id);
    const checkpoints = db.listFileCheckpoints(id);
    return { messages, activeStreams, checkpoints };
  });

  app.get('/api/threads/:id/checkpoints', async (req) => {
    const { id } = req.params as { id: string };
    return { checkpoints: db.listFileCheckpoints(id) };
  });

  app.post('/api/checkpoints/:id/revert', async (req) => {
    const { id } = req.params as { id: string };
    const result = db.revertFileCheckpoint(id);
    broadcastSync({
      type: 'CHECKPOINT_REVERTED',
      payload: { checkpointId: id, ...result },
    });
    return result;
  });

  // ==================== WORKSPACE FILES & MONACO EDITOR API ====================
  app.get('/api/workspace/files', async (req) => {
    const { root_path } = (req.query || {}) as { root_path?: string };
    const baseDir = root_path && root_path !== '.' ? root_path : REPO_ROOT;
    const files: Array<{ path: string; name: string; type: 'file' | 'directory' }> = [];

    const walk = (dir: string, depth = 0) => {
      if (depth > 3 || files.length >= 250) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === '.venv' ||
          entry.name === 'dist' ||
          entry.name === 'target' ||
          entry.name === '.runtime'
        ) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          files.push({ path: relPath, name: entry.name, type: 'directory' });
          walk(fullPath, depth + 1);
        } else {
          files.push({ path: relPath, name: entry.name, type: 'file' });
        }
      }
    };

    walk(baseDir);
    return { rootPath: baseDir.replace(/\\/g, '/'), files };
  });

  app.get('/api/workspace/file', async (req, reply) => {
    const { path: filePath, root_path } = (req.query || {}) as {
      path?: string;
      root_path?: string;
    };
    if (!filePath) {
      return reply.code(400).send({ error: 'Missing path parameter' });
    }
    const baseDir = root_path && root_path !== '.' ? root_path : REPO_ROOT;
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      return reply.code(404).send({ error: `File not found: ${resolved}` });
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    return { path: resolved.replace(/\\/g, '/'), content };
  });

  app.post('/api/workspace/file', async (req) => {
    const body = (req.body || {}) as {
      path: string;
      content: string;
      root_path?: string;
      thread_id?: string;
      message_id?: string;
    };
    const baseDir = body.root_path && body.root_path !== '.' ? body.root_path : REPO_ROOT;
    const resolved = path.isAbsolute(body.path)
      ? body.path
      : path.resolve(baseDir, body.path);
    const prev = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf-8') : null;
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, body.content, 'utf-8');

    let checkpoint = null;
    if (body.thread_id && body.message_id) {
      checkpoint = db.createFileCheckpoint({
        thread_id: body.thread_id,
        message_id: body.message_id,
        file_path: resolved,
        previous_content_blob: prev,
        new_content_blob: body.content,
      });
    }

    broadcastSync({
      type: 'FILE_UPDATED',
      payload: { path: resolved.replace(/\\/g, '/'), checkpoint },
    });
    return { saved: true, path: resolved.replace(/\\/g, '/'), checkpoint };
  });

  // ==================== TABBYAPI & MCP CONTROLS ====================
  app.post('/api/tabby/tier', async (req) => {
    const { tier, thread_id } = (req.body || {}) as {
      tier: ModelTier;
      thread_id?: string;
    };
    broadcastSync({
      type: 'MODEL_STATE',
      payload: {
        status: 'swapping',
        active_tier: tier,
        active_model: TIER_SPECS[tier]?.modelName || tier,
        status_text: `Hot-swapping ${TIER_SPECS[tier]?.displayName} from SysRAM -> VRAM...`,
      },
    });

    const swapRes = await tabby.switchModelTier(tier);
    if (thread_id) {
      db.updateThread(thread_id, { active_model_tier: tier });
    }

    const hw = queryHostHardwareTelemetry(tier);
    broadcastSync({
      type: 'MODEL_STATE',
      payload: {
        status: 'ready',
        active_tier: swapRes.tier,
        active_model: swapRes.modelName,
        swap_duration_ms: swapRes.swapDurationMs,
        tokens_per_sec: tabby.getTelemetry().tokensPerSec,
        sysram_cache: swapRes.sysramCache,
        status_text: `Ready (${swapRes.swapDurationMs}ms SysRAM swap)`,
        vram_used_gb: hw.vramUsedGb,
        vram_total_gb: hw.vramTotalGb,
        host_ram_used_gb: hw.hostRamUsedGb,
        host_ram_total_gb: hw.hostRamTotalGb,
      },
    });

    return swapRes;
  });

  app.post('/api/tabby/prewarm', async () => {
    const cache = await tabby.prewarmInactiveTiersInSysRam();
    broadcastSync({ type: 'SYSRAM_CACHE_UPDATED', payload: { sysramCache: cache } });
    return { sysramCache: cache };
  });

  app.get('/api/mcp/servers', async () => {
    return {
      servers: mcp.listServers(),
      activeTools: mcp.listActiveTools(),
    };
  });

  app.post('/api/mcp/toggle', async (req) => {
    const { serverName, enabled } = (req.body || {}) as {
      serverName: string;
      enabled?: boolean;
    };
    const updated = mcp.toggleServer(serverName, enabled);
    broadcastSync({
      type: 'MCP_STATE_UPDATED',
      payload: { servers: mcp.listServers(), activeTools: mcp.listActiveTools() },
    });
    return { server: updated, servers: mcp.listServers() };
  });

  app.post('/api/vision/capture', async () => {
    const snap = tools.captureWindowsScreen();
    broadcastSync({
      type: 'VISION_CAPTURE',
      payload: snap,
    });
    return snap;
  });

  // ==================== TURN EXECUTION ENGINE (WITH HARNESS² + PROPOSE-PROBE-COMPOSE) ====================
  async function handlePromptTurn(params: {
    threadId: string;
    prompt: string;
    tier: ModelTier;
    thinkingBudget: ThinkingBudget;
    attachments?: any[];
  }) {
    const promptStr = typeof params.prompt === 'string' ? params.prompt : '';
    let thread = db.getThread(params.threadId);
    if (!thread) {
      const defaultProj = db.ensureDefaultProject(REPO_ROOT);
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

    const project = db.getProject(thread.project_id) || db.ensureDefaultProject(REPO_ROOT);
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
        `5. GOAL-DIRECTED EXECUTION: Keep intermediate tool-step commentary brief (1 sentence max) or invoke the tool directly, saving your detailed prose and code blocks for the final synthesis.\n\n` +
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
        const activeTools = isFinalStep ? undefined : BUILTIN_TOOLS_SCHEMA;
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

        const stepText = (result.content || '').trim();

        // Check if no tools were executed in this step
        if (executedToolsThisStep.length === 0) {
          // Did the model stop prematurely with an unfulfilled intention ("Let me read...", empty output, etc.)?
          if (!isFinalStep) {
            const autoCheck = detectPrematureStop(
              stepText,
              hasExecutedTools,
              autoContinueCount,
              MAX_AUTO_CONTINUES
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
  }

  // REST Endpoint for submitting a turn
  app.post('/api/threads/:id/prompt', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as {
      prompt: string;
      tier?: ModelTier;
      thinking_budget?: ThinkingBudget;
      attachments?: any[];
    };
    const thread = db.getThread(id);
    const tier = body.tier || thread?.active_model_tier || 'medium';
    const budget = body.thinking_budget || thread?.active_thinking_budget || 'fast';

    void handlePromptTurn({
      threadId: id,
      prompt: body.prompt,
      tier,
      thinkingBudget: budget,
      attachments: body.attachments,
    });

    return { accepted: true, threadId: id, tier, thinkingBudget: budget };
  });

  // ==================== WEBSOCKET MULTIPLEXING (`/ws/sync`, `/ws/agent/:sessionId`, `/ws/terminal`) ====================
  const handleWsConnection = (socket: WebSocket, initialThreadId?: string) => {
    syncClients.add(socket);

    const projects = db.listProjects();
    const activeProject = projects[0] || db.ensureDefaultProject(REPO_ROOT);
    const threads = db.listThreads(activeProject.id);
    const targetThreadId = initialThreadId || threads[0]?.id;
    const messages = targetThreadId ? db.listMessages(targetThreadId) : [];
    const activeStreams = targetThreadId ? db.getActiveStreamsForThread(targetThreadId) : [];
    const checkpoints = targetThreadId ? db.listFileCheckpoints(targetThreadId) : [];
    const tabbyTel = tabby.getTelemetry();
    const hw = queryHostHardwareTelemetry(tabbyTel.activeTier);

    socket.send(
      JSON.stringify({
        type: 'SYNC_STATE',
        payload: {
          ports,
          projects,
          activeProject,
          threads,
          activeThreadId: targetThreadId,
          messages,
          activeStreams,
          checkpoints,
          mcpServers: mcp.listServers(),
          tabby: tabbyTel,
          telemetry: hw,
          harnessComponents: harness.listHarnessComponents(activeProject.root_path),
          ppcHistory: harness.getPpcHistory(),
        },
      })
    );

    socket.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString('utf-8'));
        const { type, payload } = msg;

        if (type === 'SESSION_INIT' || type === 'REQUEST_SYNC') {
          const reqThreadId = payload?.thread_id || payload?.session_id || targetThreadId;
          const threadMsgs = reqThreadId ? db.listMessages(reqThreadId) : [];
          const inFlight = reqThreadId ? db.getActiveStreamsForThread(reqThreadId) : [];
          socket.send(
            JSON.stringify({
              type: 'SYNC_STATE',
              payload: {
                ports,
                projects: db.listProjects(),
                threads: db.listThreads(payload?.project_id),
                activeThreadId: reqThreadId,
                messages: threadMsgs,
                activeStreams: inFlight,
                checkpoints: reqThreadId ? db.listFileCheckpoints(reqThreadId) : [],
                mcpServers: mcp.listServers(),
                tabby: tabby.getTelemetry(),
                telemetry: queryHostHardwareTelemetry(tabby.getTelemetry().activeTier),
                harnessComponents: harness.listHarnessComponents(activeProject.root_path),
                ppcHistory: harness.getPpcHistory(),
              },
            })
          );
        } else if (type === 'PROMPT_SUBMIT') {
          const threadId = payload.thread_id || payload.session_id || targetThreadId;
          const tier: ModelTier = payload.tier || 'medium';
          const budget: ThinkingBudget = payload.thinking_budget || 'fast';
          void handlePromptTurn({
            threadId,
            prompt: payload.prompt,
            tier,
            thinkingBudget: budget,
            attachments: payload.images || payload.attachments || [],
          });
        } else if (type === 'TIER_SWITCH') {
          const newTier: ModelTier = payload.new_tier || payload.tier || 'medium';
          const swapRes = await tabby.switchModelTier(newTier);
          if (payload.session_id || payload.thread_id) {
            db.updateThread(payload.thread_id || payload.session_id, {
              active_model_tier: newTier,
            });
          }
          const curHw = queryHostHardwareTelemetry(newTier);
          broadcastSync({
            type: 'MODEL_STATE',
            payload: {
              status: 'ready',
              active_tier: swapRes.tier,
              active_model: swapRes.modelName,
              swap_duration_ms: swapRes.swapDurationMs,
              tokens_per_sec: tabby.getTelemetry().tokensPerSec,
              sysram_cache: swapRes.sysramCache,
              status_text: `Swapped to ${swapRes.spec.displayName} in ${swapRes.swapDurationMs}ms`,
              vram_used_gb: curHw.vramUsedGb,
              vram_total_gb: curHw.vramTotalGb,
              host_ram_used_gb: curHw.hostRamUsedGb,
              host_ram_total_gb: curHw.hostRamTotalGb,
            },
          });
        } else if (type === 'EXEC_STREAM') {
          const pending = pendingEdgeRpc.get(payload?.request_id);
          if (pending) {
            if (payload.stream === 'stderr') pending.stderr += payload.chunk + '\n';
            else pending.stdout += payload.chunk + '\n';
          }
        } else if (type === 'EXEC_RESULT') {
          const pending = pendingEdgeRpc.get(payload?.request_id);
          if (pending) {
            pendingEdgeRpc.delete(payload.request_id);
            pending.resolve({
              exitCode: payload.exit_code ?? 0,
              durationMs: payload.duration_ms ?? 0,
              stdout: pending.stdout || (typeof payload.data === 'string' ? payload.data : ''),
              stderr: pending.stderr || payload.error || '',
            });
          }
        } else if (type === 'STOP_GENERATION') {
          const threadId = payload?.thread_id || payload?.session_id || targetThreadId;
          const ctrl = activeAbortControllers.get(threadId);
          if (ctrl) {
            ctrl.abort();
            activeAbortControllers.delete(threadId);
          }
          if (threadId) {
            db.updateThread(threadId, { status: 'idle' });
          }
        } else if (type === 'ARTIFACT_SYNC') {
          broadcastSync({
            type: 'ARTIFACT_SYNC',
            payload,
          });
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    socket.on('close', () => {
      syncClients.delete(socket);
    });
  };

  app.get('/ws/sync', { websocket: true }, (socket) => {
    handleWsConnection(socket);
  });

  app.get('/ws/agent/:sessionId', { websocket: true }, (socket, req) => {
    const { sessionId } = req.params as { sessionId: string };
    handleWsConnection(socket, sessionId);
  });

  app.get('/ws/terminal', { websocket: true }, (socket) => {
    terminalClients.add(socket);
    socket.send(
      JSON.stringify({
        type: 'TERMINAL_HISTORY',
        chunk: terminal.getHistory(),
      })
    );

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString('utf-8'));
        if (msg.type === 'TERMINAL_INPUT' && typeof msg.data === 'string') {
          terminal.writeInput(msg.data);
        } else if (msg.type === 'TERMINAL_EXEC' && typeof msg.command === 'string') {
          void terminal.executeCommand(msg.command);
        }
      } catch {
        terminal.writeInput(raw.toString('utf-8'));
      }
    });

    socket.on('close', () => {
      terminalClients.delete(socket);
    });
  });

  // Periodic Hardware & TabbyAPI Telemetry Broadcast
  const telemetryInterval = setInterval(() => {
    if (syncClients.size === 0) return;
    const tabbyTel = tabby.getTelemetry();
    const hw = queryHostHardwareTelemetry(tabbyTel.activeTier);
    broadcastSync({
      type: 'TELEMETRY',
      payload: {
        vram_used_gb: hw.vramUsedGb,
        vram_total_gb: hw.vramTotalGb,
        vram_percent: hw.vramPercent,
        host_ram_used_gb: hw.hostRamUsedGb,
        host_ram_total_gb: hw.hostRamTotalGb,
        host_ram_percent: hw.hostRamPercent,
        gpu_utilization_percent: hw.gpuUtilization,
        cpu_utilization_percent: hw.cpuUtilization,
        active_tier: tabbyTel.activeTier,
        active_model: tabbyTel.activeModel,
        tokens_per_sec: tabbyTel.tokensPerSec,
        swap_duration_ms: tabbyTel.lastSwapDurationMs,
        sysram_cache: tabbyTel.sysramCache,
      },
    });
  }, 2500);
  telemetryInterval.unref();

  // ==================== STATIC WEB BUNDLE SERVING ====================
  const clientDistPath = path.join(REPO_ROOT, 'client', 'dist');
  if (fs.existsSync(clientDistPath)) {
    await app.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/') || req.url.startsWith('/v1/')) {
        reply.code(404).send({ error: 'Not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  return {
    app,
    ports,
    db,
    tabby,
    mcp,
    terminal,
    tools,
    harness,
    broadcastSync,
  };
}

// Direct CLI execution entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  createDaemonServer()
    .then(async (ctx) => {
      await ctx.app.listen({ port: ctx.ports.daemonPort, host: ctx.ports.daemonHost });
      console.log('==============================================================');
      console.log('🚀 LocalGravity 2.0 Fastify Headless Core Daemon Active');
      console.log(`   Local Desktop URL : ${ctx.ports.localUrl}`);
      console.log(`   LAN / Remote URL  : ${ctx.ports.lanUrl}`);
      console.log(`   WebSocket Sync    : ${ctx.ports.wsSyncUrl}`);
      console.log(`   TabbyAPI Endpoint : ${ctx.ports.tabbyBaseUrl} (Q4 KV, N-gram x4)`);
      console.log(`   Client AppData    : ${getClientAppDataDir()}`);
      console.log(`   Forbidden Ports   : ${ctx.ports.forbiddenPorts.join(', ')} (Strictly Skipped)`);
      console.log('==============================================================');
    })
    .catch((err) => {
      console.error('Failed to start LocalGravity daemon:', err);
      process.exit(1);
    });
}
