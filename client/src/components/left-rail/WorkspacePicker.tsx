import React, { useState } from 'react';
import { FolderGit2, GitBranch, ChevronDown, Plus, Check, FolderOpen } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

interface WorkspacePickerProps {
  onSelectProject?: (projectId: string) => void;
  onCreateProject?: (name: string, rootPath: string) => void;
}

export const WorkspacePicker: React.FC<WorkspacePickerProps> = ({
  onSelectProject,
  onCreateProject,
}) => {
  const {
    projects,
    activeProjectId,
    workspacePath,
    gitBranch,
    setActiveProjectId,
    setWorkspacePath,
    apiBaseUrl,
    setProjects,
  } = useSessionStore();

  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjPath, setNewProjPath] = useState(workspacePath);

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const displayName =
    activeProject?.name || workspacePath.split(/[/\\]/).filter(Boolean).pop() || 'LocalGravity';

  const handleCreate = async () => {
    if (!newProjPath.trim()) return;
    const name =
      newProjName.trim() ||
      newProjPath.trim().split(/[/\\]/).filter(Boolean).pop() ||
      'Workspace';
    if (onCreateProject) {
      onCreateProject(name, newProjPath.trim());
    } else {
      try {
        const res = await fetch(`${apiBaseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, root_path: newProjPath.trim() }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.project) {
            setProjects([data.project, ...projects], data.project.id);
          }
        }
      } catch {
        setWorkspacePath(newProjPath.trim());
      }
    }
    setIsCreating(false);
    setIsOpen(false);
    setNewProjName('');
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-2.5 rounded-xl bg-[#1C2029] hover:bg-[#262B36]/80 border border-[#262B36] focus:border-[#8AB4F8] transition-all flex items-center justify-between text-left group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#8AB4F8]/15 border border-[#8AB4F8]/30 flex items-center justify-center text-[#8AB4F8] shrink-0">
            <FolderGit2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-[#E8EAED] truncate">{displayName}</span>
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#8AB4F8]/15 text-[#8AB4F8] font-mono text-[10px] border border-[#8AB4F8]/30 shrink-0">
                <GitBranch className="w-2.5 h-2.5" />
                {activeProject?.git_branch || gitBranch || 'main'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#9AA0A6] truncate mt-0.5" title={workspacePath}>
              {workspacePath}
            </div>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-[#9AA0A6] shrink-0 transition-transform ${
            isOpen ? 'rotate-180 text-[#8AB4F8]' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1.5 bg-[#1C2029] border border-[#262B36] rounded-xl shadow-2xl z-30 p-2 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#5F6368] px-2 py-1">
            Workspaces ({projects.length})
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1">
            {projects.map((proj) => {
              const isSelected = proj.id === activeProjectId;
              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => {
                    setActiveProjectId(proj.id);
                    onSelectProject?.(proj.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-[#8AB4F8]/15 text-[#E8EAED] border border-[#8AB4F8]/40'
                      : 'text-[#9AA0A6] hover:bg-[#262B36] hover:text-[#E8EAED]'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-medium truncate flex items-center gap-1.5">
                      <span>{proj.name}</span>
                      <span className="text-[10px] font-mono text-[#8AB4F8]">
                        [{proj.git_branch}]
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-[#5F6368] truncate">
                      {proj.root_path}
                    </div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-[#8AB4F8] shrink-0" />}
                </button>
              );
            })}
          </div>

          {!isCreating ? (
            <button
              type="button"
              onClick={() => {
                setNewProjPath(workspacePath);
                setIsCreating(true);
              }}
              className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-[#8AB4F8] hover:bg-[#8AB4F8]/10 transition-colors border-t border-[#262B36] pt-2"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Open Folder / New Project...</span>
            </button>
          ) : (
            <div className="p-2 bg-[#111318] rounded-lg border border-[#262B36] space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#E8EAED]">
                <FolderOpen className="w-3.5 h-3.5 text-[#8AB4F8]" />
                <span>Add Workspace Root</span>
              </div>
              <input
                type="text"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="Project name (optional)"
                className="w-full bg-[#161920] border border-[#262B36] focus:border-[#8AB4F8] rounded px-2 py-1 text-xs text-[#E8EAED] outline-none"
              />
              <input
                type="text"
                value={newProjPath}
                onChange={(e) => setNewProjPath(e.target.value)}
                placeholder="Absolute folder path..."
                className="w-full bg-[#161920] border border-[#262B36] focus:border-[#8AB4F8] rounded px-2 py-1 text-xs font-mono text-[#E8EAED] outline-none"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-2 py-1 text-[11px] text-[#9AA0A6] hover:text-[#E8EAED]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  className="px-2.5 py-1 rounded bg-[#1A73E8] hover:bg-[#4285F4] text-white text-[11px] font-medium"
                >
                  Open Workspace
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
