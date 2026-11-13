import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { LocalGravityDB } from '../db/database.js';
import { EdgeBridgeManager } from '../bridge/edgeBridge.js';
import { BuiltinToolExecutor } from '../tools/builtinTools.js';
import { SharedTerminalManager } from '../terminal/terminalManager.js';

async function runEdgeBridgeTests() {
  console.log('Running Host-Siloed Projects & EdgeBridge Unit Tests...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-edge-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new LocalGravityDB(dbPath);
  const terminal = new SharedTerminalManager(tmpDir);
  const executor = new BuiltinToolExecutor(db, terminal);
  const bridge = EdgeBridgeManager.getInstance();

  // 1. DB host_name persistence & updateProject
  const localProj = db.createProject({ name: 'LocalProj', root_path: tmpDir });
  assert.equal(localProj.host_name, os.hostname());

  const remoteProj = db.createProject({
    name: 'OpalProj',
    root_path: 'C:/Users/Mandy/Proj',
    host_name: 'opal-test-host',
  });
  assert.equal(remoteProj.host_name, 'opal-test-host');

  const updatedProj = db.updateProject(remoteProj.id, { host_name: 'opal-renamed' });
  assert.equal(updatedProj?.host_name, 'opal-renamed');

  // 2. Host silo guard: offline remote host must fail safely without touching local disk
  const offlineRes = await executor.executeTool(
    'read_file',
    { path: 'package.json' },
    {
      threadId: 'thread-offline-1',
      messageId: 'msg-1',
      workspaceRoot: tmpDir,
      projectHost: 'opal-offline-host',
    }
  );
  assert.equal(offlineRes.exitCode, 1);
  assert.ok(offlineRes.stderr.includes('currently offline'));

  // 3. Connected remote host receives EDGE_TOOL_REQUEST and resolves EDGE_TOOL_RESULT
  const sentPayloads: any[] = [];
  const fakeSocket: any = {
    send(raw: string) {
      const msg = JSON.parse(raw);
      sentPayloads.push(msg);
      if (msg.type === 'EDGE_TOOL_REQUEST') {
        setTimeout(() => {
          bridge.handleToolResult({
            request_id: msg.payload.request_id,
            stdout: 'remote-host-ok',
            stderr: '',
            exit_code: 0,
            duration_ms: 5,
          });
        }, 10);
      }
    },
  };

  bridge.registerClient('client-opal-1', fakeSocket, {
    hostname: 'OPAL-REMOTE',
    platform: 'windows',
    homeDir: 'C:\\Users\\Mandy',
  });

  const remoteRes = await executor.executeTool(
    'run_terminal',
    { command: 'python --version' },
    {
      threadId: 'thread-remote-1',
      messageId: 'msg-2',
      workspaceRoot: 'C:/Users/Mandy/Proj',
      projectHost: 'opal-remote', // case-insensitive match
    }
  );

  assert.equal(remoteRes.exitCode, 0);
  assert.equal(remoteRes.stdout, 'remote-host-ok');
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].payload.tool_name, 'run_terminal');

  bridge.unregisterSocket(fakeSocket);
  assert.equal(bridge.getClientByHost('opal-remote'), null);

  terminal.dispose();
  db.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  console.log('✅ Host-Siloed Projects & EdgeBridge Unit Tests PASSED (8/8 assertions)');
}

runEdgeBridgeTests().catch((err) => {
  console.error('❌ EdgeBridge test failed:', err);
  process.exit(1);
});
