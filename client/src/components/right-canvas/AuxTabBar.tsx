import React from 'react';
import { GitCompare, FileText, FolderOpen, Terminal, Users, Network } from 'lucide-react';
import { useArtifactStore, WorkbenchTab } from '../../store/useArtifactStore';

const TABS: Array<{ id: WorkbenchTab; label: string; icon: React.ReactNode }> = [
  { id: 'changes', label: 'Review', icon: <GitCompare className="w-3.5 h-3.5" /> },
  { id: 'plan', label: 'Artifacts', icon: <FileText className="w-3.5 h-3.5" /> },
  { id: 'editor', label: 'Files', icon: <FolderOpen className="w-3.5 h-3.5" /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal className="w-3.5 h-3.5" /> },
  { id: 'subagents', label: 'Subagents', icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'swarm', label: 'Swarm', icon: <Network className="w-3.5 h-3.5" /> },
];

/** Compact, wrap-friendly Antigravity 2.0 right-pane tab bar wired to useArtifactStore.activeTab. */
export const AuxTabBar: React.FC = () => {
  const activeTab = useArtifactStore((s) => s.activeTab);
  const setActiveTab = useArtifactStore((s) => s.setActiveTab);

  return (
    <div
      role="tablist"
      className="flex flex-wrap items-center gap-1 p-1.5 bg-[#18181B] border border-[#26262A] rounded-xl shrink-0 select-none"
    >
      {TABS.map((t) => {
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={t.label}
            onClick={() => setActiveTab(isActive ? 'none' : t.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] whitespace-nowrap transition-colors cursor-pointer ${
              isActive
                ? 'bg-[#26262A] text-[#E3E3E3] font-medium border border-[#38393F]'
                : 'text-[#8E8E93] hover:bg-[#202024] hover:text-[#E3E3E3] border border-transparent'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
};
