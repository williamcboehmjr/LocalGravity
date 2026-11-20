import os from 'node:os';
import { execFile } from 'node:child_process';
import type { ModelTier } from '../db/database.js';
import { TIER_SPECS } from '../tabby/tabbyEngine.js';

export interface HostHardwareTelemetry {
  vramUsedGb: number;
  vramTotalGb: number;
  vramPercent: number;
  hostRamUsedGb: number;
  hostRamTotalGb: number;
  hostRamPercent: number;
  gpuUtilization: number;
  cpuUtilization: number;
}

interface CachedGpuMetrics {
  vramUsedGb: number;
  vramTotalGb: number;
  gpuUtil: number;
  updatedAt: number;
}

let cachedGpu: CachedGpuMetrics | null = null;
let gpuProbeInFlight = false;

function triggerAsyncGpuProbe(): void {
  if (gpuProbeInFlight) return;
  if (cachedGpu && Date.now() - cachedGpu.updatedAt < 1800) return;
  gpuProbeInFlight = true;
  try {
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'],
      { timeout: 1000, windowsHide: true },
      (err, stdout) => {
        gpuProbeInFlight = false;
        if (err || !stdout) return;
        const firstLine = stdout.toString().trim().split(/\r?\n/)[0];
        if (!firstLine) return;
        const [usedMb, totalMb, util] = firstLine.split(',').map((s) => Number(s.trim()));
        if (!Number.isNaN(usedMb) && !Number.isNaN(totalMb) && totalMb > 0) {
          cachedGpu = {
            vramUsedGb: Number((usedMb / 1024).toFixed(1)),
            vramTotalGb: Number((totalMb / 1024).toFixed(1)),
            gpuUtil: Number.isNaN(util) ? 12 : util,
            updatedAt: Date.now(),
          };
        }
      }
    );
  } catch {
    gpuProbeInFlight = false;
  }
}

export function queryHostHardwareTelemetry(activeTier: ModelTier): HostHardwareTelemetry {
  const totalMemGb = Number((os.totalmem() / 1024 ** 3).toFixed(1));
  const freeMemGb = Number((os.freemem() / 1024 ** 3).toFixed(1));
  const usedMemGb = Number((totalMemGb - freeMemGb).toFixed(1));
  const hostRamPercent = Math.round((usedMemGb / Math.max(1, totalMemGb)) * 100);

  triggerAsyncGpuProbe();

  let vramTotalGb = 16.0;
  let vramUsedGb = TIER_SPECS[activeTier]?.estimatedVramGb ?? 12.0;
  let gpuUtil = 12;

  if (cachedGpu) {
    vramUsedGb = cachedGpu.vramUsedGb;
    vramTotalGb = cachedGpu.vramTotalGb;
    gpuUtil = cachedGpu.gpuUtil;
  } else if (os.platform() === 'linux') {
    vramTotalGb = totalMemGb;
    vramUsedGb = usedMemGb;
  }

  return {
    vramUsedGb,
    vramTotalGb,
    vramPercent: Math.round((vramUsedGb / Math.max(1, vramTotalGb)) * 100),
    hostRamUsedGb: usedMemGb,
    hostRamTotalGb: totalMemGb,
    hostRamPercent,
    gpuUtilization: gpuUtil,
    cpuUtilization: Math.min(100, Math.max(4, Math.round(os.loadavg()[0] * 10) || 14)),
  };
}
