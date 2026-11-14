import fs from 'node:fs';
import path from 'node:path';

export type ProviderKind =
  | 'strata'
  | 'ollama'
  | 'llamacpp'
  | 'tabbyapi'
  | 'openai_compatible'
  | 'google_ai_studio';

export interface ProviderProfile {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  models: string[];
  isLocal: boolean;
  enabled: boolean;
}

interface ProviderRegistryState {
  activeProviderId: string;
  profiles: ProviderProfile[];
}

const DEFAULT_PROFILES: ProviderProfile[] = [
  {
    id: 'strata',
    name: 'Strata Local Engine',
    kind: 'strata',
    baseUrl: 'http://127.0.0.1:8080/v1',
    defaultModel: 'Swift-1.5-Qwen3.8-Flash-Next',
    models: ['Swift-1.5-Qwen3.8-Flash-Next'],
    isLocal: true,
    enabled: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen3:8b',
    models: ['qwen3:8b', 'qwen2.5-coder:14b'],
    isLocal: true,
    enabled: false,
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp Server (Local)',
    kind: 'llamacpp',
    baseUrl: 'http://127.0.0.1:8081/v1',
    defaultModel: 'local-gguf',
    models: ['local-gguf'],
    isLocal: true,
    enabled: false,
  },
  {
    id: 'tabbyapi',
    name: 'TabbyAPI (Local ExLlamaV2)',
    kind: 'tabbyapi',
    baseUrl: 'http://127.0.0.1:5000/v1',
    defaultModel: 'local-exl2',
    models: ['local-exl2'],
    isLocal: true,
    enabled: false,
  },
  {
    id: 'google_ai_studio',
    name: 'Google AI Studio (Cloud Optional)',
    kind: 'google_ai_studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    isLocal: false,
    enabled: false,
  },
];

export class ProviderRegistry {
  private filePath: string;
  private state: ProviderRegistryState;

  constructor(repoRoot: string) {
    this.filePath = path.join(repoRoot, '.runtime', 'providers.json');
    this.state = {
      activeProviderId: 'strata',
      profiles: DEFAULT_PROFILES.map((p) => ({ ...p, models: [...p.models] })),
    };
    this.load();
  }

  public load(): ProviderRegistryState {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (parsed && Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
          this.state = {
            activeProviderId: String(parsed.activeProviderId || 'strata'),
            profiles: parsed.profiles,
          };
          return this.state;
        }
      }
    } catch {}
    return this.state;
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[ProviderRegistry] Failed to persist providers:', err);
    }
  }

  public listProfiles(): ProviderProfile[] {
    return this.state.profiles.map((p) => ({
      ...p,
      apiKey: p.apiKey ? '***configured***' : undefined,
    }));
  }

  public getActiveProfile(): ProviderProfile {
    return (
      this.state.profiles.find((p) => p.id === this.state.activeProviderId) ||
      this.state.profiles[0]
    );
  }

  public setActiveProfile(id: string): ProviderProfile {
    const found = this.state.profiles.find((p) => p.id === id);
    if (!found) {
      throw new Error(`Provider profile "${id}" not found`);
    }
    found.enabled = true;
    this.state.activeProviderId = found.id;
    this.save();
    return found;
  }

  public upsertProfile(profile: ProviderProfile): ProviderProfile[] {
    const idx = this.state.profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      const existing = this.state.profiles[idx];
      this.state.profiles[idx] = {
        ...existing,
        ...profile,
        apiKey: profile.apiKey === '***configured***' ? existing.apiKey : profile.apiKey,
      };
    } else {
      this.state.profiles.push(profile);
    }
    this.save();
    return this.listProfiles();
  }

  public async probeProfileHealth(id: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const profile = this.state.profiles.find((p) => p.id === id);
    if (!profile) {
      return { ok: false, latencyMs: 0, error: `Unknown provider "${id}"` };
    }
    const start = performance.now();
    try {
      const targetUrl = profile.baseUrl.replace(/\/$/, '') + '/models';
      const headers: Record<string, string> = {};
      if (profile.apiKey) headers['Authorization'] = `Bearer ${profile.apiKey}`;
      const res = await fetch(targetUrl, {
        headers,
        signal: AbortSignal.timeout(4000),
      });
      return {
        ok: res.ok,
        latencyMs: Math.round(performance.now() - start),
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        error: err?.message || 'Connection failed',
      };
    }
  }
}
