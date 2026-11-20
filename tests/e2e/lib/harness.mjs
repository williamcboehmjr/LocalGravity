import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TESTS_E2E_DIR = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(TESTS_E2E_DIR, '..', '..');
export const CLIENT_DIR = path.join(REPO_ROOT, 'client');
export const SERVER_DIR = path.join(REPO_ROOT, 'server');
export const SHARED_DIR = path.join(REPO_ROOT, 'shared');

export const FORBIDDEN_PORTS = new Set([5000, 5001]);

export const reqClient = createRequire(path.join(CLIENT_DIR, 'package.json'));
export const reqServer = createRequire(path.join(SERVER_DIR, 'package.json'));

export function requireFromClient(id) {
  return reqClient(id);
}

export function requireFromServer(id) {
  return reqServer(id);
}

export async function importFromClient(id) {
  return import(pathToFileURL(reqClient.resolve(id)).href);
}

export async function importFromServer(id) {
  return import(pathToFileURL(reqServer.resolve(id)).href);
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getFreePort() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = await new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const allocated = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close((closeErr) => {
          if (closeErr) reject(closeErr);
          else resolve(allocated);
        });
      });
    });
    if (port > 0 && !FORBIDDEN_PORTS.has(port)) {
      return port;
    }
  }
  throw new Error('Failed to allocate a free ephemeral port outside forbidden ports 5000/5001');
}

export async function withTimeout(promiseOrFn, ms, label = 'operation') {
  const controller = new AbortController();
  let timer = null;

  const targetPromise =
    typeof promiseOrFn === 'function'
      ? Promise.resolve().then(() => promiseOrFn(controller.signal))
      : Promise.resolve(promiseOrFn);

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`Timeout after ${ms}ms: ${label}`));
      reject(new Error(`Timeout after ${ms}ms: ${label}`));
    }, ms);
  });

  try {
    return await Promise.race([targetPromise, timeoutPromise]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function waitFor(predicateFn, opts = {}) {
  const { timeoutMs = 5000, intervalMs = 50, label = 'condition' } = opts;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (true) {
    try {
      const value = await predicateFn();
      if (value) return value;
      lastError = null;
    } catch (err) {
      lastError = err;
    }

    if (Date.now() >= deadline) {
      const detail = lastError ? ` (last error: ${lastError?.message || String(lastError)})` : '';
      throw new Error(`waitFor timed out after ${timeoutMs}ms waiting for ${label}${detail}`);
    }
    await delay(Math.min(intervalMs, Math.max(10, deadline - Date.now())));
  }
}

function isProcessExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child, timeoutMs) {
  if (isProcessExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('close', onExit);
      resolve(ok);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    child.once('exit', onExit);
    child.once('close', onExit);
  });
}

export async function killProcessTree(child, graceMs = 1500) {
  if (!child || isProcessExited(child)) return;

  try {
    child.kill('SIGTERM');
  } catch {}

  const exitedGracefully = await waitForChildExit(child, graceMs);
  if (exitedGracefully || isProcessExited(child)) return;

  const pid = child.pid;
  if (pid && process.platform === 'win32') {
    await new Promise((resolve) => {
      execFile('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true }, () => {
        resolve();
      });
    });
  } else if (pid) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
  }

  await waitForChildExit(child, 1500);
}

export async function removeDirSafe(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return;
  const maxAttempts = 8;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 80 });
      if (!fs.existsSync(dirPath)) return;
    } catch (err) {
      lastErr = err;
      const code = err?.code;
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY' && code !== 'EACCES') {
        throw err;
      }
    }
    await delay(100 * (attempt + 1));
  }
  if (fs.existsSync(dirPath) && lastErr) {
    throw lastErr;
  }
}

export function assertContains(haystack, needle, message) {
  const str = String(haystack ?? '');
  assert.ok(
    str.includes(needle),
    message || `Expected string to contain ${JSON.stringify(needle)}, got: ${str.slice(0, 300)}`
  );
}

export function assertNotContains(haystack, needle, message) {
  const str = String(haystack ?? '');
  assert.ok(
    !str.includes(needle),
    message || `Expected string NOT to contain ${JSON.stringify(needle)}`
  );
}

export function createTestContext({ repoRoot = REPO_ROOT, testId = 'test' } = {}) {
  const tempDirs = [];
  const cleanupHooks = [];

  return {
    repoRoot,
    testId,
    assert,
    assertContains,
    assertNotContains,
    getFreePort,
    withTimeout,
    waitFor,
    delay,
    createTempDir(prefix = 'lg-e2e-') {
      const safePrefix = prefix.endsWith('-') ? prefix : `${prefix}-`;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), safePrefix));
      tempDirs.push(dir);
      return dir;
    },
    onCleanup(fn) {
      if (typeof fn === 'function') {
        cleanupHooks.push(fn);
      }
    },
    async cleanup() {
      let firstError = null;

      while (cleanupHooks.length > 0) {
        const fn = cleanupHooks.pop();
        try {
          await fn();
        } catch (err) {
          if (!firstError) firstError = err;
        }
      }

      while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        try {
          await removeDirSafe(dir);
        } catch (err) {
          if (!firstError) firstError = err;
        }
      }

      if (firstError) throw firstError;
    },
  };
}

export function defineSuite(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('defineSuite requires an object');
  }
  return {
    name: String(spec.name || 'Unnamed Suite'),
    tier: Number(spec.tier),
    features: Array.isArray(spec.features) ? [...spec.features] : [],
    tests: Array.isArray(spec.tests) ? [...spec.tests] : [],
  };
}
