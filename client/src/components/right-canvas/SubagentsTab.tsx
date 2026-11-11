import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Cpu,
  Terminal,
  RefreshCw,
  Trash2,
  Send,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

interface BgTask {
  taskId: string;
  type: 'command' | 'timer';
  title: string;
  commandOrPrompt: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  startedAt: number;
  completedAt: number | null;
  recentLogs: string[];
}

/** Subagents & Background Tasks tab with logs, kill, and send_input support. */
export const SubagentsTab: React.FC = () => {
  const apiBaseUrl = useSessionStore((s) => s.apiBaseUrl);
  const subagentTasks = useSessionStore((s) => s.subagentTasks);
  const storeBgTasks = useSessionStore((s) => (s as any).backgroundTasks) as BgTask[] | undefined;

  const [fetchedBgTasks, setFetchedBgTasks] = useState<BgTask[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  const loadTasks = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/tasks`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tasks)) setFetchedBgTasks(data.tasks);
      }
    } catch {}
    setRefreshing(false);
  }, [apiBaseUrl]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const bgTasks: BgTask[] = storeBgTasks && storeBgTasks.length > 0 ? storeBgTasks : fetchedBgTasks;

  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleKill = async (taskId: string) => {
    try {
      await fetch(`${apiBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/kill`, { method: 'POST' });
      loadTasks();
    } catch {}
  };

  const handleSendInput = async (taskId: string, e: React.FormEvent) => {
    e.preventDefault();
    const val = inputs[taskId];
    if (!val) return;
    try {
      await fetch(`${apiBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: val }),
      });
      setInputs((prev) => ({ ...prev, [taskId]: '' }));
      loadTasks();
    } catch {}
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 text-xs bg-[#131314]">
      <div className="px-3 py-2 bg-[#161618] border-b border-[#222226] flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-1.5 font-medium text-[#E8EAED]">
          <Users className="w-3.5 h-3.5 text-[#8AB4F8]" />
          <span>Subagents & Background Tasks</span>
        </div>
        <button
          type="button"
          onClick={loadTasks}
          className={`p-1 rounded hover:bg-[#222327] text-[#8E8E93] hover:text-[#E8EAED] cursor-pointer ${
            refreshing ? 'animate-spin text-[#8AB4F8]' : ''
          }`}
          title="Refresh tasks"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Subagents */}
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#8E8E93] px-1">
            <Cpu className="w-3 h-3 text-[#C58AF9]" />
            <span>Subagents ({subagentTasks.length})</span>
          </div>

          {subagentTasks.length === 0 ? (
            <div className="p-2.5 rounded-lg bg-[#16171A] border border-[#222328] text-[11px] text-[#6E6E73]">
              No subagents invoked in this session yet.
            </div>
          ) : (
            <div className="space-y-1.5">
              {subagentTasks.map((sa) => {
                const open = Boolean(expandedIds[sa.id]);
                return (
                  <div
                    key={sa.id}
                    className="rounded-lg bg-[#17181B] border border-[#25262B] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(sa.id)}
                      className="w-full flex items-center justify-between gap-2 p-2 text-left hover:bg-[#1E1F24] cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {sa.status === 'running' ? (
                          <Loader2 className="w-3.5 h-3.5 text-[#8AB4F8] animate-spin shrink-0" />
                        ) : sa.status === 'error' ? (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                        <span className="font-medium text-[#E8EAED] truncate">{sa.role}</span>
                        <span className="text-[10px] font-mono text-[#70757A]">
                          step {sa.step}/{sa.maxSteps}
                        </span>
                      </div>
                      {open ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[#6E6E73] shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[#6E6E73] shrink-0" />
                      )}
                    </button>

                    {sa.summary && (
                      <div className="px-2.5 pb-2 text-[11px] text-[#9AA0A6] leading-snug">
                        {sa.summary}
                      </div>
                    )}

                    {open && sa.logs && sa.logs.length > 0 && (
                      <div className="px-2.5 py-2 border-t border-[#222328] bg-[#101113] font-mono text-[10.5px] text-[#BDC1C6] max-h-36 overflow-y-auto space-y-0.5">
                        {sa.logs.map((line, i) => (
                          <div key={i} className="whitespace-pre-wrap">
                            {line}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Background Tasks */}
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#8E8E93] px-1">
            <Terminal className="w-3 h-3 text-emerald-400" />
            <span>Background Tasks ({bgTasks.length})</span>
          </div>

          {bgTasks.length === 0 ? (
            <div className="p-2.5 rounded-lg bg-[#16171A] border border-[#222328] text-[11px] text-[#6E6E73]">
              No active background commands or timers.
            </div>
          ) : (
            <div className="space-y-1.5">
              {bgTasks.map((t) => {
                const open = Boolean(expandedIds[t.taskId]);
                return (
                  <div
                    key={t.taskId}
                    className="rounded-lg bg-[#17181B] border border-[#25262B] overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-2 p-2">
                      <button
                        type="button"
                        onClick={() => toggleExpand(t.taskId)}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        {t.status === 'running' ? (
                          <Loader2 className="w-3.5 h-3.5 text-[#8AB4F8] animate-spin shrink-0" />
                        ) : t.status === 'failed' || t.status === 'cancelled' ? (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                        <span className="font-mono text-[11.5px] text-[#E8EAED] truncate">
                          {t.title}
                        </span>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="px-1.5 py-0.5 rounded bg-[#222327] text-[10px] font-mono text-[#9AA0A6]">
                          {t.status}
                        </span>
                        {t.status === 'running' && (
                          <button
                            type="button"
                            onClick={() => handleKill(t.taskId)}
                            className="p-1 rounded hover:bg-rose-950/60 text-[#8E8E93] hover:text-rose-300 cursor-pointer"
                            title="Kill task"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {open && (
                      <div className="border-t border-[#222328] bg-[#101113] p-2 space-y-2">
                        <div className="font-mono text-[10.5px] text-[#BDC1C6] max-h-40 overflow-y-auto space-y-0.5">
                          {t.recentLogs.length === 0 ? (
                            <span className="text-[#6E6E73]">No log output yet.</span>
                          ) : (
                            t.recentLogs.map((l, idx) => (
                              <div key={idx} className="whitespace-pre-wrap">
                                {l}
                              </div>
                            ))
                          )}
                        </div>

                        {t.status === 'running' && t.type === 'command' && (
                          <form
                            onSubmit={(e) => handleSendInput(t.taskId, e)}
                            className="flex items-center gap-1"
                          >
                            <input
                              type="text"
                              value={inputs[t.taskId] || ''}
                              onChange={(e) =>
                                setInputs((prev) => ({ ...prev, [t.taskId]: e.target.value }))
                              }
                              placeholder="Send stdin..."
                              className="flex-1 bg-[#16171A] border border-[#2C2D32] rounded px-2 py-1 text-[11px] font-mono text-[#E8EAED] outline-none"
                            />
                            <button
                              type="submit"
                              className="px-2 py-1 rounded bg-[#242529] hover:bg-[#303238] text-[#8AB4F8] cursor-pointer"
                              title="Send input"
                            >
                              <Send className="w-3 h-3" />
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
