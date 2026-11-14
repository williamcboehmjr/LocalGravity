import React, { useState } from 'react';
import { GitCompare, RotateCcw, CheckCircle2, FileCode2 } from 'lucide-react';
import { useArtifactStore, FileCheckpointItem } from '../../store/useArtifactStore';
import { useSessionStore } from '../../store/useSessionStore';
import { MonacoDiffViewer } from '../center-canvas/MonacoDiffViewer';

/** Review / Files Changed tab using checkpoints + inline MonacoDiffViewer + 1-click revert. */
export const ChangesTab: React.FC = () => {
  const { checkpoints, setCheckpoints, activeCheckpoint, setActiveCheckpoint } = useArtifactStore();
  const apiBaseUrl = useSessionStore((s) => s.apiBaseUrl);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected: FileCheckpointItem | null =
    checkpoints.find((c) => c.id === selectedId) || activeCheckpoint || checkpoints[0] || null;

  const handleRevert = async (cp: FileCheckpointItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRevertingId(cp.id);
    try {
      const res = await fetch(`${apiBaseUrl}/api/checkpoints/${cp.id}/revert`, { method: 'POST' });
      if (res.ok) {
        const name = cp.file_path.split(/[/\\]/).pop() || cp.file_path;
        setNotice(`Reverted ${name}`);
        setCheckpoints(checkpoints.filter((c) => c.id !== cp.id));
        if (activeCheckpoint?.id === cp.id) setActiveCheckpoint(null);
        setTimeout(() => setNotice(null), 2500);
      }
    } catch {}
    setRevertingId(null);
  };

  const handleRewindAll = async (cp: FileCheckpointItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRevertingId(cp.id);
    try {
      const res = await fetch(`${apiBaseUrl}/api/checkpoints/${cp.id}/rewind`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const name = cp.file_path.split(/[/\\]/).pop() || cp.file_path;
        setNotice(`Rewound files & chat to ${name}`);
        if (Array.isArray(data.checkpoints)) {
          setCheckpoints(data.checkpoints);
        } else {
          setCheckpoints(checkpoints.filter((c) => c.id !== cp.id));
        }
        if (Array.isArray(data.messages)) {
          useSessionStore.getState().hydrateMessagesFromServer(data.messages);
        }
        if (activeCheckpoint?.id === cp.id) setActiveCheckpoint(null);
        setTimeout(() => setNotice(null), 2800);
      }
    } catch {}
    setRevertingId(null);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 text-xs bg-[#131314]">
      <div className="px-3 py-2 bg-[#161618] border-b border-[#222226] flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-1.5 font-medium text-[#E8EAED]">
          <GitCompare className="w-3.5 h-3.5 text-[#8AB4F8]" />
          <span>Review / Changes ({checkpoints.length})</span>
        </div>
        {notice && (
          <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            {notice}
          </span>
        )}
      </div>

      {checkpoints.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2 text-[#8E8E93]">
          <FileCode2 className="w-7 h-7 text-[#5F6368]" />
          <div className="text-xs font-medium text-[#E3E3E3]">No pending file checkpoints</div>
          <div className="text-[11px] max-w-xs text-[#6E6E73]">
            Edits made via <code className="text-[#8AB4F8]">write_file</code> or{' '}
            <code className="text-[#8AB4F8]">edit_file</code> appear here with diffs and 1-click revert.
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="space-y-1.5">
            {checkpoints.map((cp) => {
              const fileName = cp.file_path.split(/[/\\]/).pop() || cp.file_path;
              const isSelected = selected?.id === cp.id;
              return (
                <div
                  key={cp.id}
                  onClick={() => setSelectedId(cp.id)}
                  className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors gap-2 ${
                    isSelected
                      ? 'bg-[#202227] border-[#8AB4F8]/50'
                      : 'bg-[#17181B] hover:bg-[#1F2024] border-[#26272B]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-[#E8EAED] truncate">{fileName}</div>
                    <div className="text-[10px] text-[#6E6E73] truncate">{cp.file_path}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => handleRevert(cp, e)}
                      disabled={revertingId === cp.id}
                      className="px-2 py-1 rounded bg-[#222327] hover:bg-rose-950/60 text-[#9AA0A6] hover:text-rose-300 text-[10.5px] font-medium flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
                      title="Revert file only"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{revertingId === cp.id ? '...' : 'Revert'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleRewindAll(cp, e)}
                      disabled={revertingId === cp.id}
                      className="px-2 py-1 rounded bg-[#222327] hover:bg-amber-950/60 text-[#9AA0A6] hover:text-amber-300 text-[10.5px] font-medium flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
                      title="Revert this file, newer checkpoints, and rewind chat here"
                    >
                      <span>Rewind</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {selected && (
            <MonacoDiffViewer
              originalContent={selected.previous_content_blob ?? ''}
              modifiedContent={selected.new_content_blob}
              filePath={selected.file_path}
              onReject={() => handleRevert(selected)}
            />
          )}
        </div>
      )}
    </div>
  );
};
