import React, { useState } from 'react';
import {
  Wrench,
  RefreshCw,
  Terminal,
  GitBranch,
  Search,
  ChevronRight,
  ChevronDown,
  Eye,
  Plug,
  ShieldCheck,
} from 'lucide-react';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { useSessionStore } from '../../store/useSessionStore';

export const SkillsDrawer: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [isReloading, setIsReloading] = useState(false);
  const { mcpServers, setMcpServers } = useTelemetryStore();
  const { apiBaseUrl } = useSessionStore();

  const skills = [
    {
      name: 'inspect_models',
      type: 'vision',
      desc: 'Strata Qwen 3.8 Flash-Next & Vision verifier',
      icon: <Eye className="w-3 h-3 text-indigo-400" />,
    },
    {
      name: 'workspace_search',
      type: '19 tools',
      desc: 'Read, write, diff, grep, find_files, symbols',
      icon: <Search className="w-3 h-3 text-cyan-400" />,
    },
    {
      name: 'run_terminal',
      type: 'core',
      desc: 'PowerShell 7 + background tasks',
      icon: <Terminal className="w-3 h-3 text-emerald-400" />,
    },
    {
      name: 'git_workflow',
      type: 'skill',
      desc: 'git_status, git_diff & file checkpoints',
      icon: <GitBranch className="w-3 h-3 text-amber-400" />,
    },
    {
      name: 'harness_ppc',
      type: 'memory',
      desc: 'Propose-Probe-Compose self-learning',
      icon: <ShieldCheck className="w-3 h-3 text-purple-400" />,
    },
  ];

  const handleReload = () => {
    setIsReloading(true);
    setTimeout(() => setIsReloading(false), 600);
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
          {skills.map((s) => (
            <div
              key={s.name}
              title={s.desc}
              className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-[#1C1C1F] text-xs text-[#9A9A9E] hover:text-[#E3E3E3]"
            >
              <div className="flex items-center gap-2 truncate">
                {s.icon}
                <span className="font-mono text-[11px] truncate">{s.name}</span>
              </div>
              <span className="text-[9.5px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#18181B] border border-[#2C2C30] text-[#8E8E93]">
                {s.type}
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
