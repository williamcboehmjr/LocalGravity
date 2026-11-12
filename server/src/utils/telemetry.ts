import os from 'node:os';
import { execSync } from 'node:child_process';
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

export function queryHostHardwareTelemetry(activeTier: ModelTier): HostHardwareTelemetry {
  const totalMemGb = Number((os.totalmem() / 1024 ** 3).toFixed(1));
  const freeMemGb = Number((os.freemem() / 1024 ** 3).toFixed(1));
  const usedMemGb = Number((totalMemGb - freeMemGb).toFixed(1));
  const hostRamPercent = Math.round((usedMemGb / Math.max(1, totalMemGb)) * 100);

  let vramTotalGb = 16.0;
  let vramUsedGb = TIER_SPECS[activeTier].estimatedVramGb;
  let gpuUtil = 12;

  try {
    const smi = execSync(
      'nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits',
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 800, windowsHide: true }
    )
      .toString()
      .trim()
      .split('\n')[0];
    if (smi) {
      const [usedMb, totalMb, util] = smi.split(',').map((s) => Number(s.trim()));
      if (!Number.isNaN(usedMb) && !Number.isNaN(totalMb) && totalMb > 0) {
        vramUsedGb = Number((usedMb / 1024).toFixed(1));
        vramTotalGb = Number((totalMb / 1024).toFixed(1));
        gpuUtil = Number.isNaN(util) ? 12 : util;
      }
    }
  } catch {
    // Use estimated tier VRAM on systems where nvidia-smi isn't in PATH
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
