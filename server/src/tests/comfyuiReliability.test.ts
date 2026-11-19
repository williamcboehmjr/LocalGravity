import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { getPathsConfig, resetPathsConfigCache } from '../core/pathsConfig.js';
import { collectOutputItems } from '../tools/handlers/comfyui/comfyClient.js';
import { healComboValue, resolveWorkflowFile, WORKFLOW_ALIASES } from '../tools/handlers/comfyui/workflowConverter.js';
import { ComfyCompanionManager } from '../tools/handlers/comfyui/comfyCompanion.js';
import {
  classifyOllamaModel,
  convertMessagesToOllamaFormat,
  discoverOllamaModelsFromDisk,
  parseFallbackToolCallsFromText,
  pickBestInstalledOllamaVisionModel,
  streamOllamaChat,
  unloadOllamaModel,
} from '../tools/handlers/comfyui/ollamaClient.js';
import { selectScopedTools } from '../tools/toolScoper.js';
import { BUILTIN_TOOLS_SCHEMA } from '../tools/builtinToolsSchema.js';

async function runComfyuiReliabilityTests() {
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
    // 4b. Ollama Vision config persistence & brain flags
    mgr.updateConfig({
      studioMode: true,
      companionBrain: 'ollama_vision',
      ollamaModel: 'qwen3.5:4b',
      ollamaKeepAlive: '2m',
      keepVramWarm: true,
    });
    const reloadedOllama = mgr.reloadConfigFromDisk();
    assert.equal(reloadedOllama.companionBrain, 'ollama_vision');
    assert.equal(reloadedOllama.ollamaModel, 'qwen3.5:4b');
    assert.equal(reloadedOllama.ollamaKeepAlive, '2m');
    assert.equal(mgr.isZeroVramBrain(reloadedOllama), false);
    assert.equal(mgr.isFastLocalSwapBrain(reloadedOllama), true);

    // Zero-reload fast summary check when keepVramWarm=true
    let streamedSummary = '';
    const mockGoogleEngine: any = { getApiKey: () => '' };
    const summaryRes = await mgr.streamStudioTurn(
      {
        tier: 'low',
        thinkingBudget: 'off',
        messages: [
          { role: 'user', content: 'draw a glowing cyberpunk fox' },
          {
            role: 'tool',
            name: 'comfyui',
            content:
              '{"status":"completed","workflow":"z-image.json","seed":42,"promptEnhanced":true,"promptEnhancedBy":"ollama:qwen3.5:4b","effectivePrompt":"a luminous cyberpunk fox","outputs":[{"filename":"fox.png"}]}\n[MCP Image saved to: E:/out/fox.png](/api/mcp-outputs/fox.png)',
          },
        ],
        onTokenDelta: (d) => {
          streamedSummary += d;
        },
        onThoughtDelta: () => {},
      },
      mockGoogleEngine,
      async () => {
        throw new Error('Should not invoke Strata fallback for fast completed summary');
      }
    );
    assert.ok(summaryRes.content.includes('/api/mcp-outputs/fox.png'));
    assert.ok(streamedSummary.includes('z-image.json'));
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

  // 6. Ollama Classifier & Disk Manifest Discovery
  assert.deepEqual(
    {
      isVision: classifyOllamaModel('qwen3.5:4b').isVision,
      supportsTools: classifyOllamaModel('qwen3.5:4b').supportsTools,
      recommended: classifyOllamaModel('qwen3.5:4b').recommended,
    },
    { isVision: true, supportsTools: true, recommended: true }
  );
  assert.equal(classifyOllamaModel('qwen3-vl:8b').isVision, true);
  assert.equal(classifyOllamaModel('ministral-3:3b').supportsTools, true);
  assert.equal(classifyOllamaModel('qwen2.5:14b').isVision, false);
  assert.equal(classifyOllamaModel('qwen2.5:14b').supportsTools, true);

  const tmpOllama = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-ollama-models-'));
  try {
    const libDir = path.join(tmpOllama, 'manifests', 'registry.ollama.ai', 'library');
    fs.mkdirSync(path.join(libDir, 'qwen2.5'), { recursive: true });
    fs.mkdirSync(path.join(libDir, 'qwen3-vl'), { recursive: true });
    fs.mkdirSync(path.join(libDir, 'qwen3.5'), { recursive: true });
    fs.writeFileSync(path.join(libDir, 'qwen2.5', '14b'), JSON.stringify({ layers: [{ size: 8 * 1024 ** 3 }] }));
    fs.writeFileSync(path.join(libDir, 'qwen3-vl', '8b'), JSON.stringify({ layers: [{ size: 5.8 * 1024 ** 3 }] }));
    fs.writeFileSync(path.join(libDir, 'qwen3.5', '4b'), JSON.stringify({ layers: [{ size: 3.16 * 1024 ** 3 }] }));

    const discovered = discoverOllamaModelsFromDisk(tmpOllama);
    assert.equal(discovered.length, 3);
    assert.equal(discovered[0].name, 'qwen3.5:4b', 'Fastest vision+tools qwen3.5:4b should sort first');
    assert.equal(pickBestInstalledOllamaVisionModel(discovered), 'qwen3.5:4b');
  } finally {
    try {
      fs.rmSync(tmpOllama, { recursive: true, force: true });
    } catch {}
  }

  // 7. convertMessagesToOllamaFormat
  const convertedMsgs = convertMessagesToOllamaFormat([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Inspect this wireframe' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA1111' } },
      ],
    },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'comfyui', arguments: '{"action":"generate","prompt":"owl"}' } }],
    },
  ]);
  assert.equal(convertedMsgs[0].content, 'Inspect this wireframe');
  assert.deepEqual(convertedMsgs[0].images, ['AAAA1111']);
  assert.deepEqual(convertedMsgs[1].tool_calls?.[0].function.arguments, { action: 'generate', prompt: 'owl' });

  // 8. parseFallbackToolCallsFromText
  const xmlParsed = parseFallbackToolCallsFromText(
    '<tool_call>{"name":"comfyui","arguments":{"action":"generate","prompt":"neon owl"}}</tool_call>'
  );
  assert.equal(xmlParsed.length, 1);
  assert.equal(xmlParsed[0].name, 'comfyui');
  assert.equal(xmlParsed[0].arguments.prompt, 'neon owl');

  const fencedParsed = parseFallbackToolCallsFromText(
    '```json\n{"name":"comfyui","arguments":{"workflow":"z-image.json","prompt":"sunset"}}\n```'
  );
  assert.equal(fencedParsed[0].arguments.workflow, 'z-image.json');

  // 9. Mock HTTP Ollama streaming tool calls + keep_alive:0 unload
  let loadedModels = [{ name: 'qwen3.5:4b', size_vram: 3_400_000_000 }];
  let sawKeepAliveZero = false;
  const mockServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk.toString()));
    req.on('end', () => {
      if (req.url === '/api/ps') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: loadedModels }));
        return;
      }
      if (req.url === '/api/generate') {
        const body = JSON.parse(raw || '{}');
        if (body.keep_alive === 0) {
          sawKeepAliveZero = true;
          loadedModels = [];
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ done: true }));
        return;
      }
      if (req.url === '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write(JSON.stringify({ message: { content: 'Starting ' }, done: false }) + '\n');
        res.write(
          JSON.stringify({
            message: {
              tool_calls: [
                { function: { name: 'comfyui', arguments: { action: 'generate', prompt: 'cyberpunk cat' } } },
              ],
            },
            done: false,
          }) + '\n'
        );
        res.end(JSON.stringify({ done: true, eval_count: 18, eval_duration: 200_000_000 }) + '\n');
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
  try {
    const addr = mockServer.address() as { port: number };
    const mockUrl = `http://127.0.0.1:${addr.port}`;
    let tokens = '';
    const calledTools: Array<{ name: string; args: any }> = [];

    const streamRes = await streamOllamaChat({
      model: 'qwen3.5:4b',
      ollamaUrl: mockUrl,
      completion: {
        tier: 'low',
        thinkingBudget: 'off',
        messages: [{ role: 'user', content: 'draw a cyberpunk cat' }],
        tools: [BUILTIN_TOOLS_SCHEMA.find((t) => t.function.name === 'comfyui')!],
        onThoughtDelta: () => {},
        onTokenDelta: (d) => {
          tokens += d;
        },
        onToolCallRequest: async (name, args) => {
          calledTools.push({ name, args });
        },
      },
    });
    assert.equal(tokens, 'Starting ');
    assert.equal(streamRes.outputTokens, 18);
    assert.equal(calledTools.length, 1);
    assert.equal(calledTools[0].name, 'comfyui');
    assert.equal(calledTools[0].args.prompt, 'cyberpunk cat');

    const unloadRes = await unloadOllamaModel('qwen3.5:4b', mockUrl);
    assert.equal(sawKeepAliveZero, true, 'unloadOllamaModel must send keep_alive: 0');
    assert.ok(unloadRes.unloaded.includes('qwen3.5:4b'));
  } finally {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }

  console.log('✅ All ComfyUI Reliability & Companion Unit Tests PASSED');
}

void runComfyuiReliabilityTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
