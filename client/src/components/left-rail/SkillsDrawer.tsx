import React, { useState, useEffect, useCallback } from 'react';
import {
  Wrench,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Plug,
} from 'lucide-react';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { useSessionStore } from '../../store/useSessionStore';

export const SkillsDrawer: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [isReloading, setIsReloading] = useState(false);
  const { mcpServers, setMcpServers } = useTelemetryStore();
  const { apiBaseUrl } = useSessionStore();

  const [skills, setSkills] = useState<Array<{ name: string; description: string; rootType: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setIsReloading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/skills`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSkills(Array.isArray(data.skills) ? data.skills : []);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load skills');
    } finally {
      setIsReloading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleReload = () => {
    loadSkills();
  };

  const handleToggleMcp = async (serverName: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/mcp/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName, enabled: !currentEnabled }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.servers) setMcpServers(data.servers);
      }
    } catch {}
  };

  return (
    <div className="border-t border-[#222225] pt-2 space-y-1.5 select-none">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between p-1 text-xs text-[#8E8E93] hover:text-[#E3E3E3] cursor-pointer"
      >
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[10.5px]">
          <Wrench className="w-3.5 h-3.5 text-[#8AB4F8]" />
          <span>Skills, Tools & MCP</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleReload();
            }}
            className={`p-1 hover:text-[#8AB4F8] transition-transform ${
              isReloading ? 'animate-spin text-[#8AB4F8]' : ''
            }`}
            title="Reload skills & tools"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </div>
      </div>

      {isOpen && (
        <div className="space-y-1 pl-1">
          {loadError && (
            <div className="px-2 py-1 text-[10.5px] text-[#F28B82]">Skills unavailable: {loadError}</div>
          )}
          {!loadError && skills.length === 0 && !isReloading && (
            <div className="px-2 py-1 text-[10.5px] text-[#6E6E73]">No skills discovered</div>
          )}
          {skills.map((s) => (
            <div
              key={`${s.rootType}:${s.name}`}
              title={s.description}
              className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-[#1C1C1F] text-xs text-[#9A9A9E] hover:text-[#E3E3E3]"
            >
              <div className="flex items-center gap-2 truncate">
                <Sparkles className="w-3 h-3 text-[#8AB4F8]" />
                <span className="font-mono text-[11px] truncate">{s.name}</span>
              </div>
              <span className="text-[9.5px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#18181B] border border-[#2C2C30] text-[#8E8E93]">
                {s.rootType}
              </span>
            </div>
          ))}
          {mcpServers.length > 0 && (
            <div className="pt-1 mt-1 border-t border-[#1E1E22] space-y-1">
              {mcpServers.map((mcp) => (
                <div
                  key={mcp.name}
                  onClick={() => handleToggleMcp(mcp.name, mcp.enabled)}
                  className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-[#1C1C1F] text-xs text-[#9A9A9E] hover:text-[#E3E3E3] cursor-pointer"
                  title="Click to toggle MCP server"
                >
                  <div className="flex items-center gap-2 truncate">
                    <Plug className="w-3 h-3 text-[#C084FC]" />
                    <span className="font-mono text-[11px] truncate">mcp:{mcp.name}</span>
                  </div>
                  <span
                    className={`text-[9.5px] uppercase font-mono px-1.5 py-0.5 rounded border ${
                      mcp.enabled
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-[#18181B] border-[#2C2C30] text-[#5E5E63]'
                    }`}
                  >
                    {mcp.enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
