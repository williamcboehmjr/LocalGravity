import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { LlamaMoESidecar } from '../../tabby/llamaSidecar.js';
import { getPathsConfig } from '../../core/pathsConfig.js';
import { truncateSafeOutput, type BuiltinToolHandler } from './types.js';

const handleRunTerminal: BuiltinToolHandler = async (args, ctx, exec) => {
  const cmd = String(args.command || (process.platform === 'win32' ? 'Get-Location' : 'pwd'));
  let cwd = args.cwd ? exec.resolveSafePath(ctx.workspaceRoot, args.cwd) : ctx.workspaceRoot;
  if (!fs.existsSync(cwd)) {
    cwd = ctx.workspaceRoot;
  }
  const res = await exec.terminal.executeCommand(
    cmd,
    cwd,
    30000,
    (chunk, stream) => {
      if (stream === 'stdout') ctx.onStdoutChunk?.(chunk);
      else ctx.onStderrChunk?.(chunk);
    },
    ctx.abortSignal
  );
  return {
    ...res,
    stdout: truncateSafeOutput(res.stdout, 16000),
    stderr: truncateSafeOutput(res.stderr, 8000),
  };
};

const handleManageStrata: BuiltinToolHandler = async (args, ctx, exec) => {
  const action = String(args.action || 'status').toLowerCase();
  return await exec.executeTool(
    'inspect_models',
    {
      action: action === 'status' ? 'inspect' : action,
      test_prompt: args.test_prompt,
    },
    ctx
  );
};

const handleSearchModels: BuiltinToolHandler = async (args) => {
  const startMs = performance.now();
  const query = String(args.query || '').trim();
  const repo = String(args.repo || '').trim();
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);

  try {
    if (repo) {
      const cleanRepo = repo.replace(/^https?:\/\/huggingface\.co\//i, '').replace(/\/tree\/main.*$/, '');
      const url = `https://huggingface.co/api/models/${cleanRepo}/tree/main`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) {
        return {
          stdout: '',
          stderr: `Hugging Face repo error: ${resp.status} ${resp.statusText}`,
          exitCode: 1,
          durationMs: Math.round(performance.now() - startMs),
        };
      }
      const data: any = await resp.json();
      const files = Array.isArray(data)
        ? data.map((f: any) => ({ path: f.path, size: f.size, type: f.type }))
        : [];
      const filterQuery = query.toLowerCase();
      const filtered = filterQuery ? files.filter((f) => f.path.toLowerCase().includes(filterQuery)) : files;
      return {
        stdout: JSON.stringify({ repo: cleanRepo, totalFiles: files.length, matchedFiles: filtered.slice(0, 30) }, null, 2),
        stderr: '',
        exitCode: 0,
        durationMs: Math.round(performance.now() - startMs),
      };
    }

    const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=${limit}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      return {
        stdout: '',
        stderr: `Hugging Face search error: ${resp.status} ${resp.statusText}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const data: any = await resp.json();
    const models = Array.isArray(data)
      ? data.map((m: any) => ({
          id: m.id,
          downloads: m.downloads,
          likes: m.likes,
          pipeline_tag: m.pipeline_tag,
          lastModified: m.lastModified,
          url: `https://huggingface.co/${m.id}`,
        }))
      : [];
    return {
      stdout: JSON.stringify({ query, count: models.length, models }, null, 2),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  } catch (err: any) {
    return {
      stdout: '',
      stderr: `Model search failed: ${err?.message || String(err)}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
};

const handleInspectModels: BuiltinToolHandler = async (args) => {
  const startMs = performance.now();
  const action = String(args.action || 'inspect').toLowerCase();
  const testPrompt = String(args.test_prompt || 'What color is this test image? Answer in 1-2 words.');
  const { strataUrl, modelsDirs } = getPathsConfig();

  if (action === 'test_vision') {
    const redPng =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    try {
      const startT = performance.now();
      const resp = await fetch(`${strataUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen3.8-flash-next-iq3_s',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: testPrompt },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${redPng}` } },
              ],
            },
          ],
          max_tokens: 60,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const durMs = Math.round(performance.now() - startT);
      if (!resp.ok) {
        const err = await resp.text();
        return {
          stdout: '',
          stderr: `Strata vision test HTTP error ${resp.status}: ${err}`,
          exitCode: 1,
          durationMs: Math.round(performance.now() - startMs),
        };
      }
      const data: any = await resp.json();
      const answer = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';
      return {
        stdout: JSON.stringify(
          {
            status: 'vision_verified_functional',
            latency_ms: durMs,
            engine: `Strata (${strataUrl})`,
            model: data.model || 'qwen3.8-flash-next-iq3_s',
            test_response: answer.trim(),
            timings: data.timings,
          },
          null,
          2
        ),
        stderr: '',
        exitCode: 0,
        durationMs: Math.round(performance.now() - startMs),
      };
    } catch (e: any) {
      return {
        stdout: '',
        stderr: `Vision test failed: ${e?.message || String(e)}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
  }

  if (action === 'offload') {
    const sidecar = LlamaMoESidecar.getInstance();
    await sidecar.offloadFromGpu('tool_request');
    return {
      stdout: JSON.stringify(
        {
          status: 'offloaded',
          engine: `Strata (${strataUrl})`,
          state: await sidecar.getState(),
          offloadedAt: sidecar.getOffloadedAt(),
        },
        null,
        2
      ),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'wake') {
    const sidecar = LlamaMoESidecar.getInstance();
    const ok = await sidecar.ensureRunning(sidecar.getActiveProfile());
    return {
      stdout: ok
        ? JSON.stringify(
            {
              status: 'awake',
              engine: `Strata (${strataUrl})`,
              profile: sidecar.getActiveProfile(),
              state: await sidecar.getState(),
            },
            null,
            2
          )
        : '',
      stderr: ok ? '' : `Failed to wake Strata onto GPU at ${strataUrl}`,
      exitCode: ok ? 0 : 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'restart') {
    try {
      const sidecar = LlamaMoESidecar.getInstance();
      const prevProfile = sidecar.getActiveProfile();
      await sidecar.offloadFromGpu('restart_requested');
      const ready = await sidecar.ensureRunning(prevProfile);

      return {
        stdout: JSON.stringify(
          {
            status: ready ? 'restarted_successfully' : 'restart_failed',
            engine: `Strata (${strataUrl})`,
            profile: sidecar.getActiveProfile(),
            ready,
          },
          null,
          2
        ),
        stderr: ready ? '' : `Strata failed to restart at ${strataUrl}`,
        exitCode: ready ? 0 : 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    } catch (e: any) {
      return {
        stdout: '',
        stderr: `Failed to restart Strata: ${e?.message || String(e)}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
  }

  // Default: 'inspect'
  let healthData: any = null;
  let modelsData: any = null;
  try {
    const hRes = await fetch(`${strataUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (hRes.ok) healthData = await hRes.json();
  } catch {}
  try {
    const mRes = await fetch(`${strataUrl}/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (mRes.ok) modelsData = await mRes.json();
  } catch {}

  const sidecar = LlamaMoESidecar.getInstance();
  const { configPath } = sidecar.resolveProfileConfig(sidecar.getActiveProfile());
  let launchConfig: any = null;
  if (fs.existsSync(configPath)) {
    try {
      launchConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {}
  }

  const diskModels: Array<{ folder: string; files: Array<{ name: string; sizeGb: number }> }> = [];
  for (const modelsDir of modelsDirs) {
    if (!fs.existsSync(modelsDir)) continue;
    try {
      const entries = fs.readdirSync(modelsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory() && (ent.name.toLowerCase().includes('qwen') || ent.name.toLowerCase().includes('swift'))) {
          const subPath = path.join(modelsDir, ent.name);
          const files = fs.readdirSync(subPath).map((f) => {
            const stat = fs.statSync(path.join(subPath, f));
            return { name: f, sizeGb: Math.round((stat.size / (1024 * 1024 * 1024)) * 100) / 100 };
          });
          diskModels.push({ folder: ent.name, files });
        }
      }
    } catch {}
  }

  return {
    stdout: JSON.stringify(
      {
        engine: {
          name: 'Strata Local Inference Engine',
          url: strataUrl,
          online: healthData !== null,
          health: healthData,
          models: modelsData?.data || [],
          vision_supported:
            healthData?.images === true ||
            modelsData?.data?.[0]?.architecture?.input_modalities?.includes('image'),
        },
        active_launch_profile: launchConfig
          ? {
              path: configPath,
              model_name: launchConfig.model_name,
              max_context: 65536,
              spec: 6,
              vision_projector: launchConfig.vision?.mmproj,
              vision_gpu: launchConfig.vision?.gpu,
            }
          : null,
        disk_models: diskModels,
      },
      null,
      2
    ),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};

const handleInspectSystem: BuiltinToolHandler = async (args) => {
  const startMs = performance.now();
  const action = String(args.action || 'gpu_stats').toLowerCase();
  const filter = args.filter ? String(args.filter).toLowerCase() : '';

  if (action === 'gpu_stats') {
    try {
      const out = execSync(
        'nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu --format=csv,noheader,nounits',
        { timeout: 4000, windowsHide: true }
      )
        .toString()
        .trim();
      const parts = out.split(',').map((p) => p.trim());
      return {
        stdout: JSON.stringify(
          {
            gpuName: parts[0] || 'Unknown Nvidia GPU',
            memoryTotalMb: Number(parts[1]) || 0,
            memoryUsedMb: Number(parts[2]) || 0,
            memoryFreeMb: Number(parts[3]) || 0,
            utilizationPercent: Number(parts[4]) || 0,
            temperatureC: Number(parts[5]) || 0,
          },
          null,
          2
        ),
        stderr: '',
        exitCode: 0,
        durationMs: Math.round(performance.now() - startMs),
      };
    } catch (err: any) {
      return {
        stdout: '',
        stderr: `GPU query failed: ${err?.message || String(err)}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
  }

  if (action === 'list_ports') {
    try {
      const psScript = `Get-NetTCPConnection -State Listen | Select-Object -First 25 LocalAddress, LocalPort, OwningProcess | ConvertTo-Json`;
      const out = execSync(
        `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "${psScript}"`,
        { timeout: 5000, windowsHide: true }
      )
        .toString()
        .trim();
      let ports = JSON.parse(out || '[]');
      if (!Array.isArray(ports)) ports = [ports];
      if (filter) {
        ports = ports.filter(
          (p: any) => String(p.LocalPort).includes(filter) || String(p.OwningProcess).includes(filter)
        );
      }
      return {
        stdout: JSON.stringify({ count: ports.length, listeners: ports }, null, 2),
        stderr: '',
        exitCode: 0,
        durationMs: Math.round(performance.now() - startMs),
      };
    } catch (err: any) {
      return {
        stdout: '',
        stderr: `Port query failed: ${err?.message || String(err)}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
  }

  if (action === 'find_process') {
    try {
      const target = filter || 'strata';
      const psScript = `Get-Process | Where-Object { $_.ProcessName -like "*${target}*" } | Select-Object Id, ProcessName, WorkingSet64 | ConvertTo-Json`;
      const out = execSync(
        `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "${psScript}"`,
        { timeout: 5000, windowsHide: true }
      )
        .toString()
        .trim();
      let procs = JSON.parse(out || '[]');
      if (!Array.isArray(procs)) procs = [procs];
      return {
        stdout: JSON.stringify(
          {
            filter: target,
            count: procs.length,
            processes: procs.map((p: any) => ({
              id: p.Id,
              name: p.ProcessName,
              memoryMb: Math.round(p.WorkingSet64 / (1024 * 1024)),
            })),
          },
          null,
          2
        ),
        stderr: '',
        exitCode: 0,
        durationMs: Math.round(performance.now() - startMs),
      };
    } catch (err: any) {
      return {
        stdout: '',
        stderr: `Process query failed: ${err?.message || String(err)}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
  }

  return {
    stdout: '',
    stderr: `Unsupported inspect_system action: ${action}`,
    exitCode: 1,
    durationMs: Math.round(performance.now() - startMs),
  };
};

const handleAskQuestion: BuiltinToolHandler = async (args) => {
  const startMs = performance.now();
  const rawQuestions = Array.isArray(args?.questions) ? args.questions : [];
  const questions = rawQuestions
    .filter((q: any) => q && typeof q.question === 'string' && Array.isArray(q.options))
    .map((q: any) => ({
      question: String(q.question),
      options: q.options.map(String).filter(Boolean),
      is_multi_select: Boolean(q.is_multi_select),
    }));
  return {
    stdout: JSON.stringify({ __localgravity_widget: 'ask_question', questions }, null, 2),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};

export const SYSTEM_TOOL_HANDLERS: Record<string, BuiltinToolHandler> = {
  run_terminal: handleRunTerminal,
  manage_strata: handleManageStrata,
  search_models: handleSearchModels,
  inspect_models: handleInspectModels,
  inspect_system: handleInspectSystem,
  ask_question: handleAskQuestion,
};
