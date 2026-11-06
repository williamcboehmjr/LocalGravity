import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Sparkles,
  Save,
  Play,
  RefreshCw,
  FileText,
  FolderGit2,
  CheckCircle2,
} from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

interface HarnessComponentItem {
  id: string;
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
  content: string;
  entries?: string[];
  updatedAt: string;
}

interface PpcCycleItem {
  id: string;
  failedToolName: string;
  failedCommand: string;
  proposedTargetFile: string;
  proposedPatch: string;
  probeExitCode: number;
  composedExperienceEntry: string;
  createdAt: string;
}

export const HarnessWorkbenchTab: React.FC = () => {
  const { apiBaseUrl, workspacePath } = useSessionStore();
  const [components, setComponents] = useState<HarnessComponentItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('system');
  const [editorText, setEditorText] = useState<string>('');
  const [ppcHistory, setPpcHistory] = useState<PpcCycleItem[]>([]);
  const [statusText, setStatusText] = useState<string>('');
  const [isRunningPpc, setIsRunningPpc] = useState<boolean>(false);

  const loadHarness = async () => {
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/harness/components?root_path=${encodeURIComponent(workspacePath)}`
      );
      if (res.ok) {
        const data = await res.json();
        const list: HarnessComponentItem[] = data.components || [];
        setComponents(list);
        setPpcHistory(data.ppcHistory || []);
        const current = list.find((c) => c.id === selectedId) || list[0];
        if (current) {
          setSelectedId(current.id);
          setEditorText(current.content);
        }
      }
    } catch {}
  };

  useEffect(() => {
    loadHarness();
  }, [apiBaseUrl, workspacePath]);

  const activeComp = components.find((c) => c.id === selectedId) || components[0];

  const handleSelectComponent = (comp: HarnessComponentItem) => {
    setSelectedId(comp.id);
    setEditorText(comp.content);
  };

  const handleSaveComponent = async () => {
    if (!activeComp) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/harness/component`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root_path: workspacePath,
          relative_path: activeComp.relativePath,
          content: editorText,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setComponents(data.components || []);
        setStatusText('Saved to .localgravity/harness/');
        setTimeout(() => setStatusText(''), 2500);
      }
    } catch {}
  };

  const handleTriggerPpcLoop = async () => {
    setIsRunningPpc(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/harness/ppc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root_path: workspacePath,
          tool_name: 'run_terminal',
          command: 'ls -la --non-portable-flag',
          stderr: 'Command failed twice: unrecognized flag on Windows PowerShell',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.components) {
          setComponents(data.components);
          const exp = data.components.find((c: HarnessComponentItem) => c.id === 'experience');
          if (exp) {
            setSelectedId('experience');
            setEditorText(exp.content);
          }
        }
        if (data.cycle) {
          setPpcHistory((prev) => [data.cycle, ...prev]);
        }
        setStatusText('PPC Composed -> EXPERIENCE.md');
        setTimeout(() => setStatusText(''), 3000);
      }
    } catch {}
    setIsRunningPpc(false);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#131314] text-xs">
      {/* Header */}
      <div className="p-2.5 bg-[#101012] border-b border-[#222226] flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShieldCheck className="w-4 h-4 text-[#C58AF9] shrink-0" />
          <span className="font-semibold text-[#E3E3E3] truncate">
            Harness² 8-Component Engine (.localgravity/harness/)
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {statusText && (
            <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {statusText}
            </span>
          )}
          <button
            type="button"
            onClick={handleTriggerPpcLoop}
            disabled={isRunningPpc}
            className="px-2.5 py-1 rounded-lg bg-[#242427] hover:bg-[#2E2E32] border border-[#34343A] text-[#E3E3E3] font-medium text-[11px] flex items-center gap-1 cursor-pointer"
            title="Run Recursive Propose-Probe-Compose Self-Improvement Cycle"
          >
            <Play className="w-3 h-3 text-[#C58AF9]" />
            <span>{isRunningPpc ? 'Running PPC...' : 'Propose-Probe-Compose'}</span>
          </button>
          <button
            type="button"
            onClick={loadHarness}
            className="p-1 rounded hover:bg-[#242427] text-[#9A9A9E] hover:text-[#E3E3E3]"
            title="Reload Harness Files"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Component Selector Pills */}
      <div className="p-2 bg-[#18181B] border-b border-[#222226] flex items-center gap-1 overflow-x-auto">
        {components.map((comp) => {
          const isSelected = comp.id === selectedId;
          return (
            <button
              key={comp.id}
              type="button"
              onClick={() => handleSelectComponent(comp)}
              className={`px-2.5 py-1 rounded-lg font-mono text-[11px] flex items-center gap-1 border shrink-0 transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-[#8AB4F8]/20 border-[#8AB4F8] text-[#8AB4F8] font-semibold'
                  : 'bg-[#101012] border-[#2C2C30] text-[#9A9A9E] hover:text-[#E3E3E3]'
              }`}
            >
              {comp.kind === 'directory' ? (
                <FolderGit2 className="w-3 h-3 text-amber-400" />
              ) : (
                <FileText className="w-3 h-3 text-[#8AB4F8]" />
              )}
              <span>{comp.id.toUpperCase()}</span>
            </button>
          );
        })}
      </div>

      {/* Active Component Editor */}
      {activeComp && (
        <div className="flex-1 flex flex-col min-h-0 p-2.5 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-[#9A9A9E]">
            <span>{activeComp.relativePath}</span>
            <button
              type="button"
              onClick={handleSaveComponent}
              className="px-2.5 py-1 rounded bg-[#242427] hover:bg-[#2E2E32] border border-[#34343A] text-[#E3E3E3] font-sans font-medium flex items-center gap-1"
            >
              <Save className="w-3 h-3" />
              <span>Save Component</span>
            </button>
          </div>

          <textarea
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            className="flex-1 w-full bg-[#101012] border border-[#2C2C30] focus:border-[#8AB4F8] rounded-xl p-3 font-mono text-xs text-[#E3E3E3] outline-none resize-none leading-relaxed"
          />
        </div>
      )}

      {/* Recent Propose-Probe-Compose Audit Log */}
      {ppcHistory.length > 0 && (
        <div className="p-2.5 border-t border-[#222226] bg-[#101012] max-h-36 overflow-y-auto space-y-1.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#C58AF9]">
            <Sparkles className="w-3 h-3" />
            <span>Propose-Probe-Compose Audit Log ({ppcHistory.length})</span>
          </div>
          {ppcHistory.slice(0, 3).map((cycle) => (
            <div
              key={cycle.id}
              className="p-2 rounded-lg bg-[#18181B] border border-[#2C2C30] font-mono text-[10px] text-[#9A9A9E] space-y-0.5"
            >
              <div className="flex items-center justify-between text-[#E3E3E3]">
                <span>
                  Tool: <strong>{cycle.failedToolName}</strong> → Patched{' '}
                  <strong className="text-[#8AB4F8]">{cycle.proposedTargetFile}</strong>
                </span>
                <span className="text-emerald-400">Probe Exit: {cycle.probeExitCode}</span>
              </div>
              <div className="truncate text-[#9A9A9E]">{cycle.proposedPatch}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
