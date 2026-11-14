import React, { useState } from 'react';
import {
  FileDiff,
  File,
  Terminal,
  Puzzle,
  ChevronRight,
  MoreVertical,
  FileText,
  BookOpen,
  ListChecks,
} from 'lucide-react';
import { useArtifactStore, ArtifactRecord } from '../../store/useArtifactStore';
import { useSessionStore } from '../../store/useSessionStore';

interface OverviewSidebarProps {
  onCloseDrawer?: () => void;
}

const DEFAULT_ARTIFACTS_SHOWN = 4;

function getArtifactIcon(type: string) {
  const t = (type || '').toLowerCase();
  if (t === 'walkthrough') return <BookOpen className="w-4 h-4 text-[#9AA0A6] shrink-0" />;
  if (t === 'task') return <ListChecks className="w-4 h-4 text-[#9AA0A6] shrink-0" />;
  return <FileText className="w-4 h-4 text-[#9AA0A6] shrink-0" />;
}

export const OverviewSidebar: React.FC<OverviewSidebarProps> = ({ onCloseDrawer }) => {
  const {
    artifacts,
    checkpoints,
    setActiveTab,
    setActiveArtifactId,
    setActiveArtifactDoc,
  } = useArtifactStore();
  const subagentTasks = useSessionStore((s) => s.subagentTasks);
  const backgroundTasks = useSessionStore((s) => s.backgroundTasks);

  const [menuOpen, setMenuOpen] = useState(false);
  const [subagentsExpanded, setSubagentsExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [artifactsExpanded, setArtifactsExpanded] = useState(true);
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);

  const visibleArtifacts = showAllArtifacts
    ? artifacts
    : artifacts.slice(0, DEFAULT_ARTIFACTS_SHOWN);

  const openArtifact = (a: ArtifactRecord) => {
    setActiveArtifactId(a.id);
    setActiveArtifactDoc(
      a.type === 'plan'
        ? 'plan.md'
        : a.type === 'walkthrough'
        ? 'walkthrough.md'
        : a.type === 'task'
        ? 'task.md'
        : a.id
    );
    setActiveTab('plan');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#16171A] border border-[#24262B] rounded-xl overflow-hidden select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2 relative">
        <span className="text-[13px] font-medium text-[#9AA0A6]">Overview</span>
        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          className="p-1 rounded-md text-[#8E8E93] hover:text-[#E3E3E3] hover:bg-[#222429] transition-colors cursor-pointer"
          title="More workspace views"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>

        {menuOpen && (
          <div className="absolute right-3 top-10 z-20 w-44 rounded-xl bg-[#1E1F24] border border-[#2E3038] shadow-xl py-1 text-[12.5px] text-[#E3E3E3]">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setActiveTab('swarm');
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#2A2C33] cursor-pointer"
            >
              Swarm Board
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setActiveTab('preview');
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#2A2C33] cursor-pointer"
            >
              Vision Preview
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setActiveTab('harness');
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#2A2C33] cursor-pointer"
            >
              Task Harness
            </button>
            {onCloseDrawer && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onCloseDrawer();
                }}
                className="w-full text-left px-3 py-1.5 text-[#8E8E93] hover:bg-[#2A2C33] hover:text-[#E3E3E3] border-t border-[#2A2C33] mt-1 pt-1.5 cursor-pointer"
              >
                Hide Overview
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-1">
        {/* Primary Navigation Rows */}
        <div className="space-y-0.5 pb-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('changes')}
            className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] text-[#E3E3E3] hover:bg-[#202227] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-3 min-w-0">
              <FileDiff className="w-4 h-4 text-[#9AA0A6] shrink-0" />
              <span className="truncate">Review</span>
            </span>
            {checkpoints.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-[#24262C] text-[#9AA0A6] font-mono">
                {checkpoints.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('editor')}
            className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13.5px] text-[#E3E3E3] hover:bg-[#202227] transition-colors cursor-pointer"
          >
            <File className="w-4 h-4 text-[#9AA0A6] shrink-0" />
            <span className="truncate">Files</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('terminal')}
            className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13.5px] text-[#E3E3E3] hover:bg-[#202227] transition-colors cursor-pointer"
          >
            <Terminal className="w-4 h-4 text-[#9AA0A6] shrink-0" />
            <span className="truncate">Terminal</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('extensions')}
            className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] text-[#E3E3E3] hover:bg-[#202227] transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-3 min-w-0">
              <Puzzle className="w-4 h-4 text-[#9AA0A6] shrink-0" />
              <span className="truncate">Extensions</span>
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-[#71717A] shrink-0" />
          </button>
        </div>

        {/* Subagents (collapsed by default) */}
        <div className="border-t border-[#22242A] pt-2 pb-1">
          <button
            type="button"
            onClick={() => setSubagentsExpanded((prev) => !prev)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#202227] transition-colors cursor-pointer"
          >
            <span className="text-[13px] font-medium text-[#9AA0A6]">Subagents</span>
            <span className="px-1.5 py-0.5 rounded-full text-[11px] font-mono bg-[#23252B] text-[#9AA0A6]">
              {subagentTasks.length}
            </span>
          </button>

          {subagentsExpanded && (
            <div className="mt-1 space-y-0.5 pl-1">
              {subagentTasks.length === 0 ? (
                <div className="px-2.5 py-1.5 text-[12px] text-[#6E6E73]">No subagents yet</div>
              ) : (
                subagentTasks.slice(0, 6).map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setActiveTab('subagents')}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#202227] transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          sub.status === 'running'
                            ? 'bg-sky-400 animate-pulse'
                            : sub.status === 'error'
                            ? 'bg-rose-400'
                            : 'bg-emerald-400'
                        }`}
                      />
                      <span className="text-[12.5px] text-[#D4D4D8] truncate">{sub.role}</span>
                    </span>
                    <span className="text-[10.5px] font-mono text-[#6E6E73] shrink-0">
                      {sub.step}/{sub.maxSteps}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Background Tasks (collapsed by default) */}
        <div className="border-t border-[#22242A] pt-2 pb-1">
          <button
            type="button"
            onClick={() => setTasksExpanded((prev) => !prev)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#202227] transition-colors cursor-pointer"
          >
            <span className="text-[13px] font-medium text-[#9AA0A6]">Background Tasks</span>
            <span className="px-1.5 py-0.5 rounded-full text-[11px] font-mono bg-[#23252B] text-[#9AA0A6]">
              {backgroundTasks.length}
            </span>
          </button>

          {tasksExpanded && (
            <div className="mt-1 space-y-0.5 pl-1">
              {backgroundTasks.length === 0 ? (
                <div className="px-2.5 py-1.5 text-[12px] text-[#6E6E73]">
                  No background tasks
                </div>
              ) : (
                backgroundTasks.slice(0, 6).map((task) => (
                  <button
                    key={task.taskId}
                    type="button"
                    onClick={() => setActiveTab('harness')}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#202227] transition-colors cursor-pointer"
                  >
                    <span className="text-[12.5px] text-[#D4D4D8] truncate">{task.title}</span>
                    <span className="text-[10.5px] font-mono text-[#6E6E73] shrink-0">
                      {task.status}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Artifacts (expanded by default, max 4 shown + See more / See less) */}
        <div className="border-t border-[#22242A] pt-2">
          <button
            type="button"
            onClick={() => setArtifactsExpanded((prev) => !prev)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#202227] transition-colors cursor-pointer"
          >
            <span className="text-[13px] font-medium text-[#9AA0A6]">Artifacts</span>
            <span className="px-1.5 py-0.5 rounded-full text-[11px] font-mono bg-[#23252B] text-[#9AA0A6]">
              {artifacts.length}
            </span>
          </button>

          {artifactsExpanded && (
            <div className="mt-1 space-y-0.5">
              {artifacts.length === 0 ? (
                <div className="px-2.5 py-1.5 text-[12px] text-[#6E6E73]">No artifacts yet</div>
              ) : (
                <>
                  {visibleArtifacts.map((art) => (
                    <button
                      key={art.id}
                      type="button"
                      onClick={() => openArtifact(art)}
                      className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left text-[13.5px] text-[#E3E3E3] hover:bg-[#202227] transition-colors cursor-pointer"
                    >
                      {getArtifactIcon(art.type)}
                      <span className="truncate">{art.title || art.id}</span>
                    </button>
                  ))}

                  {artifacts.length > DEFAULT_ARTIFACTS_SHOWN && (
                    <button
                      type="button"
                      onClick={() => setShowAllArtifacts((prev) => !prev)}
                      className="w-full text-left px-2.5 py-1.5 text-[12.5px] text-[#8E8E93] hover:text-[#E3E3E3] transition-colors cursor-pointer"
                    >
                      {showAllArtifacts ? 'See less' : `See more (${artifacts.length - DEFAULT_ARTIFACTS_SHOWN})`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
