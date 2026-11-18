import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPathsConfig, resetPathsConfigCache } from '../core/pathsConfig.js';
import { collectOutputItems } from '../tools/handlers/comfyui/comfyClient.js';
import { healComboValue, resolveWorkflowFile, WORKFLOW_ALIASES } from '../tools/handlers/comfyui/workflowConverter.js';
import { ComfyCompanionManager } from '../tools/handlers/comfyui/comfyCompanion.js';
import { selectScopedTools } from '../tools/toolScoper.js';
import { BUILTIN_TOOLS_SCHEMA } from '../tools/builtinToolsSchema.js';

function runComfyuiReliabilityTests() {
  console.log('🧪 Running ComfyUI Reliability & Companion Unit Tests...');

  // 1. 3-Tier COMBO Auto-Healer
  // Tier 1: exact basename/case match
  const t1 = healComboValue('vae_name', 'Flux/FLUX2-VAE.safetensors', ['flux2-vae.safetensors', 'ae.sft']);
  assert.equal(t1, 'flux2-vae.safetensors');

  // Tier 2: aspect ratio match ('1:1 (Square)' -> '1:1 (1024x1024)')
  const t2 = healComboValue('aspect_ratio', '1:1 (Square)', [
    '16:9 (1344x768)',
    '1:1 (1024x1024)',
    '9:16 (768x1344)',
  ]);
  assert.equal(t2, '1:1 (1024x1024)', 'Should heal mismatched aspect ratio labels via ratio token');

  // Tier 3: model precision stem match + quantized preference for 16 GB VRAM
  const t3 = healComboValue('clip_name', 'qwen3vl_8b_int8_convrot.safetensors', [
    'qwen3.5_9b_bf16.safetensors',
    'qwen3vl_8b_bf16.safetensors',
    'qwen3vl_8b_fp8_scaled.safetensors',
  ]);
  assert.equal(t3, 'qwen3vl_8b_fp8_scaled.safetensors', 'Should heal missing int8_convrot CLIP to fp8_scaled before bf16');

  // 2. Output collection across images, gifs, videos, audio (with dedup)
  const items = collectOutputItems({
    '12': {
      images: [{ filename: 'img_001.png', subfolder: '', type: 'output' }],
    },
    '92': {
      gifs: [{ filename: 'minimax_001.mp4', subfolder: 'vid', type: 'output' }],
      videos: [{ filename: 'minimax_001.mp4', subfolder: 'vid', type: 'output' }],
    },
    '99': {
      audio: [{ filename: 'track.wav', subfolder: '', type: 'output' }],
    },
  });
  assert.equal(items.length, 3, 'Should deduplicate identical output entries across gifs/videos');
  assert.equal(items[0].mediaKind, 'image');
  assert.equal(items[1].mediaKind, 'video');
  assert.equal(items[2].mediaKind, 'audio');

  // 3. Workflow aliases & pathsConfig overrides
  assert.equal(WORKFLOW_ALIASES['moss'], 'Moss Image.json');
  assert.equal(WORKFLOW_ALIASES['z-image'], 'z-image.json');
  assert.equal(WORKFLOW_ALIASES['krea'], 'Famegrid Krea 2 Spice V2 - Simplified.json');
  assert.equal(WORKFLOW_ALIASES['h3'], 'H3 Image Easy Workflow.json');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-comfy-rel-'));
  const tmpWfDir = path.join(tmpRoot, 'workflows');
  fs.mkdirSync(tmpWfDir, { recursive: true });
  fs.writeFileSync(path.join(tmpWfDir, 'Moss Image.json'), '{}', 'utf-8');
  fs.writeFileSync(path.join(tmpWfDir, 'z-image.json'), '{}', 'utf-8');

  const prevWfEnv = process.env.LOCALGRAVITY_COMFY_WORKFLOWS_DIR;
  process.env.LOCALGRAVITY_COMFY_WORKFLOWS_DIR = tmpWfDir;
  resetPathsConfigCache();
  try {
    assert.equal(path.basename(resolveWorkflowFile('moss')!), 'Moss Image.json');
    assert.equal(path.basename(resolveWorkflowFile('z-image')!), 'z-image.json');
    const paths = getPathsConfig(tmpRoot);
    assert.equal(paths.comfyWorkflowsDir, tmpWfDir);
    assert.ok(paths.companionPort !== 5000 && paths.companionPort !== 5001);
  } finally {
    if (prevWfEnv === undefined) delete process.env.LOCALGRAVITY_COMFY_WORKFLOWS_DIR;
    else process.env.LOCALGRAVITY_COMFY_WORKFLOWS_DIR = prevWfEnv;
    resetPathsConfigCache();
  }

  // 4. ComfyCompanionManager config persistence in isolated path
  const studioCfgPath = path.join(tmpRoot, 'comfyui-studio.json');
  ComfyCompanionManager.setConfigPathForTest(studioCfgPath);
  try {
    const mgr = ComfyCompanionManager.getInstance();
    mgr.updateConfig({
      studioMode: true,
      defaultWorkflow: 'z-image.json',
      companionBrain: 'cpu_lightweight',
      keepVramWarm: true,
    });
    const reloaded = mgr.reloadConfigFromDisk();
    assert.equal(reloaded.studioMode, true);
    assert.equal(reloaded.defaultWorkflow, 'z-image.json');
    assert.equal(reloaded.companionBrain, 'cpu_lightweight');
    assert.equal(reloaded.keepVramWarm, true);
    assert.equal(mgr.isZeroVramBrain(reloaded), true);
  } finally {
    ComfyCompanionManager.setConfigPathForTest(null);
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }

  // 5. toolScoper deduplication & ComfyUI Studio 1-tool mode
  const fakeComfyMcpTools = [
    { type: 'function', function: { name: 'mcp_comfy_run_workflow', description: 'dup' } },
    { type: 'function', function: { name: 'mcp_comfy_generate_image', description: 'dup' } },
    { type: 'function', function: { name: 'mcp_comfy_system_stats', description: 'keep' } },
    { type: 'function', function: { name: 'mcp_fetch_fetch', description: 'keep' } },
  ];

  const studioTools = selectScopedTools({
    prompt: 'draw a cyberpunk samurai',
    forceComfyStudio: true,
    builtinTools: BUILTIN_TOOLS_SCHEMA,
    skillTools: [],
    mcpTools: fakeComfyMcpTools,
  });
  assert.equal(studioTools.length, 1);
  assert.equal(studioTools[0].function.name, 'comfyui');

  const normalComfyTools = selectScopedTools({
    prompt: 'generate an image with moss',
    builtinTools: BUILTIN_TOOLS_SCHEMA,
    skillTools: [],
    mcpTools: fakeComfyMcpTools,
  });
  const normalNames = new Set(normalComfyTools.map((t) => t.function.name));
  assert.ok(normalNames.has('comfyui'), 'Native comfyui must be present');
  assert.ok(!normalNames.has('mcp_comfy_run_workflow'), 'Duplicate mcp_comfy_run_workflow must be filtered');
  assert.ok(!normalNames.has('mcp_comfy_generate_image'), 'Duplicate mcp_comfy_generate_image must be filtered');
  assert.ok(normalNames.has('mcp_comfy_system_stats'), 'Non-duplicate comfy system stats MCP stays intact');

  console.log('✅ All ComfyUI Reliability & Companion Unit Tests PASSED');
}

runComfyuiReliabilityTests();
