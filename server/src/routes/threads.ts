import fs from 'node:fs';
import path from 'node:path';
import type { ModelTier, ThinkingBudget, ThreadStatus } from '../db/database.js';
import type { GoogleModelId } from '../google/googleAiEngine.js';
import type { RawAttachmentInput } from '../files/attachmentManager.js';
import type { RouteContext } from './types.js';

const VALID_MODEL_TIERS = new Set<ModelTier>(['low', 'medium', 'high']);
const VALID_THINKING_BUDGETS = new Set<ThinkingBudget>(['off', 'fast', 'deep', 'low', 'medium', 'high', 'xhigh']);
const VALID_THREAD_STATUSES = new Set<ThreadStatus>([
  'idle',
  'thinking',
  'executing_tool',
  'awaiting_approval',
  'error',
]);

export function registerThreadRoutes(ctx: RouteContext): void {
  const {
    app,
    repoRoot,
    db,
    activeAbortControllers,
    activeTurns,
    attachmentManager,
    broadcastSync,
    applyBrainProviderUpdate,
    handlePromptTurn,
    stopGenerationHandler,
  } = ctx;

  app.get('/api/threads', async (req) => {
    const { project_id } = (req.query || {}) as { project_id?: string };
    return { threads: db.listThreads(project_id) };
  });

  app.post('/api/threads', async (req) => {
    const body = (req.body || {}) as any;
    const projectId = body.project_id || db.ensureDefaultProject(repoRoot).id;
    const thread = db.createThread({
      project_id: projectId,
      title: body.title || 'New Thread',
      active_model_tier: body.active_model_tier || 'high',
      active_thinking_budget: body.active_thinking_budget || 'fast',
    });
    broadcastSync({ type: 'THREAD_CREATED', payload: { thread } });
    return { thread };
  });

  app.patch('/api/threads/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as Record<string, any>;
    const updates: Partial<{
      title: string;
      status: ThreadStatus;
      active_model_tier: ModelTier;
      active_thinking_budget: ThinkingBudget;
      kv_prefix_hash: string;
    }> = {};

    if (typeof body.title === 'string' && body.title.trim()) {
      updates.title = body.title.trim();
    }
    if (typeof body.active_model_tier === 'string' && VALID_MODEL_TIERS.has(body.active_model_tier as ModelTier)) {
      updates.active_model_tier = body.active_model_tier as ModelTier;
    }
    if (
      typeof body.active_thinking_budget === 'string' &&
      VALID_THINKING_BUDGETS.has(body.active_thinking_budget as ThinkingBudget)
    ) {
      updates.active_thinking_budget = body.active_thinking_budget as ThinkingBudget;
    }
    if (typeof body.status === 'string' && VALID_THREAD_STATUSES.has(body.status as ThreadStatus)) {
      updates.status = body.status as ThreadStatus;
    }

    const thread = db.updateThread(id, updates);
    if (!thread) {
      return reply.status(404).send({ error: `Thread ${id} not found` });
    }
    broadcastSync({ type: 'THREAD_UPDATED', payload: { thread } });
    return { thread };
  });

  app.delete('/api/threads/:id', async (req) => {
    const { id } = req.params as { id: string };
    await stopGenerationHandler(id);
    db.deleteThread(id);
    broadcastSync({ type: 'THREAD_DELETED', payload: { threadId: id } });
    return { deleted: true };
  });

  app.post('/api/threads/:id/clear', async (req) => {
    const { id } = req.params as { id: string };
    await stopGenerationHandler(id);
    db.clearThreadMessages(id);
    broadcastSync({ type: 'THREAD_CLEARED', payload: { threadId: id } });
    return { cleared: true };
  });

  app.post('/api/threads/:id/branch', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { message_id?: string; title?: string };
    try {
      const res = db.branchThreadFromMessage(id, body.message_id, body.title);
      broadcastSync({
        type: 'THREAD_CREATED',
        payload: {
          thread: res.thread,
          parentThreadId: id,
          branchedFromMessageId: body.message_id,
        },
      });
      return res;
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Failed to branch thread' });
    }
  });

  app.post('/api/threads/:id/rewind', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { message_id: string; revert_files?: boolean };
    if (!body.message_id) {
      return reply.status(400).send({ error: 'message_id is required' });
    }
    try {
      await stopGenerationHandler(id);
      const res = db.rewindThreadToMessage(id, body.message_id, body.revert_files !== false);
      broadcastSync({ type: 'THREAD_REWOUND', payload: { ...res } });
      return res;
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Failed to rewind thread' });
    }
  });

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
    const body = (req.body || {}) as {
      thread_id?: string;
      session_id?: string;
      turn_id?: string;
      turnId?: string;
      message_id?: string;
    };
    return await stopGenerationHandler(
      body.thread_id || body.session_id,
      body.turn_id || body.turnId || body.message_id
    );
  });

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
    broadcastSync({ type: 'CHECKPOINT_REVERTED', payload: { checkpointId: id, ...result } });
    return result;
  });

  app.post('/api/checkpoints/:id/rewind', async (req, reply) => {
    const { id } = req.params as { id: string };
    const cp = db.getFileCheckpoint(id);
    if (!cp) {
      return reply.status(404).send({ error: `Checkpoint ${id} not found` });
    }
    await stopGenerationHandler(cp.thread_id);
    const result = db.revertCheckpointAndRewindThread(id);
    broadcastSync({ type: 'CHECKPOINT_REVERTED', payload: { checkpointId: id, ...result } });
    return result;
  });

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
    reply.header('Content-Type', mimeMap[ext] || 'application/octet-stream');
    return reply.send(fs.createReadStream(filePath));
  });

  app.post('/api/threads/:id/upload', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as RawAttachmentInput;
    return await attachmentManager.saveAttachment(id, body);
  });

  app.post('/api/threads/:id/prompt', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as {
      prompt: string;
      tier?: ModelTier;
      thinking_budget?: ThinkingBudget;
      google_model?: GoogleModelId;
      attachments?: any[];
    };
    if (activeAbortControllers.has(id)) {
      await stopGenerationHandler(id);
    }
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
    }).catch((err) => {
      if (err?.name === 'AbortError' || err?.message?.toLowerCase().includes('abort')) return;
      console.error('[CentralBrain] Error in HTTP prompt turn:', err);
    });

    return { accepted: true, threadId: id, tier, thinkingBudget: budget };
  });
}
