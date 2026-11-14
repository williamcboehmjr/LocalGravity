import React, { useEffect, useState } from 'react';
import { Puzzle, Plug, Sparkles, RefreshCw, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

interface McpServerItem {
  name: string;
  transport: string;
  enabled: boolean;
  status: 'connected' | 'ready' | 'disabled' | 'error';
  toolsCount: number;
}

interface SkillItem {
  name: string;
  description: string;
  rootType: 'user' | 'builtin' | 'workspace';
}

export const ExtensionsTab: React.FC = () => {
  const apiBaseUrl = useSessionStore((s) => s.apiBaseUrl);
  const [servers, setServers] = useState<McpServerItem[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [skillContent, setSkillContent] = useState<Record<string, string>>({});

  const loadExtensions = async () => {
    setLoading(true);
    try {
      const [mcpRes, skillRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/mcp/servers`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiBaseUrl}/api/skills`).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (mcpRes?.servers) setServers(mcpRes.servers);
      if (skillRes?.skills) setSkills(skillRes.skills);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadExtensions();
  }, [apiBaseUrl]);

  const handleToggleMcp = async (serverName: string, nextEnabled: boolean) => {
    setToggling(serverName);
    try {
      const res = await fetch(`${apiBaseUrl}/api/mcp/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName, enabled: nextEnabled }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.servers) setServers(data.servers);
      }
    } catch {
    } finally {
      setToggling(null);
    }
  };

  const handleInspectSkill = async (name: string) => {
    if (expandedSkill === name) {
      setExpandedSkill(null);
      return;
    }
    setExpandedSkill(name);
    if (!skillContent[name]) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/skills/${encodeURIComponent(name)}`);
        if (res.ok) {
          const data = await res.json();
          setSkillContent((prev) => ({
            ...prev,
            [name]: data?.content || data?.description || 'No details available.',
          }));
        }
      } catch {}
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-3.5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-[#E3E3E3]">
          <Puzzle className="w-3.5 h-3.5 text-[#8AB4F8]" />
          <span>Extensions, MCP & Skills</span>
        </div>
        <button
          type="button"
          onClick={() => void loadExtensions()}
          className="p-1 rounded-md text-[#8E8E93] hover:text-[#E3E3E3] hover:bg-[#22242A] cursor-pointer"
          title="Refresh extensions"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* MCP Servers */}
      <section className="space-y-2">
        <div className="flex items-center justify-between text-[11.5px] font-medium text-[#9AA0A6]">
          <span className="inline-flex items-center gap-1.5">
            <Plug className="w-3 h-3" />
            <span>MCP Servers</span>
          </span>
          <span className="font-mono text-[10.5px] text-[#6E6E73]">{servers.length}</span>
        </div>

        {loading && servers.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-[#6E6E73] py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Loading MCP servers...</span>
          </div>
        ) : servers.length === 0 ? (
          <div className="text-xs text-[#6E6E73] py-1">No MCP servers configured.</div>
        ) : (
          <div className="space-y-1.5">
            {servers.map((srv) => (
              <div
                key={srv.name}
                className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#141518] border border-[#24262B]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        !srv.enabled
                          ? 'bg-[#52525B]'
                          : srv.status === 'error'
                          ? 'bg-rose-400'
                          : 'bg-emerald-400'
                      }`}
                    />
                    <span className="text-[12.5px] font-medium text-[#E3E3E3] truncate">
                      {srv.name}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#71717A] pl-3.5">
                    {srv.toolsCount} tools · {srv.transport}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={toggling === srv.name}
                  onClick={() => void handleToggleMcp(srv.name, !srv.enabled)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer shrink-0 ${
                    srv.enabled
                      ? 'bg-[#8AB4F8]/15 text-[#8AB4F8] border border-[#8AB4F8]/30 hover:bg-[#8AB4F8]/25'
                      : 'bg-[#1F2127] text-[#8E8E93] border border-[#2C2E35] hover:text-[#E3E3E3]'
                  }`}
                >
                  {toggling === srv.name ? '...' : srv.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Skills */}
      <section className="space-y-2">
        <div className="flex items-center justify-between text-[11.5px] font-medium text-[#9AA0A6]">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            <span>Installed Skills</span>
          </span>
          <span className="font-mono text-[10.5px] text-[#6E6E73]">{skills.length}</span>
        </div>

        {skills.length === 0 && !loading ? (
          <div className="text-xs text-[#6E6E73] py-1">No skills discovered.</div>
        ) : (
          <div className="space-y-1">
            {skills.map((sk) => {
              const isOpen = expandedSkill === sk.name;
              return (
                <div
                  key={sk.name}
                  className="rounded-lg bg-[#141518] border border-[#24262B] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => void handleInspectSkill(sk.name)}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-[#1A1B20] transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-medium text-[#E3E3E3] truncate">
                          {sk.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#22242A] text-[#8E8E93] shrink-0">
                          {sk.rootType}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#71717A] truncate mt-0.5">{sk.description}</p>
                    </div>
                    {isOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <pre className="px-2.5 py-2 border-t border-[#202227] text-[11px] font-mono text-[#A1A1AA] whitespace-pre-wrap max-h-48 overflow-y-auto bg-[#0F1013]">
                      {skillContent[sk.name] || 'Loading...'}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
