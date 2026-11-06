import React, { useState, useEffect } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import {
  FileCode2,
  Save,
  RotateCcw,
  Check,
  GitCompare,
  History,
  FolderOpen,
} from 'lucide-react';
import { useArtifactStore } from '../../store/useArtifactStore';
import { useSessionStore } from '../../store/useSessionStore';

export const WorkbenchEditor: React.FC = () => {
  const {
    workspaceFiles,
    setWorkspaceFiles,
    activeFilePath,
    activeFileContent,
    diffOriginalContent,
    setActiveFile,
    checkpoints,
    activeCheckpoint,
    setActiveCheckpoint,
  } = useArtifactStore();

  const { apiBaseUrl, workspacePath, sessionId } = useSessionStore();
  const [isDiffMode, setIsDiffMode] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const detectLanguage = (filePath: string): string => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
    if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
    if (lower.endsWith('.py')) return 'python';
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.md')) return 'markdown';
    if (lower.endsWith('.css')) return 'css';
    if (lower.endsWith('.html')) return 'html';
    if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
    if (lower.endsWith('.rs')) return 'rust';
    return 'plaintext';
  };

  const loadWorkspaceFiles = async () => {
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/workspace/files?root_path=${encodeURIComponent(workspacePath)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.files) setWorkspaceFiles(data.files);
      }
    } catch {}
  };

  const loadFile = async (relPath: string) => {
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/workspace/file?path=${encodeURIComponent(
          relPath
        )}&root_path=${encodeURIComponent(workspacePath)}`
      );
      if (res.ok) {
        const data = await res.json();
        setActiveFile(relPath, data.content ?? '', null);
        setActiveCheckpoint(null);
        setIsDiffMode(false);
      }
    } catch {}
  };

  useEffect(() => {
    loadWorkspaceFiles();
    if (!activeFileContent) {
      loadFile(activeFilePath || 'README.md');
    }
  }, [workspacePath, apiBaseUrl]);

  useEffect(() => {
    if (diffOriginalContent !== null) {
      setIsDiffMode(true);
    }
  }, [diffOriginalContent]);

  const handleSave = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/workspace/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: activeFilePath,
          content: activeFileContent,
          root_path: workspacePath,
          thread_id: sessionId,
        }),
      });
      if (res.ok) {
        setStatusMsg('Saved');
        setTimeout(() => setStatusMsg(''), 2000);
      }
    } catch {}
  };

  const handleRevertCheckpoint = async (checkpointId: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/checkpoints/${checkpointId}/revert`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setActiveFile(activeFilePath, data.restoredContent || '', null);
        setActiveCheckpoint(null);
        setIsDiffMode(false);
        setStatusMsg('Checkpoint Reverted');
        setTimeout(() => setStatusMsg(''), 2500);
      }
    } catch {}
  };

  const onlyFiles = workspaceFiles.filter((f) => f.type === 'file');

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#161920]">
      {/* Editor Toolbar */}
      <div className="p-2 border-b border-[#262B36] bg-[#111318] flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <FileCode2 className="w-4 h-4 text-[#8AB4F8] shrink-0" />
          <select
            value={activeFilePath}
            onChange={(e) => loadFile(e.target.value)}
            className="bg-[#1C2029] border border-[#262B36] focus:border-[#8AB4F8] rounded-lg px-2 py-1 text-xs font-mono text-[#E8EAED] outline-none truncate max-w-[220px]"
          >
            {onlyFiles.length === 0 && <option value="README.md">README.md</option>}
            {onlyFiles.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={loadWorkspaceFiles}
            className="p-1 rounded hover:bg-[#262B36] text-[#9AA0A6] hover:text-[#E8EAED]"
            title="Refresh file tree"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {statusMsg && (
            <span className="text-[11px] font-mono text-emerald-400 px-1.5">{statusMsg}</span>
          )}

          <button
            type="button"
            onClick={() => setIsDiffMode(!isDiffMode)}
            className={`px-2 py-1 rounded-lg text-[11px] font-mono flex items-center gap-1 border transition-colors ${
              isDiffMode
                ? 'bg-[#8AB4F8]/20 border-[#8AB4F8]/50 text-[#8AB4F8]'
                : 'bg-[#1C2029] border-[#262B36] text-[#9AA0A6] hover:text-[#E8EAED]'
            }`}
            title="Toggle Inline Diff View"
          >
            <GitCompare className="w-3 h-3" />
            <span>Diff</span>
          </button>

          {activeCheckpoint && (
            <>
              <button
                type="button"
                onClick={() => {
                  setActiveCheckpoint(null);
                  setIsDiffMode(false);
                }}
                className="px-2 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium flex items-center gap-1 hover:bg-emerald-500/30"
              >
                <Check className="w-3 h-3" />
                <span>Accept</span>
              </button>
              <button
                type="button"
                onClick={() => handleRevertCheckpoint(activeCheckpoint.id)}
                className="px-2 py-1 rounded-lg bg-[#F28B82]/20 border border-[#F28B82]/40 text-[#F28B82] text-[11px] font-medium flex items-center gap-1 hover:bg-[#F28B82]/30"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Revert Checkpoint</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleSave}
            className="px-2.5 py-1 rounded-lg bg-[#1A73E8] hover:bg-[#4285F4] text-white text-[11px] font-medium flex items-center gap-1"
          >
            <Save className="w-3 h-3" />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Checkpoint Time-Travel Strip (when checkpoints exist in current thread) */}
      {checkpoints.length > 0 && (
        <div className="px-2.5 py-1.5 bg-[#1C2029] border-b border-[#262B36] flex items-center gap-2 overflow-x-auto text-[11px]">
          <span className="flex items-center gap-1 text-[#9AA0A6] font-medium shrink-0">
            <History className="w-3 h-3 text-[#C58AF9]" />
            <span>Checkpoints:</span>
          </span>
          {checkpoints.slice(0, 6).map((cp) => {
            const shortFile = cp.file_path.split('/').pop() || cp.file_path;
            const isSelected = activeCheckpoint?.id === cp.id;
            return (
              <button
                key={cp.id}
                type="button"
                onClick={() => {
                  setActiveCheckpoint(cp);
                  setIsDiffMode(true);
                }}
                className={`px-2 py-0.5 rounded font-mono text-[10px] border shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-[#8AB4F8]/20 border-[#8AB4F8] text-[#8AB4F8]'
                    : 'bg-[#111318] border-[#262B36] text-[#9AA0A6] hover:text-[#E8EAED]'
                }`}
              >
                {shortFile}
              </button>
            );
          })}
        </div>
      )}

      {/* Monaco Code / Diff Editor Surface */}
      <div className="flex-1 min-h-0 relative">
        {isDiffMode ? (
          <DiffEditor
            height="100%"
            language={detectLanguage(activeFilePath)}
            theme="vs-dark"
            original={diffOriginalContent ?? activeFileContent}
            modified={activeFileContent}
            options={{
              renderSideBySide: false,
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontLigatures: true,
              scrollBeyondLastLine: false,
            }}
          />
        ) : (
          <Editor
            height="100%"
            language={detectLanguage(activeFilePath)}
            theme="vs-dark"
            value={activeFileContent}
            onChange={(val) => setActiveFile(activeFilePath, val || '', diffOriginalContent)}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontLigatures: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
            }}
          />
        )}
      </div>
    </div>
  );
};
