import fs from 'node:fs';
import path from 'node:path';
import type { RouteContext } from './types.js';
import { getPathsConfig } from '../core/pathsConfig.js';
import { ComfyCompanionManager } from '../tools/handlers/comfyui/comfyCompanion.js';
import { freeComfyVram, isComfyHealthy } from '../tools/handlers/comfyui/comfyClient.js';
import {
  ensureOllamaServerRunning,
  pullOllamaModel,
  unloadAllOllamaModels,
} from '../tools/handlers/comfyui/ollamaClient.js';
import type { ComfyStudioConfig } from '../core/protocol.js';

export function registerComfyuiRoutes(ctx: RouteContext): void {
  const { app, broadcastSync } = ctx;

  const listWorkflowNames = (): string[] => {
    const dir = getPathsConfig().comfyWorkflowsDir;
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.json') && !f.startsWith('.'))
      .map((f) => ({ name: f, mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map((x) => x.name);
  };

  const buildLivePayload = async () => {
    const mgr = ComfyCompanionManager.getInstance();
    return {
      config: mgr.getConfig(),
      capabilities: await mgr.getLiveCapabilities(),
      workflows: listWorkflowNames(),
      comfyRunning: await isComfyHealthy(),
    };
  };

  app.get('/api/comfyui/config', async () => {
    return await buildLivePayload();
  });

  app.post('/api/comfyui/config', async (req) => {
    const body = (req.body || {}) as Partial<ComfyStudioConfig>;
    ComfyCompanionManager.getInstance().updateConfig(body);
    const payload = await buildLivePayload();
    broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload });
    return payload;
  });

  app.post('/api/comfyui/free-vram', async () => {
    const freed = await freeComfyVram();
    return { freed };
  });

  app.post('/api/comfyui/ollama/unload', async () => {
    const res = await unloadAllOllamaModels();
    const payload = await buildLivePayload();
    broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload });
    return { ...res, capabilities: payload.capabilities };
  });

  app.post('/api/comfyui/ollama/start', async () => {
    const started = await ensureOllamaServerRunning();
    const payload = await buildLivePayload();
    broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload });
    return { ...started, ...payload };
  });

  app.post('/api/comfyui/ollama/pull', async (req, reply) => {
    const model = String((req.body as any)?.model || '').trim();
    if (!model) {
      return reply.code(400).send({ ok: false, error: 'Missing "model" parameter' });
    }
    const pullRes = await pullOllamaModel(model);
    const payload = await buildLivePayload();
    broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload });
    return { ...pullRes, model, capabilities: payload.capabilities };
  });
}
