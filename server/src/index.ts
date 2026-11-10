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
import { createPromptTurnHandler } from './agent/promptTurn.js';
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

  // Wire Antigravity 6-Pillar Managers to real-time WebSocket broadcastSync
  const taskMgr = BackgroundTaskManager.getInstance();
  const subagentMgr = SubagentManager.getInstance();
  const artifactMgr = ArtifactManager.getInstance();

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
        command: 'invoke_subagent',
        status: task.status === 'failed' ? 'error' : task.status,
        step: task.step,
        maxSteps: task.maxSteps,
        summary: task.summary,
        logs: task.resultText ? [task.resultText] : [task.summary],
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
        : 'task.md';
    broadcastSync({
      type: 'ARTIFACT_SYNC',
      payload: {
        session_id: artifact.threadId,
        artifact_name: mappedName,
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

  app.get('/api/artifacts', async (req) => {
    const { thread_id } = (req.query || {}) as { thread_id?: string };
    return {
      artifacts: artifactMgr.listArtifacts(thread_id),
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
    harness.ensureWorkspaceHarness(resolvedRoot);
    const project = db.createProject({
      name: body.name || path.basename(resolvedRoot) || 'Workspace',
      root_path: resolvedRoot,
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

  const stopGenerationHandler = async (threadId?: string) => {
    let abortedCount = 0;
    if (threadId) {
      const ctrl = activeAbortControllers.get(threadId);
      if (ctrl) {
        try { ctrl.abort(); } catch {}
        activeAbortControllers.delete(threadId);
        abortedCount++;
      }
      for (const s of db.getActiveStreamsForThread(threadId)) {
        db.finalizeStreamingMessage(s.messageId);
      }
      db.updateThread(threadId, { status: 'idle' });
    }
    // Abort all active controllers if threadId not specifically mapped or if threadId is omitted
    if (abortedCount === 0 || !threadId) {
      for (const [id, c] of activeAbortControllers.entries()) {
        try { c.abort(); } catch {}
        activeAbortControllers.delete(id);
        if (id) {
          for (const s of db.getActiveStreamsForThread(id)) {
            db.finalizeStreamingMessage(s.messageId);
          }
          db.updateThread(id, { status: 'idle' });
        }
        abortedCount++;
      }
    }
    broadcastSync({
      type: 'TURN_ABORTED',
      payload: { thread_id: threadId, session_id: threadId },
    });
    broadcastSync({
      type: 'TOKEN_STREAM',
      payload: {
        thread_id: threadId,
        session_id: threadId,
        chunk: '',
        is_finished: true,
      },
    });
    return { stopped: true, abortedCount, threadId };
  };

  app.post('/api/threads/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    return await stopGenerationHandler(id);
  });
  app.post('/api/threads/:id/cancel', async (req) => {
    const { id } = req.params as { id: string };
    return await stopGenerationHandler(id);
  });
  app.post('/api/stop', async (req) => {
    const body = (req.body || {}) as { thread_id?: string; session_id?: string };
    return await stopGenerationHandler(body.thread_id || body.session_id);
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

  // ==================== SCHEDULED TASKS & AUTOMATIONS API (ANTIGRAVITY 2.0) ====================
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
    broadcastSync, activeAbortControllers, repoRoot: REPO_ROOT,
  });



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
          backgroundTasks: taskMgr.listTasks(),
          artifacts: artifactMgr.listArtifacts(targetThreadId),
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
                backgroundTasks: taskMgr.listTasks(),
                artifacts: artifactMgr.listArtifacts(reqThreadId),
              },
            })
          );
        } else if (type === 'PROMPT_SUBMIT') {
          const threadId = payload.thread_id || payload.session_id || targetThreadId;
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
          await stopGenerationHandler(threadId);
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
