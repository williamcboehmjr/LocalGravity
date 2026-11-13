process.on('uncaughtException', (err: any) => {
  if (
    err?.code === 'ECONNRESET' ||
    err?.code === 'EPIPE' ||
    err?.message?.includes('closed') ||
    err?.message?.includes('aborted')
  ) {
    return;
  }
  console.error('[CentralBrain] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason: any) => {
  if (
    reason?.name === 'AbortError' ||
    reason?.message?.toLowerCase().includes('abort') ||
    reason?.code === 'ABORT_ERR'
  ) {
    return;
  }
  console.error('[CentralBrain] Unhandled Rejection:', reason);
});

import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import { queryHostHardwareTelemetry } from './utils/telemetry.js';
import { pruneChatMessages } from './utils/messagePruning.js';
import { detectPrematureStop } from './agent/prematureStop.js';
import { parseAntigravitySlashCommand } from './agent/slashCommands.js';
import { createPromptTurnHandler, type ActiveTurnSnapshot } from './agent/promptTurn.js';
import { SwarmManager } from './swarm/swarmManager.js';
import { AttachmentManager, RawAttachmentInput } from './files/attachmentManager.js';

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
  TIER_SPECS,  deduplicateRepeatedSequences,} from './tabby/tabbyEngine.js';
import type { BrainProviderId, GoogleModelId } from './google/googleAiEngine.js';
import { LlamaMoESidecar } from './tabby/llamaSidecar.js';
import { McpClientManager } from './mcp/mcpManager.js';
import { SkillManager, SKILL_TOOLS_SCHEMA } from './skills/skillManager.js';
import { SharedTerminalManager } from './terminal/terminalManager.js';
import {
  BuiltinToolExecutor,
  BUILTIN_TOOLS_SCHEMA,
} from './tools/builtinTools.js';
import { BackgroundTaskManager } from './tools/taskManager.js';
import { SubagentManager } from './tools/subagentManager.js';
import { EdgeBridgeManager } from './bridge/edgeBridge.js';
import { ArtifactManager } from './tools/artifactManager.js';
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
  skills: SkillManager;
  terminal: SharedTerminalManager;
  tools: BuiltinToolExecutor;
  harness: Harness2Manager;
  broadcastSync: (event: Record<string, any>) => void;
}


export async function createDaemonServer(options?: {
  dbPath?: string;
  preferredDaemonPort?: number;
  preferredTabbyPort?: number;
  /** Isolated mode for the self-test suite: skip writing runtime port files and use OS-assigned ephemeral ports. */
  isolated?: boolean;
}): Promise<DaemonContext> {
  const ports = await allocateRuntimePorts(REPO_ROOT, {
    preferredDaemonPort: options?.preferredDaemonPort,
    preferredTabbyPort: options?.preferredTabbyPort,
    skipPortFileWrite: options?.isolated,
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

  // Stay in 0 MB VRAM standby on Brain startup; models warm & load only once a client checks in.

  const attachmentManager = new AttachmentManager(REPO_ROOT);
  const mcp = new McpClientManager(REPO_ROOT);
  const skills = new SkillManager(REPO_ROOT);
  const terminal = new SharedTerminalManager(REPO_ROOT);
  const tools = new BuiltinToolExecutor(db, terminal, mcp, skills, attachmentManager);

  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  await app.register(fastifyCors, { origin: '*' });
  await app.register(fastifyWebsocket);

  const syncClients = new Set<WebSocket>();
  const terminalClients = new Set<WebSocket>();

  const activeAbortControllers = new Map<string, AbortController>();
  const activeTurns = new Map<string, ActiveTurnSnapshot>();
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

  // Wire LocalGravity 6-Pillar Managers to real-time WebSocket broadcastSync
  const taskMgr = BackgroundTaskManager.getInstance();
  const subagentMgr = SubagentManager.getInstance();
  subagentMgr.setLlmEngine(tabby);
  const artifactMgr = ArtifactManager.getInstance();
  const swarmMgr = SwarmManager.getInstance();
  swarmMgr.configure({
    db,
    broadcastSync,
    runtimeDeps: { tabby, tools, repoRoot: REPO_ROOT },
  });

  taskMgr.onEvent((evt) => {
    broadcastSync({
      type: evt.type,
      payload: evt.payload,
    });
  });

  subagentMgr.onTaskUpdate((task) => {
    broadcastSync({
      type: 'SUBAGENT_EVENT',
      payload: {
        id: task.id,
        thread_id: task.threadId,
        message_id: task.id,
        role: task.role,
        prompt: task.prompt,
        command: 'invoke_subagent',
        status: task.status === 'failed' ? 'error' : task.status,
        step: task.step,
        maxSteps: task.maxSteps,
        summary: task.summary,
        logs: task.resultText ? [task.resultText] : [task.summary],
        messageCount: task.messages?.length ?? 0,
        timestamp: Date.now(),
      },
    });
  });

  artifactMgr.onArtifactUpdate((artifact, allArtifacts) => {
    broadcastSync({
      type: 'ARTIFACT_UPDATED',
      payload: {
        artifact,
        artifacts: allArtifacts,
      },
    });
    const mappedName =
      artifact.type === 'plan'
        ? 'plan.md'
        : artifact.type === 'walkthrough'
        ? 'walkthrough.md'
        : artifact.type === 'html'
        ? `${artifact.id.replace(/^artifact-/, '')}.html`
        : 'task.md';
    broadcastSync({
      type: 'ARTIFACT_SYNC',
      payload: {
        id: artifact.id,
        type: artifact.type,
        session_id: artifact.threadId,
        artifact_name: mappedName,
        artifactId: artifact.id,
        artifactType: artifact.type,
        requestFeedback: Boolean(artifact.requestFeedback),
        userFacing: Boolean(artifact.userFacing),
        content: artifact.content,
        title: artifact.title,
        version: artifact.updatedAt,
      },
    });
  });

  // ==================== HEALTH & RUNTIME DISCOVERY ====================
  app.get('/health', async () => {
    const pragmas = db.getPragmas();
    return {
      status: 'ok',
      version: '2.2.0',
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
      backgroundTasks: taskMgr.listTasks(),
      subagentTasks: subagentMgr.listTasks(),
      artifacts: artifactMgr.listArtifacts(),
    };
  });

  app.get('/api/tasks', async () => {
    return {
      tasks: taskMgr.listTasks(),
      subagents: subagentMgr.listTasks(),
    };
  });

  app.get('/api/subagents/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = subagentMgr.getTask(id);
    if (!task) {
      return reply.code(404).send({ error: 'Subagent task not found' });
    }
    return {
      id: task.id,
      role: task.role,
      status: task.status,
      step: task.step,
      maxSteps: task.maxSteps,
      prompt: task.prompt,
      summary: task.summary,
      resultText: task.resultText,
      messages: task.messages || [],
    };
  });

  app.post('/api/tasks/:id/kill', async (req) => {
    const { id } = req.params as { id: string };
    const killed = taskMgr.killTask(id);
    return { ok: killed, tasks: taskMgr.listTasks() };
  });

  app.post('/api/tasks/:id/input', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { input?: string };
    const sent = taskMgr.sendInputToTask(id, String(body.input || ''));
    return { ok: sent };
  });

  app.get('/api/artifacts', async (req) => {
    const { thread_id } = (req.query || {}) as { thread_id?: string };
    return {
      artifacts: artifactMgr.listArtifacts(thread_id),
    };
  });

  app.get('/api/artifacts/:id/raw', async (req, reply) => {
    const { id } = req.params as { id: string };
    const artifact =
      artifactMgr.getArtifact(id) ||
      artifactMgr.listArtifacts().find((a) => a.id === `artifact-${id}` || a.title.toLowerCase() === id.toLowerCase());
    if (!artifact) {
      return reply.code(404).send({ error: `Artifact "${id}" not found` });
    }
    const darkThemeCss = `<style>:root{color-scheme:dark;--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--border:#30363d;--accent:#3b82f6;}html,body{background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,sans-serif;margin:0;padding:12px;}</style>`;
    if (artifact.type === 'html' || artifact.filePath.endsWith('.html')) {
      const html = artifact.content.includes('</head>')
        ? artifact.content.replace('</head>', `${darkThemeCss}</head>`)
        : `<!DOCTYPE html><html><head><meta charset="utf-8">${darkThemeCss}</head><body>${artifact.content}</body></html>`;
      return reply.type('text/html; charset=utf-8').send(html);
    }
    return reply.type('text/plain; charset=utf-8').send(artifact.content);
  });

  app.post('/api/artifacts/:id/feedback', async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = artifactMgr.clearArtifactFeedback(id);
    if (!updated) {
      return reply.code(404).send({ error: `Artifact "${id}" not found` });
    }
    return { ok: true, artifact: updated };
  });

  // ==================== SWARM BOARD & ROSTER API ====================
  app.get('/api/swarm/:threadId', async (req) => {
    const { threadId } = req.params as { threadId: string };
    return { swarm: swarmMgr.getSwarmSnapshot(threadId) };
  });

  app.post('/api/swarm/:threadId/post', async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    const body = (req.body || {}) as { text?: string; agent?: string; channel?: string };
    const text = String(body.text || '').trim();
    if (!text) {
      return reply.code(400).send({ error: 'text is required' });
    }
    const message = swarmMgr.postMessage(threadId, body.agent || 'user', text, {
      channel: body.channel || 'main',
    });
    return { ok: true, message, swarm: swarmMgr.getSwarmSnapshot(threadId) };
  });

  app.post('/api/swarm/:threadId/kill/:name', async (req) => {
    const { threadId, name } = req.params as { threadId: string; name: string };
    const res = swarmMgr.killMember(threadId, name, 'user');
    return { ok: res.killed, ...res, swarm: swarmMgr.getSwarmSnapshot(threadId) };
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

  // ==================== BRAIN PROVIDER (STRATA vs GOOGLE AI STUDIO) ====================
  const applyBrainProviderUpdate = (update: {
    provider?: BrainProviderId;
    googleApiKey?: string;
    selectedGoogleModel?: GoogleModelId;
  }) => {
    const prevProvider = tabby.getBrainProviderConfig().provider;
    const nextPublic = tabby.updateBrainProviderConfig(update);

    if (prevProvider !== nextPublic.provider) {
      if (nextPublic.provider === 'google_ai_studio') {
        if (!tabby.getIdleStatus().isOffloaded) {
          void tabby.offloadGpu('google_ai_studio_active');
        }
      } else if (nextPublic.provider === 'strata') {
        void ensureModelsWarmedOnClientConnect();
      }
    }

    broadcastSync({
      type: 'BRAIN_PROVIDER_UPDATED',
      payload: nextPublic,
    });

    broadcastSync({
      type: 'MODEL_STATE',
      payload: {
        status: 'ready',
        active_tier: tabby.getTelemetry().activeTier,
        active_model:
          nextPublic.provider === 'google_ai_studio'
            ? nextPublic.activeDisplayName
            : 'Qwen 3.8 Flash-Next High',
        tokens_per_sec: tabby.getTelemetry().tokensPerSec,
        status_text:
          nextPublic.provider === 'google_ai_studio'
            ? `Google AI Studio (${nextPublic.activeDisplayName})`
            : 'GPU Active & Ready',
      },
    });

    return nextPublic;
  };

  app.get('/api/brain/provider', async () => {
    return tabby.getBrainProviderPublicConfig();
  });

  app.post('/api/brain/provider', async (req) => {
    const body = (req.body || {}) as {
      provider?: BrainProviderId;
      googleApiKey?: string;
      selectedGoogleModel?: GoogleModelId;
    };
    return applyBrainProviderUpdate(body);
  });

  // ==================== GPU LIFECYCLE & SELF-RESTART ENDPOINTS ====================
  app.get('/api/gpu/status', async () => {
    const sidecar = LlamaMoESidecar.getInstance();
    const sidecarState = await sidecar.getState();
    const idleStatus = tabby.getIdleStatus();
    return {
      gpuState: sidecarState,
      idleTimeoutMinutes: idleStatus.idleTimeoutMinutes,
      secondsRemaining: idleStatus.secondsRemaining,
      isOffloaded: idleStatus.isOffloaded,
      activeTier: idleStatus.activeTier,
      recentLogs: sidecar.getRecentLogs().slice(-50),
      offloadedAt: sidecar.getOffloadedAt(),
    };
  });

  app.post('/api/gpu/offload', async () => {
    await tabby.offloadGpu('manual_api_request');
    broadcastSync({
      type: 'MODEL_STATE',
      payload: {
        status: 'idle',
        active_tier: 'high',
        active_model: 'offloaded',
        text: 'GPU Offloaded (0 MB VRAM)',
      },
    });
    return { success: true, gpuState: 'standby' };
  });

  app.post('/api/gpu/wake', async () => {
    broadcastSync({
      type: 'MODEL_STATE',
      payload: {
        status: 'swapping',
        active_tier: 'high',
        active_model: 'waking',
        text: 'Waking Strata GPU Engine...',
      },
    });
    const ok = await tabby.wakeGpu();
    broadcastSync({
      type: 'MODEL_STATE',
      payload: {
        status: ok ? 'ready' : 'error',
        active_tier: 'high',
        active_model: 'Qwen 3.8 Flash-Next High',
        text: ok ? 'GPU Active & Ready' : 'Failed to wake GPU',
      },
    });
    return { success: ok, gpuState: ok ? 'active' : 'standby' };
  });

  app.post('/api/gpu/timeout', async (req) => {
    const { minutes } = (req.body || {}) as { minutes?: number };
    if (typeof minutes === 'number') {
      tabby.setIdleTimeoutMinutes(minutes);
    }
    return tabby.getIdleStatus();
  });

  app.post('/api/system/restart', async () => {
    console.log('[System] Self-restart requested via API.');
    broadcastSync({
      type: 'SYSTEM_RESTARTING',
      payload: { message: 'LocalGravity Central Brain is restarting...', timestamp: Date.now() },
    });
    setTimeout(() => {
      // Exit code 42 signals the Windows Tray supervisor to immediately restart
      process.exit(42);
    }, 400);
    return { status: 'restarting', supervisorExitCode: 42 };
  });

  app.post('/api/system/shutdown', async () => {
    console.log('[System] Graceful shutdown requested via API.');
    broadcastSync({
      type: 'SYSTEM_SHUTTING_DOWN',
      payload: { message: 'LocalGravity is shutting down...', timestamp: Date.now() },
    });
    setTimeout(async () => {
      try {
        await tabby.offloadGpu('shutdown');
        db.close();
      } catch {}
      process.exit(0);
    }, 400);
    return { status: 'shutting_down' };
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
    const tier: ModelTier = body.tier || 'high';
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
    const hostName =
      typeof body.host_name === 'string' && body.host_name.trim()
        ? body.host_name.trim()
        : os.hostname();
    if (!EdgeBridgeManager.getInstance().isRemoteHost(hostName)) {
      harness.ensureWorkspaceHarness(resolvedRoot);
    }
    const project = db.createProject({
      name: body.name || path.basename(resolvedRoot) || 'Workspace',
      root_path: resolvedRoot,
      host_name: hostName,
      default_model_tier: body.default_model_tier || 'high',
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
      active_model_tier: body.active_model_tier || 'high',
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

  const stopGenerationHandler = async (threadId?: string, rawTurnId?: string) => {
    const turnId = rawTurnId && !rawTurnId.startsWith('pending-') ? rawTurnId : undefined;
    let abortedCount = 0;
    let targetMessageId: string | undefined;
    let targetTurnId: string | undefined = turnId;

    if (threadId) {
      const currentTurn = activeTurns.get(threadId);
      const ctrl = activeAbortControllers.get(threadId);

      // Keyed by turn: never let a stale stop request abort a newer turn on the same thread.
      if (turnId && currentTurn && currentTurn.turn_id !== turnId) {
        return { stopped: false, abortedCount: 0, staleTurn: true, threadId, turnId };
      }

      // Idempotent: if this turn/thread has no active controller or active stream, return cleanly.
      const streams = db.getActiveStreamsForThread(threadId);
      if (!ctrl && !currentTurn && streams.length === 0) {
        return { stopped: true, abortedCount: 0, alreadyIdle: true, threadId, turnId };
      }

      targetTurnId = currentTurn?.turn_id || turnId || streams[0]?.messageId;
      targetMessageId = currentTurn?.message_id || streams[0]?.messageId;

      if (ctrl) {
        try { ctrl.abort(); } catch {}
        activeAbortControllers.delete(threadId);
        abortedCount++;
      }
      if (currentTurn) {
        activeTurns.delete(threadId);
      }
      for (const s of streams) {
        db.finalizeRunningToolExecutions(s.messageId);
        db.finalizeStreamingMessage(s.messageId);
      }
      db.updateThread(threadId, { status: 'idle' });
      if (streams.length > 0 && abortedCount === 0) {
        abortedCount++;
      }
    } else {
      // Global stop (no threadId specified): abort all active turns.
      for (const [id, c] of activeAbortControllers.entries()) {
        try { c.abort(); } catch {}
        activeAbortControllers.delete(id);
        activeTurns.delete(id);
        if (id) {
          for (const s of db.getActiveStreamsForThread(id)) {
            db.finalizeRunningToolExecutions(s.messageId);
            db.finalizeStreamingMessage(s.messageId);
          }
          db.updateThread(id, { status: 'idle' });
        }
        abortedCount++;
      }
    }

    if (abortedCount > 0) {
      if (threadId && targetTurnId) {
        broadcastSync({
          type: 'TURN_PHASE',
          payload: {
            seq: Number.MAX_SAFE_INTEGER,
            thread_id: threadId,
            threadId,
            turn_id: targetTurnId,
            message_id: targetMessageId || targetTurnId,
            phase: 'aborted',
            is_active: false,
            step: 0,
            max_steps: 0,
            status_label: 'Stopped',
            thinking_finished: true,
            timestamp: Date.now(),
          },
        });
      }
      broadcastSync({
        type: 'TURN_ABORTED',
        payload: {
          thread_id: threadId,
          session_id: threadId,
          ...(targetTurnId ? { turn_id: targetTurnId } : {}),
          ...(targetMessageId ? { message_id: targetMessageId } : {}),
        },
      });
      broadcastSync({
        type: 'TOKEN_STREAM',
        payload: {
          thread_id: threadId,
          session_id: threadId,
          ...(targetMessageId ? { message_id: targetMessageId } : {}),
          chunk: '',
          is_finished: true,
        },
      });
    }
    return { stopped: true, abortedCount, threadId, turnId: targetTurnId, messageId: targetMessageId };
  };

  app.post('/api/threads/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { turn_id?: string; turnId?: string; message_id?: string };
    return await stopGenerationHandler(id, body.turn_id || body.turnId || body.message_id);
  });
  app.post('/api/threads/:id/cancel', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { turn_id?: string; turnId?: string; message_id?: string };
    return await stopGenerationHandler(id, body.turn_id || body.turnId || body.message_id);
  });
  app.post('/api/stop', async (req) => {
    const body = (req.body || {}) as { thread_id?: string; session_id?: string; turn_id?: string; turnId?: string; message_id?: string };
    return await stopGenerationHandler(body.thread_id || body.session_id, body.turn_id || body.turnId || body.message_id);
  });

  // ==================== MESSAGES, TOOLS & CHECKPOINTS API ====================
  app.get('/api/threads/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    const thread = db.getThread(id);
    const messages = db.listMessages(id);
    const activeStreams = db.getActiveStreamsForThread(id);
    const checkpoints = db.listFileCheckpoints(id);
    const activeTurn = activeTurns.get(id) || null;
    return {
      messages,
      activeStreams,
      checkpoints,
      threadStatus: thread?.status || 'idle',
      thread,
      activeTurn,
    };
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

  app.post('/api/engine/prewarm', async () => {
    const cache = await tabby.prewarmInactiveTiersInSysRam();
    broadcastSync({ type: 'SYSRAM_CACHE_UPDATED', payload: { sysramCache: cache } });
    return { sysramCache: cache };
  });

  app.get('/api/skills', async () => {
    return { skills: skills.listSkills() };
  });

  app.get('/api/skills/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const skill = skills.readSkill(name);
    if (!skill) return reply.status(404).send({ error: `Skill "${name}" not found` });
    return skill;
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

  // ==================== SCHEDULED TASKS & AUTOMATIONS API (LocalGravity) ====================
  const automationsFilePath = path.join(REPO_ROOT, '.localgravity', 'harness', 'automations.json');
  const readAutomations = (): Array<{
    id: string;
    name: string;
    cron: string;
    prompt: string;
    tier: ModelTier;
    enabled: boolean;
    lastRunAt: string | null;
  }> => {
    try {
      if (fs.existsSync(automationsFilePath)) {
        return JSON.parse(fs.readFileSync(automationsFilePath, 'utf-8'));
      }
    } catch {}
    const defaults = [
      {
        id: 'auto-strata-health',
        name: 'Strata & Vision Health Check',
        cron: '0 */6 * * *',
        prompt: '/vision Inspect Strata Qwen 3.8 Flash-Next health and verify vision readiness.',
        tier: 'high' as ModelTier,
        enabled: true,
        lastRunAt: null,
      },
      {
        id: 'auto-harness-compact',
        name: 'Harness² Experience Compaction',
        cron: '0 3 * * *',
        prompt: '/learn Summarize recent tool lessons into .localgravity/harness/EXPERIENCE.md',
        tier: 'high' as ModelTier,
        enabled: false,
        lastRunAt: null,
      },
    ];
    try {
      fs.mkdirSync(path.dirname(automationsFilePath), { recursive: true });
      fs.writeFileSync(automationsFilePath, JSON.stringify(defaults, null, 2), 'utf-8');
    } catch {}
    return defaults;
  };

  const writeAutomations = (items: any[]) => {
    try {
      fs.mkdirSync(path.dirname(automationsFilePath), { recursive: true });
      fs.writeFileSync(automationsFilePath, JSON.stringify(items, null, 2), 'utf-8');
    } catch {}
  };

  app.get('/api/automations', async () => {
    return { automations: readAutomations() };
  });

  app.post('/api/automations', async (req) => {
    const body = (req.body || {}) as any;
    const list = readAutomations();
    const item = {
      id: 'auto-' + Date.now().toString(36),
      name: body.name || 'Scheduled Task',
      cron: body.cron || '0 9 * * *',
      prompt: body.prompt || '/goal Check project status',
      tier: (body.tier || 'high') as ModelTier,
      enabled: body.enabled ?? true,
      lastRunAt: null,
    };
    const next = [item, ...list];
    writeAutomations(next);
    return { automation: item, automations: next };
  });

  app.patch('/api/automations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as any;
    const list = readAutomations().map((a) => (a.id === id ? { ...a, ...body } : a));
    writeAutomations(list);
    return { automations: list };
  });

  app.delete('/api/automations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const list = readAutomations().filter((a) => a.id !== id);
    writeAutomations(list);
    return { automations: list };
  });

  // ==================== AUTO-UPDATER PROXY API (PRIVATE GITHUB REPO SUPPORT) ====================
  function getGitHubAuthToken(): string {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
    if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
    try {
      const res = spawnSync('git', ['credential', 'fill'], {
        input: 'protocol=https\nhost=github.com\n\n',
        encoding: 'utf-8',
        timeout: 3000,
        windowsHide: true,
      });
      if (res.stdout) {
        for (const line of res.stdout.split('\n')) {
          if (line.startsWith('password=')) {
            return line.slice('password='.length).trim();
          }
        }
      }
    } catch {}
    return '';
  }

  app.get('/api/updater/latest.json', async (req, reply) => {
    try {
      const token = getGitHubAuthToken();
      const repo = 'williamcboehmjr/LocalGravity';
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'LocalGravity-Brain-Updater/2.1',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const relRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
      if (!relRes.ok) {
        return reply.code(relRes.status).send({
          error: `GitHub release fetch failed: ${relRes.status} ${relRes.statusText}`,
        });
      }

      const release = (await relRes.json()) as any;
      const latestAsset = (release.assets || []).find((a: any) => a.name === 'latest.json');
      if (!latestAsset) {
        return reply.code(404).send({ error: 'latest.json asset not found in latest release' });
      }

      const manifestRes = await fetch(latestAsset.url, {
        headers: {
          ...headers,
          Accept: 'application/octet-stream',
        },
      });

      if (!manifestRes.ok) {
        return reply.code(manifestRes.status).send({
          error: `Failed to download latest.json asset: ${manifestRes.status} ${manifestRes.statusText}`,
        });
      }

      const manifest = (await manifestRes.json()) as any;
      const host = req.headers.host || `localhost:${ports.daemonPort}`;
      const proto = (req.headers['x-forwarded-proto'] as string) || 'http';

      if (manifest.platforms && typeof manifest.platforms === 'object') {
        for (const [_, platData] of Object.entries(manifest.platforms as Record<string, any>)) {
          if (platData && platData.url) {
            const fileName = platData.url.split('/').pop();
            platData.url = `${proto}://${host}/api/updater/download/${fileName}`;
          }
        }
      }

      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
      return reply.send(manifest);
    } catch (err: any) {
      console.error('[Updater] Failed to serve latest.json proxy:', err);
      return reply.code(500).send({ error: err.message || 'Internal updater error' });
    }
  });

  app.get('/api/updater/download/:fileName', async (req, reply) => {
    const { fileName } = req.params as { fileName: string };
    try {
      const token = getGitHubAuthToken();
      const repo = 'williamcboehmjr/LocalGravity';
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'LocalGravity-Brain-Updater/2.1',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const relRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
      if (!relRes.ok) {
        return reply.code(relRes.status).send({
          error: `GitHub release fetch failed: ${relRes.status} ${relRes.statusText}`,
        });
      }

      const release = (await relRes.json()) as any;
      const targetAsset = (release.assets || []).find((a: any) => a.name === fileName);
      if (!targetAsset) {
        return reply.code(404).send({ error: `Asset ${fileName} not found in release` });
      }

      const dlRes = await fetch(targetAsset.url, {
        headers: {
          ...headers,
          Accept: 'application/octet-stream',
        },
        redirect: 'follow',
      });

      if (!dlRes.ok) {
        return reply.code(dlRes.status).send({
          error: `Asset download failed: ${dlRes.status} ${dlRes.statusText}`,
        });
      }

      reply.header('Content-Type', 'application/octet-stream');
      if (targetAsset.size) {
        reply.header('Content-Length', String(targetAsset.size));
      }
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`);

      if (dlRes.body) {
        // @ts-ignore - Node.js Readable from web ReadableStream
        const stream = Readable.fromWeb(dlRes.body as any);
        return reply.send(stream);
      } else {
        const buffer = Buffer.from(await dlRes.arrayBuffer());
        return reply.send(buffer);
      }
    } catch (err: any) {
      console.error(`[Updater] Download proxy failed for ${fileName}:`, err);
      return reply.code(500).send({ error: err.message || 'Updater download proxy failed' });
    }
  });

  // ==================== UPLOADED FILES SERVING & UPLOAD API ====================
  app.get('/api/uploads/:threadId/:filename', async (req, reply) => {
    const { threadId, filename } = req.params as { threadId: string; filename: string };
    const safeThread = threadId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFile = path.basename(decodeURIComponent(filename));
    const filePath = path.join(attachmentManager.getUploadsRoot(), safeThread, safeFile);
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'File not found' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.pdf': 'application/pdf',
      '.json': 'application/json',
      '.csv': 'text/csv',
      '.txt': 'text/plain',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.zip': 'application/zip',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    reply.header('Content-Type', contentType);
    const stream = fs.createReadStream(filePath);
    return reply.send(stream);
  });

  app.post('/api/threads/:id/upload', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as RawAttachmentInput;
    const saved = await attachmentManager.saveAttachment(id, body);
    return saved;
  });

  // ==================== TURN EXECUTION ENGINE (WITH HARNESS² + PROPOSE-PROBE-COMPOSE) ====================
  const handlePromptTurn = createPromptTurnHandler({
    db, tabby, mcp, skills, tools, harness, terminal, attachmentManager,
    broadcastSync, activeAbortControllers, activeTurns, repoRoot: REPO_ROOT,
  });



  // REST Endpoint for submitting a turn
  app.post('/api/threads/:id/prompt', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as {
      prompt: string;
      tier?: ModelTier;
      thinking_budget?: ThinkingBudget;
      google_model?: GoogleModelId;
      attachments?: any[];
    };
    if (body.google_model) {
      applyBrainProviderUpdate({ selectedGoogleModel: body.google_model });
    }
    const thread = db.getThread(id);
    const tier = body.tier || thread?.active_model_tier || 'high';
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

  // 60s Cron Evaluator for .localgravity/harness/automations.json
  const matchCronField = (field: string, value: number): boolean => {
    if (field === '*') return true;
    for (const part of field.split(',')) {
      if (part.startsWith('*/')) {
        const step = Number(part.slice(2));
        if (step > 0 && value % step === 0) return true;
      } else if (part.includes('-')) {
        const [lo, hi] = part.split('-').map(Number);
        if (!Number.isNaN(lo) && !Number.isNaN(hi) && value >= lo && value <= hi) return true;
      } else if (Number(part) === value) {
        return true;
      }
    }
    return false;
  };
  const matchesCronExpression = (cronExpr: string, now: Date): boolean => {
    const parts = (cronExpr || '').trim().split(/\s+/);
    if (parts.length !== 5) return false;
    return (
      matchCronField(parts[0], now.getMinutes()) &&
      matchCronField(parts[1], now.getHours()) &&
      matchCronField(parts[2], now.getDate()) &&
      matchCronField(parts[3], now.getMonth() + 1) &&
      matchCronField(parts[4], now.getDay())
    );
  };

  const cronTimer = setInterval(() => {
    try {
      const now = new Date();
      const minuteKey = now.toISOString().slice(0, 16);
      const list = readAutomations();
      let changed = false;
      for (const item of list) {
        if (!item.enabled || !item.prompt) continue;
        if (item.lastRunAt && item.lastRunAt.slice(0, 16) === minuteKey) continue;
        if (!matchesCronExpression(item.cron, now)) continue;
        item.lastRunAt = now.toISOString();
        changed = true;
        broadcastSync({
          type: 'TIMER_FIRED',
          payload: {
            taskId: item.id,
            automationId: item.id,
            title: item.name,
            prompt: item.prompt,
            timestamp: Date.now(),
          },
        });
        const threads = db.listThreads();
        const targetId = threads[0]?.id || 'thread-default';
        void handlePromptTurn({
          threadId: targetId,
          prompt: item.prompt,
          tier: item.tier || 'high',
          thinkingBudget: 'fast',
        }).catch((err) => console.error('[AutomationCron] Error running automation turn:', err));
      }
      if (changed) writeAutomations(list);
    } catch (err) {
      console.error('[AutomationCron] Tick error:', err);
    }
  }, 60_000);
  cronTimer.unref?.();
  app.addHook('onClose', async () => {
    clearInterval(cronTimer);
  });

  // ==================== WEBSOCKET MULTIPLEXING (`/ws/sync`, `/ws/agent/:sessionId`, `/ws/terminal`) ====================
  let clientWakeInFlight: Promise<void> | null = null;
  const ensureModelsWarmedOnClientConnect = () => {
    if (tabby.getBrainProviderConfig().provider === 'google_ai_studio') return;
    if (!tabby.getIdleStatus().isOffloaded) return;
    if (clientWakeInFlight) return;

    clientWakeInFlight = (async () => {
      try {
        console.log('[Strata] Client connected — waking Strata & loading models into RAM/VRAM...');
        broadcastSync({
          type: 'MODEL_STATE',
          payload: {
            status: 'swapping',
            active_tier: tabby.getTelemetry().activeTier,
            active_model: 'waking',
            text: 'Waking Strata GPU Engine...',
          },
        });
        void tabby.prewarmInactiveTiersInSysRam();
        const ok = await tabby.wakeGpu();
        broadcastSync({
          type: 'MODEL_STATE',
          payload: {
            status: ok ? 'ready' : 'error',
            active_tier: tabby.getTelemetry().activeTier,
            active_model: 'Qwen 3.8 Flash-Next High',
            text: ok ? 'GPU Active & Ready' : 'Failed to wake GPU',
          },
        });
      } catch (err) {
        console.error('[Strata] Client-connect wake error:', err);
      } finally {
        clientWakeInFlight = null;
      }
    })();
  };

  const handleWsConnection = (socket: WebSocket, initialThreadId?: string) => {
    syncClients.add(socket);
    void ensureModelsWarmedOnClientConnect();

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
          activeTurn: targetThreadId ? (activeTurns.get(targetThreadId) || null) : null,
          checkpoints,
          mcpServers: mcp.listServers(),
          tabby: tabbyTel,
          brainProvider: tabby.getBrainProviderPublicConfig(),
          telemetry: hw,
          harnessComponents: harness.listHarnessComponents(activeProject.root_path),
          ppcHistory: harness.getPpcHistory(),
          backgroundTasks: taskMgr.listTasks(),
          artifacts: artifactMgr.listArtifacts(targetThreadId),
          swarm: targetThreadId ? swarmMgr.getSwarmSnapshot(targetThreadId) : null,
          brainHost: os.hostname(),
          edgeHosts: EdgeBridgeManager.getInstance().listClients(),
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
                activeTurn: reqThreadId ? (activeTurns.get(reqThreadId) || null) : null,
                checkpoints: reqThreadId ? db.listFileCheckpoints(reqThreadId) : [],
                mcpServers: mcp.listServers(),
                tabby: tabby.getTelemetry(),
                brainProvider: tabby.getBrainProviderPublicConfig(),
                telemetry: queryHostHardwareTelemetry(tabby.getTelemetry().activeTier),
                harnessComponents: harness.listHarnessComponents(activeProject.root_path),
                ppcHistory: harness.getPpcHistory(),
                backgroundTasks: taskMgr.listTasks(),
                artifacts: artifactMgr.listArtifacts(reqThreadId),
                swarm: reqThreadId ? swarmMgr.getSwarmSnapshot(reqThreadId) : null,
                brainHost: os.hostname(),
                edgeHosts: EdgeBridgeManager.getInstance().listClients(),
              },
            })
          );
        } else if (type === 'EDGE_REGISTER') {
          if (payload?.client_id) {
            EdgeBridgeManager.getInstance().registerClient(String(payload.client_id), socket, {
              hostname: String(payload.hostname || 'unknown-host'),
              platform: String(payload.platform || 'unknown'),
              homeDir: payload.home_dir ? String(payload.home_dir) : undefined,
            });
            broadcastSync({
              type: 'EDGE_HOSTS_UPDATE',
              payload: {
                brainHost: os.hostname(),
                edgeHosts: EdgeBridgeManager.getInstance().listClients(),
              },
            });
          }
        } else if (type === 'EDGE_TOOL_RESULT') {
          EdgeBridgeManager.getInstance().handleToolResult(payload || {});
        } else if (type === 'BRAIN_PROVIDER_SWITCH') {
          applyBrainProviderUpdate({
            provider: payload?.provider,
            googleApiKey: payload?.googleApiKey,
            selectedGoogleModel: payload?.selectedGoogleModel,
          });
        } else if (type === 'PROMPT_SUBMIT') {
          const threadId = payload.thread_id || payload.session_id || targetThreadId;
          if (payload?.client_id && threadId) {
            EdgeBridgeManager.getInstance().bindThread(threadId, String(payload.client_id));
          }
          if (payload?.google_model) {
            applyBrainProviderUpdate({ selectedGoogleModel: payload.google_model });
          }
          const tier: ModelTier = payload.tier || 'high';
          const budget: ThinkingBudget = payload.thinking_budget || 'fast';
          void handlePromptTurn({
            threadId,
            prompt: payload.prompt,
            tier,
            thinkingBudget: budget,
            attachments: payload.images || payload.attachments || [],
          }).catch((err) => {
            if (err?.name === 'AbortError' || err?.message?.toLowerCase().includes('abort')) return;
            console.error('[CentralBrain] Error in prompt turn:', err);
          });
        } else if (type === 'TIER_SWITCH') {
          const newTier: ModelTier = payload.new_tier || payload.tier || 'high';
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
        } else if (type === 'STOP_GENERATION' || type === 'CANCEL_GENERATION') {
          const threadId = payload?.thread_id || payload?.session_id || targetThreadId;
          const turnId = payload?.turn_id || payload?.turnId || payload?.message_id;
          await stopGenerationHandler(threadId, turnId);
        } else if (type === 'ARTIFACT_SYNC') {
          broadcastSync({
            type: 'ARTIFACT_SYNC',
            payload,
          });
        } else if (type === 'TASK_INPUT') {
          const taskId = payload?.task_id;
          if (!taskId) return;

          // Spawn-backed task: forward raw keystrokes to the live process stdin.
          if (typeof payload.data === 'string') {
            const ok = taskMgr.sendInputToTask(taskId, payload.data);
            if (!ok) {
              console.log(`[TaskInput] Task ${taskId} has no live stdin (exited, not running, or non-interactive)`);
            }
          }

          // Spawn-based tasks have no terminal geometry; just refresh the client with current state.
          const t = taskMgr.getTask(taskId);
          if (t) broadcastSync({ type: 'TASK_UPDATE', payload: { task: t } });
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    socket.on('close', () => {
      syncClients.delete(socket);
      EdgeBridgeManager.getInstance().unregisterSocket(socket);
      broadcastSync({
        type: 'EDGE_HOSTS_UPDATE',
        payload: {
          brainHost: os.hostname(),
          edgeHosts: EdgeBridgeManager.getInstance().listClients(),
        },
      });
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
    skills,
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
