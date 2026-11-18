import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { BuiltinToolHandler } from './types.js';
import { LlamaMoESidecar } from '../../tabby/llamaSidecar.js';

export const name = 'comfyui';

const COMFY_ROOT = 'C:\\Users\\Sue\\Documents\\GitHub\\ComfyUI\\ComfyUI-Easy-Install';
const COMFY_APP_DIR = path.join(COMFY_ROOT, 'ComfyUI');
const WORKFLOWS_DIR = path.join(COMFY_APP_DIR, 'user', 'default', 'workflows');
const PYTHON_EXE = path.join(COMFY_ROOT, 'python_embeded', 'python.exe');
const COMFY_URL = 'http://127.0.0.1:8188';
const STRATA_URL = 'http://127.0.0.1:8080';

const WORKFLOW_ALIASES: Record<string, string> = {
  moss: 'Moss Image.json',
  'moss image': 'Moss Image.json',
  'moss-image': 'Moss Image.json',
  h3: 'H3 Image Easy Workflow.json',
  'h3 image': 'H3 Image Easy Workflow.json',
  'h3-image': 'H3 Image Easy Workflow.json',
  'minimax h3 image': 'H3 Image Easy Workflow.json',
  'minimax-h3-image': 'H3 Image Easy Workflow.json',
  minimax: 'H3 Image Easy Workflow.json',
  krea: 'Famegrid Krea 2 Spice V2 - Simplified.json',
  'krea 2': 'Famegrid Krea 2 Spice V2 - Simplified.json',
  qwen: 'Qwen 2.1 Image Edit.json',
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function resolveWorkflowFile(requested?: string): string | null {
  if (!fs.existsSync(WORKFLOWS_DIR)) return null;
  const raw = (requested || 'Moss Image.json').trim();
  const aliasTarget = WORKFLOW_ALIASES[raw.toLowerCase()];
  const candidateName = aliasTarget || raw;

  if (path.isAbsolute(candidateName) && fs.existsSync(candidateName)) {
    return candidateName;
  }

  const directPath = path.join(WORKFLOWS_DIR, candidateName);
  if (fs.existsSync(directPath)) return directPath;
  if (!candidateName.toLowerCase().endsWith('.json')) {
    const withJson = path.join(WORKFLOWS_DIR, `${candidateName}.json`);
    if (fs.existsSync(withJson)) return withJson;
  }

  const files = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.json') && !f.startsWith('.'));
  const lower = candidateName.toLowerCase().replace(/\.json$/i, '');
  const exactInsensitive = files.find((f) => f.toLowerCase().replace(/\.json$/i, '') === lower);
  if (exactInsensitive) return path.join(WORKFLOWS_DIR, exactInsensitive);

  const partial = files.find((f) => f.toLowerCase().includes(lower));
  return partial ? path.join(WORKFLOWS_DIR, partial) : null;
}

async function isComfyHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureComfyServerRunning(abortSignal?: AbortSignal): Promise<{ running: boolean; startedNow: boolean; error?: string }> {
  if (await isComfyHealthy()) {
    return { running: true, startedNow: false };
  }

  if (!fs.existsSync(PYTHON_EXE)) {
    return { running: false, startedNow: false, error: `Embedded Python not found at ${PYTHON_EXE}` };
  }

  const child = spawn(
    PYTHON_EXE,
    [
      '-I',
      '-W',
      'ignore::FutureWarning',
      'ComfyUI\\main.py',
      '--windows-standalone-build',
      '--listen',
      '0.0.0.0',
      '--disable-auto-launch',
      '--disable-pinned-memory',
      '--fp32-vae',
    ],
    {
      cwd: COMFY_ROOT,
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
    if (await isComfyHealthy()) {
      return { running: true, startedNow: true };
    }
  }

  return { running: false, startedNow: true, error: 'ComfyUI did not become healthy on port 8188 within 90s' };
}

async function freeComfyVram(): Promise<boolean> {
  try {
    const res = await fetch(`${COMFY_URL}/free`, {
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

function collectNodesIncludingSubgraphs(wf: Record<string, any>): any[] {
  const collected: any[] = [];
  if (Array.isArray(wf.nodes)) collected.push(...wf.nodes);
  const subs = wf.definitions?.subgraphs;
  if (Array.isArray(subs)) {
    for (const sub of subs) {
      if (Array.isArray(sub?.nodes)) collected.push(...sub.nodes);
    }
  }
  return collected;
}

function extractWorkflowInspection(wfPath: string) {
  const raw = fs.readFileSync(wfPath, 'utf-8').replace(/^\uFEFF/, '');
  const wf = JSON.parse(raw);
  const allNodes = collectNodesIncludingSubgraphs(wf);

  const models: Array<{ nodeId: any; nodeType: string; values: any }> = [];
  const promptNodes: Array<{ nodeId: any; nodeType: string; title?: string; textPreview: string }> = [];
  const samplers: Array<{ nodeId: any; nodeType: string; values: any }> = [];
  const resolutions: Array<{ nodeId: any; nodeType: string; values: any }> = [];
  let ollamaEnhancer: { nodeId: any; systemPrompt: string; defaultPrompt: string } | null = null;

  for (const n of allNodes) {
    if (!n || typeof n !== 'object') continue;
    const t = String(n.type || '');
    const mode = Number(n.mode || 0);
    const active = mode !== 2 && mode !== 4;
    const vals = n.widgets_values_named || n.widgets_values || [];

    if (/Loader/i.test(t) || t === 'OTUNetLoaderW8A8') {
      models.push({ nodeId: n.id, nodeType: t, values: vals });
    }
    if (
      active &&
      (t === 'CLIPTextEncode' ||
        t === 'DF_Text_Box' ||
        t === 'PrimitiveStringMultiline' ||
        t === 'MiniMaxH3ImageConditioning' ||
        t === 'TextEncodeQwenImage21')
    ) {
      const textVal = Array.isArray(n.widgets_values)
        ? String(n.widgets_values[0] || '')
        : String(n.widgets_values_named?.text || n.widgets_values_named?.prompt || n.widgets_values_named?.value || n.widgets_values_named?.Text || '');
      promptNodes.push({
        nodeId: n.id,
        nodeType: t,
        title: n.title || undefined,
        textPreview: textVal.slice(0, 200),
      });
    }
    if (active && (/Sampler/i.test(t) || t === 'BasicScheduler')) {
      samplers.push({ nodeId: n.id, nodeType: t, values: vals });
    }
    if (active && (t === 'ResolutionSelector' || t === 'FluxResolutionNode' || t.includes('Empty') && t.includes('Latent'))) {
      resolutions.push({ nodeId: n.id, nodeType: t, values: vals });
    }
    if (active && (t === 'OllamaGenerateV2' || t === 'TextGenerate') && !ollamaEnhancer) {
      const sys = Array.isArray(n.widgets_values)
        ? String(n.widgets_values[0] || '')
        : String(n.widgets_values_named?.system || '');
      let resolvedSys = sys.trim();
      if (resolvedSys.length <= 20) {
        for (const cand of allNodes) {
          if (!cand || typeof cand !== 'object') continue;
          const ct = String(cand.type || '');
          const cMode = Number(cand.mode || 0);
          if (cMode === 2 || cMode === 4) continue;
          if (ct === 'PrimitiveStringMultiline' || ct === 'DF_Text_Box') {
            const cText = Array.isArray(cand.widgets_values)
              ? String(cand.widgets_values[0] || '')
              : String(cand.widgets_values_named?.value || cand.widgets_values_named?.Text || cand.widgets_values_named?.text || '');
            const lowerCText = cText.toLowerCase();
            if (
              lowerCText.includes('role and objective') ||
              lowerCText.includes('prompt engineer') ||
              lowerCText.includes('caption-expansion')
            ) {
              resolvedSys = cText.trim();
              break;
            }
          }
        }
      }
      if (resolvedSys.length > 20) {
        ollamaEnhancer = {
          nodeId: n.id,
          systemPrompt: resolvedSys,
          defaultPrompt: '',
        };
      }
    }
  }

  return {
    workflow: path.basename(wfPath),
    path: wfPath,
    nodeCount: allNodes.length,
    models,
    promptNodes,
    samplers,
    resolutions,
    hasPromptEnhancer: Boolean(ollamaEnhancer),
    enhancerSystemPrompt: ollamaEnhancer?.systemPrompt || null,
  };
}

function cleanEnhancedPrompt(rawOutput: string): string {
  let cleaned = rawOutput.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  if (cleaned.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed);
        if (keys.length === 1 && typeof parsed.caption === 'string') {
          return parsed.caption.trim();
        }
        if (typeof parsed.expanded_caption === 'string' && parsed.expanded_caption.trim().length > 0) {
          return parsed.expanded_caption.trim();
        }
        if (parsed.summary && Array.isArray(parsed.items)) {
          return JSON.stringify(parsed, null, 2);
        }
      }
    } catch {
      const captionMatch = cleaned.match(/^\{\s*"caption"\s*:\s*"([\s\S]*)"\s*\}\s*$/);
      if (captionMatch) {
        return captionMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
      }
    }
  }
  return cleaned;
}

function readBrainProviderConfig(): {
  provider: 'strata' | 'google_ai_studio';
  googleApiKey: string;
} {
  let provider: 'strata' | 'google_ai_studio' = 'strata';
  let fileKey = '';
  try {
    const cfgPath = path.join(REPO_ROOT, '.runtime', 'brain-provider.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (parsed?.provider === 'google_ai_studio') provider = 'google_ai_studio';
      if (typeof parsed?.googleApiKey === 'string') fileKey = parsed.googleApiKey.trim();
    }
  } catch {}
  const googleApiKey =
    fileKey ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    '';
  return { provider, googleApiKey };
}

async function enhancePromptWithGemini(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  abortSignal?: AbortSignal
): Promise<string> {
  const candidates = ['gemini-4-hydrogen', 'gemini-3.8-flash'];
  for (const model of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    const onAbort = () => controller.abort();
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: 1500,
            temperature: 0.6,
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) continue;
      const data: any = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim().length > 10) {
        return cleanEnhancedPrompt(content);
      }
    } catch {
      if (abortSignal?.aborted) break;
    } finally {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
    }
  }
  return userPrompt;
}

async function enhancePromptWithStrata(
  systemPrompt: string,
  userPrompt: string,
  abortSignal?: AbortSignal
): Promise<string> {
  const sidecar = LlamaMoESidecar.getInstance();
  const awake = await sidecar.ensureRunning('swift-1.5-iq2_xs');
  if (!awake) {
    return userPrompt;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const onAbort = () => controller.abort();
  abortSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(`${STRATA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'swift-1.5-iq2_xs',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 1500,
        temperature: 0.6,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return userPrompt;
    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim().length > 10) {
      return cleanEnhancedPrompt(content);
    }
    return userPrompt;
  } catch {
    return userPrompt;
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener('abort', onAbort);
  }
}

const PYTHON_CONVERTER_SCRIPT = `
import json, sys, urllib.request, random

payload = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
wf_path = payload['workflow_path']
prompt_text = payload.get('prompt')
neg_text = payload.get('negative_prompt')
aspect_ratio = payload.get('aspect_ratio')
megapixels = payload.get('megapixels')
width = payload.get('width')
height = payload.get('height')
steps = payload.get('steps')
cfg = payload.get('cfg')
seed = payload.get('seed')

from comfy_cli.workflow_to_api import convert_ui_to_api, is_api_format

wf = json.load(open(wf_path, 'r', encoding='utf-8-sig'))
obj_info = json.loads(urllib.request.urlopen('${COMFY_URL}/object_info', timeout=25).read().decode('utf-8'))

api_wf = wf if is_api_format(wf) else convert_ui_to_api(wf, obj_info)

# 1. Identify positive and negative prompt nodes
pos_nodes = set()
neg_nodes = set()
for nid, node in api_wf.items():
    ct = node.get('class_type', '')
    inps = node.get('inputs', {})
    if ct in ('KSampler', 'KSamplerAdvanced', 'SamplerCustom'):
        if isinstance(inps.get('positive'), list):
            pos_nodes.add(str(inps['positive'][0]))
        if isinstance(inps.get('negative'), list):
            neg_nodes.add(str(inps['negative'][0]))
    elif ct == 'BasicGuider':
        if isinstance(inps.get('conditioning'), list):
            pos_nodes.add(str(inps['conditioning'][0]))
    elif ct in ('MiniMaxH3ImageConditioning', 'TextEncodeQwenImage21'):
        pos_nodes.add(nid)

def resolve_conditioning_target(start_id, seen=None):
    if seen is None: seen = set()
    if start_id in seen or start_id not in api_wf:
        return None
    seen.add(start_id)
    node = api_wf[start_id]
    ct = node.get('class_type', '')
    inps = node.get('inputs', {})
    if ct in ('CLIPTextEncode', 'MiniMaxH3ImageConditioning', 'TextEncodeQwenImage21'):
        return start_id
    for k in ('conditioning', 'positive'):
        v = inps.get(k)
        if isinstance(v, list) and len(v) >= 1:
            found = resolve_conditioning_target(str(v[0]), seen)
            if found:
                return found
    return None

if prompt_text is not None:
    for pid in list(pos_nodes):
        target_id = resolve_conditioning_target(pid) or pid
        if target_id not in api_wf:
            continue
        pnode = api_wf[target_id]
        pct = pnode.get('class_type', '')
        if pct == 'CLIPTextEncode':
            pnode['inputs']['text'] = prompt_text
        elif pct in ('MiniMaxH3ImageConditioning', 'TextEncodeQwenImage21'):
            pnode['inputs']['prompt'] = prompt_text

if neg_text is not None:
    for nid in list(neg_nodes):
        target_id = resolve_conditioning_target(nid) or nid
        if target_id not in api_wf:
            continue
        nnode = api_wf[target_id]
        if nnode.get('class_type') == 'CLIPTextEncode':
            nnode['inputs']['text'] = neg_text

# 2. Apply optional resolution/sampler/seed overrides
effective_seed = int(seed) if seed is not None and int(seed) >= 0 else random.randint(1, 2147483647)

for nid, node in api_wf.items():
    ct = node.get('class_type', '')
    inps = node.get('inputs', {})

    if ct in ('ResolutionSelector', 'FluxResolutionNode'):
        if aspect_ratio is not None and 'aspect_ratio' in inps:
            inps['aspect_ratio'] = aspect_ratio
        if megapixels is not None and 'megapixels' in inps:
            inps['megapixels'] = megapixels

    if ct in ('EmptyLatentImage', 'EmptyFlux2LatentImage', 'EmptySD3LatentImage'):
        if width is not None and not isinstance(inps.get('width'), list):
            inps['width'] = int(width)
        if height is not None and not isinstance(inps.get('height'), list):
            inps['height'] = int(height)

    if ct in ('BasicScheduler', 'KSampler', 'KSamplerAdvanced') and steps is not None:
        if 'steps' in inps and not isinstance(inps['steps'], list):
            inps['steps'] = int(steps)

    if cfg is not None:
        if ct in ('SamplerCustom', 'KSampler', 'KSamplerAdvanced') and 'cfg' in inps and not isinstance(inps['cfg'], list):
            inps['cfg'] = float(cfg)
        elif ct == 'FluxGuidance' and 'guidance' in inps and not isinstance(inps['guidance'], list):
            inps['guidance'] = float(cfg)

    for sk in ('seed', 'noise_seed'):
        val = inps.get(sk)
        if val is not None and not isinstance(val, list):
            if (seed is not None and int(seed) >= 0) or (isinstance(val, (int, float)) and val < 0) or sk == 'seed':
                if isinstance(val, (int, float)) and (val < 0 or seed is not None):
                    inps[sk] = effective_seed

# 3. Convert PreviewImage to SaveImage if no SaveImage exists
has_save = any(n.get('class_type') == 'SaveImage' for n in api_wf.values())
if not has_save:
    for nid, node in api_wf.items():
        if node.get('class_type') == 'PreviewImage':
            node['class_type'] = 'SaveImage'
            node['inputs']['filename_prefix'] = 'LocalGravity_MOSS'

# 4. Backward BFS reachability from output nodes
output_types = {'SaveImage', 'SaveVideo', 'VHS_VideoCombine', 'SaveAnimatedWEBP', 'SaveAudio'}
queue = [nid for nid, n in api_wf.items() if n.get('class_type') in output_types]
reachable = set(queue)
while queue:
    curr = queue.pop(0)
    cnode = api_wf.get(curr, {})
    for val in cnode.get('inputs', {}).values():
        if isinstance(val, list) and len(val) >= 1:
            dep = str(val[0])
            if dep in api_wf and dep not in reachable:
                reachable.add(dep)
                queue.append(dep)

pruned = {nid: api_wf[nid] for nid in reachable if api_wf[nid].get('class_type') in obj_info}

# 5. Validate / auto-heal COMBO filenames against live /object_info
for nid, node in pruned.items():
    ct = node.get('class_type', '')
    schema_inps = obj_info.get(ct, {}).get('input', {})
    all_specs = {}
    all_specs.update(schema_inps.get('required', {}) or {})
    all_specs.update(schema_inps.get('optional', {}) or {})
    for k, val in list(node.get('inputs', {}).items()):
        if isinstance(val, list) or k not in all_specs:
            continue
        spec = all_specs[k]
        if isinstance(spec, list) and len(spec) > 0 and isinstance(spec[0], list):
            choices = spec[0]
            if choices and val not in choices:
                val_str = str(val).replace('/', '\\\\')
                base = val_str.split('\\\\')[-1].lower()
                match = next((c for c in choices if str(c).replace('/', '\\\\').split('\\\\')[-1].lower() == base), None)
                if match is not None:
                    node['inputs'][k] = match

print(json.dumps({'api_prompt': pruned, 'effective_seed': effective_seed, 'node_count': len(pruned)}))
`;

async function sanitizeWorkflowViaPython(params: {
  workflowPath: string;
  prompt?: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  megapixels?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
}): Promise<{ api_prompt: Record<string, any>; effective_seed: number; node_count: number }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpPy = path.join(os.tmpdir(), `lg_comfy_conv_${stamp}.py`);
  const tmpPayload = path.join(os.tmpdir(), `lg_comfy_payload_${stamp}.json`);
  fs.writeFileSync(tmpPy, PYTHON_CONVERTER_SCRIPT, 'utf-8');
  fs.writeFileSync(
    tmpPayload,
    JSON.stringify({
      workflow_path: params.workflowPath,
      prompt: params.prompt ?? null,
      negative_prompt: params.negative_prompt ?? null,
      aspect_ratio: params.aspect_ratio ?? null,
      megapixels: params.megapixels ?? null,
      width: params.width ?? null,
      height: params.height ?? null,
      steps: params.steps ?? null,
      cfg: params.cfg ?? null,
      seed: params.seed ?? null,
    }),
    'utf-8'
  );

  try {
    const out = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
      const child = spawn(PYTHON_EXE, [tmpPy, tmpPayload], {
        cwd: COMFY_ROOT,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        reject(new Error('Workflow conversion timed out after 30s'));
      }, 30000);
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? 1 });
      });
    });

    const lines = out.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const jsonLine = [...lines].reverse().find((l) => l.startsWith('{'));
    if (out.code !== 0 || !jsonLine) {
      throw new Error(
        `Workflow conversion failed (exit ${out.code}): ${(out.stderr || out.stdout).slice(0, 800)}`
      );
    }
    return JSON.parse(jsonLine);
  } finally {
    try {
      fs.unlinkSync(tmpPy);
    } catch {}
    try {
      fs.unlinkSync(tmpPayload);
    } catch {}
  }
}

export const execute: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const action = String(args.action || 'generate').toLowerCase();

  if (action === 'list_workflows') {
    if (!fs.existsSync(WORKFLOWS_DIR)) {
      return {
        stdout: '',
        stderr: `Workflows directory not found: ${WORKFLOWS_DIR}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const items = fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.toLowerCase().endsWith('.json') && !f.startsWith('.'))
      .map((f) => {
        const st = fs.statSync(path.join(WORKFLOWS_DIR, f));
        return { name: f, sizeBytes: st.size, updatedAt: st.mtime.toISOString(), mtimeMs: st.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map(({ mtimeMs: _m, ...rest }) => rest);

    return {
      stdout: JSON.stringify({ workflowsDir: WORKFLOWS_DIR, count: items.length, workflows: items }, null, 2),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'inspect_workflow') {
    const wfPath = resolveWorkflowFile(args.workflow);
    if (!wfPath) {
      return {
        stdout: '',
        stderr: `Workflow "${args.workflow || 'Moss Image.json'}" not found in ${WORKFLOWS_DIR}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const info = extractWorkflowInspection(wfPath);
    return {
      stdout: JSON.stringify(info, null, 2),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'status') {
    const comfyUp = await isComfyHealthy();
    let stats: any = null;
    let queue: any = null;
    if (comfyUp) {
      try {
        stats = await (await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(3000) })).json();
      } catch {}
      try {
        queue = await (await fetch(`${COMFY_URL}/queue`, { signal: AbortSignal.timeout(3000) })).json();
      } catch {}
    }
    const strataState = await LlamaMoESidecar.getInstance().getState();
    return {
      stdout: JSON.stringify(
        {
          comfyui: { url: COMFY_URL, running: comfyUp, systemStats: stats, queue },
          strata: { url: STRATA_URL, state: strataState, profile: LlamaMoESidecar.getInstance().getActiveProfile() },
        },
        null,
        2
      ),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'start_server') {
    const res = await ensureComfyServerRunning(ctx.abortSignal);
    return {
      stdout: res.running ? JSON.stringify({ status: 'running', url: COMFY_URL, startedNow: res.startedNow }, null, 2) : '',
      stderr: res.running ? '' : res.error || 'Failed to start ComfyUI',
      exitCode: res.running ? 0 : 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'free_vram') {
    const freed = await freeComfyVram();
    return {
      stdout: JSON.stringify({ freed, url: COMFY_URL }, null, 2),
      stderr: '',
      exitCode: freed ? 0 : 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'generate' || action === 'run_workflow') {
    const wfPath = resolveWorkflowFile(args.workflow);
    if (!wfPath) {
      return {
        stdout: '',
        stderr: `Workflow "${args.workflow || 'Moss Image.json'}" not found in ${WORKFLOWS_DIR}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }

    const inspection = extractWorkflowInspection(wfPath);
    const defaultPrompt =
      inspection.promptNodes.find((p) => p.textPreview.trim().length > 0)?.textPreview ||
      'Editorial photograph with rich lighting and crisp detail';
    const rawPrompt = typeof args.prompt === 'string' && args.prompt.trim() ? args.prompt.trim() : defaultPrompt;

    const providerCfg = readBrainProviderConfig();
    const isGoogleMode =
      providerCfg.provider === 'google_ai_studio' && Boolean(providerCfg.googleApiKey);
    const sidecar = LlamaMoESidecar.getInstance();
    const wasStrataActive = await sidecar.isHealthy();

    let finalPrompt = rawPrompt;
    let promptEnhanced = false;
    let enhancedBy: 'gemini' | 'strata' | null = null;
    if (
      args.enhance_prompt !== false &&
      inspection.enhancerSystemPrompt &&
      !rawPrompt.trimStart().startsWith('{')
    ) {
      if (isGoogleMode) {
        ctx.onStdoutChunk?.('[ComfyUI] Enhancing prompt with Gemini API (zero GPU cost)...\n');
        const enhanced = await enhancePromptWithGemini(
          inspection.enhancerSystemPrompt,
          rawPrompt,
          providerCfg.googleApiKey,
          ctx.abortSignal
        );
        if (enhanced !== rawPrompt) {
          finalPrompt = enhanced;
          promptEnhanced = true;
          enhancedBy = 'gemini';
        }
      } else {
        ctx.onStdoutChunk?.('[ComfyUI] Enhancing prompt with Strata before GPU handoff...\n');
        const enhanced = await enhancePromptWithStrata(
          inspection.enhancerSystemPrompt,
          rawPrompt,
          ctx.abortSignal
        );
        if (enhanced !== rawPrompt) {
          finalPrompt = enhanced;
          promptEnhanced = true;
          enhancedBy = 'strata';
        }
      }
    }

    if (wasStrataActive || !isGoogleMode) {
      ctx.onStdoutChunk?.('[ComfyUI] Offloading Strata from GPU to free 16 GB VRAM for ComfyUI...\n');
      await sidecar.offloadFromGpu('comfyui_generate');
    }

    let savedOutputs: Array<{ filename: string; localPath: string; apiUrl: string; subfolder: string; type: string }> = [];
    let promptId = '';
    let effectiveSeed = 0;
    let sanitizedNodeCount = 0;
    let strataReloaded = false;
    let generationError: string | null = null;

    try {
      const serverCheck = await ensureComfyServerRunning(ctx.abortSignal);
      if (!serverCheck.running) {
        throw new Error(serverCheck.error || 'Failed to ensure ComfyUI is running on port 8188');
      }

      ctx.onStdoutChunk?.(`[ComfyUI] Preparing workflow "${path.basename(wfPath)}"...\n`);
      const converted = await sanitizeWorkflowViaPython({
        workflowPath: wfPath,
        prompt: finalPrompt,
        negative_prompt: typeof args.negative_prompt === 'string' ? args.negative_prompt : undefined,
        aspect_ratio: typeof args.aspect_ratio === 'string' ? args.aspect_ratio : undefined,
        megapixels: args.megapixels !== undefined ? Number(args.megapixels) : undefined,
        width: args.width !== undefined ? Number(args.width) : undefined,
        height: args.height !== undefined ? Number(args.height) : undefined,
        steps: args.steps !== undefined ? Number(args.steps) : undefined,
        cfg: args.cfg !== undefined ? Number(args.cfg) : undefined,
        seed: args.seed !== undefined ? Number(args.seed) : undefined,
      });

      effectiveSeed = converted.effective_seed;
      sanitizedNodeCount = converted.node_count;

      ctx.onStdoutChunk?.(`[ComfyUI] Queueing workflow (${sanitizedNodeCount} nodes, seed ${effectiveSeed})...\n`);
      const submitRes = await fetch(`${COMFY_URL}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: converted.api_prompt, client_id: 'localgravity' }),
        signal: AbortSignal.timeout(15000),
      });

      const submitText = await submitRes.text();
      if (!submitRes.ok) {
        throw new Error(`ComfyUI /prompt rejected (${submitRes.status}): ${submitText.slice(0, 1000)}`);
      }
      const submitJson = JSON.parse(submitText);
      if (submitJson.node_errors && Object.keys(submitJson.node_errors).length > 0) {
        throw new Error(`ComfyUI node validation errors: ${JSON.stringify(submitJson.node_errors).slice(0, 1200)}`);
      }
      promptId = String(submitJson.prompt_id || '');
      if (!promptId) {
        throw new Error(`ComfyUI did not return prompt_id: ${submitText.slice(0, 400)}`);
      }

      const timeoutMs = Number(args.timeout_ms) || 600000;
      const pollDeadline = Date.now() + timeoutMs;
      let lastLogAt = Date.now();
      let completedEntry: any = null;

      while (Date.now() < pollDeadline) {
        if (ctx.abortSignal?.aborted) {
          throw new Error('ComfyUI generation aborted by user.');
        }
        await new Promise((r) => setTimeout(r, 1500));

        const histRes = await fetch(`${COMFY_URL}/history/${encodeURIComponent(promptId)}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (histRes.ok) {
          const histJson: any = await histRes.json();
          if (histJson && histJson[promptId]) {
            completedEntry = histJson[promptId];
            const statusObj = completedEntry.status;
            if (statusObj?.status_str === 'error') {
              const msgs = Array.isArray(statusObj.messages) ? JSON.stringify(statusObj.messages) : '';
              throw new Error(`ComfyUI execution failed: ${msgs.slice(0, 1200)}`);
            }
            if (statusObj?.completed || (completedEntry.outputs && Object.keys(completedEntry.outputs).length > 0)) {
              break;
            }
          }
        }

        if (Date.now() - lastLogAt >= 6000) {
          lastLogAt = Date.now();
          const elapsedS = Math.round((performance.now() - startMs) / 1000);
          ctx.onStdoutChunk?.(`[ComfyUI] Generating image with ${path.basename(wfPath)} (${elapsedS}s elapsed)...\n`);
        }
      }

      if (!completedEntry) {
        throw new Error(`ComfyUI job ${promptId} timed out after ${Math.round(timeoutMs / 1000)}s`);
      }

      const outDir = path.join(REPO_ROOT, '.runtime', 'mcp-outputs');
      fs.mkdirSync(outDir, { recursive: true });

      const outputsObj = completedEntry.outputs || {};
      for (const nodeOut of Object.values(outputsObj) as any[]) {
        const images = Array.isArray(nodeOut?.images) ? nodeOut.images : [];
        for (const img of images) {
          if (!img?.filename) continue;
          const q = new URLSearchParams({
            filename: String(img.filename),
            subfolder: String(img.subfolder || ''),
            type: String(img.type || 'output'),
          });
          const viewRes = await fetch(`${COMFY_URL}/view?${q.toString()}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!viewRes.ok) continue;
          const buf = Buffer.from(await viewRes.arrayBuffer());
          const safeBase = String(img.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
          const copyName = `comfyui-${Date.now()}-${safeBase}`;
          const localPath = path.join(outDir, copyName);
          fs.writeFileSync(localPath, buf);
          savedOutputs.push({
            filename: String(img.filename),
            localPath,
            apiUrl: `/api/mcp-outputs/${copyName}`,
            subfolder: String(img.subfolder || ''),
            type: String(img.type || 'output'),
          });
        }
      }
    } catch (err: any) {
      generationError = err?.message || String(err);
    } finally {
      if (ctx.abortSignal?.aborted) {
        try {
          await fetch(`${COMFY_URL}/interrupt`, { method: 'POST', signal: AbortSignal.timeout(3000) });
        } catch {}
      }
      await freeComfyVram();
      await new Promise((r) => setTimeout(r, 1500));
      if (!isGoogleMode || wasStrataActive) {
        ctx.onStdoutChunk?.('[ComfyUI] Freed ComfyUI VRAM. Reloading Strata onto GPU...\n');
        strataReloaded = await sidecar.ensureRunning('swift-1.5-iq2_xs');
      } else {
        ctx.onStdoutChunk?.('[ComfyUI] Freed ComfyUI VRAM (Google API mode active; Strata left off GPU).\n');
      }
    }

    if (generationError) {
      return {
        stdout: '',
        stderr: `${generationError} (Strata reloaded: ${strataReloaded})`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }

    const lines: string[] = [
      JSON.stringify(
        {
          status: 'completed',
          workflow: path.basename(wfPath),
          promptId,
          seed: effectiveSeed,
          sanitizedNodes: sanitizedNodeCount,
          promptEnhancedByStrata: enhancedBy === 'strata' && promptEnhanced,
          promptEnhancedBy: enhancedBy,
          effectivePrompt: finalPrompt,
          strataReloaded,
          outputs: savedOutputs,
        },
        null,
        2
      ),
    ];

    for (const out of savedOutputs) {
      lines.push(`[MCP Image saved to: ${out.localPath}](${out.apiUrl})`);
    }

    return {
      stdout: lines.join('\n'),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'gemini_image' || action === 'gemini_video') {
    const providerCfg = readBrainProviderConfig();
    const apiKey = providerCfg.googleApiKey;
    if (!apiKey) {
      return {
        stdout: '',
        stderr:
          'Google AI Studio API key is not configured. Open Settings -> Brain Inference Provider and save your Gemini API key (or set GEMINI_API_KEY) to use gemini_image / gemini_video.',
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }

    const inputBlocks: any[] = [];
    if (args.input_image) {
      const resolvedImg = exec.resolveSafePath(ctx.workspaceRoot, String(args.input_image));
      if (!fs.existsSync(resolvedImg)) {
        return {
          stdout: '',
          stderr: `Reference input image not found: ${resolvedImg}`,
          exitCode: 1,
          durationMs: Math.round(performance.now() - startMs),
        };
      }
      const ext = path.extname(resolvedImg).toLowerCase();
      const mimeType =
        ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
          ? 'image/webp'
          : 'image/png';
      inputBlocks.push({
        type: 'image',
        data: fs.readFileSync(resolvedImg).toString('base64'),
        mime_type: mimeType,
      });
    }
    inputBlocks.push({
      type: 'text',
      text: String(args.prompt || 'Generate asset'),
    });

    const isVideo = action === 'gemini_video';
    const candidates = args.google_model
      ? [String(args.google_model)]
      : isVideo
      ? ['gemini-omni-1.2-flash', 'gemini-omni-1.1-flash']
      : ['gemini-nano-banana-2.1'];
    const reqTimeoutMs = isVideo ? 600000 : 180000;

    let lastStatus = 0;
    let lastErr = '';
    for (const model of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), reqTimeoutMs);
      const onAbort = () => controller.abort();
      ctx.abortSignal?.addEventListener('abort', onAbort, { once: true });

      try {
        ctx.onStdoutChunk?.(`[Gemini API] Calling ${model} for ${isVideo ? 'video' : 'image'} generation...\n`);
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
            'Api-Revision': '2026-05-20',
          },
          body: JSON.stringify({
            model,
            input: inputBlocks,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          lastStatus = res.status;
          lastErr = await res.text().catch(() => res.statusText);
          if (res.status === 404 || (res.status === 400 && /model|not found/i.test(lastErr))) {
            continue;
          }
          return {
            stdout: '',
            stderr: `Gemini ${model} failed (${res.status}): ${lastErr.slice(0, 800)}`,
            exitCode: 1,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        const data: any = await res.json();
        const mediaType = isVideo ? 'video' : 'image';
        let mediaData: string | undefined = isVideo
          ? data?.output_video?.data
          : data?.output_image?.data;
        let mediaMime: string | undefined = isVideo
          ? data?.output_video?.mime_type
          : data?.output_image?.mime_type;

        if (!mediaData) {
          const allSteps = Array.isArray(data?.steps) ? data.steps : [];
          for (const st of allSteps) {
            if (st?.type && st.type !== 'model_output') continue;
            const items = Array.isArray(st?.content) ? st.content : [];
            for (const item of items) {
              if (item?.type === mediaType && typeof item.data === 'string' && item.data.length > 0) {
                mediaData = item.data;
                mediaMime = item.mime_type;
              }
            }
          }
        }
        if (!mediaData && Array.isArray(data?.outputs)) {
          for (const out of data.outputs) {
            if (out?.type === mediaType && typeof out.data === 'string' && out.data.length > 0) {
              mediaData = out.data;
              mediaMime = out.mime_type;
            }
          }
        }

        if (!mediaData) {
          return {
            stdout: '',
            stderr: `Gemini ${model} returned no ${mediaType} output data: ${JSON.stringify(data).slice(0, 800)}`,
            exitCode: 1,
            durationMs: Math.round(performance.now() - startMs),
          };
        }

        const outDir = path.join(REPO_ROOT, '.runtime', 'mcp-outputs');
        fs.mkdirSync(outDir, { recursive: true });
        const ext = isVideo
          ? mediaMime?.includes('webm')
            ? 'webm'
            : 'mp4'
          : mediaMime?.includes('jpeg')
          ? 'jpg'
          : mediaMime?.includes('webp')
          ? 'webp'
          : 'png';
        const prefix = isVideo ? 'gemini-video' : 'gemini-image';
        const copyName = `${prefix}-${Date.now()}.${ext}`;
        const localPath = path.join(outDir, copyName);
        fs.writeFileSync(localPath, Buffer.from(mediaData, 'base64'));
        const apiUrl = `/api/mcp-outputs/${copyName}`;

        const outputSummary = JSON.stringify(
          {
            status: 'completed',
            provider: 'google_ai_studio',
            model,
            mediaType,
            mimeType: mediaMime || (isVideo ? 'video/mp4' : 'image/png'),
            localPath,
            apiUrl,
          },
          null,
          2
        );
        const linkLine = isVideo
          ? `[MCP Video saved to: ${localPath}](${apiUrl})`
          : `[MCP Image saved to: ${localPath}](${apiUrl})`;

        return {
          stdout: `${outputSummary}\n${linkLine}`,
          stderr: '',
          exitCode: 0,
          durationMs: Math.round(performance.now() - startMs),
        };
      } catch (err: any) {
        if (ctx.abortSignal?.aborted) {
          return {
            stdout: '',
            stderr: `Gemini ${mediaLabel(isVideo)} generation aborted by user.`,
            exitCode: 130,
            durationMs: Math.round(performance.now() - startMs),
          };
        }
        lastErr = err?.message || String(err);
      } finally {
        clearTimeout(timer);
        ctx.abortSignal?.removeEventListener('abort', onAbort);
      }
    }

    return {
      stdout: '',
      stderr: `Gemini ${isVideo ? 'video' : 'image'} generation failed (${lastStatus || 'error'}): ${lastErr.slice(0, 800)}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  return {
    stdout: '',
    stderr: `Unsupported comfyui action "${action}". Valid actions: generate, list_workflows, inspect_workflow, status, start_server, free_vram, gemini_image, gemini_video.`,
    exitCode: 1,
    durationMs: Math.round(performance.now() - startMs),
  };
};

function mediaLabel(isVideo: boolean): string {
  return isVideo ? 'video' : 'image';
}
