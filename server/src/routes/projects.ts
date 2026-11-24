import os from 'node:os';
import path from 'node:path';
import { EdgeBridgeManager } from '../bridge/edgeBridge.js';
import type { LocalGravityDB, ModelTier, ThinkingBudget } from '../db/database.js';
import type { RouteContext } from './types.js';

const VALID_MODEL_TIERS = new Set<ModelTier>(['high', 'medium', 'low', 'inkling', 'inkling_orch']);
const VALID_THINKING_BUDGETS = new Set<ThinkingBudget>([
  'off',
  'fast',
  'deep',
  'low',
  'medium',
  'high',
  'xhigh',
]);

export type ProjectPatch = Parameters<LocalGravityDB['updateProject']>[1];

export function sanitizeProjectPatch(body: Record<string, unknown>): ProjectPatch {
  const patch: ProjectPatch = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.root_path === 'string') patch.root_path = body.root_path;
  if (typeof body.host_name === 'string') patch.host_name = body.host_name;
  if (typeof body.git_branch === 'string') patch.git_branch = body.git_branch;
  if (typeof body.default_model_tier === 'string' && VALID_MODEL_TIERS.has(body.default_model_tier as ModelTier)) {
    patch.default_model_tier = body.default_model_tier as ModelTier;
  }
  if (
    typeof body.default_thinking_budget === 'string' &&
    VALID_THINKING_BUDGETS.has(body.default_thinking_budget as ThinkingBudget)
  ) {
    patch.default_thinking_budget = body.default_thinking_budget as ThinkingBudget;
  }
  if (typeof body.custom_instructions === 'string') patch.custom_instructions = body.custom_instructions;
  if (Array.isArray(body.enabled_mcp_servers)) {
    patch.enabled_mcp_servers = body.enabled_mcp_servers.filter((s): s is string => typeof s === 'string');
  }
  if (Array.isArray(body.pinned_files)) {
    patch.pinned_files = body.pinned_files.filter((s): s is string => typeof s === 'string');
  }
  return patch;
}

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
    const body = (req.body || {}) as Record<string, unknown>;
    const patch = sanitizeProjectPatch(body);
    const project = db.updateProject(id, patch);
    if (project && typeof patch.root_path === 'string') {
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
