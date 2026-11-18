import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getPathsConfig } from '../../../core/pathsConfig.js';
import { getCachedObjectInfoFile } from './comfyClient.js';

export const WORKFLOW_ALIASES: Record<string, string> = {
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
  'z-image': 'z-image.json',
  zimage: 'z-image.json',
  turbo: 'z-image.json',
  'z-image-turbo': 'Z-Image-Turbo-Boosted.json',
  'h3 video': 'MiniMax H3.json',
};

export function resolveWorkflowFile(requested?: string): string | null {
  const { comfyWorkflowsDir } = getPathsConfig();
  if (!fs.existsSync(comfyWorkflowsDir)) return null;
  const raw = (requested || 'Moss Image.json').trim();
  const aliasTarget = WORKFLOW_ALIASES[raw.toLowerCase()];
  const candidateName = aliasTarget || raw;

  if (path.isAbsolute(candidateName) && fs.existsSync(candidateName)) {
    return candidateName;
  }

  const directPath = path.join(comfyWorkflowsDir, candidateName);
  if (fs.existsSync(directPath)) return directPath;
  if (!candidateName.toLowerCase().endsWith('.json')) {
    const withJson = path.join(comfyWorkflowsDir, `${candidateName}.json`);
    if (fs.existsSync(withJson)) return withJson;
  }

  const files = fs
    .readdirSync(comfyWorkflowsDir)
    .filter((f) => f.toLowerCase().endsWith('.json') && !f.startsWith('.'));
  const lower = candidateName.toLowerCase().replace(/\.json$/i, '');
  const exactInsensitive = files.find((f) => f.toLowerCase().replace(/\.json$/i, '') === lower);
  if (exactInsensitive) return path.join(comfyWorkflowsDir, exactInsensitive);

  const partial = files.find((f) => f.toLowerCase().includes(lower));
  return partial ? path.join(comfyWorkflowsDir, partial) : null;
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

export function extractWorkflowInspection(wfPath: string) {
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
    if (active && (t === 'ResolutionSelector' || t === 'FluxResolutionNode' || (t.includes('Empty') && t.includes('Latent')))) {
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

/**
 * Pure TypeScript mirror of PYTHON_CONVERTER_SCRIPT's 3-tier COMBO auto-healer:
 * 1. Exact case-insensitive / basename match
 * 2. Aspect ratio W:H match (e.g. '1:1 (Square)' -> '1:1 (1024x1024)')
 * 3. Model precision-stem match (e.g. 'qwen3vl_8b_int8_convrot.safetensors' -> 'qwen3vl_8b_fp8_scaled.safetensors')
 */
export function healComboValue(_inputKey: string, val: any, choices: any[]): any | null {
  if (!Array.isArray(choices) || choices.length === 0) return null;
  if (choices.includes(val)) return val;

  const valStr = String(val ?? '');
  const base = valStr.replace(/\//g, '\\').split('\\').pop()!.toLowerCase();

  // Tier 1: exact case-insensitive match or basename match
  for (const c of choices) {
    const cStr = String(c);
    if (cStr.toLowerCase() === valStr.toLowerCase()) return c;
    if (cStr.replace(/\//g, '\\').split('\\').pop()!.toLowerCase() === base) return c;
  }

  // Tier 2: aspect ratio match (e.g. "1:1 (Square)" -> "1:1 (1024x1024)" or "1:1")
  const ratioMatch = valStr.match(/\b(\d+\s*:\s*\d+)\b/);
  if (ratioMatch) {
    const ratio = ratioMatch[1].replace(/\s+/g, '');
    const ratioStart = choices.find((c) => new RegExp(`^${ratio}(?:\\b|\\s|\\(|$)`, 'i').test(String(c)));
    if (ratioStart !== undefined) return ratioStart;
    const ratioContains = choices.find((c) => String(c).replace(/\s+/g, '').includes(ratio));
    if (ratioContains !== undefined) return ratioContains;
  }

  // Tier 3: precision/quant stem match
  const stripStem = (s: string) =>
    s
      .replace(/\//g, '\\')
      .split('\\')
      .pop()!
      .toLowerCase()
      .replace(/\.(safetensors|gguf|sft|pth|pt|ckpt)$/i, '')
      .replace(/(?:_|-)?(?:int8_convrot|convrot_int8|int8|fp8_scaled|fp8_e4m3fn|fp8|bf16|fp16|fp32|nvfp4_awq|nvfp4|awq|q4_k_m|q8_0|q4_0|pruned)/g, '')
      .replace(/[_-]+/g, '_')
      .replace(/^_|_$/g, '');

  const vStem = stripStem(valStr);
  if (vStem.length >= 4) {
    const scored: Array<{ score: number; choice: any }> = [];
    for (const c of choices) {
      const cStr = String(c);
      const cStem = stripStem(cStr);
      if (cStem === vStem || (cStem.length >= 4 && (cStem.includes(vStem) || vStem.includes(cStem)))) {
        const cl = cStr.toLowerCase();
        // Prefer memory-friendly quantized weights on 16 GB VRAM before BF16/FP32
        const quantScore =
          cl.includes('fp8') || cl.includes('int8') || cl.includes('nvfp4') || cl.includes('q4')
            ? 3
            : cl.includes('fp16') || cl.includes('bf16')
              ? 1
              : 2;
        const exactStemBonus = cStem === vStem ? 10 : 0;
        scored.push({ score: exactStemBonus + quantScore, choice: c });
      }
    }
    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score);
      return scored[0].choice;
    }
  }

  return null;
}

const PYTHON_CONVERTER_SCRIPT = `
import json, sys, urllib.request, random, re, os

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
comfy_url = payload.get('comfy_url') or 'http://127.0.0.1:8188'
obj_info_path = payload.get('obj_info_path')

from comfy_cli.workflow_to_api import convert_ui_to_api, is_api_format

wf = json.load(open(wf_path, 'r', encoding='utf-8-sig'))
if obj_info_path and os.path.exists(obj_info_path):
    obj_info = json.load(open(obj_info_path, 'r', encoding='utf-8'))
else:
    obj_info = json.loads(urllib.request.urlopen(comfy_url + '/object_info', timeout=30).read().decode('utf-8'))

api_wf = wf if is_api_format(wf) else convert_ui_to_api(wf, obj_info)

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
            if isinstance(val, (int, float)):
                inps[sk] = effective_seed

has_save = any(n.get('class_type') in ('SaveImage', 'SaveVideo', 'VHS_VideoCombine') for n in api_wf.values())
if not has_save:
    for nid, node in api_wf.items():
        if node.get('class_type') == 'PreviewImage':
            node['class_type'] = 'SaveImage'
            node['inputs']['filename_prefix'] = 'LocalGravity_Comfy'

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

def strip_stem(s):
    base = str(s).replace('/', '\\\\').split('\\\\')[-1].lower()
    base = re.sub(r'\\.(safetensors|gguf|sft|pth|pt|ckpt)$', '', base, flags=re.I)
    base = re.sub(r'(?:_|-)?(?:int8_convrot|convrot_int8|int8|fp8_scaled|fp8_e4m3fn|fp8|bf16|fp16|fp32|nvfp4_awq|nvfp4|awq|q4_k_m|q8_0|q4_0|pruned)', '', base)
    base = re.sub(r'[_-]+', '_', base).strip('_')
    return base

def heal_combo(val, choices):
    if not choices or val in choices:
        return None
    val_str = str(val)
    base = val_str.replace('/', '\\\\').split('\\\\')[-1].lower()
    for c in choices:
        cs = str(c)
        if cs.lower() == val_str.lower() or cs.replace('/', '\\\\').split('\\\\')[-1].lower() == base:
            return c
    rm = re.search(r'\\b(\\d+\\s*:\\s*\\d+)\\b', val_str)
    if rm:
        ratio = re.sub(r'\\s+', '', rm.group(1))
        for c in choices:
            if re.match(r'^' + re.escape(ratio) + r'(?:\\b|\\s|\\(|$)', str(c), flags=re.I):
                return c
        for c in choices:
            if ratio in re.sub(r'\\s+', '', str(c)):
                return c
    vs = strip_stem(val_str)
    if len(vs) >= 4:
        cands = []
        for c in choices:
            cs_raw = str(c)
            cs = strip_stem(cs_raw)
            if cs == vs or (len(cs) >= 4 and (cs in vs or vs in cs)):
                cl = cs_raw.lower()
                qscore = 3 if ('fp8' in cl or 'int8' in cl or 'nvfp4' in cl or 'q4' in cl) else (1 if ('fp16' in cl or 'bf16' in cl) else 2)
                cands.append(((10 if cs == vs else 0) + qscore, c))
        if cands:
            cands.sort(key=lambda x: x[0], reverse=True)
            return cands[0][1]
    return None

healed = []
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
                match = heal_combo(val, choices)
                if match is not None:
                    node['inputs'][k] = match
                    healed.append({'node': nid, 'input': k, 'from': val, 'to': match})

print(json.dumps({'api_prompt': pruned, 'effective_seed': effective_seed, 'node_count': len(pruned), 'healed_inputs': healed}))
`;

export async function sanitizeWorkflowViaPython(params: {
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
}): Promise<{
  api_prompt: Record<string, any>;
  effective_seed: number;
  node_count: number;
  healed_inputs?: Array<{ node: string; input: string; from: any; to: any }>;
}> {
  const { comfyRoot, comfyPythonExe, comfyUrl } = getPathsConfig();
  const objInfoPath = await getCachedObjectInfoFile(false);

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
      comfy_url: comfyUrl,
      obj_info_path: objInfoPath,
    }),
    'utf-8'
  );

  try {
    const out = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
      const child = spawn(comfyPythonExe, [tmpPy, tmpPayload], {
        cwd: comfyRoot,
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
