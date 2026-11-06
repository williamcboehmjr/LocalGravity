#!/usr/bin/env node
/**
 * LocalGravity 2.0 Node Startup Orchestrator & Dynamic Port Allocator
 * - Strictly forbids ports 5000 and 5001 under all circumstances.
 * - Dynamically allocates free TCP ports starting at 3390 (Fastify Core) and 3450 (TabbyAPI).
 * - Atomically writes `.runtime/ports.json` and `client/public/runtime-ports.json`.
 * - Starts the Fastify Headless Daemon, triggers SysRAM pre-warming, and prints Local & LAN URLs.
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const SERVER_DIR = path.join(SCRIPT_DIR, 'server');
const RUNTIME_DIR = path.join(SCRIPT_DIR, '.runtime');
const PORTS_FILE = path.join(RUNTIME_DIR, 'ports.json');

const FORBIDDEN_PORTS = new Set([5000, 5001]);

function isPortFree(port, host = '0.0.0.0') {
  if (FORBIDDEN_PORTS.has(port)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host, exclusive: true }, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findFreePort(startPort, reserved) {
  let candidate = startPort;
  for (let i = 0; i < 250; i++, candidate++) {
    if (FORBIDDEN_PORTS.has(candidate) || reserved.has(candidate)) continue;
    if (await isPortFree(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Unable to find free TCP port starting at ${startPort}`);
}

function detectLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const netInfo of nets[name] || []) {
      if (netInfo.family === 'IPv4' && !netInfo.internal) {
        return netInfo.address;
      }
    }
  }
  return '127.0.0.1';
}

function writePortsAtomically(config) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const tmp = path.join(RUNTIME_DIR, `ports.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmp, PORTS_FILE);

  const clientPub = path.join(SCRIPT_DIR, 'client', 'public');
  fs.mkdirSync(clientPub, { recursive: true });
  const clientTarget = path.join(clientPub, 'runtime-ports.json');
  const clientTmp = `${clientTarget}.tmp`;
  fs.writeFileSync(clientTmp, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(clientTmp, clientTarget);
}

async function isDaemonHealthy(port) {
  if (FORBIDDEN_PORTS.has(port)) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const isHeadless = process.argv.includes('--headless');

  let portsCfg = null;
  if (fs.existsSync(PORTS_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(PORTS_FILE, 'utf-8'));
      if (
        existing.daemonPort &&
        !FORBIDDEN_PORTS.has(existing.daemonPort) &&
        (await isDaemonHealthy(existing.daemonPort))
      ) {
        portsCfg = existing;
      }
    } catch {}
  }

  if (!portsCfg) {
    const reserved = new Set([5000, 5001]);
    const daemonPort = await findFreePort(3390, reserved);
    const tabbyPort = await findFreePort(3450, reserved);
    const vitePort = await findFreePort(5173, reserved);
    const lanIp = detectLanIp();

    portsCfg = {
      daemonPort,
      tabbyPort,
      vitePort,
      daemonHost: '0.0.0.0',
      lanIp,
      localUrl: `http://localhost:${daemonPort}`,
      lanUrl: `http://${lanIp}:${daemonPort}`,
      wsSyncUrl: `ws://localhost:${daemonPort}/ws/sync`,
      tabbyBaseUrl: `http://127.0.0.1:${tabbyPort}`,
      allocatedAt: new Date().toISOString(),
      forbiddenPorts: [5000, 5001],
    };

    writePortsAtomically(portsCfg);

    const distEntry = path.join(SERVER_DIR, 'dist', 'index.js');
    const child = spawn(process.execPath, [distEntry], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        LOCALGRAVITY_DAEMON_PORT: String(daemonPort),
        LOCALGRAVITY_TABBY_PORT: String(tabbyPort),
        LOCALGRAVITY_VITE_PORT: String(vitePort),
        LOCALGRAVITY_REUSE_PORTS: '1',
      },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    let ready = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await isDaemonHealthy(daemonPort)) {
        ready = true;
        break;
      }
    }

    if (!ready) {
      console.error('ERROR: Fastify Headless Core Daemon failed to start.');
      process.exit(1);
    }
  }

  // Trigger SysRAM Pre-Warm pass
  try {
    await fetch(`http://127.0.0.1:${portsCfg.daemonPort}/api/tabby/prewarm`, {
      method: 'POST',
      signal: AbortSignal.timeout(4000),
    });
  } catch {}

  console.log('==================================================================');
  console.log('  LocalGravity 2.0 (Google Antigravity 2.0 + Harness² Engine)');
  console.log('==================================================================');
  console.log(`  Local Desktop URL       : ${portsCfg.localUrl}`);
  console.log(`  LAN / Remote Web URL    : ${portsCfg.lanUrl}`);
  console.log(`  WebSocket Multiplexer   : ${portsCfg.wsSyncUrl}`);
  console.log(`  TabbyAPI EXL3 Endpoint  : ${portsCfg.tabbyBaseUrl} (Q4 KV, N-gram x4)`);
  console.log(`  Port Safety Verification: Ports 5000 & 5001 UNTOUCHED`);
  console.log('==================================================================');

  if (!isHeadless && os.platform() === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', portsCfg.localUrl], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
