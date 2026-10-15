import React from 'react';
import { Cpu, HardDrive, Zap } from 'lucide-react';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { useSessionStore } from '../../store/useSessionStore';

export const NodeStatusBadge: React.FC = () => {
  const { vramUsedGb, vramTotalGb, vramPercent, hostRamUsedGb, hostRamTotalGb, rttLatencyMs } = useTelemetryStore();
  const { isConnected, activeModelName, modelStatus, modelStatusText } = useSessionStore();

  return (
    <div className="p-3 bg-surface border border-border-subtle rounded-lg text-xs space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-medium text-text-primary">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
          <span>Central Brain (Host)</span>
        </div>
        <span className="text-text-muted font-mono">{rttLatencyMs}ms</span>
      </div>

      <div className="flex items-center gap-1 text-text-secondary truncate">
        <Zap className="w-3.5 h-3.5 text-accent-blue shrink-0" />
        <span className="font-mono truncate">{activeModelName}</span>
      </div>

      {modelStatus === 'swapping' && (
        <div className="text-accent-amber font-mono animate-pulse truncate text-[11px]">
          {modelStatusText}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border-subtle/50 text-[11px] text-text-muted">
        <div className="flex items-center gap-1">
          <HardDrive className="w-3 h-3 text-cyan-400" />
          <span>VRAM: {vramUsedGb}/{vramTotalGb}GB ({vramPercent}%)</span>
        </div>
        <div className="flex items-center gap-1">
          <Cpu className="w-3 h-3 text-purple-400" />
          <span>RAM: {hostRamUsedGb}/{hostRamTotalGb}GB</span>
        </div>
      </div>
    </div>
  );
};
