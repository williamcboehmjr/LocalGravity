import React, { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Loader2,
  History,
  Clock,
  SlidersHorizontal,
  Folder,
  FolderPlus,
  ListFilter,
  Monitor,
} from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

interface SessionListProps {
  onNewThread?: () => void;
  onSelectThread?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onOpenAutomations?: () => void;
  onOpenCustomizations?: () => void;
  searchFilter?: string;
}

export const SessionList: React.FC<SessionListProps> = ({
  onNewThread,
  onSelectThread,
  onDeleteThread,
  onSelectProject,
  onOpenAutomations,
  onOpenCustomizations,
  searchFilter = '',
}) => {
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    setProjects,
    apiBaseUrl,
    localHostName,
    brainHostname,
    edgeHosts,
    sessions,
    sessionId,
    switchSession,
    createNewProject,
    deleteSession,
    renameSession,
    isGenerating,
    workspacePath,
  } = useSessionStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<string | null>(null);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjPath, setNewProjPath] = useState(workspacePath || '.');
  const [viewMode, setViewMode] = useState<'projects' | 'history'>('projects');
  const [localOnly, setLocalOnly] = useState(false);

  // Global Cmd/Ctrl+N shortcut for New Conversation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (onNewThread) onNewThread();
        else createNewProject();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNewThread, createNewProject]);

  const handleStartRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const handleSaveRename = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (editTitle.trim()) {
      const newTitle = editTitle.trim();
      renameSession(id, newTitle);
      fetch(`${apiBaseUrl}/api/threads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      }).catch(() => {});
    }
    setEditingId(null);
  };

  const handleCreateProject = async () => {
    if (!newProjPath.trim()) return;
    const name =
      newProjName.trim() ||
      newProjPath.trim().split(/[/\\]/).filter(Boolean).pop() ||
      'Workspace';
    try {
      const res = await fetch(`${apiBaseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          root_path: newProjPath.trim(),
          host_name: localHostName || brainHostname || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.project) {
          setProjects([data.project, ...projects], data.project.id);
          onSelectProject?.(data.project.id);
        }
      }
    } catch {}
    setIsAddingProject(false);
    setNewProjName('');
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/projects/${projectId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const remaining = projects.filter((p) => p.id !== projectId);
        const nextActive =
          activeProjectId === projectId ? (remaining[0]?.id ?? '') : activeProjectId;
        setProjects(remaining, nextActive || undefined);
        if (activeProjectId === projectId && nextActive) {
          onSelectProject?.(nextActive);
        }
      }
    } catch {}
    setConfirmDeleteProjectId(null);
  };

  const filteredSessions = sessions.filter((s) =>
    !searchFilter.trim()
      ? true
      : s.title.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const renderSessionRow = (s: (typeof sessions)[0]) => {
    const isActive = s.id === sessionId;
    const isRunning =
      (isActive && isGenerating) ||
      s.status === 'thinking' ||
      s.status === 'executing_tool';

    return (
      <div
        key={s.id}
        onClick={() => {
          switchSession(s.id);
          onSelectThread?.(s.id);
        }}
        className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
          isActive
            ? 'bg-[#262629] text-[#E3E3E3] font-medium'
            : 'text-[#8E8E93] hover:bg-[#1C1C1F] hover:text-[#E3E3E3]'
        }`}
      >
        {editingId === s.id ? (
          <div
            className="flex items-center gap-1 flex-1 min-w-0"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename(s.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              autoFocus
              className="w-full bg-[#131314] border border-[#3E3E44] rounded px-1.5 py-0.5 text-xs text-[#E3E3E3] outline-none"
            />
            <button
              type="button"
              onClick={(e) => handleSaveRename(s.id, e)}
              className="p-0.5 text-emerald-400 hover:text-emerald-300"
            >
              <Check className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditingId(null);
              }}
              className="p-0.5 text-[#8E8E93] hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <>
            <span className="truncate flex-1 pr-2">{s.title}</span>

            <div className="flex items-center gap-1 shrink-0">
              {isRunning ? (
                <Loader2 className="w-3.5 h-3.5 text-[#9A9A9E] animate-spin" />
              ) : (
                <span className="text-[11px] text-[#5E5E63] group-hover:hidden">
                  {s.updated}
                </span>
              )}

              <div className="hidden group-hover:flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={(e) => handleStartRename(s.id, s.title, e)}
                  className="p-0.5 rounded hover:bg-[#323236] text-[#8E8E93] hover:text-[#E3E3E3]"
                  title="Rename"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await fetch(`${apiBaseUrl}/api/threads/${s.id}`, { method: 'DELETE' });
                    } catch {}
                    deleteSession(s.id);
                    onDeleteThread?.(s.id);
                  }}
                  className="p-0.5 rounded hover:bg-[#323236] text-[#8E8E93] hover:text-rose-400"
                  title="Delete Conversation"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 select-none">
      {/* + New Conversation Button */}
      <button
        type="button"
        onClick={() => (onNewThread ? onNewThread() : createNewProject())}
        className="w-full py-1.5 px-3 rounded-lg bg-[#1E1E20] hover:bg-[#26262A] border border-[#2C2C30] text-[#E3E3E3] font-medium text-xs flex items-center gap-2 transition-colors cursor-pointer mb-2"
      >
        <Plus className="w-3.5 h-3.5 text-[#9A9A9E]" />
        <span>New Conversation</span>
      </button>

      {/* Top Primary Navigation Links (matching LocalGravity) */}
      <div className="space-y-0.5 mb-2">
        <button
          type="button"
          onClick={() => setViewMode(viewMode === 'history' ? 'projects' : 'history')}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
            viewMode === 'history'
              ? 'bg-[#222226] text-[#E3E3E3]'
              : 'text-[#9A9A9E] hover:bg-[#1A1A1D] hover:text-[#E3E3E3]'
          }`}
        >
          <History className="w-3.5 h-3.5 text-[#8E8E93]" />
          <span>Conversation History</span>
        </button>

        <button
          type="button"
          onClick={onOpenAutomations}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-[#9A9A9E] hover:bg-[#1A1A1D] hover:text-[#E3E3E3] transition-colors"
        >
          <Clock className="w-3.5 h-3.5 text-[#8E8E93]" />
          <span>Automations</span>
        </button>

        <button
          type="button"
          onClick={onOpenCustomizations}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-[#9A9A9E] hover:bg-[#1A1A1D] hover:text-[#E3E3E3] transition-colors"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#8E8E93]" />
          <span>Customizations</span>
        </button>
      </div>

      <div className="border-t border-[#222225] my-1.5" />

      {/* Projects Section Header */}
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[11px] font-medium text-[#6E6E73]">
          {viewMode === 'history' ? 'All Conversations' : 'Projects'}
        </span>
        <div className="flex items-center gap-1">
          {viewMode !== 'history' && (
            <button
              type="button"
              onClick={() => setLocalOnly((v) => !v)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                localOnly
                  ? 'bg-[#8AB4F8]/15 text-[#8AB4F8] border border-[#8AB4F8]/30'
                  : 'text-[#6E6E73] hover:text-[#E3E3E3] hover:bg-[#1E1E20]'
              }`}
              title={localOnly ? 'Showing only this computer' : 'Showing all computers'}
            >
              {localOnly ? 'This PC' : 'All PCs'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'history' ? 'projects' : 'history')}
            className="p-1 rounded hover:bg-[#1E1E20] text-[#6E6E73] hover:text-[#E3E3E3] transition-colors"
            title="Toggle Filter View"
          >
            <ListFilter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsAddingProject(!isAddingProject)}
            className="p-1 rounded hover:bg-[#1E1E20] text-[#6E6E73] hover:text-[#E3E3E3] transition-colors"
            title="Add Project Workspace"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Inline Add Project Form */}
      {isAddingProject && (
        <div className="mx-1 mb-2 p-2.5 rounded-lg bg-[#1A1A1D] border border-[#2C2C30] space-y-2">
          <input
            type="text"
            value={newProjName}
            onChange={(e) => setNewProjName(e.target.value)}
            placeholder="Project name"
            className="w-full bg-[#131314] border border-[#2C2C30] rounded px-2 py-1 text-xs text-[#E3E3E3] outline-none focus:border-[#4E4E54]"
          />
          <input
            type="text"
            value={newProjPath}
            onChange={(e) => setNewProjPath(e.target.value)}
            placeholder="Workspace path (e.g. C:\Projects\App)"
            className="w-full bg-[#131314] border border-[#2C2C30] rounded px-2 py-1 text-xs font-mono text-[#E3E3E3] outline-none focus:border-[#4E4E54]"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setIsAddingProject(false)}
              className="px-2 py-1 rounded text-[11px] text-[#8E8E93] hover:text-[#E3E3E3]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateProject}
              className="px-2.5 py-1 rounded bg-[#28282C] hover:bg-[#323238] text-[#E3E3E3] text-[11px] font-medium"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Scrollable Projects & Conversations Tree */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-0.5 pt-0.5">
        {viewMode === 'history' ? (
          <div className="space-y-0.5">
            {filteredSessions.map((s) => renderSessionRow(s))}
          </div>
        ) : (
          (() => {
            const myHost = (localHostName || brainHostname || '').trim().toLowerCase();
            const isHostOnline = (host: string) => {
              const h = host.trim().toLowerCase();
              if (!h || h === brainHostname.trim().toLowerCase()) return true;
              return edgeHosts.some((e) => e.hostname.trim().toLowerCase() === h);
            };
            const hostMap = new Map<string, typeof projects>();
            for (const p of projects) {
              const owner = (p.host_name || brainHostname || 'Local').trim();
              if (localOnly && myHost && owner.toLowerCase() !== myHost) continue;
              const arr = hostMap.get(owner) || [];
              arr.push(p);
              hostMap.set(owner, arr);
            }
            const sortedHosts = Array.from(hostMap.keys()).sort((a, b) => {
              const aLocal = myHost && a.toLowerCase() === myHost;
              const bLocal = myHost && b.toLowerCase() === myHost;
              if (aLocal && !bLocal) return -1;
              if (!aLocal && bLocal) return 1;
              return a.localeCompare(b);
            });

            return sortedHosts.map((hostName) => {
              const hostProjs = hostMap.get(hostName) || [];
              const isLocal = Boolean(myHost && hostName.toLowerCase() === myHost);
              const online = isHostOnline(hostName);
              return (
                <div key={hostName} className="space-y-1.5">
                  <div className="flex items-center justify-between px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[#6E6E73]">
                    <span className="flex items-center gap-1.5 truncate">
                      <Monitor className="w-3 h-3 shrink-0" />
                      <span className="truncate">{isLocal ? `${hostName} (This PC)` : hostName}</span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-[9.5px] font-normal lowercase ${
                        online ? 'text-emerald-400' : 'text-[#55555A]'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          online ? 'bg-emerald-400' : 'bg-[#55555A]'
                        }`}
                      />
                      {online ? 'online' : 'offline'}
                    </span>
                  </div>
                  {hostProjs.map((proj) => {
                    const isProjActive = proj.id === activeProjectId;
                    const isConfirmingDelete = confirmDeleteProjectId === proj.id;
                    return (
                      <div key={proj.id} className="space-y-1">
                        <div className="group/proj flex items-center justify-between gap-1 px-2 py-1 rounded-md hover:bg-[#1C1C1F] transition-colors">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteProjectId(null);
                              setActiveProjectId(proj.id);
                              onSelectProject?.(proj.id);
                            }}
                            className={`flex-1 min-w-0 flex items-center gap-2 text-xs text-left transition-colors ${
                              isProjActive
                                ? 'text-[#A0A0A5] font-medium'
                                : 'text-[#6E6E73] group-hover/proj:text-[#A0A0A5]'
                            }`}
                            title={`${proj.root_path} (${hostName})`}
                          >
                            <Folder className="w-3.5 h-3.5 shrink-0 text-[#6E6E73]" />
                            <span className="truncate">{proj.name}</span>
                          </button>

                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteProject(proj.id);
                                }}
                                className="p-1 text-red-400 hover:text-red-300 rounded transition-colors"
                                title="Confirm delete project"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteProjectId(null);
                                }}
                                className="p-1 text-[#6E6E73] hover:text-[#E3E3E3] rounded transition-colors"
                                title="Cancel"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteProjectId(proj.id);
                              }}
                              className="opacity-0 group-hover/proj:opacity-100 p-1 text-[#6E6E73] hover:text-red-400 rounded transition-all shrink-0"
                              title="Delete project"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        {isProjActive ? (
                          <div className="pl-2 space-y-0.5">
                            {filteredSessions.length > 0 ? (
                              filteredSessions.map((s) => renderSessionRow(s))
                            ) : (
                              <div className="px-2.5 py-1 text-[11px] text-[#55555A]">
                                No conversations yet
                              </div>
                            )}
                          </div>
                        ) : (
                          <div
                            onClick={() => {
                              setActiveProjectId(proj.id);
                              onSelectProject?.(proj.id);
                            }}
                            className="pl-4.5 px-2.5 py-0.5 text-[11px] text-[#55555A] hover:text-[#8E8E93] cursor-pointer truncate"
                          >
                            Switch to view conversations
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()
        )}
      </div>
    </div>
  );
};
