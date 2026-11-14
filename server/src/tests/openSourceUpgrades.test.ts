import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildCompactRepoMap } from '../tools/repoMap.js';
import { LspDiagnosticsManager } from '../tools/lspManager.js';
import { PermissionEngine } from '../tools/permissionEngine.js';
import { ProviderRegistry } from '../providers/providerRegistry.js';
import { Harness2Manager } from '../harness/harnessManager.js';
import { parseAntigravitySlashCommand } from '../agent/slashCommands.js';
import { LocalGravityDB } from '../db/database.js';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('buildCompactRepoMap extracts exported symbols from workspace', () => {
  const tmp = makeTempDir('lg-repomap-');
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'src', 'math.ts'),
      'export function addNumbers(a: number, b: number) { return a + b; }\nexport interface CalcConfig { precision: number; }\n',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tmp, 'src', 'index.ts'),
      'import { addNumbers } from "./math.js";\nexport function runCalc() { return addNumbers(1, 2); }\n',
      'utf-8'
    );

    const map = buildCompactRepoMap(tmp, 2000);
    assert.ok(map.includes('src/math.ts'));
    assert.ok(map.includes('addNumbers'));
    assert.ok(map.includes('CalcConfig'));
    assert.ok(map.includes('runCalc'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('LspDiagnosticsManager detects broken TS/JSON syntax and extracts symbols', () => {
  const tmp = makeTempDir('lg-lsp-');
  try {
    const lsp = new LspDiagnosticsManager();

    const badJsonPath = path.join(tmp, 'broken.json');
    fs.writeFileSync(badJsonPath, '{"hello": }', 'utf-8');
    const jsonDiags = lsp.checkFileDiagnostics(badJsonPath);
    assert.ok(jsonDiags.length >= 1, 'Expected JSON syntax diagnostic');

    const badTsPath = path.join(tmp, 'broken.ts');
    fs.writeFileSync(badTsPath, 'export function ok() {}\nexport const broken = ;\n', 'utf-8');
    const tsDiags = lsp.checkFileDiagnostics(badTsPath);
    assert.ok(tsDiags.length >= 1, 'Expected TypeScript syntax diagnostic');
    assert.ok(lsp.formatPostEditDiagnosticNote(badTsPath).includes('LSP Auto-Check'));

    const symbols = lsp.extractSymbols(badTsPath);
    assert.ok(symbols.some((s) => s.name === 'ok' && s.kind === 'function'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('PermissionEngine evaluates defaults and persists custom rules', () => {
  const tmp = makeTempDir('lg-perm-');
  try {
    const engine = new PermissionEngine(tmp);
    assert.equal(engine.evaluate('read_file', { path: 'README.md' }).decision, 'allow');
    assert.equal(engine.evaluate('run_terminal', { command: 'git status --short' }).decision, 'allow');
    assert.equal(engine.evaluate('run_terminal', { command: 'sudo rm -rf / --no-preserve-root' }).decision, 'deny');

    engine.upsertRule({
      id: 'ask-parallel-mcp',
      toolPattern: 'mcp_parallel_*',
      action: 'ask',
      description: 'Confirm cloud search calls',
    });

    const reloaded = new PermissionEngine(tmp);
    assert.equal(reloaded.evaluate('mcp_parallel_web_search', {}).decision, 'ask');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ProviderRegistry defaults to local strata and persists custom endpoints', () => {
  const tmp = makeTempDir('lg-prov-');
  try {
    const reg = new ProviderRegistry(tmp);
    const initial = reg.getActiveProfile();
    assert.equal(initial.id, 'strata');
    assert.equal(initial.isLocal, true);

    reg.upsertProfile({
      id: 'custom-vllm',
      name: 'Local vLLM',
      kind: 'openai_compatible',
      baseUrl: 'http://127.0.0.1:8000/v1',
      defaultModel: 'qwen3-coder',
      models: ['qwen3-coder'],
      isLocal: true,
      enabled: true,
    });
    reg.setActiveProfile('custom-vllm');

    const reloaded = new ProviderRegistry(tmp);
    assert.equal(reloaded.getActiveProfile().id, 'custom-vllm');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Harness2Manager auto-discovers AGENTS.md and .clinerules', () => {
  const tmp = makeTempDir('lg-harness-');
  try {
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'Always prefer strict TypeScript.', 'utf-8');
    fs.writeFileSync(path.join(tmp, '.clinerules'), 'Run unit tests after every edit.', 'utf-8');

    const mgr = new Harness2Manager();
    const compiled = mgr.buildCompiledHarnessPrompt(tmp);
    assert.ok(compiled.includes('Always prefer strict TypeScript.'));
    assert.ok(compiled.includes('Run unit tests after every edit.'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('parseAntigravitySlashCommand handles leading and mid-sentence commands', () => {
  const leading = parseAntigravitySlashCommand('/swarm build a calculator');
  assert.equal(leading.command, '/swarm');
  assert.equal(leading.cleanPrompt, 'build a calculator');

  const midSentence = parseAntigravitySlashCommand('build a calculator with /swarm');
  assert.equal(midSentence.command, '/swarm');
  assert.equal(midSentence.cleanPrompt, 'build a calculator with');
});

test('LocalGravityDB revertCheckpointAndRewindThread restores file and rewinds newer messages', () => {
  const tmp = makeTempDir('lg-rewind-');
  const dbPath = path.join(tmp, 'test.sqlite');
  let db: LocalGravityDB | null = null;
  try {
    db = new LocalGravityDB(dbPath);
    const proj = db.ensureDefaultProject(tmp);
    const thread = db.createThread({ project_id: proj.id, title: 'Rewind Test' });

    const m1 = db.createMessage({ thread_id: thread.id, role: 'user', content: 'step 1' });
    const targetFile = path.join(tmp, 'demo.txt');
    fs.writeFileSync(targetFile, 'v1\n', 'utf-8');

    const cp1 = db.createFileCheckpoint({
      thread_id: thread.id,
      message_id: m1.id,
      file_path: targetFile,
      previous_content_blob: 'v0\n',
      new_content_blob: 'v1\n',
    });

    // Simulate a later message + edit after cp1
    (db as any).db
      .prepare("UPDATE file_checkpoints SET created_at = '2026-01-01T00:00:01.000Z' WHERE id = ?")
      .run(cp1.id);
    (db as any).db
      .prepare("UPDATE messages SET created_at = '2026-01-01T00:00:01.000Z' WHERE id = ?")
      .run(m1.id);

    const m2 = db.createMessage({ thread_id: thread.id, role: 'assistant', content: 'step 2 edit' });
    (db as any).db
      .prepare("UPDATE messages SET created_at = '2026-01-01T00:00:02.000Z' WHERE id = ?")
      .run(m2.id);

    fs.writeFileSync(targetFile, 'v2\n', 'utf-8');
    const cp2 = db.createFileCheckpoint({
      thread_id: thread.id,
      message_id: m2.id,
      file_path: targetFile,
      previous_content_blob: 'v1\n',
      new_content_blob: 'v2\n',
    });
    (db as any).db
      .prepare("UPDATE file_checkpoints SET created_at = '2026-01-01T00:00:02.000Z' WHERE id = ?")
      .run(cp2.id);

    const res = db.revertCheckpointAndRewindThread(cp1.id);
    assert.equal(res.reverted, true);
    assert.equal(res.rewound, true);
    assert.equal(fs.readFileSync(targetFile, 'utf-8'), 'v0\n');
    assert.equal(res.checkpoints.length, 0);
    assert.equal(res.messages.length, 1);
    assert.equal(res.messages[0].id, m1.id);
  } finally {
    try { (db as any)?.db?.close(); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
