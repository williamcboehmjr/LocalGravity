import React, { useState } from 'react';
import {
  CheckSquare,
  Square,
  ListTodo,
  History,
  RotateCcw,
  FileDiff,
  CheckCircle2,
} from 'lucide-react';
import { useArtifactStore, FileCheckpointItem } from '../../store/useArtifactStore';
import { useSessionStore } from '../../store/useSessionStore';

interface TaskChecklistProps {
  onSync?: (markdown: string) => void;
}

export const TaskChecklist: React.FC<TaskChecklistProps> = ({ onSync }) => {
  const { parsedTasks, toggleTask, checkpoints, setActiveCheckpoint, setCheckpoints } =
    useArtifactStore();
  const { apiBaseUrl } = useSessionStore();
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [revertNotice, setRevertNotice] = useState<string | null>(null);

  const handleToggle = (id: string) => {
    const updatedMd = toggleTask(id);
    if (onSync) onSync(updatedMd);
  };

  const handleRevertCheckpoint = async (cp: FileCheckpointItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setRevertingId(cp.id);
    try {
      const res = await fetch(`${apiBaseUrl}/api/checkpoints/${cp.id}/revert`, {
        method: 'POST',
      });
      if (res.ok) {
        const shortName = cp.file_path.split(/[/\\]/).pop() || cp.file_path;
        setRevertNotice(`Reverted ${shortName}`);
        setCheckpoints(checkpoints.filter((c) => c.id !== cp.id));
        setTimeout(() => setRevertNotice(null), 2500);
      }
    } catch {}
    setRevertingId(null);
  };

  // Group by category
  const categories = Array.from(new Set(parsedTasks.map((t) => t.category || 'General')));

  const total = parsedTasks.length;
  const completed = parsedTasks.filter((t) => t.completed).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 text-xs bg-[#131314]">
      {/* Progress Header */}
      <div className="p-3 bg-[#161618] border-b border-[#222226] space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-medium text-[#E8EAED]">
            <ListTodo className="w-3.5 h-3.5 text-[#8AB4F8]" />
            <span>Task Checklist (task.md)</span>
          </div>
          <span className="font-mono text-[#8E8E93]">
            {completed}/{total} ({percent}%)
          </span>
        </div>

        <div className="w-full h-1.5 bg-[#0D0E10] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#8AB4F8] transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Scrollable Checklist + File Checkpoints Review */}
      <div className="flex-1 overflow-y-auto p-3 space-y-5">
        <div className="space-y-4">
          {categories.map((cat) => {
            const tasksInCat = parsedTasks.filter((t) => (t.category || 'General') === cat);
            return (
              <div key={cat} className="space-y-1.5">
                <h4 className="text-[11px] font-semibold text-[#6E6E73] uppercase tracking-wider px-1">
                  {cat}
                </h4>
                <div className="space-y-1">
                  {tasksInCat.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => handleToggle(task.id)}
                      className="group flex items-start gap-2.5 p-2 rounded-lg hover:bg-[#1C1D20] cursor-pointer transition-colors select-none"
                    >
                      <button type="button" className="mt-0.5 shrink-0 text-[#8AB4F8]">
                        {task.completed ? (
                          <CheckSquare className="w-4 h-4 fill-[#8AB4F8]/20" />
                        ) : (
                          <Square className="w-4 h-4 text-[#6E6E73] group-hover:text-[#A0A0A6]" />
                        )}
                      </button>
                      <span
                        className={`leading-relaxed text-xs transition-colors ${
                          task.completed
                            ? 'line-through text-[#6E6E73]'
                            : 'text-[#E3E3E3] group-hover:text-white'
                        }`}
                      >
                        {task.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Antigravity 2.0 File Checkpoints & Diff Review */}
        <div className="pt-3 border-t border-[#222226] space-y-2 select-none">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9AA0A6]">
              <History className="w-3.5 h-3.5 text-amber-400" />
              <span>File Checkpoints & Diffs ({checkpoints.length})</span>
            </div>
            {revertNotice && (
              <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />
                {revertNotice}
              </span>
            )}
          </div>

          {checkpoints.length === 0 ? (
            <div className="p-3 rounded-lg bg-[#16171A] border border-[#222328] text-[11px] text-[#6E6E73]">
              File modifications made by tools (`write_file`, `apply_diff`) automatically create
              restorable checkpoints here.
            </div>
          ) : (
            <div className="space-y-1.5">
              {checkpoints.map((cp) => {
                const fileName = cp.file_path.split(/[/\\]/).pop() || cp.file_path;
                return (
                  <div
                    key={cp.id}
                    onClick={() => setActiveCheckpoint(cp)}
                    className="flex items-center justify-between p-2 rounded-lg bg-[#17181B] hover:bg-[#1F2024] border border-[#26272B] cursor-pointer transition-colors gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-[#E8EAED] truncate">{fileName}</div>
                      <div className="text-[10px] text-[#6E6E73] truncate">{cp.file_path}</div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveCheckpoint(cp);
                        }}
                        className="px-2 py-1 rounded bg-[#222327] hover:bg-[#2C2E33] text-[#8AB4F8] text-[10.5px] font-medium flex items-center gap-1"
                        title="Inspect Side-by-Side Diff in Editor"
                      >
                        <FileDiff className="w-3 h-3" />
                        <span>Diff</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleRevertCheckpoint(cp, e)}
                        disabled={revertingId === cp.id}
                        className="px-2 py-1 rounded bg-[#222327] hover:bg-rose-950/60 text-[#9AA0A6] hover:text-rose-300 text-[10.5px] font-medium flex items-center gap-1 transition-colors"
                        title="Revert File to Checkpoint"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{revertingId === cp.id ? '...' : 'Revert'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
