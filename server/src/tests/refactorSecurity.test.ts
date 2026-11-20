import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { LocalGravityDB } from '../db/database.js';
import { createAutomationStore, registerAutomationRoutes } from '../routes/automations.js';
import { registerProjectRoutes, sanitizeProjectPatch } from '../routes/projects.js';
import { SharedTerminalManager } from '../terminal/terminalManager.js';
import { BuiltinToolExecutor } from '../tools/builtinTools.js';

async function runRefactorSecurityTests() {
  console.log('Running Route Whitelist & JSON Patch Security Unit Tests...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-refactor-sec-'));
  const db = new LocalGravityDB(path.join(tmpDir, 'test.db'));
  const terminal = new SharedTerminalManager(tmpDir);
  const executor = new BuiltinToolExecutor(db, terminal);
  const app = Fastify({ logger: false });

  const events: Array<Record<string, any>> = [];
  const fakeCtx: any = {
    app,
    repoRoot: tmpDir,
    db,
    terminal,
    harness: {
      ensureWorkspaceHarness: () => {},
    },
    broadcastSync: (evt: Record<string, any>) => events.push(evt),
  };

  registerProjectRoutes(fakeCtx);
  registerAutomationRoutes(fakeCtx, createAutomationStore(tmpDir));

  try {
    // 1. sanitizeProjectPatch accepts string ThinkingBudget & all updateProject fields, rejects invalid/unknown keys
    const sanitized = sanitizeProjectPatch({
      id: 'evil-overwrite',
      created_at: '1999-01-01',
      name: 'Renamed',
      default_model_tier: 'medium',
      default_thinking_budget: 'xhigh',
      custom_instructions: 'Always verify',
      host_name: 'workstation-b',
      git_branch: 'feat/test',
      enabled_mcp_servers: ['comfy-mcp', 123],
      pinned_files: ['README.md'],
    });
    assert.deepEqual(sanitized, {
      name: 'Renamed',
      default_model_tier: 'medium',
      default_thinking_budget: 'xhigh',
      custom_instructions: 'Always verify',
      host_name: 'workstation-b',
      git_branch: 'feat/test',
      enabled_mcp_servers: ['comfy-mcp'],
      pinned_files: ['README.md'],
    });
    assert.equal((sanitized as any).id, undefined);
    assert.equal((sanitized as any).created_at, undefined);

    // Invalid enum values are ignored rather than corrupting DB state
    const invalidEnumPatch = sanitizeProjectPatch({
      default_model_tier: 'invalid_tier',
      default_thinking_budget: 999,
    });
    assert.deepEqual(invalidEnumPatch, {});

    // 2. End-to-end PATCH /api/projects/:id preserves ThinkingBudget + all project fields
    const proj = db.createProject({ name: 'InitProj', root_path: tmpDir });
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${proj.id}`,
      payload: {
        id: 'blocked-id',
        name: 'UpdatedProj',
        default_model_tier: 'low',
        default_thinking_budget: 'xhigh',
        custom_instructions: 'Be concise',
        enabled_mcp_servers: ['filesystem'],
        pinned_files: ['src/index.ts'],
      },
    });
    assert.equal(patchRes.statusCode, 200);
    const updated = patchRes.json().project;
    assert.equal(updated.id, proj.id);
    assert.equal(updated.name, 'UpdatedProj');
    assert.equal(updated.default_model_tier, 'low');
    assert.equal(updated.default_thinking_budget, 'xhigh');
    assert.equal(updated.custom_instructions, 'Be concise');
    assert.deepEqual(JSON.parse(updated.enabled_mcp_servers), ['filesystem']);
    assert.deepEqual(JSON.parse(updated.pinned_files), ['src/index.ts']);

    // 3. PATCH /api/automations/:id ignores arbitrary unknown keys while applying whitelisted fields
    const listRes = await app.inject({ method: 'GET', url: '/api/automations' });
    const firstAuto = listRes.json().automations[0];
    const autoPatchRes = await app.inject({
      method: 'PATCH',
      url: `/api/automations/${firstAuto.id}`,
      payload: {
        id: 'hijacked-id',
        extraField: 'should-not-persist',
        enabled: false,
        name: 'Updated Auto',
      },
    });
    assert.equal(autoPatchRes.statusCode, 200);
    const patchedAuto = autoPatchRes.json().automations.find((a: any) => a.id === firstAuto.id);
    assert.ok(patchedAuto);
    assert.equal(patchedAuto.name, 'Updated Auto');
    assert.equal(patchedAuto.enabled, false);
    assert.equal(patchedAuto.extraField, undefined);

    // 4. patch_json blocks prototype pollution keys and records file checkpoints on set/delete
    const jsonFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(jsonFile, JSON.stringify({ theme: 'dark', nested: { flag: true } }, null, 2), 'utf-8');

    const thread = db.createThread({ project_id: proj.id, title: 'JSON Patch Thread' });
    const msg = db.createMessage({
      thread_id: thread.id,
      role: 'assistant',
      content: 'Updating config.json',
    });
    const checkpoints: any[] = [];
    const toolCtx = {
      threadId: thread.id,
      messageId: msg.id,
      workspaceRoot: tmpDir,
      onFileCheckpointCreated: (cp: any) => checkpoints.push(cp),
    };

    const protoRead = await executor.executeTool(
      'patch_json',
      { path: jsonFile, action: 'read', key_path: '__proto__.polluted' },
      toolCtx
    );
    assert.equal(protoRead.exitCode, 1);
    assert.ok(protoRead.stderr.includes('Invalid or forbidden key_path'));

    const protoSet = await executor.executeTool(
      'patch_json',
      { path: jsonFile, action: 'set', key_path: 'constructor.prototype.polluted', value: true },
      toolCtx
    );
    assert.equal(protoSet.exitCode, 1);
    assert.equal(({} as any).polluted, undefined);

    const validSet = await executor.executeTool(
      'patch_json',
      { path: jsonFile, action: 'set', key_path: 'nested.flag', value: false },
      toolCtx
    );
    assert.equal(validSet.exitCode, 0, validSet.stderr);
    assert.equal(checkpoints.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(jsonFile, 'utf-8')).nested.flag, false);

    const validDelete = await executor.executeTool(
      'patch_json',
      { path: jsonFile, action: 'delete', key_path: 'nested.flag' },
      toolCtx
    );
    assert.equal(validDelete.exitCode, 0, validDelete.stderr);
    assert.equal(checkpoints.length, 2);
    assert.equal('flag' in JSON.parse(fs.readFileSync(jsonFile, 'utf-8')).nested, false);

    console.log('✅ Route Whitelist & JSON Patch Security Unit Tests PASSED');
  } finally {
    await app.close();
    terminal.dispose();
    db.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

runRefactorSecurityTests().catch((err) => {
  console.error('❌ Route Whitelist & JSON Patch Security Unit Tests FAILED:', err);
  process.exit(1);
});
