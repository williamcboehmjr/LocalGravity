import fs from 'node:fs';
import path from 'node:path';
import { ChildProcess, spawn } from 'node:child_process';
import { getPathsConfig } from '../../../core/pathsConfig.js';
import type { OllamaModelItem } from '../../../core/protocol.js';
import type { InferenceCompletionParams, InferenceCompletionResult } from '../../../core/inferenceBackend.js';
import { cleanEnhancedPrompt } from './geminiMedia.js';

export const RECOMMENDED_OLLAMA_VISION_MODELS: OllamaModelItem[] = [
  {
    name: 'qwen3.5:4b',
    sizeGb: 3.2,
    isVision: true,
    supportsTools: true,
    recommended: true,
    hint: 'Fastest unified Vision + Tools (<1s GPU swap)',
    installed: false,
  },
  {
    name: 'qwen3-vl:4b',
    sizeGb: 2.8,
    isVision: true,
    supportsTools: true,
    recommended: true,
    hint: 'Compact spatial Vision + agentic tools',
    installed: false,
  },
  {
    name: 'ministral-3:3b',
    sizeGb: 2.2,
    isVision: true,
    supportsTools: true,
    recommended: true,
    hint: 'Ultra-fast edge JSON tool caller + Vision',
    installed: false,
  },
  {
    name: 'qwen3-vl:8b',
    sizeGb: 5.8,
    isVision: true,
    supportsTools: true,
    recommended: true,
    hint: 'Richer Vision reasoning + detailed prompts',
    installed: false,
  },
  {
    name: 'qwen2.5vl:3b',
    sizeGb: 3.0,
    isVision: true,
    supportsTools: true,
    recommended: false,
    hint: 'Fast compact Vision model',
    installed: false,
  },
  {
    name: 'qwen2.5vl:7b',
    sizeGb: 5.6,
    isVision: true,
    supportsTools: true,
    recommended: false,
    hint: 'Balanced Vision model',
    installed: false,
  },
  {
    name: 'gemma4:e4b',
    sizeGb: 5.0,
    isVision: true,
    supportsTools: true,
    recommended: true,
    hint: 'Multimodal + native tool support',
    installed: false,
  },
];

const RECOMMENDED_PRIORITY = new Map<string, { order: number; item: OllamaModelItem }>(
  RECOMMENDED_OLLAMA_VISION_MODELS.map((item, idx) => [item.name.toLowerCase(), { order: idx, item }])
);

export function classifyOllamaModel(name: string): {
  isVision: boolean;
  supportsTools: boolean;
  recommended: boolean;
  hint: string;
} {
  const lower = (name || '').trim().toLowerCase();
  const rec = RECOMMENDED_PRIORITY.get(lower)?.item;
  const isVision =
    rec?.isVision ??
    /(\bvl\b|-vl|vision|qwen3\.5|gemma[34]|minicpm-v|ministral-3|llava|moondream|pixtral)/i.test(lower);
  const supportsTools =
    rec?.supportsTools ??
    /(qwen3\.5|qwen3-vl|qwen3\.8|qwen2\.5|ministral-3|gemma4|llama3\.[123])/i.test(lower);
  const hint =
    rec?.hint ||
    (isVision && supportsTools
      ? 'Vision + Tool Calling'
      : isVision
        ? 'Vision'
        : supportsTools
          ? 'Text + Tools (No Vision)'
          : 'Text Only');

  return {
    isVision,
    supportsTools,
    recommended: Boolean(rec?.recommended),
    hint,
  };
}

export function discoverOllamaModelsFromDisk(modelsDir?: string): OllamaModelItem[] {
  const rootDir = path.join(
    modelsDir || getPathsConfig().ollamaModelsDir,
    'manifests',
    'registry.ollama.ai'
  );
  if (!fs.existsSync(rootDir)) return [];

  const found: OllamaModelItem[] = [];
  let namespaces: fs.Dirent[] = [];
  try {
    namespaces = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const ns of namespaces) {
    if (!ns.isDirectory()) continue;
    const nsDir = path.join(rootDir, ns.name);
    let repos: fs.Dirent[] = [];
    try {
      repos = fs.readdirSync(nsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const repo of repos) {
      if (!repo.isDirectory()) continue;
      const repoDir = path.join(nsDir, repo.name);
      let tags: fs.Dirent[] = [];
      try {
        tags = fs.readdirSync(repoDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const tag of tags) {
        if (!tag.isFile()) continue;
        const manifestPath = path.join(repoDir, tag.name);
        let sizeBytes = 0;
        try {
          const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          if (Array.isArray(parsed?.layers)) {
            for (const layer of parsed.layers) {
              if (typeof layer?.size === 'number') {
                sizeBytes += layer.size;
              }
            }
          }
          if (typeof parsed?.config?.size === 'number') {
            sizeBytes += parsed.config.size;
          }
        } catch {
          continue;
        }

        const fullName = ns.name === 'library' ? `${repo.name}:${tag.name}` : `${ns.name}/${repo.name}:${tag.name}`;
        const cls = classifyOllamaModel(fullName);
        found.push({
          name: fullName,
          sizeGb: Math.round((sizeBytes / 1024 ** 3) * 100) / 100,
          isVision: cls.isVision,
          supportsTools: cls.supportsTools,
          recommended: cls.recommended,
          hint: cls.hint,
          installed: true,
        });
      }
    }
  }

  return sortOllamaModels(found);
}

function sortOllamaModels(items: OllamaModelItem[]): OllamaModelItem[] {
  const rank = (m: OllamaModelItem): number => {
    const rec = RECOMMENDED_PRIORITY.get(m.name.toLowerCase());
    if (m.installed) {
      if (rec) return rec.order;
      if (m.isVision && m.supportsTools) return 100 + m.sizeGb;
      if (m.isVision) return 200 + m.sizeGb;
      return 300 + m.sizeGb;
    }
    return 1000 + (rec ? rec.order : 100 + m.sizeGb);
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export async function isOllamaHealthy(ollamaUrl = getPathsConfig().ollamaUrl): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1800) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getOllamaRunningModels(
  ollamaUrl = getPathsConfig().ollamaUrl
): Promise<Array<{ name: string; sizeVramGb: number }>> {
  try {
    const res = await fetch(`${ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(1800) });
    if (!res.ok) return [];
    const data: any = await res.json();
    const list = Array.isArray(data?.models) ? data.models : [];
    return list.map((m: any) => ({
      name: String(m.name || m.model || ''),
      sizeVramGb: Math.round((Number(m.size_vram || m.size || 0) / 1024 ** 3) * 100) / 100,
    }));
  } catch {
    return [];
  }
}

export async function listOllamaModels(
  ollamaUrl = getPathsConfig().ollamaUrl,
  modelsDir = getPathsConfig().ollamaModelsDir
): Promise<OllamaModelItem[]> {
  let installed: OllamaModelItem[] = [];

  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data: any = await res.json();
      const rawModels = Array.isArray(data?.models) ? data.models : [];
      installed = rawModels.map((m: any) => {
        const name = String(m.name || m.model || '');
        const cls = classifyOllamaModel(name);
        return {
          name,
          sizeGb: Math.round((Number(m.size || 0) / 1024 ** 3) * 100) / 100,
          isVision: cls.isVision,
          supportsTools: cls.supportsTools,
          recommended: cls.recommended,
          hint: cls.hint,
          installed: true,
        };
      });
    }
  } catch {}

  if (installed.length === 0) {
    installed = discoverOllamaModelsFromDisk(modelsDir);
  }

  const byLowerName = new Map<string, OllamaModelItem>();
  for (const item of installed) {
    byLowerName.set(item.name.toLowerCase(), item);
  }

  for (const rec of RECOMMENDED_OLLAMA_VISION_MODELS) {
    const key = rec.name.toLowerCase();
    if (!byLowerName.has(key)) {
      byLowerName.set(key, { ...rec, installed: false });
    }
  }

  return sortOllamaModels(Array.from(byLowerName.values()));
}

export function pickBestInstalledOllamaVisionModel(models: OllamaModelItem[]): string {
  const sorted = sortOllamaModels(models);
  const installedVisionTools = sorted.find((m) => m.installed && m.isVision && m.supportsTools);
  if (installedVisionTools) return installedVisionTools.name;

  const installedVision = sorted.find((m) => m.installed && m.isVision);
  if (installedVision) return installedVision.name;

  const anyInstalled = sorted.find((m) => m.installed);
  if (anyInstalled) return anyInstalled.name;

  return 'qwen3.5:4b';
}

let managedOllamaProc: ChildProcess | null = null;
let startPromise: Promise<{ running: boolean; startedNow: boolean; error?: string }> | null = null;

export function stopManagedOllamaServer(): void {
  if (managedOllamaProc) {
    try {
      managedOllamaProc.kill();
    } catch {}
    managedOllamaProc = null;
  }
}

export async function ensureOllamaServerRunning(
  ollamaUrl = getPathsConfig().ollamaUrl
): Promise<{ running: boolean; startedNow: boolean; error?: string }> {
  if (await isOllamaHealthy(ollamaUrl)) {
    return { running: true, startedNow: false };
  }

  if (startPromise) {
    return await startPromise;
  }

  startPromise = (async () => {
    const { ollamaExe } = getPathsConfig();
    if (!ollamaExe || (ollamaExe !== 'ollama' && !fs.existsSync(ollamaExe))) {
      return {
        running: false,
        startedNow: false,
        error: `Ollama executable not found${ollamaExe ? ` at ${ollamaExe}` : ''}. Install Ollama or start it manually.`,
      };
    }

    console.log(`[OllamaClient] Launching headless Ollama server (${ollamaExe} serve) with flash attention & q8_0 KV...`);
    const child = spawn(ollamaExe, ['serve'], {
      stdio: 'ignore',
      windowsHide: true,
      detached: false,
      env: {
        ...process.env,
        OLLAMA_FLASH_ATTENTION: process.env.OLLAMA_FLASH_ATTENTION || '1',
        OLLAMA_KV_CACHE_TYPE: process.env.OLLAMA_KV_CACHE_TYPE || 'q8_0',
        OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE || '2m',
      },
    });
    managedOllamaProc = child;
    child.on('exit', () => {
      if (managedOllamaProc === child) {
        managedOllamaProc = null;
      }
    });
    child.on('error', () => {
      if (managedOllamaProc === child) {
        managedOllamaProc = null;
      }
    });

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.killed) {
        if (await isOllamaHealthy(ollamaUrl)) {
          return { running: true, startedNow: false };
        }
        return {
          running: false,
          startedNow: false,
          error: `ollama serve exited early with code ${child.exitCode}`,
        };
      }
      await new Promise((r) => setTimeout(r, 400));
      if (await isOllamaHealthy(ollamaUrl)) {
        return { running: true, startedNow: true };
      }
    }

    return {
      running: false,
      startedNow: false,
      error: `Timed out waiting for Ollama server at ${ollamaUrl}`,
    };
  })().finally(() => {
    startPromise = null;
  });

  return await startPromise;
}

export async function unloadOllamaModel(
  modelName: string,
  ollamaUrl = getPathsConfig().ollamaUrl
): Promise<{ unloaded: string[]; durationMs: number }> {
  const start = performance.now();
  const running = await getOllamaRunningModels(ollamaUrl);
  const targets = new Set<string>(running.map((m) => m.name).filter(Boolean));
  if (modelName && modelName.trim()) {
    targets.add(modelName.trim());
  }

  const unloaded: string[] = [];
  for (const target of targets) {
    try {
      const res = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: target, prompt: '', keep_alive: 0, stream: false }),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        unloaded.push(target);
      }
    } catch {}
  }

  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    const remaining = await getOllamaRunningModels(ollamaUrl);
    if (remaining.length === 0) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  return {
    unloaded,
    durationMs: Math.round(performance.now() - start),
  };
}

export async function unloadAllOllamaModels(
  ollamaUrl = getPathsConfig().ollamaUrl
): Promise<{ unloaded: string[]; durationMs: number }> {
  const start = performance.now();
  const running = await getOllamaRunningModels(ollamaUrl);
  if (running.length === 0) {
    return { unloaded: [], durationMs: 0 };
  }

  const unloaded: string[] = [];
  for (const entry of running) {
    if (!entry.name) continue;
    try {
      const res = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: entry.name, prompt: '', keep_alive: 0, stream: false }),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        unloaded.push(entry.name);
      }
    } catch {}
  }

  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    const remaining = await getOllamaRunningModels(ollamaUrl);
    if (remaining.length === 0) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  return {
    unloaded,
    durationMs: Math.round(performance.now() - start),
  };
}

export async function pullOllamaModel(
  modelName: string,
  ollamaUrl = getPathsConfig().ollamaUrl
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = (modelName || '').trim();
  if (!trimmed || !/^[a-zA-Z0-9._:/-]+$/.test(trimmed)) {
    return { ok: false, error: `Invalid Ollama model name "${modelName}"` };
  }

  const started = await ensureOllamaServerRunning(ollamaUrl);
  if (!started.running) {
    return { ok: false, error: started.error || 'Ollama server is unavailable' };
  }

  try {
    const res = await fetch(`${ollamaUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed, stream: false }),
      signal: AbortSignal.timeout(600000),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `Pull failed (${res.status}): ${text.slice(0, 300)}` };
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) {
        return { ok: false, error: String(parsed.error) };
      }
    } catch {}
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export interface OllamaChatMessage {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, any> } }>;
  tool_name?: string;
}

export function convertMessagesToOllamaFormat(messages: Array<Record<string, any>>): OllamaChatMessage[] {
  return messages.map((m) => {
    const role = String(m.role || 'user');
    let textContent = '';
    const images: string[] = [];

    if (typeof m.content === 'string') {
      textContent = m.content;
    } else if (Array.isArray(m.content)) {
      const textParts: string[] = [];
      for (const part of m.content) {
        if (!part) continue;
        if (part.type === 'text' && typeof part.text === 'string') {
          textParts.push(part.text);
        } else if (part.type === 'image_url' && typeof part.image_url?.url === 'string') {
          const url = part.image_url.url;
          const b64Match = url.match(/^data:image\/[^;]+;base64,(.+)$/i);
          if (b64Match?.[1]) {
            images.push(b64Match[1]);
          } else if (/^[A-Za-z0-9+/=]{64,}$/.test(url)) {
            images.push(url);
          }
        }
      }
      textContent = textParts.join('\n');
    } else if (m.content !== null && m.content !== undefined) {
      textContent = JSON.stringify(m.content);
    }

    const out: OllamaChatMessage = {
      role,
      content: textContent,
    };

    if (images.length > 0) {
      out.images = images;
    }

    if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      out.tool_calls = m.tool_calls.map((tc: any) => {
        const rawArgs = tc?.function?.arguments;
        let parsedArgs: Record<string, any> = {};
        if (rawArgs && typeof rawArgs === 'object') {
          parsedArgs = rawArgs;
        } else if (typeof rawArgs === 'string' && rawArgs.trim()) {
          try {
            const p = JSON.parse(rawArgs);
            if (p && typeof p === 'object') parsedArgs = p;
          } catch {}
        }
        return {
          function: {
            name: String(tc?.function?.name || tc?.name || ''),
            arguments: parsedArgs,
          },
        };
      });
    }

    if (role === 'tool' && m.name) {
      out.tool_name = String(m.name);
    }

    return out;
  });
}

export function parseFallbackToolCallsFromText(
  text: string
): Array<{ name: string; arguments: Record<string, any> }> {
  const results: Array<{ name: string; arguments: Record<string, any> }> = [];
  if (!text) return results;

  const tryPushObj = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    const rawName = obj.name || obj.function?.name;
    const rawArgs = obj.arguments !== undefined ? obj.arguments : obj.function?.arguments;
    if (typeof rawName !== 'string' || !rawName.trim()) return;
    let argsObj: Record<string, any> = {};
    if (rawArgs && typeof rawArgs === 'object') {
      argsObj = rawArgs;
    } else if (typeof rawArgs === 'string' && rawArgs.trim()) {
      try {
        const parsed = JSON.parse(rawArgs);
        if (parsed && typeof parsed === 'object') argsObj = parsed;
      } catch {}
    }
    results.push({ name: rawName.trim(), arguments: argsObj });
  };

  // 1. Explicit <tool_call>{...}</tool_call> blocks
  const xmlRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = xmlRegex.exec(text)) !== null) {
    try {
      tryPushObj(JSON.parse(match[1]));
    } catch {}
  }
  if (results.length > 0) return results;

  // 2. Fenced JSON or direct JSON payload containing "name" + "arguments"
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  while ((match = fenceRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) parsed.forEach(tryPushObj);
      else tryPushObj(parsed);
    } catch {}
  }
  if (results.length > 0) return results;

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      tryPushObj(JSON.parse(trimmed));
    } catch {}
  }

  return results;
}

export async function enhancePromptWithOllama(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  keepAlive?: string;
  ollamaUrl?: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const url = params.ollamaUrl || getPathsConfig().ollamaUrl;
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        stream: false,
        think: false,
        keep_alive: params.keepAlive || '2m',
        options: {
          num_ctx: 4096,
          temperature: 0.6,
        },
      }),
      signal: params.abortSignal
        ? AbortSignal.any([params.abortSignal, AbortSignal.timeout(35000)])
        : AbortSignal.timeout(35000),
    });

    if (!res.ok) return params.userPrompt;
    const data: any = await res.json();
    const content = data?.message?.content;
    if (typeof content === 'string' && content.trim().length > 10) {
      return cleanEnhancedPrompt(content);
    }
  } catch {}
  return params.userPrompt;
}

export async function streamOllamaChat(params: {
  model: string;
  keepAlive?: string;
  ollamaUrl?: string;
  completion: InferenceCompletionParams;
}): Promise<InferenceCompletionResult> {
  const { model, keepAlive, completion } = params;
  const url = params.ollamaUrl || getPathsConfig().ollamaUrl;
  const startTime = performance.now();

  const body: Record<string, any> = {
    model,
    messages: convertMessagesToOllamaFormat(completion.messages),
    stream: true,
    think: false,
    keep_alive: keepAlive || '2m',
    options: {
      num_ctx: 8192,
      temperature: 0.25,
    },
  };
  if (completion.tools && completion.tools.length > 0) {
    body.tools = completion.tools;
  }

  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: completion.abortSignal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    const msg = `⚠️ Ollama Vision error (${res.status}) with "${model}": ${errText.slice(0, 400)}`;
    completion.onTokenDelta(msg, Math.max(1, Math.ceil(msg.length / 4)));
    return {
      content: msg,
      thinkingContent: '',
      thinkingDurationMs: 0,
      thinkingTokens: 0,
      outputTokens: 10,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let rawBuffer = '';
  let content = '';
  let thinkingContent = '';
  let outputTokens = 0;
  let thinkingTokens = 0;
  let announced = false;
  const collectedToolCalls: Array<{ name: string; arguments: Record<string, any> }> = [];

  const handleNdjsonLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (parsed?.error) {
      const errMsg = `\n\n⚠️ Ollama error: ${String(parsed.error)}`;
      content += errMsg;
      outputTokens += Math.max(1, Math.ceil(errMsg.length / 4));
      completion.onTokenDelta(errMsg, outputTokens);
      return;
    }

    const msg = parsed?.message;
    const evalTps =
      parsed?.done && typeof parsed?.eval_count === 'number' && typeof parsed?.eval_duration === 'number' && parsed.eval_duration > 0
        ? Number((parsed.eval_count / (parsed.eval_duration / 1e9)).toFixed(1))
        : undefined;

    if (typeof msg?.thinking === 'string' && msg.thinking.length > 0) {
      thinkingContent += msg.thinking;
      thinkingTokens += Math.max(1, Math.ceil(msg.thinking.length / 4));
      completion.onThoughtDelta?.(msg.thinking, Math.round(performance.now() - startTime), thinkingTokens);
    }

    if (typeof msg?.content === 'string' && msg.content.length > 0) {
      content += msg.content;
      outputTokens += Math.max(1, Math.ceil(msg.content.length / 4));
      const tps =
        evalTps ||
        Number((outputTokens / Math.max(0.08, (performance.now() - startTime) / 1000)).toFixed(1));
      completion.onTokenDelta(msg.content, outputTokens, tps);
    }

    if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
      if (!announced) {
        announced = true;
        completion.onToolCallPreparing?.(msg.tool_calls[0]?.function?.name || msg.tool_calls[0]?.name);
      }
      for (const tc of msg.tool_calls) {
        const fnName = String(tc?.function?.name || tc?.name || '').trim();
        if (!fnName) continue;
        const rawArgs = tc?.function?.arguments;
        let argsObj: Record<string, any> = {};
        if (rawArgs && typeof rawArgs === 'object') {
          argsObj = rawArgs;
        } else if (typeof rawArgs === 'string' && rawArgs.trim()) {
          try {
            const p = JSON.parse(rawArgs);
            if (p && typeof p === 'object') argsObj = p;
          } catch {}
        }
        collectedToolCalls.push({ name: fnName, arguments: argsObj });
      }
    }

    if (parsed?.done && typeof parsed?.eval_count === 'number' && parsed.eval_count > 0) {
      outputTokens = parsed.eval_count;
      if (evalTps && content.length > 0) {
        completion.onTokenDelta('', outputTokens, evalTps);
      }
    }
  };

  while (true) {
    if (completion.abortSignal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    rawBuffer += decoder.decode(value, { stream: true });
    const lines = rawBuffer.split('\n');
    rawBuffer = lines.pop() || '';
    for (const line of lines) {
      handleNdjsonLine(line);
    }
  }
  if (rawBuffer.trim()) {
    handleNdjsonLine(rawBuffer);
  }

  if (
    collectedToolCalls.length === 0 &&
    content.trim() &&
    completion.tools &&
    completion.tools.length > 0 &&
    !completion.abortSignal?.aborted
  ) {
    const fallbackCalls = parseFallbackToolCallsFromText(content);
    if (fallbackCalls.length > 0) {
      if (!announced) {
        completion.onToolCallPreparing?.(fallbackCalls[0].name);
      }
      collectedToolCalls.push(...fallbackCalls);
    }
  }

  if (completion.onToolCallRequest && collectedToolCalls.length > 0 && !completion.abortSignal?.aborted) {
    for (const call of collectedToolCalls) {
      await completion.onToolCallRequest(call.name, call.arguments);
    }
  }

  return {
    content,
    thinkingContent,
    thinkingDurationMs: thinkingTokens > 0 ? Math.round(performance.now() - startTime) : 0,
    thinkingTokens,
    outputTokens,
  };
}
