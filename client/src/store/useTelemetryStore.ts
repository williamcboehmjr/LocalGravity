import { create } from 'zustand';
import { ModelTier } from '../types/protocol';

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

  setTelemetry: (data: Partial<TelemetryState>) => void;
  setRttLatency: (ms: number) => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  vramUsedGb: 0.0,
  vramTotalGb: 16.0,
  vramPercent: 0.0,
  hostRamUsedGb: 0.0,
  hostRamTotalGb: 128.0,
  hostRamPercent: 0.0,
  gpuUtilization: 0.0,
  cpuUtilization: 0.0,
  rttLatencyMs: 4,
  activeTier: 'low',
  activeModel: 'qwen3.5:4b',

  setTelemetry: (data) => set((state) => ({ ...state, ...data })),
  setRttLatency: (ms) => set({ rttLatencyMs: ms }),
}));
