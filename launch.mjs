#!/usr/bin/env node
/**
 * LocalGravity 2.0 Node Startup Orchestrator & Dynamic Port Allocator
 * - Strictly forbids ports 5000 and 5001 under all circumstances.
 * - Dynamically allocates free TCP ports starting at 3390 (Fastify Core) and 3450 (TabbyAPI).
 * - Atomically writes `.runtime/ports.json` and `client/public/runtime-ports.json`.
 * - In foreground mode (default for runlocalgravitybrain.bat), keeps the process attached
 *   so closing the console window shuts down the brain immediately.
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

process.on('uncaughtException', (err) => {
  if (err?.code === 'ECONNRESET' || err?.code === 'EPIPE' || err?.message?.includes('closed')) return;
  console.error('[Launch] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Launch] Unhandled Rejection:', reason);
});

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

async function isStrataHealthy() {
  try {
    const res = await fetch('http://127.0.0.1:8080/health', {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureStrataRunning() {
  if (await isStrataHealthy()) {
    console.log('  [Strata Engine]         : Active & Ready on http://127.0.0.1:8080 (Qwen 3.8 Flash-Next + DFlash2)');
    return true;
  }

  console.log('  [Strata Engine]         : Not detected on port 8080. Starting Strata Engine...');

  const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Sue\\AppData\\Local';
  const configPath = path.join(localAppData, 'Strata', 'install', 'strata-swift-iq2_xs.json');
  const pythonExe = path.join(localAppData, 'Strata', 'terminal', '0.1.58', 'python', 'python.exe');
  const serverPy = path.join(localAppData, 'Strata', 'terminal', '0.1.58', 'serve', 'server.py');

  if (!fs.existsSync(configPath) || !fs.existsSync(pythonExe) || !fs.existsSync(serverPy)) {
    console.warn('  [Strata Engine]         : Strata components not found at ' + configPath);
    return false;
  }

  const strataCwd = path.join(localAppData, 'Strata', 'terminal', '0.1.58');
  const child = spawn(
    pythonExe,
    [serverPy, '--engine', 'strata', '--config', configPath, '--port', '8080'],
    {
      cwd: strataCwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }
  );
  child.unref();

  process.stdout.write('  [Strata Engine]         : Loading weights & DFlash2 expert cache into RAM/VRAM ');
  const start = Date.now();
  while (Date.now() - start < 180000) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await isStrataHealthy()) {
      const sec = Math.round((Date.now() - start) / 1000);
      console.log(`\n  [Strata Engine]         : READY in ${sec}s on port 8080!`);
      return true;
    }
    process.stdout.write('.');
  }
  console.log('\n  [Strata Engine]         : Warning: Strata took longer than 180s to respond.');
  return false;
}

async function openBrowser(url) {
  if (os.platform() === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } else if (os.platform() === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function main() {
  const isHeadless = process.argv.includes('--headless');
  const isDaemon = process.argv.includes('--daemon');
  const isForeground = process.argv.includes('--foreground') || !isDaemon;

  let portsCfg = null;
  if (!isForeground && fs.existsSync(PORTS_FILE)) {
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
    const vitePort = await findFreePort(5173, reserved);
    const lanIp = detectLanIp();

    portsCfg = {
      daemonPort,
      vitePort,
      strataPort: 8080,
      daemonHost: '0.0.0.0',
      lanIp,
      localUrl: `http://localhost:${daemonPort}`,
      lanUrl: `http://${lanIp}:${daemonPort}`,
      wsSyncUrl: `ws://localhost:${daemonPort}/ws/sync`,
      strataUrl: 'http://127.0.0.1:8080',
      tabbyBaseUrl: process.env.LOCALGRAVITY_TABBY_URL || 'http://127.0.0.1:8080',
      allocatedAt: new Date().toISOString(),
      forbiddenPorts: [5000, 5001],
    };

    writePortsAtomically(portsCfg);

    const distEntry = path.join(SERVER_DIR, 'dist', 'index.js');

    if (isForeground) {
      console.log('==================================================================');
      console.log('  LocalGravity 2.0 (Google Antigravity 2.0 + Strata Local Engine)');
      console.log('==================================================================');
      console.log(`  Local Desktop URL       : ${portsCfg.localUrl}`);
      console.log(`  LAN / Remote Web URL    : ${portsCfg.lanUrl}`);
      console.log(`  WebSocket Multiplexer   : ${portsCfg.wsSyncUrl}`);
      console.log(`  Strata Inference Engine : http://127.0.0.1:8080 (Qwen 3.8 Flash-Next)`);
      console.log(`  Port Safety Verification: Ports 5000 & 5001 UNTOUCHED`);
      console.log('------------------------------------------------------------------');

      // Proactively ensure Strata Local Inference Engine is running
      await ensureStrataRunning();

      console.log('------------------------------------------------------------------');
      console.log('  [RUNNING IN FOREGROUND]');
      console.log('  Closing this console window immediately shuts down the Brain.');
      console.log('==================================================================\n');

      if (!isHeadless) {
        setTimeout(() => {
          openBrowser(portsCfg.localUrl);
        }, 800);
      }

      // Import and start server directly in this process
      const serverModule = await import('./server/dist/index.js');
      const ctx = await serverModule.createDaemonServer();
      await ctx.app.listen({ port: portsCfg.daemonPort, host: portsCfg.daemonHost });

      // Clean shutdown handler on Ctrl+C or kill
      const cleanup = async () => {
        console.log('\nStopping LocalGravity Central Brain...');
        try {
          await ctx.app.close();
          ctx.terminal?.dispose();
          ctx.db?.close();
        } catch {}
        console.log('LocalGravity Central Brain stopped.');
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Keep foreground process alive indefinitely until SIGINT/SIGTERM
      await new Promise(() => {});
    } else {
      // Detached Daemon Execution
      await ensureStrataRunning();
      const child = spawn(process.execPath, [distEntry], {
        cwd: SERVER_DIR,
        env: {
          ...process.env,
          LOCALGRAVITY_DAEMON_PORT: String(daemonPort),
          LOCALGRAVITY_TABBY_PORT: '8080',
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
  }

  console.log('==================================================================');
  console.log('  LocalGravity 2.0 (Google Antigravity 2.0 + Strata Local Engine)');
  console.log('==================================================================');
  console.log(`  Local Desktop URL       : ${portsCfg.localUrl}`);
  console.log(`  LAN / Remote Web URL    : ${portsCfg.lanUrl}`);
  console.log(`  WebSocket Multiplexer   : ${portsCfg.wsSyncUrl}`);
  console.log(`  Strata Inference Engine : http://127.0.0.1:8080 (Qwen 3.8 Flash-Next)`);
  console.log(`  Port Safety Verification: Ports 5000 & 5001 UNTOUCHED`);
  console.log('==================================================================');

  if (!isHeadless) {
    await openBrowser(portsCfg.localUrl);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
