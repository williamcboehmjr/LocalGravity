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
import { queryHostHardwareTelemetry } from './utils/telemetry.js';
import { pruneChatMessages } from './utils/messagePruning.js';
import { detectPrematureStop } from './agent/prematureStop.js';
import { parseAntigravitySlashCommand } from './agent/slashCommands.js';
import { createPromptTurnHandler } from './agent/promptTurn.js';

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

  const mcp = new McpClientManager(REPO_ROOT);
  const skills = new SkillManager(REPO_ROOT);
  const terminal = new SharedTerminalManager(REPO_ROOT);
  const tools = new BuiltinToolExecutor(db, terminal, mcp, skills);

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

  // ==================== TURN EXECUTION ENGINE (WITH HARNESS² + PROPOSE-PROBE-COMPOSE) ====================
    const handlePromptTurn = createPromptTurnHandler({
    db, tabby, mcp, skills, tools, harness, terminal,
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
          const tier: ModelTier = payload.tier || 'high';
          const budget: ThinkingBudget = payload.thinking_budget || 'fast';
          void handlePromptTurn({
            threadId,
            prompt: payload.prompt,
            tier,
            thinkingBudget: budget,
            attachments: payload.images || payload.attachments || [],
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
