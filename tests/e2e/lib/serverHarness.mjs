import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_PORTS,
  killProcessTree,
  removeDirSafe,
  REPO_ROOT,
  requireFromServer,
} from './harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOOTSTRAP_SCRIPT = path.join(__dirname, 'serverBootstrap.mjs');
const RUNTIME_FILES_TO_SNAPSHOT = [
  '.runtime/brain-provider.json',
  '.runtime/comfyui-studio.json',
  '.runtime/providers.json',
  '.runtime/permissions.json',
  '.runtime/mcp-toggle-state.json',
  '.localgravity/harness/automations.json',
];

let serverBuildChecked = false;

function getNewestMtimeMs(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let newest = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime > newest) newest = mtime;
      }
    }
  }
  return newest;
}

export async function ensureServerBuilt(repoRoot = REPO_ROOT, { force = false } = {}) {
  const serverDir = path.join(repoRoot, 'server');
  const distIndex = path.join(serverDir, 'dist', 'index.js');
  const srcDir = path.join(serverDir, 'src');

  if (!force && serverBuildChecked && fs.existsSync(distIndex)) {
    return;
  }

  let needsBuild = force || !fs.existsSync(distIndex);
  if (!needsBuild) {
    const distMtime = fs.statSync(distIndex).mtimeMs;
    const newestSrcMtime = getNewestMtimeMs(srcDir);
    if (newestSrcMtime > distMtime) {
      needsBuild = true;
    }
  }

  if (needsBuild) {
    const res = await new Promise((resolve, reject) => {
      const cmd = process.platform === 'win32' ? 'cmd.exe' : 'npm';
      const args =
        process.platform === 'win32'
          ? ['/d', '/s', '/c', 'npm', '--prefix', serverDir, 'run', 'build']
          : ['--prefix', serverDir, 'run', 'build'];
      const child = spawn(cmd, args, {
        cwd: repoRoot,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString('utf-8');
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString('utf-8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
    });

    if (res.code !== 0) {
      throw new Error(
        `Failed to build server (exit ${res.code}):\n${res.stdout}\n${res.stderr}`
      );
    }
  }

  if (!fs.existsSync(distIndex)) {
    throw new Error(`Server build succeeded but ${distIndex} is still missing`);
  }
  serverBuildChecked = true;
}

function snapshotRuntimeFiles(repoRoot) {
  const snapshots = [];
  for (const relPath of RUNTIME_FILES_TO_SNAPSHOT) {
    const filePath = path.join(repoRoot, relPath);
    if (fs.existsSync(filePath)) {
      snapshots.push({
        filePath,
        existed: true,
        content: fs.readFileSync(filePath),
      });
    } else {
      snapshots.push({
        filePath,
        existed: false,
        content: null,
      });
    }
  }
  return snapshots;
}

function restoreRuntimeFiles(snapshots) {
  for (const snap of snapshots) {
    try {
      if (snap.existed) {
        fs.mkdirSync(path.dirname(snap.filePath), { recursive: true });
        fs.writeFileSync(snap.filePath, snap.content);
      } else if (fs.existsSync(snap.filePath)) {
        fs.unlinkSync(snap.filePath);
      }
    } catch {}
  }
}

export async function startServer(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  if (!options.skipBuild) {
    await ensureServerBuilt(repoRoot);
  }

  let ownedTempDir = false;
  let tempDir = options.tempDir;
  if (!tempDir) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-srv-'));
    ownedTempDir = true;
  }

  const homeDir = path.join(tempDir, 'home');
  const appDataDir = path.join(homeDir, 'AppData', 'Roaming');
  const localAppDataDir = path.join(homeDir, 'AppData', 'Local');
  const cwdDir = path.join(tempDir, 'cwd');
  const workspaceDir = path.join(tempDir, 'workspace');
  const dbPath = path.join(tempDir, 'db.sqlite');

  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(localAppDataDir, { recursive: true });
  fs.mkdirSync(cwdDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  if (options.mcpServers && typeof options.mcpServers === 'object') {
    const mcpConfigPath = path.join(homeDir, '.gemini', 'config', 'mcp_config.json');
    fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
    fs.writeFileSync(
      mcpConfigPath,
      JSON.stringify({ mcpServers: options.mcpServers }, null, 2),
      'utf-8'
    );
  }

  const runtimeSnapshots = snapshotRuntimeFiles(repoRoot);
  const timeoutMs = options.timeoutMs ?? 20000;

  const childEnv = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: appDataDir,
    LOCALAPPDATA: localAppDataDir,
    LOCALGRAVITY_DISABLE_PATHS_CACHE: '1',
    LOCALGRAVITY_STRATA_DIR: path.join(tempDir, 'nonexistent-strata'),
    LOCALGRAVITY_COMFY_ROOT: path.join(tempDir, 'nonexistent-comfy'),
    LOCALGRAVITY_OLLAMA_EXE: path.join(tempDir, 'nonexistent-ollama.exe'),
    LOCALGRAVITY_LLAMA_SERVER_EXE: path.join(tempDir, 'nonexistent-llama.exe'),
    LOCALGRAVITY_LITERT_EXE: path.join(tempDir, 'nonexistent-litert.exe'),
    LOCALGRAVITY_MODELS_DIR: path.join(tempDir, 'models'),
    COMFY_URL: 'http://127.0.0.1:1',
    LOCALGRAVITY_OLLAMA_URL: 'http://127.0.0.1:1',
    LOCALGRAVITY_IDLE_TIMEOUT_MINUTES: '0',
    LG_TEST_REPO_ROOT: repoRoot,
    LG_TEST_DB_PATH: dbPath,
  };

  if (options.mockLlmUrl) {
    const normalizedMock = String(options.mockLlmUrl).replace(/\/+$/, '');
    childEnv.LG_TEST_MOCK_LLM_URL = normalizedMock;
    childEnv.LOCALGRAVITY_TABBY_URL = normalizedMock;
    childEnv.LOCALGRAVITY_STRATA_URL = normalizedMock;
    childEnv.GEMINI_BASE_URL = `${normalizedMock}/v1beta`;
  }

  if (options.googleApiKey !== undefined) {
    childEnv.GEMINI_API_KEY = String(options.googleApiKey);
    childEnv.GOOGLE_API_KEY = String(options.googleApiKey);
  }

  if (options.env && typeof options.env === 'object') {
    Object.assign(childEnv, options.env);
  }

  const child = spawn(process.execPath, [BOOTSTRAP_SCRIPT], {
    cwd: cwdDir,
    env: childEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  let stdoutLog = '';
  let stderrLog = '';
  const openSockets = new Set();

  let readyInfo;
  try {
    readyInfo = await new Promise((resolve, reject) => {
      let settled = false;
      let lineBuf = '';

      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };

      const timer = setTimeout(() => {
        fail(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for LocalGravity server READY_JSON.\nSTDOUT:\n${stdoutLog}\nSTDERR:\n${stderrLog}`
          )
        );
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf-8');
        stdoutLog += text;
        lineBuf += text;
        const lines = lineBuf.split(/\r?\n/);
        lineBuf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('READY_JSON:')) {
            try {
              const parsed = JSON.parse(line.slice('READY_JSON:'.length));
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(parsed);
              }
            } catch (err) {
              fail(new Error(`Invalid READY_JSON payload: ${line} (${err})`));
            }
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        stderrLog += chunk.toString('utf-8');
      });

      child.once('error', (err) => {
        fail(new Error(`Failed to spawn server bootstrap process: ${err.message}`));
      });

      child.once('exit', (code, signal) => {
        fail(
          new Error(
            `Server process exited prematurely (code=${code}, signal=${signal}).\nSTDOUT:\n${stdoutLog}\nSTDERR:\n${stderrLog}`
          )
        );
      });
    });
  } catch (err) {
    await killProcessTree(child, 500);
    restoreRuntimeFiles(runtimeSnapshots);
    if (ownedTempDir) await removeDirSafe(tempDir);
    throw err;
  }

  const port = Number(readyInfo?.port || 0);
  assert.ok(port > 0, `Server must bind a positive port, got ${port}`);
  assert.ok(!FORBIDDEN_PORTS.has(port), `Server bound forbidden port ${port}`);

  const baseUrl = `http://127.0.0.1:${port}`;
  const wsSyncUrl = `ws://127.0.0.1:${port}/ws/sync`;
  const Database = requireFromServer('better-sqlite3');
  const WebSocket = requireFromServer('ws');

  async function fetchJson(urlPath, init = {}) {
    const targetUrl = urlPath.startsWith('http://') || urlPath.startsWith('https://')
      ? urlPath
      : `${baseUrl}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
    const headers = { ...(init.headers || {}) };
    let body = init.body;
    if (body !== undefined && body !== null && typeof body === 'object' && !(body instanceof Uint8Array) && !(body instanceof Buffer)) {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      body = JSON.stringify(body);
    }

    const res = await fetch(targetUrl, {
      ...init,
      headers,
      body,
    });
    const text = await res.text();
    let data = null;
    if (text.trim().length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return {
      status: res.status,
      ok: res.ok,
      headers: Object.fromEntries(res.headers.entries()),
      data,
      text,
    };
  }

  if (options.initialProvider || options.googleApiKey !== undefined) {
    const providerBody = {};
    if (options.initialProvider) providerBody.provider = options.initialProvider;
    if (options.googleApiKey !== undefined) providerBody.googleApiKey = options.googleApiKey;
    if (options.selectedGoogleModel) providerBody.selectedGoogleModel = options.selectedGoogleModel;
    await fetchJson('/api/brain/provider', {
      method: 'POST',
      body: providerBody,
    });
  }

  function openDbReadonly() {
    return new Database(dbPath, { readonly: true });
  }

  function queryDb(sql, ...params) {
    const db = openDbReadonly();
    try {
      return db.prepare(sql).all(...params);
    } finally {
      db.close();
    }
  }

  function getDbRow(sql, ...params) {
    const db = openDbReadonly();
    try {
      return db.prepare(sql).get(...params);
    } finally {
      db.close();
    }
  }

  function getPragmas() {
    const db = openDbReadonly();
    try {
      const journal = db.pragma('journal_mode', { simple: true });
      const fk = db.pragma('foreign_keys', { simple: true });
      const sync = db.pragma('synchronous', { simple: true });
      return { journal_mode: journal, foreign_keys: fk, synchronous: sync };
    } finally {
      db.close();
    }
  }

  async function connectWs(wsPath = '/ws/sync') {
    const targetUrl = `${baseUrl.replace(/^http/, 'ws')}${wsPath.startsWith('/') ? '' : '/'}${wsPath}`;
    const ws = new WebSocket(targetUrl);
    openSockets.add(ws);
    const events = [];
    const listeners = new Set();

    ws.on('message', (raw) => {
      const str = raw.toString('utf-8');
      let parsed;
      try {
        parsed = JSON.parse(str);
      } catch {
        parsed = { type: 'RAW', raw: str };
      }
      events.push(parsed);
      for (const fn of [...listeners]) {
        fn(parsed);
      }
    });

    ws.once('close', () => {
      openSockets.delete(ws);
    });

    await new Promise((resolve, reject) => {
      const onOpen = () => {
        ws.off('error', onErr);
        resolve();
      };
      const onErr = (err) => {
        ws.off('open', onOpen);
        reject(err);
      };
      ws.once('open', onOpen);
      ws.once('error', onErr);
    });

    function matchEvent(evt, predicateOrType) {
      if (typeof predicateOrType === 'string') {
        return evt?.type === predicateOrType;
      }
      if (typeof predicateOrType === 'function') {
        return Boolean(predicateOrType(evt));
      }
      return false;
    }

    return {
      ws,
      events,
      send(type, payload = {}, id = undefined) {
        const msg = id !== undefined ? { id, type, payload } : { type, payload };
        ws.send(JSON.stringify(msg));
      },
      sendRaw(data) {
        ws.send(data);
      },
      waitForEvent(predicateOrType, timeoutOrOpts = 10000) {
        const timeoutMs =
          typeof timeoutOrOpts === 'number' ? timeoutOrOpts : (timeoutOrOpts?.timeoutMs ?? 10000);
        const fromIndex =
          typeof timeoutOrOpts === 'object' && timeoutOrOpts ? (timeoutOrOpts.fromIndex ?? 0) : 0;

        for (let i = fromIndex; i < events.length; i++) {
          if (matchEvent(events[i], predicateOrType)) {
            return Promise.resolve(events[i]);
          }
        }

        return new Promise((resolve, reject) => {
          let settled = false;
          const cleanup = () => {
            clearTimeout(timer);
            listeners.delete(onEvent);
            ws.off('close', onClose);
          };
          const onEvent = (evt) => {
            if (matchEvent(evt, predicateOrType)) {
              if (settled) return;
              settled = true;
              cleanup();
              resolve(evt);
            }
          };
          const onClose = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('WebSocket closed before expected event arrived'));
          };
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            const desc =
              typeof predicateOrType === 'string' ? predicateOrType : 'predicate';
            reject(
              new Error(
                `Timed out after ${timeoutMs}ms waiting for WS event (${desc}). Received types: [${events
                  .map((e) => e.type)
                  .join(', ')}]`
              )
            );
          }, timeoutMs);
          if (typeof timer.unref === 'function') timer.unref();
          listeners.add(onEvent);
          ws.once('close', onClose);
        });
      },
      async collectEvents(untilPredicate, timeoutMs = 10000) {
        const collected = [...events];
        for (let i = 0; i < collected.length; i++) {
          if (untilPredicate(collected[i], collected.slice(0, i + 1))) {
            return collected.slice(0, i + 1);
          }
        }
        await this.waitForEvent(
          (evt) => {
            collected.push(evt);
            return untilPredicate(evt, collected);
          },
          { timeoutMs, fromIndex: collected.length }
        );
        return collected;
      },
      async close() {
        if (ws.readyState === WebSocket.CLOSED) return;
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            try {
              ws.terminate();
            } catch {}
            resolve();
          }, 1000);
          if (typeof timer.unref === 'function') timer.unref();
          ws.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
          try {
            ws.close();
          } catch {
            clearTimeout(timer);
            resolve();
          }
        });
      },
    };
  }

  let stopped = false;

  async function stop() {
    if (stopped) return;
    stopped = true;

    for (const sock of [...openSockets]) {
      try {
        sock.terminate();
      } catch {}
    }
    openSockets.clear();

    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected) {
        try {
          child.send('shutdown');
        } catch {}
      }
      const exited = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 3000);
        if (typeof timer.unref === 'function') timer.unref();
        child.once('exit', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      if (!exited) {
        await killProcessTree(child, 1000);
      }
    }

    restoreRuntimeFiles(runtimeSnapshots);
    if (ownedTempDir) {
      await removeDirSafe(tempDir);
    }
  }

  return {
    port,
    baseUrl,
    wsSyncUrl,
    dbPath,
    workspaceDir,
    homeDir,
    cwdDir,
    pid: child.pid,
    getStdout: () => stdoutLog,
    getStderr: () => stderrLog,
    fetchJson,
    getHealth: () => fetchJson('/health'),
    getApiHealth: () => fetchJson('/api/health'),
    createProject: (body) => fetchJson('/api/projects', { method: 'POST', body }),
    listThreads: (projectId) =>
      fetchJson(projectId ? `/api/threads?project_id=${encodeURIComponent(projectId)}` : '/api/threads'),
    createThread: (body) => fetchJson('/api/threads', { method: 'POST', body }),
    patchThread: (id, patch) =>
      fetchJson(`/api/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
    deleteThread: (id) =>
      fetchJson(`/api/threads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    clearThread: (id) =>
      fetchJson(`/api/threads/${encodeURIComponent(id)}/clear`, { method: 'POST' }),
    rewindThread: (id, messageId, revertFiles = true) =>
      fetchJson(`/api/threads/${encodeURIComponent(id)}/rewind`, {
        method: 'POST',
        body: { message_id: messageId, revert_files: revertFiles },
      }),
    getMessages: (id) => fetchJson(`/api/threads/${encodeURIComponent(id)}/messages`),
    sendPrompt: (threadId, body) =>
      fetchJson(`/api/threads/${encodeURIComponent(threadId)}/prompt`, { method: 'POST', body }),
    postStop: (bodyOrThreadId) => {
      if (typeof bodyOrThreadId === 'string') {
        return fetchJson(`/api/threads/${encodeURIComponent(bodyOrThreadId)}/stop`, {
          method: 'POST',
          body: {},
        });
      }
      return fetchJson('/api/stop', { method: 'POST', body: bodyOrThreadId || {} });
    },
    getCheckpoints: (threadId) =>
      fetchJson(`/api/threads/${encodeURIComponent(threadId)}/checkpoints`),
    revertCheckpoint: (cpId) =>
      fetchJson(`/api/checkpoints/${encodeURIComponent(cpId)}/revert`, { method: 'POST' }),
    rewindCheckpoint: (cpId) =>
      fetchJson(`/api/checkpoints/${encodeURIComponent(cpId)}/rewind`, { method: 'POST' }),
    setBrainProvider: (body) =>
      fetchJson('/api/brain/provider', { method: 'POST', body }),
    getBrainProvider: () => fetchJson('/api/brain/provider'),
    uploadFile: (threadId, rawInput) =>
      fetchJson(`/api/threads/${encodeURIComponent(threadId)}/upload`, {
        method: 'POST',
        body: rawInput,
      }),
    async getUpload(threadId, filename) {
      const res = await fetch(
        `${baseUrl}/api/uploads/${encodeURIComponent(threadId)}/${encodeURIComponent(filename)}`
      );
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
        buffer: buf,
        text: buf.toString('utf-8'),
      };
    },
    connectWs,
    openDbReadonly,
    queryDb,
    getDbRow,
    getPragmas,
    stop,
  };
}

