import fs from 'node:fs';
import path from 'node:path';
import type { BuiltinToolHandler } from './types.js';
import { LlamaMoESidecar } from '../../tabby/llamaSidecar.js';
import { getPathsConfig } from '../../core/pathsConfig.js';
import {
  isComfyHealthy,
  ensureComfyServerRunning,
  freeComfyVram,
  interruptComfyJob,
  getComfyQueue,
  waitForComfyJob,
  downloadComfyOutputs,
  invalidateObjectInfoCache,
} from './comfyui/comfyClient.js';
import {
  resolveWorkflowFile,
  extractWorkflowInspection,
  sanitizeWorkflowViaPython,
} from './comfyui/workflowConverter.js';
import {
  readBrainProviderConfig,
  executeGeminiMediaAction,
} from './comfyui/geminiMedia.js';
import { ComfyCompanionManager } from './comfyui/comfyCompanion.js';
import { unloadAllOllamaModels } from './comfyui/ollamaClient.js';

export const name = 'comfyui';

export function shouldSkipDuplicateOllamaEnhancement(
  rawPrompt: string,
  enhancerSystemPrompt?: string
): boolean {
  const trimmed = (rawPrompt || '').trim();
  if (trimmed.length < 120) return false;
  if (trimmed.split(/\s+/).length < 18) return false;
  if (/\bjson\b/i.test(enhancerSystemPrompt || '')) return false;
  return true;
}

export const execute: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const action = String(args.action || 'generate').toLowerCase();
  const { comfyUrl, comfyWorkflowsDir } = getPathsConfig();

  if (action === 'list_workflows') {
    if (!fs.existsSync(comfyWorkflowsDir)) {
      return {
        stdout: '',
        stderr: `Workflows directory not found: ${comfyWorkflowsDir}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const items = fs
      .readdirSync(comfyWorkflowsDir)
      .filter((f) => f.toLowerCase().endsWith('.json') && !f.startsWith('.'))
      .map((f) => {
        const st = fs.statSync(path.join(comfyWorkflowsDir, f));
        return { name: f, sizeBytes: st.size, updatedAt: st.mtime.toISOString(), mtimeMs: st.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const priorityNames = new Set([
      'Moss Image.json',
      'H3 Image Easy Workflow.json',
      'Famegrid Krea 2 Spice V2 - Simplified.json',
      'z-image.json',
      'Z-Image-Turbo-Boosted.json',
      'Qwen 2.1 Image Edit.json',
      'MiniMax H3.json',
    ]);
    const featured = items.filter((i) => priorityNames.has(i.name));
    const recent = items.slice(0, 40);

    return {
      stdout: JSON.stringify(
        {
          workflowsDir: comfyWorkflowsDir,
          totalCount: items.length,
          featuredWorkflows: featured,
          recentWorkflows: recent,
        },
        null,
        2
      ),
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
        stderr: `Workflow "${args.workflow || 'Moss Image.json'}" not found in ${comfyWorkflowsDir}`,
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
    const comfyUp = await isComfyHealthy(comfyUrl);
    let stats: any = null;
    let queue: any = null;
    if (comfyUp) {
      try {
        const r = await fetch(`${comfyUrl}/system_stats`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) stats = await r.json();
      } catch {}
      queue = await getComfyQueue(comfyUrl);
    }
    const sidecar = LlamaMoESidecar.getInstance();
    return {
      stdout: JSON.stringify(
        {
          comfyui: { url: comfyUrl, running: comfyUp, systemStats: stats, queue },
          strata: { state: await sidecar.getState(), profile: sidecar.getActiveProfile() },
          companion: ComfyCompanionManager.getInstance().getCapabilities(),
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
      stdout: JSON.stringify({ ...res, url: comfyUrl }, null, 2),
      stderr: res.running ? '' : res.error || 'Failed to start ComfyUI',
      exitCode: res.running ? 0 : 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'free_vram') {
    const ok = await freeComfyVram();
    return {
      stdout: JSON.stringify({ freed: ok, url: comfyUrl }, null, 2),
      stderr: ok ? '' : 'ComfyUI /free call failed or server is offline',
      exitCode: ok ? 0 : 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'gemini_image' || action === 'gemini_video') {
    return await executeGeminiMediaAction(action, args, ctx, exec, startMs);
  }

  if (action === 'generate' || action === 'run_workflow') {
    const companion = ComfyCompanionManager.getInstance();
    const studioCfg = companion.getConfig();
    const requestedWf = typeof args.workflow === 'string' && args.workflow.trim()
      ? args.workflow.trim()
      : studioCfg.studioMode && studioCfg.defaultWorkflow
        ? studioCfg.defaultWorkflow
        : 'Moss Image.json';

    // Allow selecting gemini_image as the default studio workflow seamlessly
    if (requestedWf === 'gemini_image' || requestedWf === 'gemini_video') {
      return await executeGeminiMediaAction(requestedWf, args, ctx, exec, startMs);
    }

    const wfPath = resolveWorkflowFile(requestedWf);
    if (!wfPath) {
      return {
        stdout: '',
        stderr: `Workflow "${requestedWf}" not found in ${comfyWorkflowsDir}`,
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
    const prevProfile = sidecar.getActiveProfile();
    const wasStrataActive = await sidecar.isHealthy();
    const effectiveBrain = companion.resolveEffectiveBrain(studioCfg);
    const zeroVramCompanion = studioCfg.studioMode && companion.isZeroVramBrain(studioCfg);
    const isOllamaVision = studioCfg.studioMode && effectiveBrain === 'ollama_vision';

    let finalPrompt = rawPrompt;
    let promptEnhanced = false;
    let enhancedBy: string | null = null;
    const shouldEnhance = args.enhance_prompt !== false && (studioCfg.studioMode ? studioCfg.enhancePrompt : true);

    if (
      shouldEnhance &&
      inspection.enhancerSystemPrompt &&
      !rawPrompt.trimStart().startsWith('{')
    ) {
      if (
        isOllamaVision &&
        shouldSkipDuplicateOllamaEnhancement(rawPrompt, inspection.enhancerSystemPrompt)
      ) {
        ctx.onStdoutChunk?.(
          `[ComfyUI] Using Ollama Vision's already-expanded prompt directly (single-pass fast turn).\n`
        );
      } else {
        const enhanceLabel = studioCfg.studioMode
          ? effectiveBrain === 'ollama_vision'
            ? `ollama:${companion.resolveOllamaModel(studioCfg)}`
            : effectiveBrain
          : isGoogleMode
            ? 'gemini'
            : 'strata';
        ctx.onStdoutChunk?.(`[ComfyUI] Enhancing prompt (${enhanceLabel})...\n`);
        const res = await companion.enhancePrompt(inspection.enhancerSystemPrompt, rawPrompt, ctx.abortSignal);
        if (res.enhanced !== rawPrompt) {
          finalPrompt = res.enhanced;
          promptEnhanced = true;
          enhancedBy = res.enhancedBy;
        }
      }
    }

    if (wasStrataActive) {
      ctx.onStdoutChunk?.('[ComfyUI] Offloading Strata from GPU to free 16 GB VRAM for ComfyUI...\n');
      await sidecar.offloadFromGpu('comfyui_generate');
    }

    const ollamaUnload = await unloadAllOllamaModels();
    if (ollamaUnload.unloaded.length > 0) {
      ctx.onStdoutChunk?.(
        `[ComfyUI] Unloaded Ollama (${ollamaUnload.unloaded.join(', ')}) from GPU in ${ollamaUnload.durationMs}ms...\n`
      );
    }

    let savedOutputs: Array<{
      filename: string;
      localPath: string;
      apiUrl: string;
      subfolder: string;
      type: string;
      mediaKind: 'image' | 'video' | 'audio';
    }> = [];
    let promptId = '';
    let effectiveSeed = 0;
    let sanitizedNodeCount = 0;
    let healedInputsCount = 0;
    let strataReloaded = false;
    let generationError: string | null = null;

    try {
      const serverCheck = await ensureComfyServerRunning(ctx.abortSignal);
      if (!serverCheck.running) {
        throw new Error(serverCheck.error || `Failed to ensure ComfyUI is running at ${comfyUrl}`);
      }

      ctx.onStdoutChunk?.(`[ComfyUI] Preparing workflow "${path.basename(wfPath)}"...\n`);
      let converted = await sanitizeWorkflowViaPython({
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
      healedInputsCount = Array.isArray(converted.healed_inputs) ? converted.healed_inputs.length : 0;

      ctx.onStdoutChunk?.(
        `[ComfyUI] Queueing workflow (${sanitizedNodeCount} nodes, seed ${effectiveSeed}${healedInputsCount ? `, auto-healed ${healedInputsCount} input(s)` : ''})...\n`
      );
      let submitRes = await fetch(`${comfyUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: converted.api_prompt, client_id: 'localgravity' }),
        signal: AbortSignal.timeout(15000),
      });

      let submitText = await submitRes.text();
      if (!submitRes.ok && submitText.includes('Value not in list')) {
        // Cached object_info might be stale (e.g., user just added a LoRA/model); refresh cache and re-sanitize once.
        invalidateObjectInfoCache();
        converted = await sanitizeWorkflowViaPython({
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
        submitRes = await fetch(`${comfyUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: converted.api_prompt, client_id: 'localgravity' }),
          signal: AbortSignal.timeout(15000),
        });
        submitText = await submitRes.text();
      }

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
      const completedEntry = await waitForComfyJob({
        promptId,
        workflowName: path.basename(wfPath),
        timeoutMs,
        startMs,
        abortSignal: ctx.abortSignal,
        onLog: (line) => ctx.onStdoutChunk?.(line),
      });

      savedOutputs = await downloadComfyOutputs(completedEntry.outputs || {});
    } catch (err: any) {
      generationError = err?.message || String(err);
    } finally {
      if (generationError || ctx.abortSignal?.aborted) {
        await interruptComfyJob(promptId || undefined);
      }

      const keepWarm =
        studioCfg.keepVramWarm &&
        !generationError &&
        ((studioCfg.studioMode && (zeroVramCompanion || isOllamaVision)) ||
          (isGoogleMode && !wasStrataActive));
      if (keepWarm) {
        ctx.onStdoutChunk?.('[ComfyUI] Keeping workflow models warm in VRAM for fast repeat turns.\n');
      } else {
        await freeComfyVram();
        const shouldReloadStrata = wasStrataActive && !zeroVramCompanion && !isOllamaVision && !isGoogleMode;
        await new Promise((r) => setTimeout(r, shouldReloadStrata ? 1200 : 800));
        if (shouldReloadStrata) {
          ctx.onStdoutChunk?.(`[ComfyUI] Freed ComfyUI VRAM. Reloading Strata (${prevProfile}) onto GPU...\n`);
          strataReloaded = await sidecar.ensureRunning(prevProfile);
        } else {
          ctx.onStdoutChunk?.('[ComfyUI] Freed ComfyUI VRAM.\n');
        }
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
          healedInputs: healedInputsCount,
          promptEnhancedBy: enhancedBy,
          promptEnhanced,
          effectivePrompt: finalPrompt,
          strataReloaded,
          vramKeptWarm: studioCfg.studioMode && studioCfg.keepVramWarm && (zeroVramCompanion || isOllamaVision),
          outputs: savedOutputs,
        },
        null,
        2
      ),
    ];

    for (const out of savedOutputs) {
      const label = out.mediaKind === 'video' ? 'MCP Video saved to' : out.mediaKind === 'audio' ? 'MCP Audio saved to' : 'MCP Image saved to';
      lines.push(`[${label}: ${out.localPath}](${out.apiUrl})`);
    }

    let inspectScreenshotBase64: string | undefined;
    if (Boolean(args.inspect_output)) {
      const firstImage = savedOutputs.find(
        (o) => o.mediaKind === 'image' && o.localPath && fs.existsSync(o.localPath)
      );
      if (firstImage) {
        try {
          const buf = fs.readFileSync(firstImage.localPath);
          const ext = (path.extname(firstImage.localPath) || '.png').toLowerCase();
          const mime =
            ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.webp'
                ? 'image/webp'
                : 'image/png';
          inspectScreenshotBase64 = `data:${mime};base64,${buf.toString('base64')}`;
        } catch {}
      }
    }

    return {
      stdout: lines.join('\n'),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
      ...(inspectScreenshotBase64 ? { screenshotBase64: inspectScreenshotBase64 } : {}),
    };
  }

  return {
    stdout: '',
    stderr: `Unsupported comfyui action "${action}". Valid actions: generate, list_workflows, inspect_workflow, status, start_server, free_vram, gemini_image, gemini_video.`,
    exitCode: 1,
    durationMs: Math.round(performance.now() - startMs),
  };
};
