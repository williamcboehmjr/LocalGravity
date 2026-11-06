import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Pin,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

interface SessionListProps {
  onNewThread?: () => void;
  onSelectThread?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
}

export const SessionList: React.FC<SessionListProps> = ({
  onNewThread,
  onSelectThread,
  onDeleteThread,
}) => {
  const {
    sessions,
    sessionId,
    switchSession,
    createNewProject,
    deleteSession,
    renameSession,
    isGenerating,
  } = useSessionStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  // Global Ctrl+N shortcut for New Thread
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

  const togglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sortedSessions = [...sessions].sort((a, b) => {
    const aPinned = pinnedIds.has(a.id) ? 1 : 0;
    const bPinned = pinnedIds.has(b.id) ? 1 : 0;
    return bPinned - aPinned;
  });

  const handleStartRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const handleSaveRename = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (editTitle.trim()) {
      renameSession(id, editTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-2">
      {/* New Thread Action Button (Ctrl+N) */}
      <button
        type="button"
        onClick={() => (onNewThread ? onNewThread() : createNewProject())}
        className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-[#1A73E8] to-[#4285F4] hover:brightness-110 text-white font-medium text-xs flex items-center justify-between shadow-md transition-all cursor-pointer active:scale-[0.99]"
      >
        <span className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          <span>New Thread</span>
        </span>
        <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/25 text-white/90">
          Ctrl+N
        </kbd>
      </button>

      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5F6368]">
          Workspace Threads ({sessions.length})
        </span>
      </div>

      {/* Threads List */}
      <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
        {sortedSessions.map((s) => {
          const isActive = s.id === sessionId;
          const isPinned = pinnedIds.has(s.id);
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
              className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs cursor-pointer transition-all border ${
                isActive
                  ? 'bg-[#1C2029] text-[#E8EAED] border-[#8AB4F8]/50 shadow-sm'
                  : 'bg-transparent text-[#9AA0A6] border-transparent hover:bg-[#161920] hover:text-[#E8EAED]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Live Status Ring / Icon */}
                {isRunning ? (
                  <div className="relative w-4 h-4 flex items-center justify-center shrink-0">
                    <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-[#8AB4F8] via-[#C58AF9] to-[#F28B82] animate-spin opacity-80" />
                    <Loader2 className="w-3 h-3 text-white animate-spin relative z-10" />
                  </div>
                ) : s.status === 'error' ? (
                  <AlertCircle className="w-3.5 h-3.5 text-[#F28B82] shrink-0" />
                ) : (
                  <MessageSquare
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? 'text-[#8AB4F8]' : 'text-[#5F6368]'
                    }`}
                  />
                )}

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
                      className="w-full bg-[#111318] border border-[#8AB4F8] rounded px-1.5 py-0.5 text-xs text-[#E8EAED] outline-none"
                    />
                    <button
                      type="button"
                      onClick={(e) => handleSaveRename(s.id, e)}
                      className="p-0.5 text-emerald-400 hover:text-emerald-300"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(null);
                      }}
                      className="p-0.5 text-[#9AA0A6] hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium flex items-center gap-1">
                      {isPinned && <Pin className="w-2.5 h-2.5 text-[#8AB4F8] shrink-0" />}
                      <span className="truncate">{s.title}</span>
                    </div>
                    <div className="text-[10px] text-[#5F6368] font-mono truncate">
                      {isRunning ? 'Thinking / Running tool...' : s.updated}
                    </div>
                  </div>
                )}
              </div>

              {editingId !== s.id && (
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 ml-1">
                  <button
                    type="button"
                    onClick={(e) => togglePin(s.id, e)}
                    className={`p-1 rounded hover:bg-[#262B36] ${
                      isPinned ? 'text-[#8AB4F8]' : 'text-[#5F6368] hover:text-[#E8EAED]'
                    }`}
                    title={isPinned ? 'Unpin thread' : 'Pin thread'}
                  >
                    <Pin className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleStartRename(s.id, s.title, e)}
                    className="p-1 rounded hover:bg-[#262B36] text-[#5F6368] hover:text-[#E8EAED]"
                    title="Rename thread"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(s.id);
                      onDeleteThread?.(s.id);
                    }}
                    className="p-1 rounded hover:bg-[#262B36] text-[#5F6368] hover:text-[#F28B82]"
                    title="Delete thread"
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
