import React, { useState } from 'react';
import { Wrench, RefreshCw, Terminal, GitBranch, Search, ChevronRight, ChevronDown } from 'lucide-react';

export const SkillsDrawer: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [isReloading, setIsReloading] = useState(false);

  const skills = [
    { name: 'run_command', type: 'core', desc: 'OS shell runner (Reverse-RPC)', icon: <Terminal className="w-3 h-3 text-emerald-400" /> },
    { name: 'workspace_search', type: 'skill', desc: 'Fast file and AST grep', icon: <Search className="w-3 h-3 text-cyan-400" /> },
    { name: 'git_workflow', type: 'skill', desc: 'Diff inspection & staging', icon: <GitBranch className="w-3 h-3 text-amber-400" /> },
  ];

  const handleReload = () => {
    setIsReloading(true);
    setTimeout(() => setIsReloading(false), 600);
  };

  return (
    <div className="border-t border-border-subtle pt-2 space-y-1">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between p-1 text-xs text-text-muted hover:text-text-primary cursor-pointer select-none"
      >
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[11px]">
          <Wrench className="w-3.5 h-3.5 text-accent-blue" />
          <span>Skills & MCP</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleReload();
            }}
            className={`p-1 hover:text-accent-blue transition-transform ${isReloading ? 'animate-spin text-accent-blue' : ''}`}
            title="Reload skills"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>
      </div>

      {isOpen && (
        <div className="space-y-1 pl-1">
          {skills.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between p-1.5 rounded hover:bg-surface-muted text-xs text-text-secondary hover:text-text-primary"
            >
              <div className="flex items-center gap-2 truncate">
                {s.icon}
                <span className="font-mono text-[11px] truncate">{s.name}</span>
              </div>
              <span className="text-[10px] uppercase font-mono px-1 rounded bg-surface border border-border-subtle/50 text-text-muted">
                {s.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
