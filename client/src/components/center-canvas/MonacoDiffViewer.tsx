import React, { useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { Check, X, Split } from 'lucide-react';

interface MonacoDiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  language?: string;
  filePath?: string;
  onAccept?: () => void;
  onReject?: () => void;
}

export const MonacoDiffViewer: React.FC<MonacoDiffViewerProps> = ({
  originalContent,
  modifiedContent,
  language = 'typescript',
  filePath = 'modified_file',
  onAccept,
  onReject,
}) => {
  const [inlineView, setInlineView] = useState(false);

  return (
    <div className="my-3 border border-border-strong rounded-lg overflow-hidden bg-surface shadow-md">
      {/* Diff Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-muted border-b border-border-subtle text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-text-primary font-medium">{filePath}</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-950/60 text-blue-400 border border-blue-800/40">
            DIFF
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setInlineView(!inlineView)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-surface hover:bg-surface-highlight text-text-secondary text-[11px]"
            title="Toggle inline vs side-by-side"
          >
            <Split className="w-3 h-3" />
            <span>{inlineView ? 'Side-by-Side' : 'Inline'}</span>
          </button>

          {onReject && (
            <button
              onClick={onReject}
              className="flex items-center gap-1 px-2 py-1 rounded bg-rose-950/50 hover:bg-rose-900/50 text-rose-400 border border-rose-800/40 text-[11px]"
            >
              <X className="w-3 h-3" />
              <span>Reject</span>
            </button>
          )}

          {onAccept && (
            <button
              onClick={onAccept}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-950/50 hover:bg-emerald-900/50 text-emerald-400 border border-emerald-800/40 text-[11px] font-medium"
            >
              <Check className="w-3 h-3" />
              <span>Accept</span>
            </button>
          )}
        </div>
      </div>

      {/* Editor Body */}
      <div className="h-64 w-full">
        <DiffEditor
          height="100%"
          original={originalContent}
          modified={modifiedContent}
          language={language}
          theme="vs-dark"
          options={{
            renderSideBySide: !inlineView,
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
};
