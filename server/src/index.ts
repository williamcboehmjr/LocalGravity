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
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import { queryHostHardwareTelemetry } from './utils/telemetry.js';
import { createPromptTurnHandler, type ActiveTurnSnapshot } from './agent/promptTurn.js';
import { SwarmManager } from './swarm/swarmManager.js';
import { AttachmentManager } from './files/attachmentManager.js';
import { allocateRuntimePorts, RuntimePortsConfig, isPortForbidden } from './portAllocator.js';
import { LocalGravityDB, ModelTier, ThinkingBudget } from './db/database.js';
import { TabbyEngine, TIER_SPECS } from './tabby/tabbyEngine.js';
import type { BrainProviderId, GoogleModelId } from './google/googleAiEngine.js';
import { LlamaMoESidecar } from './tabby/llamaSidecar.js';
import { McpClientManager } from './mcp/mcpManager.js';
import { SkillManager } from './skills/skillManager.js';
import { SharedTerminalManager } from './terminal/terminalManager.js';
import { BuiltinToolExecutor } from './tools/builtinTools.js';
import { BackgroundTaskManager } from './tools/taskManager.js';
import { SubagentManager } from './tools/subagentManager.js';
import { EdgeBridgeManager } from './bridge/edgeBridge.js';
import { ArtifactManager } from './tools/artifactManager.js';
import { ProviderRegistry } from './providers/providerRegistry.js';
import { Harness2Manager, getClientAppDataDir } from './harness/harnessManager.js';
import { getPathsConfig } from './core/pathsConfig.js';
import { ComfyCompanionManager } from './tools/handlers/comfyui/comfyCompanion.js';
import { stopManagedOllamaServer } from './tools/handlers/comfyui/ollamaClient.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerThreadRoutes } from './routes/threads.js';
import { registerHarnessRoutes } from './routes/harness.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerUpdaterRoutes } from './routes/updater.js';
import { registerComfyuiRoutes } from './routes/comfyui.js';
import { createAutomationStore, registerAutomationRoutes } from './routes/automations.js';
import { startAutomationCronRunner } from './services/cronRunner.js';
import type { RouteContext } from './routes/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readServerPackageVersion(): string {
  try {
    const pkgPath = path.join(REPO_ROOT, 'server', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (typeof parsed?.version === 'string' && parsed.version.trim()) return parsed.version.trim();
    }
  } catch {}
  return '2.3.22';
}

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
  const pkgVersion = readServerPackageVersion();
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

  const db = new LocalGravityDB(options?.dbPath || path.join(REPO_ROOT, '.runtime', 'localgravity.sqlite'));
  try {
    db.db.prepare("UPDATE threads SET status = 'idle' WHERE status != 'idle'").run();
    db.db
      .prepare(
        "UPDATE tool_executions SET status = 'error', stderr_stream = CASE WHEN stderr_stream = '' THEN 'Interrupted by Central Brain restart' ELSE stderr_stream END WHERE status = 'running'"
      )
      .run();
  } catch {}

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

  const attachmentManager = new AttachmentManager(REPO_ROOT);
  const mcp = new McpClientManager(REPO_ROOT);
  const skills = new SkillManager(REPO_ROOT);
  const terminal = new SharedTerminalManager(REPO_ROOT);
  const tools = new BuiltinToolExecutor(db, terminal, mcp, skills, attachmentManager, REPO_ROOT);
  const providerRegistry = new ProviderRegistry(REPO_ROOT);

  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  await app.register(fastifyCors, { origin: '*' });
  await app.register(fastifyWebsocket);

  const syncClients = new Set<WebSocket>();
  const terminalClients = new Set<WebSocket>();
  const activeAbortControllers = new Map<string, AbortController>();
  const activeTurns = new Map<string, ActiveTurnSnapshot>();
  const pendingEdgeRpc = new Map<string, { resolve: (res: any) => void; stdout: string; stderr: string }>();

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

  const taskMgr = BackgroundTaskManager.getInstance();
  const subagentMgr = SubagentManager.getInstance();
  subagentMgr.setLlmEngine(tabby);
  const artifactMgr = ArtifactManager.getInstance();
  const swarmMgr = SwarmManager.getInstance();
  swarmMgr.configure({ db, broadcastSync, runtimeDeps: { tabby, tools, repoRoot: REPO_ROOT } });

  taskMgr.onEvent((evt) => {
    broadcastSync({ type: evt.type, payload: evt.payload });
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
      payload: { artifact, artifacts: allArtifacts },
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

  const handlePromptTurn = createPromptTurnHandler({
    db,
    tabby,
    mcp,
    skills,
    tools,
    harness,
    terminal,
    attachmentManager,
    broadcastSync,
    activeAbortControllers,
    activeTurns,
    repoRoot: REPO_ROOT,
  });

  const stopGenerationHandler = async (threadId?: string, rawTurnId?: string) => {
    const turnId = rawTurnId && !rawTurnId.startsWith('pending-') ? rawTurnId : undefined;
    let abortedCount = 0;
    let targetMessageId: string | undefined;
    let targetTurnId: string | undefined = turnId;

    if (threadId) {
      const currentTurn = activeTurns.get(threadId);
      const ctrl = activeAbortControllers.get(threadId);
      if (turnId && currentTurn && currentTurn.turn_id !== turnId) {
        return { stopped: false, abortedCount: 0, staleTurn: true, threadId, turnId };
      }

      const streams = db.getActiveStreamsForThread(threadId);
      targetTurnId = currentTurn?.turn_id || turnId || streams[0]?.messageId;
      targetMessageId = currentTurn?.message_id || streams[0]?.messageId;

      if (ctrl) {
        try {
          ctrl.abort();
        } catch {}
        activeAbortControllers.delete(threadId);
        abortedCount++;
      }
      if (currentTurn) activeTurns.delete(threadId);
      for (const s of streams) {
        db.finalizeRunningToolExecutions(s.messageId);
        db.finalizeStreamingMessage(s.messageId);
      }
      const prevThread = db.getThread(threadId);
      const stoppedOrphanTools = db.db
        .prepare(
          "UPDATE tool_executions SET status = 'error', stderr_stream = CASE WHEN stderr_stream = '' THEN 'Stopped by user' ELSE stderr_stream END WHERE thread_id = ? AND status = 'running'"
        )
        .run(threadId);
      db.updateThread(threadId, { status: 'idle' });
      if (
        abortedCount === 0 &&
        (streams.length > 0 || (prevThread && prevThread.status !== 'idle') || stoppedOrphanTools.changes > 0)
      ) {
        abortedCount++;
      }
    } else {
      for (const [id, c] of activeAbortControllers.entries()) {
        try {
          c.abort();
        } catch {}
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

    if (abortedCount > 0 || threadId) {
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

  let clientWakeInFlight: Promise<void> | null = null;
  const ensureModelsWarmedOnClientConnect = () => {
    if (tabby.getBrainProviderConfig().provider === 'google_ai_studio') return;
    const comfyMgr = ComfyCompanionManager.getInstance();
    if (comfyMgr.getConfig().studioMode && (comfyMgr.isZeroVramBrain() || comfyMgr.isFastLocalSwapBrain())) {
      return;
    }
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

    broadcastSync({ type: 'BRAIN_PROVIDER_UPDATED', payload: nextPublic });
    broadcastSync({
      type: 'MODEL_STATE',
      payload: {
        status: 'ready',
        active_tier: tabby.getTelemetry().activeTier,
        active_model:
          nextPublic.provider === 'google_ai_studio' ? nextPublic.activeDisplayName : 'Qwen 3.8 Flash-Next High',
        tokens_per_sec: tabby.getTelemetry().tokensPerSec,
        status_text:
          nextPublic.provider === 'google_ai_studio'
            ? `Google AI Studio (${nextPublic.activeDisplayName})`
            : 'GPU Active & Ready',
      },
    });

    return nextPublic;
  };

  // ==================== CORE HEALTH, PROVIDER, GPU & TELEMETRY ROUTES ====================
  app.get('/health', async () => ({
    status: 'ok',
    version: pkgVersion,
    engine: 'Fastify Headless Core + TabbyAPI EXL2/EXL3 + Harness²',
    ports,
    sqlitePragmas: db.getPragmas(),
    tabby: tabby.getTelemetry(),
    mcpServers: mcp.listServers(),
    clientAppDataDir: getClientAppDataDir().replace(/\\/g, '/'),
  }));

  app.get('/api/health', async () => ({
    status: 'ok',
    activeTier: tabby.getTelemetry().activeTier,
    uptimeSeconds: Math.floor(process.uptime()),
  }));

  app.get('/api/system/summary', async () => ({
    nodeVersion: process.version,
    platform: process.platform,
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    backgroundTasks: taskMgr.listTasks(),
    subagentTasks: subagentMgr.listTasks(),
    artifacts: artifactMgr.listArtifacts(),
  }));

  app.get('/api/runtime/ports', async () => ports);
  app.get('/api/client/appdata', async () => harness.ensureClientAppDataInitialized());

  app.get('/api/telemetry', async () => {
    const tabbyTel = tabby.getTelemetry();
    const hw = queryHostHardwareTelemetry(tabbyTel.activeTier);
    return { ...hw, tabby: tabbyTel, mcpServers: mcp.listServers(), ports };
  });

  app.get('/api/brain/provider', async () => tabby.getBrainProviderPublicConfig());
  app.post('/api/brain/provider', async (req) =>
    applyBrainProviderUpdate(
      (req.body || {}) as {
        provider?: BrainProviderId;
        googleApiKey?: string;
        selectedGoogleModel?: GoogleModelId;
      }
    )
  );

  app.get('/api/gpu/status', async () => {
    const sidecar = LlamaMoESidecar.getInstance();
    const idleStatus = tabby.getIdleStatus();
    return {
      gpuState: await sidecar.getState(),
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
      payload: { status: 'idle', active_tier: 'high', active_model: 'offloaded', text: 'GPU Offloaded (0 MB VRAM)' },
    });
    return { success: true, gpuState: 'standby' };
  });

  app.post('/api/gpu/wake', async () => {
    broadcastSync({
      type: 'MODEL_STATE',
      payload: { status: 'swapping', active_tier: 'high', active_model: 'waking', text: 'Waking Strata GPU Engine...' },
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
    if (typeof minutes === 'number') tabby.setIdleTimeoutMinutes(minutes);
    return tabby.getIdleStatus();
  });

  app.post('/api/system/restart', async () => {
    console.log('[System] Self-restart requested via API.');
    broadcastSync({
      type: 'SYSTEM_RESTARTING',
      payload: { message: 'LocalGravity Central Brain is restarting...', timestamp: Date.now() },
    });
    setTimeout(() => process.exit(42), 400);
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
        ComfyCompanionManager.getInstance().stopCpuServer();
        stopManagedOllamaServer();
        await tabby.offloadGpu('shutdown');
        db.close();
      } catch {}
      process.exit(0);
    }, 400);
    return { status: 'shutting_down' };
  });

  app.post('/v1/model/load', async (req) => {
    const body = (req.body || {}) as { tier?: ModelTier; model_name?: string };
    const tier: ModelTier =
      body.tier || (body.model_name?.includes('27B') ? 'high' : body.model_name?.includes('4B') ? 'low' : 'medium');
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
          message: { role: 'assistant', content: res.content, reasoning_content: res.thinkingContent },
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

  app.post('/api/tabby/tier', async (req) => {
    const { tier, thread_id } = (req.body || {}) as { tier: ModelTier; thread_id?: string };
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
    if (thread_id) db.updateThread(thread_id, { active_model_tier: tier });
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

  // ==================== MODULAR ROUTE PLUGINS ====================
  const routeCtx: RouteContext = {
    app,
    repoRoot: REPO_ROOT,
    ports,
    db,
    tabby,
    mcp,
    skills,
    terminal,
    tools,
    harness,
    attachmentManager,
    providerRegistry,
    taskMgr,
    subagentMgr,
    artifactMgr,
    swarmMgr,
    activeAbortControllers,
    activeTurns,
    broadcastSync,
    applyBrainProviderUpdate,
    handlePromptTurn,
    stopGenerationHandler,
  };

  registerProjectRoutes(routeCtx);
  registerThreadRoutes(routeCtx);
  registerHarnessRoutes(routeCtx, pkgVersion);
  registerWorkspaceRoutes(routeCtx);
  registerUpdaterRoutes(routeCtx);
  registerComfyuiRoutes(routeCtx);

  const automationStore = createAutomationStore(REPO_ROOT);
  registerAutomationRoutes(routeCtx, automationStore);
  startAutomationCronRunner({
    app,
    db,
    readAutomations: automationStore.readAutomations,
    writeAutomations: automationStore.writeAutomations,
    broadcastSync,
    handlePromptTurn,
  });

  // ==================== WEBSOCKET MULTIPLEXING ====================
  const buildComfyStudioSnapshot = () => {
    const mgr = ComfyCompanionManager.getInstance();
    const wfDir = getPathsConfig().comfyWorkflowsDir;
    let workflows: string[] = [];
    if (fs.existsSync(wfDir)) {
      try {
        workflows = fs
          .readdirSync(wfDir)
          .filter((f) => f.toLowerCase().endsWith('.json') && !f.startsWith('.'))
          .sort();
      } catch {}
    }
    return { config: mgr.getConfig(), capabilities: mgr.getCapabilities(), workflows };
  };

  const buildLiveComfyStudioSnapshot = async () => {
    const base = buildComfyStudioSnapshot();
    const liveCaps = await ComfyCompanionManager.getInstance().getLiveCapabilities();
    return { ...base, capabilities: liveCaps };
  };

  const handleWsConnection = (socket: WebSocket, initialThreadId?: string) => {
    syncClients.add(socket);
    void ensureModelsWarmedOnClientConnect();
    void buildLiveComfyStudioSnapshot()
      .then((snap) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'COMFY_CONFIG_UPDATED', payload: snap }));
        }
      })
      .catch(() => {});

    const projects = db.listProjects();
    const activeProject = projects[0] || db.ensureDefaultProject(REPO_ROOT);
    const threads = db.listThreads(activeProject.id);
    const targetThreadId = initialThreadId || threads[0]?.id;
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
          messages: targetThreadId ? db.listMessages(targetThreadId) : [],
          activeStreams: targetThreadId ? db.getActiveStreamsForThread(targetThreadId) : [],
          activeTurn: targetThreadId ? activeTurns.get(targetThreadId) || null : null,
          checkpoints: targetThreadId ? db.listFileCheckpoints(targetThreadId) : [],
          mcpServers: mcp.listServers(),
          tabby: tabbyTel,
          brainProvider: tabby.getBrainProviderPublicConfig(),
          comfyStudio: buildComfyStudioSnapshot(),
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
          socket.send(
            JSON.stringify({
              type: 'SYNC_STATE',
              payload: {
                ports,
                projects: db.listProjects(),
                threads: db.listThreads(payload?.project_id),
                activeThreadId: reqThreadId,
                messages: reqThreadId ? db.listMessages(reqThreadId) : [],
                activeStreams: reqThreadId ? db.getActiveStreamsForThread(reqThreadId) : [],
                activeTurn: reqThreadId ? activeTurns.get(reqThreadId) || null : null,
                checkpoints: reqThreadId ? db.listFileCheckpoints(reqThreadId) : [],
                mcpServers: mcp.listServers(),
                tabby: tabby.getTelemetry(),
                brainProvider: tabby.getBrainProviderPublicConfig(),
                comfyStudio: buildComfyStudioSnapshot(),
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
              payload: { brainHost: os.hostname(), edgeHosts: EdgeBridgeManager.getInstance().listClients() },
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
        } else if (type === 'COMFY_CONFIG_UPDATE') {
          ComfyCompanionManager.getInstance().updateConfig(payload || {});
          void buildLiveComfyStudioSnapshot().then((snap) => {
            broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload: snap });
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
            db.updateThread(payload.thread_id || payload.session_id, { active_model_tier: newTier });
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
            pendingEdgeRpc.delete(payload?.request_id);
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
          broadcastSync({ type: 'ARTIFACT_SYNC', payload });
        } else if (type === 'TASK_INPUT') {
          const taskId = payload?.task_id;
          if (!taskId) return;
          if (typeof payload.data === 'string') {
            const ok = taskMgr.sendInputToTask(taskId, payload.data);
            if (!ok) {
              console.log(`[TaskInput] Task ${taskId} has no live stdin (exited, not running, or non-interactive)`);
            }
          }
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
        payload: { brainHost: os.hostname(), edgeHosts: EdgeBridgeManager.getInstance().listClients() },
      });
    });
  };

  app.get('/ws/sync', { websocket: true }, (socket) => handleWsConnection(socket));
  app.get('/ws/agent/:sessionId', { websocket: true }, (socket, req) => {
    const { sessionId } = req.params as { sessionId: string };
    handleWsConnection(socket, sessionId);
  });

  app.get('/ws/terminal', { websocket: true }, (socket) => {
    terminalClients.add(socket);
    socket.send(JSON.stringify({ type: 'TERMINAL_HISTORY', chunk: terminal.getHistory() }));
    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString('utf-8'));
        if (msg.type === 'TERMINAL_INPUT' && typeof msg.data === 'string') terminal.writeInput(msg.data);
        else if (msg.type === 'TERMINAL_EXEC' && typeof msg.command === 'string') void terminal.executeCommand(msg.command);
      } catch {
        terminal.writeInput(raw.toString('utf-8'));
      }
    });
    socket.on('close', () => terminalClients.delete(socket));
  });

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

  app.addHook('onClose', async () => {
    clearInterval(telemetryInterval);
    ComfyCompanionManager.getInstance().stopCpuServer();
    stopManagedOllamaServer();
  });

  const clientDistPath = path.join(REPO_ROOT, 'client', 'dist');
  if (fs.existsSync(clientDistPath)) {
    await app.register(fastifyStatic, { root: clientDistPath, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/') || req.url.startsWith('/v1/')) {
        reply.code(404).send({ error: 'Not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  return { app, ports, db, tabby, mcp, skills, terminal, tools, harness, broadcastSync };
}

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
