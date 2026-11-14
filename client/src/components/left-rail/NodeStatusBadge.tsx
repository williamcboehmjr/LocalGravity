import React, { useState } from 'react';
import { Cpu, HardDrive, Plug, Zap, RefreshCw, Settings, ChevronUp, ChevronDown } from 'lucide-react';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { useSessionStore, getGoogleModelOption } from '../../store/useSessionStore';

interface NodeStatusBadgeProps {
  onOpenSettings?: () => void;
}

export const NodeStatusBadge: React.FC<NodeStatusBadgeProps> = ({ onOpenSettings }) => {
  const {
    vramUsedGb,
    vramTotalGb,
    vramPercent,
    hostRamUsedGb,
    hostRamTotalGb,
    tokensPerSec,
    lastSwapDurationMs,
    mcpServers,
    setMcpServers,
  } = useTelemetryStore();

  const {
    isConnected,
    activeModelName,
    apiBaseUrl,
    brainHost,
    brainPort,
    brainProvider,
    selectedGoogleModel,
  } = useSessionStore();

  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggleMcp = async (serverName: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/mcp/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.servers) setMcpServers(data.servers);
      }
    } catch {
      setMcpServers(
        mcpServers.map((s) => (s.name === serverName ? { ...s, enabled: !s.enabled } : s))
      );
    }
  };



  const handlePrewarmSysRam = async () => {
    try {
      await fetch(`${apiBaseUrl}/api/tabby/prewarm`, { method: 'POST' });
    } catch {}
  };

  return (
    <div className="pt-2 border-t border-[#222225] text-xs shrink-0 select-none">
      {/* Expandable Hardware Telemetry Drawer */}
      {isExpanded && (
        <div className="mb-2 p-2.5 rounded-xl bg-[#1A1A1D] border border-[#28282C] space-y-2.5 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[#E3E3E3] text-[11px] truncate">
              {isConnected ? `Connected (${brainHost}:${brainPort})` : `Offline (${brainHost}:${brainPort})`}
            </span>
            <span className="font-mono text-[10px] text-[#9A9A9E] bg-[#242428] px-1.5 py-0.5 rounded">
              {tokensPerSec.toFixed(1)} tok/s
            </span>
          </div>

          {/* Active Model Pill */}
          <div className="px-2 py-1.5 rounded-lg bg-[#131314] border border-[#242427] flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <Zap className="w-3 h-3 text-[#9A9A9E] shrink-0" />
              <span className="font-mono text-[10px] text-[#E3E3E3] truncate" title={activeModelName}>
                {activeModelName}
              </span>
            </div>
            <span className="text-[10px] font-mono text-[#6E6E73] shrink-0 ml-1">
              {lastSwapDurationMs}ms
            </span>
          </div>

          {/* VRAM & SysRAM Bars */}
          <div className="space-y-1.5">
            <div>
              <div className="flex justify-between text-[10px] text-[#8E8E93] mb-0.5">
                <span className="flex items-center gap-1">
                  <Cpu className="w-3 h-3" />
                  <span>VRAM (Swift 1.5)</span>
                </span>
                <span className="font-mono text-[#E3E3E3]">
                  {vramUsedGb.toFixed(1)} / {vramTotalGb.toFixed(0)} GB
                </span>
              </div>
              <div className="w-full h-1 bg-[#131314] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#9A9A9E] transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(8, vramPercent))}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[10px] text-[#8E8E93] mb-0.5">
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />
                  <span>SysRAM Cache</span>
                </span>
                <span className="font-mono text-[#E3E3E3]">
                  {hostRamUsedGb.toFixed(0)} / {hostRamTotalGb.toFixed(0)} GB
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1">
                <div className="px-2 py-0.5 rounded text-[9.5px] font-mono flex items-center justify-between border bg-[#262629] border-[#3E3E44] text-[#E3E3E3]">
                  <span className={`font-semibold ${brainProvider === 'google_ai_studio' ? 'text-sky-400' : 'text-emerald-400'}`}>
                    {brainProvider === 'google_ai_studio'
                      ? `Google AI Studio (${getGoogleModelOption(selectedGoogleModel).name})`
                      : 'Swift 1.5 IQ2_XS + Vision'}
                  </span>
                  <span className="text-[#9A9A9E]">
                    {brainProvider === 'google_ai_studio' ? 'API Active' : 'VRAM Active'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* MCP Servers Quick Toggle */}
          <div className="pt-1.5 border-t border-[#242427] space-y-1">
            <div className="flex items-center justify-between text-[10px] text-[#6E6E73]">
              <span className="flex items-center gap-1">
                <Plug className="w-3 h-3" />
                <span>MCP Servers</span>
              </span>
              <button
                type="button"
                onClick={handlePrewarmSysRam}
                className="hover:text-[#E3E3E3]"
                title="Pre-warm SysRAM Cache"
              >
                <RefreshCw className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {mcpServers.map((mcp) => (
                <button
                  key={mcp.name}
                  type="button"
                  onClick={() => handleToggleMcp(mcp.name)}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                    mcp.enabled
                      ? 'bg-[#242428] border-[#38383E] text-[#E3E3E3]'
                      : 'bg-transparent border-[#242427] text-[#6E6E73]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      mcp.enabled ? 'bg-emerald-400' : 'bg-[#55555A]'
                    }`}
                  />
                  <span>{mcp.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Footer Row matching Antigravity Settings Bar */}
      <div className="flex items-center justify-between px-1 py-1">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-2 text-[12.5px] font-medium text-[#9AA0A6] hover:text-white transition-colors py-1.5 px-2 rounded-lg hover:bg-[#1E1F23] cursor-pointer"
          title="Open Settings"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
        </button>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-[#1E1F23] text-[11px] text-[#8E8E93] hover:text-[#E3E3E3] transition-colors cursor-pointer"
          title={`Toggle Node Details (${brainHost})`}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              !isConnected
                ? 'bg-amber-400'
                : brainProvider === 'google_ai_studio'
                ? 'bg-sky-400'
                : 'bg-emerald-400'
            }`}
          />
          <span className="truncate max-w-[100px]">
            {!isConnected
              ? 'Offline'
              : brainProvider === 'google_ai_studio'
              ? 'Google AI'
              : 'Local GPU'}
          </span>
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-[#6E6E73]" />
          ) : (
            <ChevronUp className="w-3 h-3 text-[#6E6E73]" />
          )}
        </button>
      </div>
    </div>
  );
};
