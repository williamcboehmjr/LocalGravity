import React, { useState } from 'react';
import { Plus, MessageSquare, Search, Trash2, Edit2, Check } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

export const SessionList: React.FC = () => {
  const { sessionId, sessions, createNewProject, switchSession, deleteSession, renameSession } =
    useSessionStore();
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const handleStartRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const handleSaveRename = (id: string, e?: React.MouseEvent | React.FormEvent) => {
    if (e) e.stopPropagation();
    if (editTitle.trim()) {
      renameSession(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const filtered = sessions.filter((s) =>
    s.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Projects
        </span>
        <button
          onClick={createNewProject}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-accent-blue bg-blue-950/40 hover:bg-blue-900/60 border border-blue-800/60 rounded-md transition-colors shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Project</span>
        </button>
      </div>

      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-text-muted" />
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-surface border border-border-subtle rounded-md pl-8 pr-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-border-strong"
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
        {filtered.map((s) => {
          const isActive = s.id === sessionId;
          const isEditing = editingId === s.id;

          return (
            <div
              key={s.id}
              onClick={() => !isEditing && switchSession(s.id)}
              className={`group flex items-center justify-between p-2 rounded-md text-xs cursor-pointer transition-colors ${
                isActive
                  ? 'bg-surface-highlight text-text-primary font-medium border border-border-subtle'
                  : 'text-text-secondary hover:bg-surface-muted hover:text-text-primary'
              }`}
            >
              <div className="flex items-center gap-2 truncate flex-1 min-w-0 mr-1">
                <MessageSquare
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isActive ? 'text-accent-blue' : 'text-text-muted group-hover:text-accent-blue'
                  }`}
                />
                <div className="truncate flex-1 min-w-0">
                  {isEditing ? (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(s.id, e);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                        className="bg-black/50 border border-border-strong text-white text-xs px-1.5 py-0.5 rounded outline-none w-full"
                      />
                      <button
                        onClick={(e) => handleSaveRename(s.id, e)}
                        className="p-1 hover:text-emerald-400 text-text-secondary"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="truncate text-white font-medium">{s.title}</div>
                      <div className="text-[10px] text-text-muted">{s.updated}</div>
                    </>
                  )}
                </div>
              </div>

              {!isEditing && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => handleStartRename(s.id, s.title, e)}
                    className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"
                    title="Rename Project"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(s.id);
                    }}
                    className="p-1 text-text-muted hover:text-rose-400 rounded transition-colors"
                    title="Delete Project"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
