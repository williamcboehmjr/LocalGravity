import React, { useState, useEffect, useRef } from 'react';
import {
  Palette,
  ChevronDown,
  Check,
  Cpu,
  Cloud,
  Flame,
  Trash2,
  Sparkles,
  Eye,
  Download,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';
import type { ComfyCompanionBrainId } from '../../types/protocol';

const COMPANION_OPTIONS: Array<{
  id: ComfyCompanionBrainId;
  label: string;
  desc: string;
  vramBadge: string;
}> = [
  {
    id: 'auto',
    label: 'Auto (Smart Fastest)',
    desc: 'Gemini 3.8 Flash if keyed, else Ollama Vision or CPU',
    vramBadge: 'Auto Swap',
  },
  {
    id: 'ollama_vision',
    label: 'Ollama Vision (Fast GPU Swap)',
    desc: 'Local Ollama vision + tools • Instant keep_alive:0 unload/reload',
    vramBadge: '~1-2s Swap',
  },
  {
    id: 'gemini_flash',
    label: 'Gemini 3.8 Flash',
    desc: 'Instant cloud tool calls & prompt expansion',
    vramBadge: '0 MB GPU',
  },
  {
    id: 'cpu_lightweight',
    label: 'Local CPU Companion (llama-server)',
    desc: 'Offline CPU GGUF (-ngl 0) • Leaves 100% VRAM for ComfyUI',
    vramBadge: '0 MB GPU',
  },
  {
    id: 'gemma4_litert',
    label: 'Gemma 4 E4B (LiteRT-LM)',
    desc: 'On-device LiteRT single-turn tool + enhancer',
    vramBadge: 'Low/0 GPU',
  },
  {
    id: 'strata',
    label: 'Strata (Swift 1.5)',
    desc: 'Heavy 64 GB MoE • Requires GPU offload & reload per turn',
    vramBadge: 'Full Swap',
  },
];

function shortWorkflowLabel(wf: string): string {
  const lower = (wf || '').toLowerCase();
  if (lower.includes('moss')) return 'MOSS';
  if (lower.includes('z-image') && lower.includes('turbo')) return 'Z-Turbo';
  if (lower.includes('z-image')) return 'Z-Image';
  if (lower.includes('krea')) return 'Krea 2';
  if (lower.includes('minimax h3.json') || lower === 'h3 video') return 'H3 Video';
  if (lower.includes('h3')) return 'H3 Image';
  if (lower.includes('qwen')) return 'Qwen Edit';
  if (lower === 'gemini_image') return 'Nano Banana';
  return wf.replace(/\.json$/i, '').slice(0, 14);
}

interface ComfyStudioPopoverProps {
  onCloseOtherMenus?: () => void;
}

export const ComfyStudioPopover: React.FC<ComfyStudioPopoverProps> = ({ onCloseOtherMenus }) => {
  const {
    apiBaseUrl,
    comfyConfig,
    comfyCapabilities,
    comfyWorkflows,
    comfyApiUnsupported,
    comfySwitchingStatus,
    setComfyStudioState,
    updateComfyConfigRemote,
    freeComfyVramRemote,
    unloadOllamaRemote,
    pullOllamaModelRemote,
    restartBrainRemote,
  } = useSessionStore();
  const [open, setOpen] = useState(false);
  const [freeingVram, setFreeingVram] = useState(false);
  const [unloadingOllama, setUnloadingOllama] = useState(false);
  const [restartingBrain, setRestartingBrain] = useState(false);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const fetchedOnceRef = useRef(false);

  useEffect(() => {
    if (!apiBaseUrl) return;
    if (!open && fetchedOnceRef.current) return;
    fetchedOnceRef.current = true;
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/comfyui/config`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setComfyStudioState({ apiUnsupported: true });
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data) {
            setComfyStudioState({ ...data, apiUnsupported: false });
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, open, setComfyStudioState]);

  const presets = comfyCapabilities?.presets || [
    { id: 'moss', label: 'MOSS Image (Default)', workflow: 'Moss Image.json', speedHint: 'Balanced (25 steps)', vramHint: '5 GB UNET', stepsHint: '25 steps', kind: 'comfyui' as const },
    { id: 'z-image', label: 'Z-Image Turbo (Draft Speed)', workflow: 'z-image.json', speedHint: 'Ultra-Fast (9 steps)', vramHint: '4B CLIP', stepsHint: '9 steps', kind: 'comfyui' as const },
    { id: 'krea', label: 'Krea 2 Spice Turbo', workflow: 'Famegrid Krea 2 Spice V2 - Simplified.json', speedHint: 'Very Fast (8 steps)', vramHint: '13 GB UNET', stepsHint: '8 steps', kind: 'comfyui' as const },
    { id: 'h3', label: 'MiniMax H3 Image', workflow: 'H3 Image Easy Workflow.json', speedHint: 'Heavy (~131s cold)', vramHint: '19.5 GB UNET', stepsHint: '6 steps', kind: 'comfyui' as const },
    { id: 'qwen', label: 'Qwen 2.1 Image Edit', workflow: 'Qwen 2.1 Image Edit.json', speedHint: 'Edit (25 steps)', vramHint: 'INT8 + FP8', stepsHint: '25 steps', kind: 'comfyui' as const },
    { id: 'gemini_image', label: 'Gemini Nano Banana 2.1', workflow: 'gemini_image', speedHint: 'Cloud (~5s)', vramHint: '0 VRAM', stepsHint: 'Cloud', kind: 'cloud' as const },
  ];

  const handleFreeVram = async () => {
    setFreeingVram(true);
    await freeComfyVramRemote();
    setFreeingVram(false);
  };

  const handleUnloadOllama = async () => {
    setUnloadingOllama(true);
    await unloadOllamaRemote();
    setUnloadingOllama(false);
  };

  const handlePullOllama = async (model: string) => {
    setPullError(null);
    setPullingModel(model);
    const res = await pullOllamaModelRemote(model);
    setPullingModel(null);
    if (!res.ok) {
      setPullError(res.error || `Failed to pull ${model}`);
    } else {
      await updateComfyConfigRemote({ ollamaModel: model, companionBrain: 'ollama_vision', studioMode: true });
    }
  };

  const presetNames = new Set(presets.map((p) => p.workflow.toLowerCase()));
  const extraWorkflows = comfyWorkflows.filter((w) => !presetNames.has(w.toLowerCase())).slice(0, 15);
  const discoveredGgufs = comfyCapabilities?.discoveredGgufs || [];
  const ollamaModels = comfyCapabilities?.ollamaModels || [];
  const installedOllama = ollamaModels.filter((m) => m.installed);
  const unInstalledRecommendedOllama = ollamaModels.filter((m) => !m.installed && m.recommended).slice(0, 3);
  const loadedOllama = comfyCapabilities?.ollamaLoadedModels || [];

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          onCloseOtherMenus?.();
          setOpen((v) => !v);
        }}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
          comfyConfig.studioMode
            ? 'bg-violet-950/70 border-violet-500/50 text-violet-200 hover:bg-violet-900/70 shadow-sm'
            : 'bg-[#222327] border-[#34363B] text-[#9AA0A6] hover:text-[#E8EAED] hover:bg-[#2A2B30]'
        }`}
        title="ComfyUI Studio: pick dedicated image workflow + zero-VRAM fast companion model"
      >
        <Palette className={`w-3.5 h-3.5 shrink-0 ${comfyConfig.studioMode ? 'text-violet-300' : 'text-[#9AA0A6]'}`} />
        <span className="truncate max-w-[90px] sm:max-w-[130px]">
          {comfyConfig.studioMode ? `Comfy: ${shortWorkflowLabel(comfyConfig.defaultWorkflow)}` : 'Comfy'}
        </span>
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-80 sm:w-96 max-h-[75vh] overflow-y-auto bg-[#1B1C20] border border-[#2F3036] rounded-xl shadow-2xl p-3 z-50 space-y-3 text-xs select-none">
          {comfyApiUnsupported && (
            <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-200 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Central Brain server is outdated</span>
              </div>
              <div className="text-[10.5px] text-amber-200/80">
                The background server is missing ComfyUI Studio routes (/api/comfyui/config returned 404). Restart it once to enable Ollama Vision switching.
              </div>
              <button
                type="button"
                disabled={restartingBrain}
                onClick={async () => {
                  setRestartingBrain(true);
                  await restartBrainRemote();
                  setTimeout(() => setRestartingBrain(false), 4000);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-100 text-[11px] font-medium transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${restartingBrain ? 'animate-spin' : ''}`} />
                <span>{restartingBrain ? 'Restarting Central Brain...' : 'Restart Central Brain'}</span>
              </button>
            </div>
          )}

          {comfySwitchingStatus && (
            <div className="px-2.5 py-1.5 rounded-lg bg-violet-950/60 border border-violet-500/40 text-violet-200 flex items-center gap-2 text-[11px]">
              <RefreshCw className="w-3.5 h-3.5 text-violet-300 animate-spin shrink-0" />
              <span className="truncate">{comfySwitchingStatus}</span>
            </div>
          )}

          {/* Header + Studio Mode Toggle */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#2A2B30]">
            <div>
              <div className="font-semibold text-[#E8EAED] flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-violet-400" />
                <span>ComfyUI Studio (Fast Turns)</span>
              </div>
              <div className="text-[10.5px] text-[#8E8E93]">
                Single-tool mode • Fast Ollama Vision / 0-VRAM swap
              </div>
            </div>
            <button
              type="button"
              onClick={() => void updateComfyConfigRemote({ studioMode: !comfyConfig.studioMode })}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                comfyConfig.studioMode
                  ? 'bg-violet-600 text-white hover:bg-violet-500'
                  : 'bg-[#2A2B30] text-[#9AA0A6] hover:text-white'
              }`}
            >
              {comfyConfig.studioMode ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Workflow / Model Presets */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#80868B] px-1">
              Image / Video Workflow
            </div>
            <div className="space-y-0.5 max-h-44 overflow-y-auto pr-0.5">
              {presets.map((p) => {
                const active = comfyConfig.defaultWorkflow === p.workflow;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void updateComfyConfigRemote({ defaultWorkflow: p.workflow, studioMode: true })}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                      active ? 'bg-[#292A32] text-[#E8EAED]' : 'text-[#9AA0A6] hover:bg-[#23242B] hover:text-[#E8EAED]'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-medium truncate">{p.label}</div>
                      <div className="text-[10px] text-[#7E828A] font-mono truncate">
                        {p.speedHint} • {p.vramHint}
                      </div>
                    </div>
                    {active && <Check className="w-3.5 h-3.5 text-violet-400 shrink-0" />}
                  </button>
                );
              })}

              {extraWorkflows.length > 0 && (
                <div className="pt-1">
                  <select
                    value={presetNames.has(comfyConfig.defaultWorkflow.toLowerCase()) ? '' : comfyConfig.defaultWorkflow}
                    onChange={(e) => {
                      if (e.target.value) {
                        void updateComfyConfigRemote({ defaultWorkflow: e.target.value, studioMode: true });
                      }
                    }}
                    className="w-full bg-[#141518] border border-[#2D2F35] rounded-lg px-2 py-1.5 text-[11px] text-[#C4C7C5] outline-none"
                  >
                    <option value="">Other ComfyUI workflow JSON ({extraWorkflows.length})...</option>
                    {extraWorkflows.map((wf) => (
                      <option key={wf} value={wf}>
                        {wf}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Fast Companion Brain Selector */}
          <div className="space-y-1 pt-1 border-t border-[#2A2B30]">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#80868B]">
                Tool &amp; Prompt Companion Brain
              </span>
              {comfyCapabilities?.resolvedEffectiveBrain && (
                <span className="text-[10px] font-mono text-emerald-400">
                  → {comfyCapabilities.resolvedEffectiveBrain}
                </span>
              )}
            </div>
            <div className="space-y-0.5">
              {COMPANION_OPTIONS.map((opt) => {
                const active = comfyConfig.companionBrain === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void updateComfyConfigRemote({ companionBrain: opt.id })}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                      active ? 'bg-[#292A32] text-[#E8EAED]' : 'text-[#9AA0A6] hover:bg-[#23242B] hover:text-[#E8EAED]'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 font-medium truncate">
                        {opt.id === 'gemini_flash' ? (
                          <Cloud className="w-3 h-3 text-sky-400 shrink-0" />
                        ) : opt.id === 'ollama_vision' ? (
                          <Eye className="w-3 h-3 text-violet-400 shrink-0" />
                        ) : (
                          <Cpu className="w-3 h-3 text-emerald-400 shrink-0" />
                        )}
                        <span className="truncate">{opt.label}</span>
                      </div>
                      <div className="text-[10px] text-[#7E828A] truncate">{opt.desc}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="px-1.5 py-0.5 rounded bg-[#141518] border border-[#2D2F35] text-[9.5px] font-mono text-[#9AA0A6]">
                        {opt.vramBadge}
                      </span>
                      {active && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Ollama Vision Model Selector */}
            {(comfyConfig.companionBrain === 'ollama_vision' || comfyConfig.companionBrain === 'auto') && (
              <div className="pt-1.5 px-1 space-y-1.5">
                <div className="text-[10px] text-[#8E8E93] flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3 text-violet-400" />
                    <span>Ollama Vision Model:</span>
                  </span>
                  <div className="flex items-center gap-1.5 font-mono text-[9.5px]">
                    <span className={comfyCapabilities?.ollamaRunning ? 'text-emerald-400' : 'text-amber-300'}>
                      {comfyCapabilities?.ollamaRunning ? 'Online' : 'Auto-Start'}
                    </span>
                    <span className="text-[#5F6368]">•</span>
                    <span className="text-violet-300">
                      {loadedOllama.length > 0 ? `GPU: ${loadedOllama[0].name}` : 'GPU: Unloaded'}
                    </span>
                  </div>
                </div>
                {installedOllama.length > 0 ? (
                  <select
                    value={comfyConfig.ollamaModel || comfyCapabilities?.resolvedOllamaModel || 'qwen3.5:4b'}
                    onChange={(e) =>
                      void updateComfyConfigRemote({
                        ollamaModel: e.target.value,
                        companionBrain: 'ollama_vision',
                        studioMode: true,
                      })
                    }
                    className="w-full bg-[#141518] border border-[#2D2F35] rounded-lg px-2 py-1 text-[11px] font-mono text-[#E8EAED] outline-none"
                  >
                    {installedOllama.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.isVision ? '★ Vision' : 'Text'}
                        {m.supportsTools ? '+Tools' : ''} • {m.name} ({m.sizeGb} GB)
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-[10px] text-[#6E6E73] italic">
                    No installed Ollama models detected yet. Pull one below:
                  </div>
                )}

                {unInstalledRecommendedOllama.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    {unInstalledRecommendedOllama.map((m) => (
                      <button
                        key={m.name}
                        type="button"
                        disabled={Boolean(pullingModel)}
                        onClick={() => void handlePullOllama(m.name)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#141518] hover:bg-[#252730] border border-[#2D2F35] text-[9.5px] font-mono text-[#9AA0A6] hover:text-[#E8EAED] transition-colors cursor-pointer disabled:opacity-50"
                        title={m.hint}
                      >
                        <Download className="w-2.5 h-2.5 text-violet-400" />
                        <span>
                          {pullingModel === m.name ? `Pulling ${m.name}...` : `Pull ${m.name} (${m.sizeGb}GB)`}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {pullError && <div className="text-[10px] text-rose-400">{pullError}</div>}
              </div>
            )}

            {/* Optional Local CPU GGUF Picker */}
            {(comfyConfig.companionBrain === 'cpu_lightweight' || comfyConfig.companionBrain === 'auto') && (
              <div className="pt-1 px-1 space-y-1">
                <div className="text-[10px] text-[#8E8E93] flex items-center justify-between">
                  <span>CPU Companion GGUF (-ngl 0):</span>
                  <span className="font-mono text-[9.5px] text-amber-300/90">
                    {discoveredGgufs.length} found
                  </span>
                </div>
                {discoveredGgufs.length > 0 ? (
                  <select
                    value={comfyConfig.customGgufPath}
                    onChange={(e) => void updateComfyConfigRemote({ customGgufPath: e.target.value })}
                    className="w-full bg-[#141518] border border-[#2D2F35] rounded-lg px-2 py-1 text-[11px] font-mono text-[#E8EAED] outline-none"
                  >
                    <option value="">Auto-pick smallest ({discoveredGgufs[0].name} • {discoveredGgufs[0].sizeGb} GB)</option>
                    {discoveredGgufs.map((g) => (
                      <option key={g.path} value={g.path}>
                        {g.name} ({g.sizeGb} GB)
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-[10px] text-[#6E6E73] italic">
                    Tip: drop any 3B-4B Q4_K_M .gguf into E:\Github\Models\fast-companion\
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Toggles + Free VRAM action */}
          <div className="pt-2 border-t border-[#2A2B30] space-y-1.5">
            <label className="flex items-center justify-between px-1 py-0.5 cursor-pointer">
              <span className="flex items-center gap-1.5 text-[11px] text-[#C4C7C5]">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                <span>Keep ComfyUI models warm in VRAM</span>
              </span>
              <input
                type="checkbox"
                checked={comfyConfig.keepVramWarm}
                onChange={(e) => void updateComfyConfigRemote({ keepVramWarm: e.target.checked })}
                className="accent-violet-500 cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between px-1 py-0.5 cursor-pointer">
              <span className="flex items-center gap-1.5 text-[11px] text-[#C4C7C5]">
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                <span>Auto-enhance prompt before ComfyUI</span>
              </span>
              <input
                type="checkbox"
                checked={comfyConfig.enhancePrompt}
                onChange={(e) => void updateComfyConfigRemote({ enhancePrompt: e.target.checked })}
                className="accent-violet-500 cursor-pointer"
              />
            </label>

            <div className="flex items-center justify-between gap-1.5 pt-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleFreeVram}
                  disabled={freeingVram}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#23242B] hover:bg-[#2E303A] text-[#C4C7C5] text-[10.5px] transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3 h-3 text-rose-400" />
                  <span>{freeingVram ? 'Freeing...' : 'Free ComfyUI'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleUnloadOllama}
                  disabled={unloadingOllama}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#23242B] hover:bg-[#2E303A] text-[#C4C7C5] text-[10.5px] transition-colors cursor-pointer"
                >
                  <Eye className="w-3 h-3 text-violet-400" />
                  <span>{unloadingOllama ? 'Unloading...' : 'Unload Ollama'}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2.5 py-1 rounded-lg text-[11px] text-[#8E8E93] hover:text-[#E8EAED] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
