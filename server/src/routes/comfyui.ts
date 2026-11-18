import fs from 'node:fs';
import path from 'node:path';
import type { RouteContext } from './types.js';
import { getPathsConfig } from '../core/pathsConfig.js';
import { ComfyCompanionManager } from '../tools/handlers/comfyui/comfyCompanion.js';
import { freeComfyVram, isComfyHealthy } from '../tools/handlers/comfyui/comfyClient.js';
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

  app.get('/api/comfyui/config', async () => {
    const mgr = ComfyCompanionManager.getInstance();
    return {
      config: mgr.getConfig(),
      capabilities: mgr.getCapabilities(),
      workflows: listWorkflowNames(),
      comfyRunning: await isComfyHealthy(),
    };
  });

  app.post('/api/comfyui/config', async (req) => {
    const body = (req.body || {}) as Partial<ComfyStudioConfig>;
    const mgr = ComfyCompanionManager.getInstance();
    const config = mgr.updateConfig(body);
    const payload = {
      config,
      capabilities: mgr.getCapabilities(),
      workflows: listWorkflowNames(),
      comfyRunning: await isComfyHealthy(),
    };
    broadcastSync({ type: 'COMFY_CONFIG_UPDATED', payload });
    return payload;
  });

  app.post('/api/comfyui/free-vram', async () => {
    const freed = await freeComfyVram();
    return { freed };
  });
}
