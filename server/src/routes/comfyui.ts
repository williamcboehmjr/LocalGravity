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

function listWorkflowNames(): string[] {
  const dir = getPathsConfig().comfyWorkflowsDir;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.json') && !f.startsWith('.'))
    .map((f) => ({ name: f, mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((x) => x.name);
}

export async function buildLiveComfyPayload() {
  const mgr = ComfyCompanionManager.getInstance();
  return {
    config: mgr.getConfig(),
    capabilities: await mgr.getLiveCapabilities(),
    workflows: listWorkflowNames(),
    comfyRunning: await isComfyHealthy(),
  };
}

export async function applyComfyConfigAndSwitch(params: {
  patch: Partial<ComfyStudioConfig>;
  broadcastSync: (event: Record<string, any>) => void;
  forceSwitch?: boolean;
}) {
  const { patch, broadcastSync, forceSwitch = false } = params;
  const mgr = ComfyCompanionManager.getInstance();
  const prev = mgr.getConfig();
  const next = mgr.updateConfig(patch);

  const shouldTriggerSwitch =
    forceSwitch ||
    prev.studioMode !== next.studioMode ||
    prev.companionBrain !== next.companionBrain ||
    prev.ollamaModel !== next.ollamaModel ||
    (next.studioMode && patch.studioMode === true);

  let switchingMessage: string | null = null;
  if (shouldTriggerSwitch) {
    const eff = mgr.resolveEffectiveBrain(next);
    if (next.studioMode && eff === 'ollama_vision') {
      switchingMessage = `Dropping Strata & loading ${mgr.resolveOllamaModel(next)}...`;
    } else if (next.studioMode && mgr.isZeroVramBrain(next)) {
      switchingMessage = 'Freeing GPU VRAM for ComfyUI Studio...';
    } else if (!next.studioMode) {
      switchingMessage = 'Unloading Ollama & waking Strata...';
    }
  }

  const initialPayload = {
    ...(await buildLiveComfyPayload()),
    switching: shouldTriggerSwitch,
    switchingMessage,
  };
  broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload: initialPayload });

  if (shouldTriggerSwitch) {
    void mgr
      .prepareStudioEngineSwitch((evt) => {
        broadcastSync({
          type: 'MODEL_STATE',
          payload: {
            status: evt.switching ? 'swapping' : 'ready',
            active_model: evt.activeModel,
            status_text: evt.statusText,
          },
        });
      })
      .then(async () => {
        const donePayload = {
          ...(await buildLiveComfyPayload()),
          switching: false,
          switchingMessage: null,
        };
        broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload: donePayload });
      })
      .catch(() => {});
  }

  return initialPayload;
}

export function registerComfyuiRoutes(ctx: RouteContext): void {
  const { app, broadcastSync } = ctx;

  app.get('/api/comfyui/config', async () => {
    return await buildLiveComfyPayload();
  });

  app.post('/api/comfyui/config', async (req) => {
    const body = (req.body || {}) as Partial<ComfyStudioConfig>;
    return await applyComfyConfigAndSwitch({
      patch: body,
      broadcastSync,
    });
  });

  app.post('/api/comfyui/free-vram', async () => {
    const freed = await freeComfyVram();
    return { freed };
  });

  app.post('/api/comfyui/ollama/unload', async () => {
    const res = await unloadAllOllamaModels();
    const payload = await buildLiveComfyPayload();
    broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload });
    return { ...res, capabilities: payload.capabilities };
  });

  app.post('/api/comfyui/ollama/start', async () => {
    const started = await ensureOllamaServerRunning();
    const payload = await buildLiveComfyPayload();
    broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload });
    return { ...started, ...payload };
  });

  app.post('/api/comfyui/ollama/pull', async (req, reply) => {
    const model = String((req.body as any)?.model || '').trim();
    if (!model) {
      return reply.code(400).send({ ok: false, error: 'Missing "model" parameter' });
    }
    const pullRes = await pullOllamaModel(model);
    const payload = await buildLiveComfyPayload();
    broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload });
    return { ...pullRes, model, capabilities: payload.capabilities };
  });
}
