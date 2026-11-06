import React from 'react';
import { Cpu, HardDrive, Plug, Zap, RefreshCw } from 'lucide-react';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { useSessionStore } from '../../store/useSessionStore';
import { ModelTier } from '../../types/protocol';

export const NodeStatusBadge: React.FC = () => {
  const {
    vramUsedGb,
    vramTotalGb,
    vramPercent,
    hostRamUsedGb,
    hostRamTotalGb,
    tokensPerSec,
    lastSwapDurationMs,
    sysramCache,
    mcpServers,
    setMcpServers,
  } = useTelemetryStore();

  const { isConnected, activeModelName, selectedTier, apiBaseUrl } = useSessionStore();

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

  const tiers: ModelTier[] = ['low', 'medium', 'high'];

  return (
    <div className="p-2.5 rounded-xl bg-[#1C2029] border border-[#262B36] space-y-2.5 text-xs shrink-0">
      {/* Header: TabbyAPI Connection & Active VRAM Model */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isConnected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400 animate-pulse'
            }`}
          />
          <span className="font-semibold text-[#E8EAED] truncate text-[11px]">
            TabbyAPI EXL3 • Q4 KV
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#8AB4F8] bg-[#8AB4F8]/10 px-1.5 py-0.5 rounded border border-[#8AB4F8]/30">
          {tokensPerSec.toFixed(1)} tok/s
        </span>
      </div>

      {/* Active Model Pill */}
      <div className="px-2 py-1.5 rounded-lg bg-[#111318] border border-[#262B36] flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <Zap className="w-3.5 h-3.5 text-[#8AB4F8] shrink-0" />
          <span className="font-mono text-[11px] text-[#E8EAED] truncate" title={activeModelName}>
            {activeModelName}
          </span>
        </div>
        <span className="text-[10px] font-mono text-[#9AA0A6] shrink-0 ml-1">
          {lastSwapDurationMs}ms swap
        </span>
      </div>

      {/* VRAM & 128GB SysRAM Bars */}
      <div className="space-y-1.5">
        <div>
          <div className="flex justify-between text-[10px] text-[#9AA0A6] mb-0.5">
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3 text-[#8AB4F8]" />
              <span>VRAM ({selectedTier.toUpperCase()})</span>
            </span>
            <span className="font-mono text-[#E8EAED]">
              {vramUsedGb.toFixed(1)} / {vramTotalGb.toFixed(0)} GB
            </span>
          </div>
          <div className="w-full h-1.5 bg-[#111318] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#1A73E8] to-[#8AB4F8] transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(8, vramPercent))}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-[10px] text-[#9AA0A6] mb-0.5">
            <span className="flex items-center gap-1">
              <HardDrive className="w-3 h-3 text-[#C58AF9]" />
              <span>SysRAM Hot-Swap Cache</span>
            </span>
            <span className="font-mono text-[#E8EAED]">
              {hostRamUsedGb.toFixed(0)} / {hostRamTotalGb.toFixed(0)} GB
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 pt-0.5">
            {tiers.map((t) => {
              const item = sysramCache?.[t];
              const isVram = t === selectedTier || item?.state === 'vram_active';
              const isWarm = item?.state === 'warm';
              return (
                <button
                  key={t}
                  type="button"
                  onClick={handlePrewarmSysRam}
                  title={`Tier ${t.toUpperCase()}: ${item?.state || 'warm'} (${item?.throughputMBps || 2400} MB/s)`}
                  className={`px-1.5 py-1 rounded text-[10px] font-mono flex items-center justify-between border transition-colors ${
                    isVram
                      ? 'bg-[#8AB4F8]/15 border-[#8AB4F8]/50 text-[#8AB4F8] font-semibold'
                      : isWarm
                      ? 'bg-[#111318] border-emerald-500/30 text-emerald-300'
                      : 'bg-[#111318] border-[#262B36] text-[#5F6368]'
                  }`}
                >
                  <span className="uppercase">{t === 'medium' ? 'MED' : t}</span>
                  <span className="text-[9px]">{isVram ? 'VRAM' : 'RAM'}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Toggleable MCP Server Pills */}
      <div className="pt-1.5 border-t border-[#262B36]">
        <div className="flex items-center justify-between text-[10px] text-[#9AA0A6] mb-1.5">
          <span className="flex items-center gap-1 font-medium">
            <Plug className="w-3 h-3 text-[#8AB4F8]" />
            <span>MCP Servers</span>
          </span>
          <button
            type="button"
            onClick={handlePrewarmSysRam}
            className="text-[#5F6368] hover:text-[#E8EAED] transition-colors"
            title="Refresh SysRAM Cache & MCP Discovery"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {mcpServers.map((srv) => (
            <button
              key={srv.name}
              type="button"
              onClick={() => handleToggleMcp(srv.name)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono flex items-center gap-1 border transition-all cursor-pointer ${
                srv.enabled
                  ? 'bg-[#8AB4F8]/15 border-[#8AB4F8]/40 text-[#E8EAED]'
                  : 'bg-[#111318] border-[#262B36] text-[#5F6368] line-through'
              }`}
              title={`Click to ${srv.enabled ? 'disable' : 'enable'} MCP server: ${srv.name} (${srv.toolsCount} tools)`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  srv.enabled ? 'bg-emerald-400' : 'bg-[#5F6368]'
                }`}
              />
              <span>{srv.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
