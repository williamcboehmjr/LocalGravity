import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * CRITICAL PORT CONSTRAINT:
 * Port 5000 is strictly reserved/forbidden and MUST NEVER be scanned or bound.
 * Port 5001 is the host TabbyAPI instance (PID 18372); daemon must not bind to it,
 * but TabbyEngine client communicates with it over http://127.0.0.1:5001.
 */
export const FORBIDDEN_PORTS = new Set<number>([5000, 5001]);

export interface RuntimePortsConfig {
  daemonPort: number;
  tabbyPort: number;
  vitePort: number;
  daemonHost: string;
  lanIp: string;
  localUrl: string;
  lanUrl: string;
  wsSyncUrl: string;
  tabbyBaseUrl: string;
  allocatedAt: string;
  forbiddenPorts: number[];
}

export function isPortForbidden(port: number): boolean {
  return FORBIDDEN_PORTS.has(port);
}

/**
 * Checks whether a TCP port is free to bind on 0.0.0.0 / 127.0.0.1.
 * Explicitly rejects ports 5000 and 5001 without ever touching them.
 */
export async function isPortAvailable(port: number, host = '0.0.0.0'): Promise<boolean> {
  if (isPortForbidden(port)) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once('error', () => {
      resolve(false);
    });

    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/**
 * Dynamically scans upward from startPort for a free TCP port,
 * skipping any forbidden ports (5000, 5001) and any already-reserved ports.
 */
export async function findFreePort(
  startPort: number,
  reservedPorts: Set<number> = new Set(),
  maxAttempts = 200
): Promise<number> {
  let candidate = startPort;
  for (let i = 0; i < maxAttempts; i++, candidate++) {
    if (isPortForbidden(candidate) || reservedPorts.has(candidate)) {
      continue;
    }
    const free = await isPortAvailable(candidate);
    if (free) {
      reservedPorts.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Unable to allocate a free TCP port starting from ${startPort}`);
}

export function detectLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const netInfo of netList) {
      if (netInfo.family === 'IPv4' && !netInfo.internal) {
        if (
          netInfo.address.startsWith('192.168.') ||
          netInfo.address.startsWith('10.') ||
          netInfo.address.startsWith('100.') ||
          netInfo.address.startsWith('172.')
        ) {
          return netInfo.address;
        }
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Atomically writes `.runtime/ports.json` and client `.env.local` discovery files.
 */
export function writeRuntimePortsAtomically(
  repoRoot: string,
  config: RuntimePortsConfig
): string {
  const runtimeDir = path.join(repoRoot, '.runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });

  const targetPath = path.join(runtimeDir, 'ports.json');
  const tempPath = path.join(runtimeDir, `ports.${process.pid}.${Date.now()}.tmp`);

  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tempPath, targetPath);

  // Also write to client/public/runtime-ports.json so browser/Tauri UI can auto-discover
  const clientPublicDir = path.join(repoRoot, 'client', 'public');
  try {
    fs.mkdirSync(clientPublicDir, { recursive: true });
    const clientRuntimePath = path.join(clientPublicDir, 'runtime-ports.json');
    const clientTmp = `${clientRuntimePath}.tmp`;
    fs.writeFileSync(clientTmp, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(clientTmp, clientRuntimePath);
  } catch {
    // Non-fatal if client/public is read-only
  }

  return targetPath;
}

export async function allocateRuntimePorts(
  repoRoot: string,
  options?: {
    preferredDaemonPort?: number;
    preferredTabbyPort?: number;
    preferredVitePort?: number;
  }
): Promise<RuntimePortsConfig> {
  // Check if launch.py already pre-allocated and wrote a valid .runtime/ports.json
  const existingPortsPath = path.join(repoRoot, '.runtime', 'ports.json');
  if (process.env.LOCALGRAVITY_REUSE_PORTS === '1' && fs.existsSync(existingPortsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(existingPortsPath, 'utf-8')) as RuntimePortsConfig;
      if (
        parsed.daemonPort &&
        !isPortForbidden(parsed.daemonPort) &&
        !isPortForbidden(parsed.tabbyPort) &&
        !isPortForbidden(parsed.vitePort)
      ) {
        const daemonFree = await isPortAvailable(parsed.daemonPort);
        if (daemonFree) {
          return parsed;
        }
      }
    } catch {
      // Proceed to fresh dynamic allocation
    }
  }

  const reserved = new Set<number>([5000, 5001]);

  const startDaemon = Number(process.env.LOCALGRAVITY_DAEMON_PORT) || options?.preferredDaemonPort || 3390;
  const startVite = Number(process.env.LOCALGRAVITY_VITE_PORT) || options?.preferredVitePort || 5173;

  const daemonPort = await findFreePort(startDaemon, reserved);
  const vitePort = await findFreePort(startVite, reserved);
  const tabbyPort = 8080;

  const lanIp = detectLanIp();

  const config: RuntimePortsConfig = {
    daemonPort,
    tabbyPort,
    vitePort,
    daemonHost: '0.0.0.0',
    lanIp,
    localUrl: `http://localhost:${daemonPort}`,
    lanUrl: `http://${lanIp}:${daemonPort}`,
    wsSyncUrl: `ws://localhost:${daemonPort}/ws/sync`,
    tabbyBaseUrl: process.env.LOCALGRAVITY_TABBY_URL || 'http://127.0.0.1:8080',
    allocatedAt: new Date().toISOString(),
    forbiddenPorts: [5000, 5001],
  };

  writeRuntimePortsAtomically(repoRoot, config);
  return config;
}
