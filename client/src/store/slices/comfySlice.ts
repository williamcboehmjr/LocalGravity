import type { ComfyStudioConfig, ComfyWorkflowPreset, OllamaModelItem } from '../../types/protocol';

export interface DiscoveredGgufItem {
  name: string;
  path: string;
  sizeGb: number;
}

export interface ComfyCapabilities {
  hasGoogleApiKey: boolean;
  hasLlamaServer: boolean;
  llamaServerExe?: string | null;
  hasLitertLm: boolean;
  litertLmExe?: string | null;
  hasOllama?: boolean;
  ollamaRunning?: boolean;
  ollamaUrl?: string;
  ollamaLoadedModels?: Array<{ name: string; sizeVramGb: number }>;
  ollamaModels?: OllamaModelItem[];
  resolvedOllamaModel?: string;
  cpuServerRunning: boolean;
  companionUrl?: string;
  presets: ComfyWorkflowPreset[];
  discoveredGgufs: DiscoveredGgufItem[];
  resolvedEffectiveBrain?: string;
}

export interface ComfySlice {
  comfyConfig: ComfyStudioConfig;
  comfyWorkflows: string[];
  comfyCapabilities: ComfyCapabilities | null;
  comfyRunning: boolean;
  comfyApiUnsupported: boolean;
  comfySwitchingStatus: string | null;
  setComfyStudioState: (payload: {
    config?: Partial<ComfyStudioConfig>;
    workflows?: string[];
    capabilities?: ComfyCapabilities | null;
    comfyRunning?: boolean;
    apiUnsupported?: boolean;
    switching?: boolean;
    switchingMessage?: string | null;
  }) => void;
  updateComfyConfigRemote: (patch: Partial<ComfyStudioConfig>) => Promise<void>;
  freeComfyVramRemote: () => Promise<boolean>;
  unloadOllamaRemote: () => Promise<boolean>;
  pullOllamaModelRemote: (model: string) => Promise<{ ok: boolean; error?: string }>;
  restartBrainRemote: () => Promise<boolean>;
}

const DEFAULT_COMFY_CONFIG: ComfyStudioConfig = {
  studioMode: false,
  defaultWorkflow: 'Moss Image.json',
  companionBrain: 'auto',
  customGgufPath: '',
  ollamaModel: 'qwen3.5:4b',
  ollamaKeepAlive: '3m',
  keepVramWarm: true,
  enhancePrompt: true,
};

export const CLIENT_COMFY_PREF_KEY = 'localgravity_client_comfy_pref';

export function loadClientComfyPref(): Partial<ComfyStudioConfig> | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(CLIENT_COMFY_PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Partial<ComfyStudioConfig>;
  } catch {
    return null;
  }
}

export function saveClientComfyPref(cfg: ComfyStudioConfig): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(CLIENT_COMFY_PREF_KEY, JSON.stringify(cfg));
  } catch {}
}

export function createComfySlice(
  set: (partial: any) => void,
  get: () => { apiBaseUrl: string; comfyConfig: ComfyStudioConfig }
): ComfySlice {
  return {
    comfyConfig: { ...DEFAULT_COMFY_CONFIG, ...(loadClientComfyPref() || {}) },
    comfyWorkflows: [],
    comfyCapabilities: null,
    comfyRunning: false,
    comfyApiUnsupported: false,
    comfySwitchingStatus: null,

    setComfyStudioState: (payload) => {
      set((state: ComfySlice) => ({
        comfyConfig: payload.config ? { ...state.comfyConfig, ...payload.config } : state.comfyConfig,
        comfyWorkflows: Array.isArray(payload.workflows) ? payload.workflows : state.comfyWorkflows,
        comfyCapabilities: payload.capabilities !== undefined ? payload.capabilities : state.comfyCapabilities,
        comfyRunning: typeof payload.comfyRunning === 'boolean' ? payload.comfyRunning : state.comfyRunning,
        comfyApiUnsupported:
          typeof payload.apiUnsupported === 'boolean' ? payload.apiUnsupported : state.comfyApiUnsupported,
        comfySwitchingStatus:
          payload.switching === false
            ? null
            : payload.switching === true
              ? payload.switchingMessage || state.comfySwitchingStatus || 'Swapping GPU engine...'
              : payload.switchingMessage !== undefined
                ? payload.switchingMessage
                : state.comfySwitchingStatus,
      }));
    },

    updateComfyConfigRemote: async (patch) => {
      const { apiBaseUrl, comfyConfig } = get();
      const prevConfig = comfyConfig;
      const optimistic = { ...comfyConfig, ...patch };
      set({ comfyConfig: optimistic });
      try {
        const res = await fetch(`${apiBaseUrl}/api/comfyui/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.status === 404) {
          set({
            comfyConfig: prevConfig,
            comfyApiUnsupported: true,
            comfySwitchingStatus: null,
          });
          return;
        }
        if (res.ok) {
          const data = await res.json();
          const finalCfg = data.config || optimistic;
          saveClientComfyPref(finalCfg);
          set({
            comfyConfig: finalCfg,
            comfyCapabilities: data.capabilities || null,
            comfyWorkflows: Array.isArray(data.workflows) ? data.workflows : [],
            comfyRunning: Boolean(data.comfyRunning),
            comfyApiUnsupported: false,
            comfySwitchingStatus: data.switching
              ? data.switchingMessage || 'Swapping GPU engine...'
              : null,
          });
        }
      } catch {}
    },

    freeComfyVramRemote: async () => {
      const { apiBaseUrl } = get();
      try {
        const res = await fetch(`${apiBaseUrl}/api/comfyui/free-vram`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          return Boolean(data.freed);
        }
      } catch {}
      return false;
    },

    unloadOllamaRemote: async () => {
      const { apiBaseUrl } = get();
      try {
        const res = await fetch(`${apiBaseUrl}/api/comfyui/ollama/unload`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          if (data.capabilities) {
            set({ comfyCapabilities: data.capabilities });
          }
          return true;
        }
      } catch {}
      return false;
    },

    pullOllamaModelRemote: async (model: string) => {
      const { apiBaseUrl } = get();
      try {
        const res = await fetch(`${apiBaseUrl}/api/comfyui/ollama/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model }),
        });
        const data = await res.json();
        if (data.capabilities) {
          set({ comfyCapabilities: data.capabilities });
        }
        return { ok: Boolean(data.ok), error: data.error };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    },

    restartBrainRemote: async () => {
      const { apiBaseUrl } = get();
      try {
        const res = await fetch(`${apiBaseUrl}/api/system/restart`, { method: 'POST' });
        return res.ok;
      } catch {}
      return false;
    },
  };
}
