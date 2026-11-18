import os from 'node:os';
import path from 'node:path';
import { EdgeBridgeManager } from '../bridge/edgeBridge.js';
import type { RouteContext } from './types.js';

export function registerProjectRoutes(ctx: RouteContext): void {
  const { app, db, repoRoot, harness, terminal, broadcastSync } = ctx;

  app.get('/api/projects', async () => {
    return { projects: db.listProjects() };
  });

  app.post('/api/projects', async (req) => {
    const body = (req.body || {}) as any;
    const resolvedRoot = body.root_path && body.root_path !== '.' ? body.root_path : repoRoot;
    const hostName =
      typeof body.host_name === 'string' && body.host_name.trim() ? body.host_name.trim() : os.hostname();
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
}
