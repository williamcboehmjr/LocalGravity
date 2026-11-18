import type { ComfyStudioConfig, ComfyWorkflowPreset } from '../../types/protocol';

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
  setComfyStudioState: (payload: {
    config?: Partial<ComfyStudioConfig>;
    workflows?: string[];
    capabilities?: ComfyCapabilities | null;
    comfyRunning?: boolean;
  }) => void;
  updateComfyConfigRemote: (patch: Partial<ComfyStudioConfig>) => Promise<void>;
  freeComfyVramRemote: () => Promise<boolean>;
}

const DEFAULT_COMFY_CONFIG: ComfyStudioConfig = {
  studioMode: false,
  defaultWorkflow: 'Moss Image.json',
  companionBrain: 'auto',
  customGgufPath: '',
  keepVramWarm: true,
  enhancePrompt: true,
};

export function createComfySlice(
  set: (partial: any) => void,
  get: () => { apiBaseUrl: string; comfyConfig: ComfyStudioConfig }
): ComfySlice {
  return {
    comfyConfig: DEFAULT_COMFY_CONFIG,
    comfyWorkflows: [],
    comfyCapabilities: null,
    comfyRunning: false,

    setComfyStudioState: (payload) => {
      set((state: ComfySlice) => ({
        comfyConfig: payload.config ? { ...state.comfyConfig, ...payload.config } : state.comfyConfig,
        comfyWorkflows: Array.isArray(payload.workflows) ? payload.workflows : state.comfyWorkflows,
        comfyCapabilities: payload.capabilities !== undefined ? payload.capabilities : state.comfyCapabilities,
        comfyRunning: typeof payload.comfyRunning === 'boolean' ? payload.comfyRunning : state.comfyRunning,
      }));
    },

    updateComfyConfigRemote: async (patch) => {
      const { apiBaseUrl, comfyConfig } = get();
      const optimistic = { ...comfyConfig, ...patch };
      set({ comfyConfig: optimistic });
      try {
        const res = await fetch(`${apiBaseUrl}/api/comfyui/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          const data = await res.json();
          set({
            comfyConfig: data.config || optimistic,
            comfyCapabilities: data.capabilities || null,
            comfyWorkflows: Array.isArray(data.workflows) ? data.workflows : [],
            comfyRunning: Boolean(data.comfyRunning),
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
  };
}
