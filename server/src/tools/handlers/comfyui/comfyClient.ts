import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { getPathsConfig } from '../../../core/pathsConfig.js';

export interface SavedComfyOutput {
  filename: string;
  localPath: string;
  apiUrl: string;
  subfolder: string;
  type: string;
  mediaKind: 'image' | 'video' | 'audio';
}

interface ObjectInfoCacheEntry {
  url: string;
  fetchedAt: number;
  data: Record<string, any>;
  cacheFilePath: string;
}

const OBJECT_INFO_TTL_MS = 5 * 60 * 1000;
let objectInfoCache: ObjectInfoCacheEntry | null = null;

export function invalidateObjectInfoCache(): void {
  objectInfoCache = null;
}

export async function isComfyHealthy(comfyUrl = getPathsConfig().comfyUrl): Promise<boolean> {
  try {
    const res = await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureComfyServerRunning(
  abortSignal?: AbortSignal
): Promise<{ running: boolean; startedNow: boolean; error?: string }> {
  const { comfyUrl, comfyRoot, comfyPythonExe } = getPathsConfig();
  if (await isComfyHealthy(comfyUrl)) {
    return { running: true, startedNow: false };
  }

  if (comfyPythonExe !== 'python' && !fs.existsSync(comfyPythonExe)) {
    return { running: false, startedNow: false, error: `Embedded Python not found at ${comfyPythonExe}` };
  }

  const mainPy = fs.existsSync(path.join(comfyRoot, 'ComfyUI', 'main.py'))
    ? 'ComfyUI\\main.py'
    : path.join(getPathsConfig().comfyAppDir, 'main.py');

  const child = spawn(
    comfyPythonExe,
    [
      '-I',
      '-W',
      'ignore::FutureWarning',
      mainPy,
      '--windows-standalone-build',
      '--listen',
      '0.0.0.0',
      '--disable-auto-launch',
      '--disable-pinned-memory',
      '--fp32-vae',
    ],
    {
      cwd: comfyRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }
  );
  child.unref();

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (abortSignal?.aborted) {
      return { running: false, startedNow: true, error: 'Aborted while waiting for ComfyUI to start' };
    }
    await new Promise((r) => setTimeout(r, 1500));
    if (await isComfyHealthy(comfyUrl)) {
      return { running: true, startedNow: true };
    }
  }

  return { running: false, startedNow: true, error: `ComfyUI did not become healthy at ${comfyUrl} within 90s` };
}

export async function interruptComfyJob(promptId?: string): Promise<boolean> {
  const { comfyUrl } = getPathsConfig();
  try {
    const res = await fetch(`${comfyUrl}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: promptId ? JSON.stringify({ prompt_id: promptId }) : undefined,
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function freeComfyVram(): Promise<boolean> {
  const { comfyUrl } = getPathsConfig();
  try {
    const res = await fetch(`${comfyUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getComfyQueue(comfyUrl = getPathsConfig().comfyUrl): Promise<{
  runningIds: string[];
  pendingIds: string[];
} | null> {
  try {
    const res = await fetch(`${comfyUrl}/queue`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    const runningIds = Array.isArray(json?.queue_running)
      ? json.queue_running.map((item: any) => String(item?.[1] || '')).filter(Boolean)
      : [];
    const pendingIds = Array.isArray(json?.queue_pending)
      ? json.queue_pending.map((item: any) => String(item?.[1] || '')).filter(Boolean)
      : [];
    return { runningIds, pendingIds };
  } catch {
    return null;
  }
}

export async function getCachedObjectInfoFile(forceRefresh = false): Promise<string | null> {
  const { comfyUrl, runtimeDir } = getPathsConfig();
  const now = Date.now();
  if (
    !forceRefresh &&
    objectInfoCache &&
    objectInfoCache.url === comfyUrl &&
    now - objectInfoCache.fetchedAt < OBJECT_INFO_TTL_MS &&
    fs.existsSync(objectInfoCache.cacheFilePath)
  ) {
    return objectInfoCache.cacheFilePath;
  }

  try {
    const res = await fetch(`${comfyUrl}/object_info`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const text = await res.text();
    const data = JSON.parse(text);
    const cacheDir = fs.existsSync(runtimeDir) ? runtimeDir : os.tmpdir();
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFilePath = path.join(cacheDir, 'comfy_object_info_cache.json');
    fs.writeFileSync(cacheFilePath, text, 'utf-8');
    objectInfoCache = {
      url: comfyUrl,
      fetchedAt: now,
      data,
      cacheFilePath,
    };
    return cacheFilePath;
  } catch {
    return null;
  }
}

export function collectOutputItems(outputsObj: Record<string, any>): Array<{
  filename: string;
  subfolder: string;
  type: string;
  mediaKind: 'image' | 'video' | 'audio';
}> {
  const collected: Array<{
    filename: string;
    subfolder: string;
    type: string;
    mediaKind: 'image' | 'video' | 'audio';
  }> = [];
  const seen = new Set<string>();

  const pushItems = (list: any, defaultKind: 'image' | 'video' | 'audio') => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item?.filename) continue;
      const fname = String(item.filename);
      const subfolder = String(item.subfolder || '');
      const type = String(item.type || 'output');
      const key = `${type}:${subfolder}:${fname}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lower = fname.toLowerCase();
      const mediaKind: 'image' | 'video' | 'audio' =
        defaultKind === 'audio' || /\.(wav|mp3|flac|ogg)$/.test(lower)
          ? 'audio'
          : defaultKind === 'video' || /\.(mp4|webm|mov|mkv|avi)$/.test(lower)
            ? 'video'
            : 'image';
      collected.push({ filename: fname, subfolder, type, mediaKind });
    }
  };

  for (const nodeOut of Object.values(outputsObj || {}) as any[]) {
    if (!nodeOut || typeof nodeOut !== 'object') continue;
    pushItems(nodeOut.images, 'image');
    pushItems(nodeOut.gifs, 'video');
    pushItems(nodeOut.videos, 'video');
    pushItems(nodeOut.audio, 'audio');
  }

  // Filter out intermediate "temp" preview images whenever final "output" renders are present.
  const hasFinalOutput = collected.some((item) => item.type === 'output');
  return hasFinalOutput ? collected.filter((item) => item.type === 'output') : collected;
}

export async function waitForComfyJob(params: {
  promptId: string;
  workflowName: string;
  timeoutMs: number;
  startMs: number;
  clientId?: string;
  nodeClassMap?: Record<string, string>;
  comfyUrlOverride?: string;
  pollIntervalMs?: number;
  abortSignal?: AbortSignal;
  onLog?: (line: string) => void;
}): Promise<any> {
  const comfyUrl = params.comfyUrlOverride || getPathsConfig().comfyUrl;
  const pollDeadline = Date.now() + params.timeoutMs;
  const submittedAt = Date.now();
  const pollIntervalMs = Math.max(10, params.pollIntervalMs ?? 1500);
  let lastLogAt = Date.now();
  let lastProgressLogAt = 0;
  let lastNodeLogged = '';
  let consecutivePollErrors = 0;
  let missingFromQueuePolls = 0;
  let wsExecutionError: string | null = null;
  let ws: WebSocket | null = null;

  if (params.clientId) {
    try {
      const wsUrl = `${comfyUrl.replace(/^http/i, 'ws')}/ws?clientId=${encodeURIComponent(params.clientId)}`;
      ws = new WebSocket(wsUrl);
      ws.on('error', () => {});
      ws.on('message', (rawData) => {
        try {
          const msg = JSON.parse(rawData.toString());
          const data = msg?.data || {};
          if (msg?.type === 'executing') {
            if (data.prompt_id && data.prompt_id !== params.promptId) return;
            if (data.node === null) {
              lastLogAt = Date.now();
              params.onLog?.('[ComfyUI] Graph execution complete — verifying final saved output...\n');
            } else if (data.node !== undefined) {
              const cls = params.nodeClassMap?.[String(data.node)] || `Node #${data.node}`;
              if (cls !== lastNodeLogged) {
                lastNodeLogged = cls;
                lastLogAt = Date.now();
                params.onLog?.(`[ComfyUI] Running stage: ${cls}...\n`);
              }
            }
          } else if (msg?.type === 'progress') {
            const val = Number(data.value || 0);
            const max = Number(data.max || 0);
            const now = Date.now();
            if (max > 0 && (now - lastProgressLogAt >= 2500 || val >= max)) {
              lastProgressLogAt = now;
              lastLogAt = now;
              const elapsedS = Math.round((performance.now() - params.startMs) / 1000);
              const pct = Math.min(100, Math.round((val / max) * 100));
              params.onLog?.(`[ComfyUI] Sampling step ${val}/${max} (${pct}%) • ${elapsedS}s elapsed\n`);
            }
          } else if (msg?.type === 'execution_error' && data.prompt_id === params.promptId) {
            wsExecutionError = data.exception_message || JSON.stringify(data);
          }
        } catch {}
      });
    } catch {
      ws = null;
    }
  }

  try {
    while (Date.now() < pollDeadline) {
      if (params.abortSignal?.aborted) {
        throw new Error('ComfyUI generation aborted by user.');
      }
      if (wsExecutionError) {
        throw new Error(`ComfyUI execution error: ${String(wsExecutionError).slice(0, 1200)}`);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));

      try {
        const histRes = await fetch(`${comfyUrl}/history/${encodeURIComponent(params.promptId)}`, {
          signal: AbortSignal.timeout(12000),
        });
        consecutivePollErrors = 0;
        if (histRes.ok) {
          const histJson: any = await histRes.json();
          if (histJson && histJson[params.promptId]) {
            const entry = histJson[params.promptId];
            const statusObj = entry.status;
            if (statusObj?.status_str === 'error') {
              const msgs = Array.isArray(statusObj.messages) ? JSON.stringify(statusObj.messages) : '';
              throw new Error(`ComfyUI execution failed: ${msgs.slice(0, 1200)}`);
            }
            const isExplicitlyComplete =
              statusObj?.completed === true || statusObj?.status_str === 'success';
            let isLegacyComplete = false;
            if (!isExplicitlyComplete && !statusObj && entry.outputs && Object.keys(entry.outputs).length > 0) {
              const q = await getComfyQueue(comfyUrl);
              if (q && !q.runningIds.includes(params.promptId) && !q.pendingIds.includes(params.promptId)) {
                isLegacyComplete = true;
              }
            }
            if (isExplicitlyComplete || isLegacyComplete) {
              return entry;
            }
          } else if (Date.now() - submittedAt > 10000) {
            // Verify job hasn't silently crashed out of queue while absent from history
            const q = await getComfyQueue(comfyUrl);
            if (q && !q.runningIds.includes(params.promptId) && !q.pendingIds.includes(params.promptId)) {
              missingFromQueuePolls++;
              if (missingFromQueuePolls >= 3) {
                throw new Error(
                  `ComfyUI job ${params.promptId} left the queue without history output (possible OOM or workflow error).`
                );
              }
            } else {
              missingFromQueuePolls = 0;
            }
          }
        }
      } catch (pollErr: any) {
        if (
          pollErr?.message?.includes('ComfyUI execution failed') ||
          pollErr?.message?.includes('ComfyUI execution error') ||
          pollErr?.message?.includes('left the queue without history output')
        ) {
          throw pollErr;
        }
        consecutivePollErrors++;
        if (consecutivePollErrors >= 12) {
          throw new Error(
            `Lost connection to ComfyUI during job ${params.promptId} (${consecutivePollErrors} consecutive poll failures): ${pollErr?.message || pollErr}`
          );
        }
      }

      if (Date.now() - lastLogAt >= 6000) {
        lastLogAt = Date.now();
        const elapsedS = Math.round((performance.now() - params.startMs) / 1000);
        params.onLog?.(`[ComfyUI] Generating with ${params.workflowName} (${elapsedS}s elapsed)...\n`);
      }
    }

    throw new Error(`ComfyUI job ${params.promptId} timed out after ${Math.round(params.timeoutMs / 1000)}s`);
  } finally {
    if (ws) {
      try {
        ws.close();
      } catch {}
    }
  }
}

export async function downloadComfyOutputs(
  outputsObj: Record<string, any>,
  comfyUrlOverride?: string
): Promise<SavedComfyOutput[]> {
  const { comfyUrl: defaultUrl, mcpOutputsDir } = getPathsConfig();
  const comfyUrl = comfyUrlOverride || defaultUrl;
  fs.mkdirSync(mcpOutputsDir, { recursive: true });
  const items = collectOutputItems(outputsObj);
  const savedOutputs: SavedComfyOutput[] = [];

  for (const item of items) {
    const q = new URLSearchParams({
      filename: item.filename,
      subfolder: item.subfolder,
      type: item.type,
    });
    const viewRes = await fetch(`${comfyUrl}/view?${q.toString()}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!viewRes.ok) continue;
    const buf = Buffer.from(await viewRes.arrayBuffer());
    if (buf.length === 0) continue;
    const safeBase = item.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const copyName = `comfyui-${Date.now()}-${safeBase}`;
    const localPath = path.join(mcpOutputsDir, copyName);
    const tmpPath = `${localPath}.tmp`;
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, localPath);
    savedOutputs.push({
      filename: item.filename,
      localPath,
      apiUrl: `/api/mcp-outputs/${copyName}`,
      subfolder: item.subfolder,
      type: item.type,
      mediaKind: item.mediaKind,
    });
  }

  return savedOutputs;
}
