import fs from 'node:fs';
import path from 'node:path';
import type { ProviderProfile } from '../providers/providerRegistry.js';
import type { PermissionRule } from '../tools/permissionEngine.js';
import type { RouteContext } from './types.js';

export function registerHarnessRoutes(ctx: RouteContext, pkgVersion: string): void {
  const {
    app,
    repoRoot,
    tools,
    harness,
    skills,
    mcp,
    providerRegistry,
    taskMgr,
    subagentMgr,
    artifactMgr,
    swarmMgr,
    broadcastSync,
  } = ctx;

  // ==================== TASKS, SUBAGENTS, ARTIFACTS & MCP OUTPUTS ====================
  app.get('/api/tasks', async () => ({
    tasks: taskMgr.listTasks(),
    subagents: subagentMgr.listTasks(),
  }));

  app.get('/api/subagents/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = subagentMgr.getTask(id);
    if (!task) return reply.code(404).send({ error: 'Subagent task not found' });
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
    return { ok: taskMgr.sendInputToTask(id, String(body.input || '')) };
  });

  app.get('/api/artifacts', async (req) => {
    const { thread_id } = (req.query || {}) as { thread_id?: string };
    return { artifacts: artifactMgr.listArtifacts(thread_id) };
  });

  app.get('/api/artifacts/:id/raw', async (req, reply) => {
    const { id } = req.params as { id: string };
    const artifact =
      artifactMgr.getArtifact(id) ||
      artifactMgr.listArtifacts().find((a) => a.id === `artifact-${id}` || a.title.toLowerCase() === id.toLowerCase());
    if (!artifact) return reply.code(404).send({ error: `Artifact "${id}" not found` });
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
    if (!updated) return reply.code(404).send({ error: `Artifact "${id}" not found` });
    return { ok: true, artifact: updated };
  });

  app.get('/api/mcp-outputs/:filename', async (req, reply) => {
    const safeName = path.basename(String((req.params as any).filename || ''));
    if (!safeName) return reply.code(400).send({ error: 'Invalid filename' });
    const fullPath = path.join(repoRoot, '.runtime', 'mcp-outputs', safeName);
    if (!fs.existsSync(fullPath)) return reply.code(404).send({ error: 'Output image not found' });
    const ext = path.extname(safeName).toLowerCase();
    const mime =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.mp4'
              ? 'video/mp4'
              : ext === '.webm'
                ? 'video/webm'
                : ext === '.wav'
                  ? 'audio/wav'
                  : ext === '.mp3'
                    ? 'audio/mpeg'
                    : 'image/png';
    return reply.type(mime).send(fs.readFileSync(fullPath));
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
    if (!text) return reply.code(400).send({ error: 'text is required' });
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

  // ==================== HARNESS² 8-COMPONENT & PROPOSE-PROBE-COMPOSE API ====================
  app.get('/api/harness/components', async (req) => {
    const { root_path } = (req.query || {}) as { root_path?: string };
    const targetRoot = root_path && root_path !== '.' ? root_path : repoRoot;
    return {
      workspaceRoot: targetRoot.replace(/\\/g, '/'),
      components: harness.listHarnessComponents(targetRoot),
      ppcHistory: harness.getPpcHistory(),
    };
  });

  app.put('/api/harness/component', async (req) => {
    const body = (req.body || {}) as { root_path?: string; relative_path: string; content: string };
    const targetRoot = body.root_path && body.root_path !== '.' ? body.root_path : repoRoot;
    const components = harness.updateHarnessFile(targetRoot, body.relative_path, body.content);
    broadcastSync({
      type: 'HARNESS_UPDATED',
      payload: { workspaceRoot: targetRoot.replace(/\\/g, '/'), components },
    });
    return { components };
  });

  app.post('/api/harness/ppc', async (req) => {
    const body = (req.body || {}) as { root_path?: string; tool_name?: string; command?: string; stderr?: string };
    const targetRoot = body.root_path && body.root_path !== '.' ? body.root_path : repoRoot;
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
          { threadId: 'ppc-probe', messageId: 'ppc-msg', workspaceRoot: targetRoot }
        );
        return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
      },
    });

    broadcastSync({
      type: 'HARNESS_PPC_COMPLETED',
      payload: { cycle, components: harness.listHarnessComponents(targetRoot) },
    });
    return { cycle, components: harness.listHarnessComponents(targetRoot) };
  });

  // ==================== PROVIDERS, PERMISSIONS, OPENAPI, SKILLS & MCP ====================
  app.get('/api/providers', async () => ({
    activeProvider: providerRegistry.getActiveProfile(),
    profiles: providerRegistry.listProfiles(),
  }));

  app.post('/api/providers', async (req, reply) => {
    const body = (req.body || {}) as { activeProviderId?: string; profile?: ProviderProfile };
    try {
      if (body.profile) providerRegistry.upsertProfile(body.profile);
      if (body.activeProviderId) providerRegistry.setActiveProfile(body.activeProviderId);
      return {
        activeProvider: providerRegistry.getActiveProfile(),
        profiles: providerRegistry.listProfiles(),
      };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Invalid provider request' });
    }
  });

  app.post('/api/providers/test', async (req) => {
    const { id } = (req.body || {}) as { id: string };
    return providerRegistry.probeProfileHealth(id);
  });

  app.get('/api/permissions', async () => ({ rules: tools.getPermissionEngine().listRules() }));

  app.post('/api/permissions', async (req) => {
    const body = (req.body || {}) as { rules?: PermissionRule[]; rule?: PermissionRule; deleteId?: string };
    const permEngine = tools.getPermissionEngine();
    if (body.deleteId) return { rules: permEngine.deleteRule(body.deleteId) };
    if (body.rule) return { rules: permEngine.upsertRule(body.rule) };
    if (Array.isArray(body.rules)) return { rules: permEngine.saveRules(body.rules) };
    return { rules: permEngine.listRules() };
  });

  app.get('/api/openapi.json', async () => ({
    openapi: '3.1.0',
    info: {
      title: 'LocalGravity Central Brain API',
      version: pkgVersion,
      description: 'Local-first, cloud-optional autonomous AI engineering daemon API.',
    },
    paths: {
      '/api/health': { get: { summary: 'Daemon & hardware health' } },
      '/api/projects': { get: { summary: 'List projects' }, post: { summary: 'Create project' } },
      '/api/threads': { get: { summary: 'List threads' }, post: { summary: 'Create thread' } },
      '/api/comfyui/config': { get: { summary: 'Get ComfyUI Studio config & fast companion state' }, post: { summary: 'Update ComfyUI Studio config' } },
      '/api/checkpoints/{id}/revert': { post: { summary: 'Revert single file checkpoint' } },
      '/api/checkpoints/{id}/rewind': { post: { summary: 'Revert files and rewind thread messages to checkpoint' } },
      '/api/providers': { get: { summary: 'List local/cloud provider profiles' }, post: { summary: 'Switch active or upsert provider profile' } },
      '/api/providers/test': { post: { summary: 'Probe provider endpoint health' } },
      '/api/permissions': { get: { summary: 'List granular allow/ask/deny tool rules' }, post: { summary: 'Save or update permission rules' } },
      '/api/mcp/servers': { get: { summary: 'List configured MCP servers & active tools' } },
      '/api/mcp/toggle': { post: { summary: 'Enable or disable an MCP server (persisted)' } },
      '/api/skills': { get: { summary: 'List discovered workspace & user skills' } },
      '/api/swarm/{threadId}': { get: { summary: 'Inspect swarm roster and board messages' } },
    },
  }));

  app.get('/api/skills', async () => ({ skills: skills.listSkills() }));

  app.post('/api/reload', async () => {
    const discoveredSkills = skills.discoverSkills();
    harness.ensureWorkspaceHarness(repoRoot);
    const components = harness.listHarnessComponents(repoRoot);
    const mcpServers = mcp.loadConfig();
    const permRules = tools.getPermissionEngine().reloadRules();
    const payload = {
      reloaded: true,
      skillsCount: discoveredSkills.length,
      skills: discoveredSkills,
      componentsCount: components.length,
      mcpServersCount: mcpServers.length,
      permissionRulesCount: permRules.length,
      timestamp: Date.now(),
    };
    broadcastSync({ type: 'HARNESS_RELOADED', payload });
    return payload;
  });

  app.get('/api/skills/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const skill = skills.readSkill(name);
    if (!skill) return reply.status(404).send({ error: `Skill "${name}" not found` });
    return skill;
  });

  app.get('/api/mcp/servers', async () => ({
    servers: mcp.listServers(),
    activeTools: mcp.listActiveTools(),
  }));

  app.post('/api/mcp/toggle', async (req) => {
    const { serverName, enabled } = (req.body || {}) as { serverName: string; enabled?: boolean };
    let updated = mcp.toggleServer(serverName, enabled);
    if (updated?.enabled && (updated.transport === 'http' || updated.transport === 'sse')) {
      updated = await mcp.refreshServerTools(serverName);
    }
    broadcastSync({
      type: 'MCP_STATE_UPDATED',
      payload: { servers: mcp.listServers(), activeTools: mcp.listActiveTools() },
    });
    return { server: updated, servers: mcp.listServers() };
  });
}
