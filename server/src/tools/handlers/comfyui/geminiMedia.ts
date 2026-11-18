import fs from 'node:fs';
import path from 'node:path';
import { getPathsConfig } from '../../../core/pathsConfig.js';
import type { BuiltinToolResult, ToolExec, ToolExecutionContext } from '../types.js';

export function cleanEnhancedPrompt(rawOutput: string): string {
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

export function readBrainProviderConfig(): {
  provider: 'strata' | 'google_ai_studio';
  googleApiKey: string;
} {
  const { runtimeDir } = getPathsConfig();
  let provider: 'strata' | 'google_ai_studio' = 'strata';
  let fileKey = '';
  try {
    const cfgPath = path.join(runtimeDir, 'brain-provider.json');
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

export async function enhancePromptWithGemini(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  abortSignal?: AbortSignal
): Promise<string> {
  const candidates = ['gemini-3.8-flash', 'gemini-4-hydrogen'];
  for (const model of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
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

export async function executeGeminiMediaAction(
  action: 'gemini_image' | 'gemini_video',
  args: Record<string, any>,
  ctx: ToolExecutionContext,
  exec: ToolExec,
  startMs: number
): Promise<BuiltinToolResult> {
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
      let mediaData: string | undefined = isVideo ? data?.output_video?.data : data?.output_image?.data;
      let mediaMime: string | undefined = isVideo ? data?.output_video?.mime_type : data?.output_image?.mime_type;

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

      const { mcpOutputsDir } = getPathsConfig();
      fs.mkdirSync(mcpOutputsDir, { recursive: true });
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
      const localPath = path.join(mcpOutputsDir, copyName);
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
          stderr: `Gemini ${isVideo ? 'video' : 'image'} generation aborted by user.`,
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
