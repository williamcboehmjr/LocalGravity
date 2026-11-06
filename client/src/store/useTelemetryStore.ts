import { create } from 'zustand';
import { ModelTier } from '../types/protocol';

export interface SysRamWarmItem {
  tier: ModelTier;
  modelName: string;
  state: 'cold' | 'warming' | 'warm' | 'vram_active';
  bytesWarmed: number;
  totalBytes: number;
  filesCount: number;
  throughputMBps: number;
  lastWarmedAt: string | null;
}

export interface McpServerStatusItem {
  name: string;
  transport: 'stdio' | 'sse';
  command: string;
  args: string[];
  enabled: boolean;
  status: 'connected' | 'ready' | 'disabled' | 'error';
  toolsCount: number;
}

interface TelemetryState {
  vramUsedGb: number;
  vramTotalGb: number;
  vramPercent: number;
  hostRamUsedGb: number;
  hostRamTotalGb: number;
  hostRamPercent: number;
  gpuUtilization: number;
  cpuUtilization: number;
  rttLatencyMs: number;
  activeTier: ModelTier;
  activeModel: string;
  tokensPerSec: number;
  lastSwapDurationMs: number;
  tabbyConnected: boolean;
  tabbyUrl: string;
  daemonPort: number;
  tabbyPort: number;
  lanUrl: string;
  sysramCache: Record<ModelTier, SysRamWarmItem>;
  mcpServers: McpServerStatusItem[];

  setTelemetry: (data: Partial<TelemetryState>) => void;
  setRttLatency: (ms: number) => void;
  setMcpServers: (servers: McpServerStatusItem[]) => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  vramUsedGb: 6.8,
  vramTotalGb: 16.0,
  vramPercent: 42,
  hostRamUsedGb: 24.5,
  hostRamTotalGb: 128.0,
  hostRamPercent: 19,
  gpuUtilization: 12,
  cpuUtilization: 8,
  rttLatencyMs: 2,
  activeTier: 'medium',
  activeModel: 'Qwen3.5-9B-EXL3-4.0bpw',
  tokensPerSec: 74.2,
  lastSwapDurationMs: 840,
  tabbyConnected: true,
  tabbyUrl: 'http://127.0.0.1:3450',
  daemonPort: 3390,
  tabbyPort: 3450,
  lanUrl: 'http://127.0.0.1:3390',
  sysramCache: {
    low: {
      tier: 'low',
      modelName: 'Qwen3.5-4B-EXL3-4.5bpw',
      state: 'warm',
      bytesWarmed: 67108864,
      totalBytes: 3650722201,
      filesCount: 1,
      throughputMBps: 2480.0,
      lastWarmedAt: null,
    },
    medium: {
      tier: 'medium',
      modelName: 'Qwen3.5-9B-EXL3-4.0bpw',
      state: 'vram_active',
      bytesWarmed: 0,
      totalBytes: 7301444403,
      filesCount: 1,
      throughputMBps: 0,
      lastWarmedAt: null,
    },
    high: {
      tier: 'high',
      modelName: 'Qwen-3.8-27B-VL-EXL3-3.5bpw',
      state: 'warm',
      bytesWarmed: 67108864,
      totalBytes: 15676630630,
      filesCount: 2,
      throughputMBps: 2610.0,
      lastWarmedAt: null,
    },
  },
  mcpServers: [
    {
      name: 'local-fetch',
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      enabled: true,
      status: 'ready',
      toolsCount: 1,
    },
    {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
      enabled: true,
      status: 'ready',
      toolsCount: 2,
    },
  ],

  setTelemetry: (data) => set((state) => ({ ...state, ...data })),
  setRttLatency: (ms) => set({ rttLatencyMs: ms }),
  setMcpServers: (servers) => set({ mcpServers: servers }),
}));
