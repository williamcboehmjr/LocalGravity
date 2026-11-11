import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText,
  Play,
  Edit3,
  Check,
  Copy,
  Sparkles,
  ListTodo,
  BookOpenCheck,
  Code2,
} from 'lucide-react';
import { useArtifactStore, ArtifactDocType, ArtifactRecord } from '../../store/useArtifactStore';
import { useSessionStore } from '../../store/useSessionStore';

interface PlanViewerProps {
  onProceedPlan?: (prompt: string) => void;
  onSyncArtifact?: (doc: ArtifactDocType, content: string) => void;
}

export const PlanViewer: React.FC<PlanViewerProps> = ({ onProceedPlan, onSyncArtifact }) => {
  const {
    activeArtifactDoc,
    setActiveArtifactDoc,
    planMarkdown,
    setPlanMarkdown,
    walkthroughMarkdown,
    setWalkthroughMarkdown,
    taskMarkdown,
    setTaskMarkdown,
    artifacts,
    activeArtifactId,
    setActiveArtifactId,
    clearArtifactFeedback,
  } = useArtifactStore();
  const apiBaseUrl = useSessionStore((s) => s.apiBaseUrl);

  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const htmlArtifacts = artifacts.filter((a) => a.type === 'html');
  const selectedHtmlArtifact: ArtifactRecord | undefined = htmlArtifacts.find(
    (a) => a.id === activeArtifactDoc || a.id === activeArtifactId
  );

  // Match the current doc to an ArtifactRecord so requestFeedback / id are authoritative
  const activeRecord: ArtifactRecord | undefined = selectedHtmlArtifact
    ? selectedHtmlArtifact
    : artifacts.find((a) => {
        if (activeArtifactDoc === 'plan.md') return a.type === 'plan';
        if (activeArtifactDoc === 'walkthrough.md') return a.type === 'walkthrough';
        if (activeArtifactDoc === 'task.md') return a.type === 'task';
        return a.id === activeArtifactDoc;
      });

  const activeContent = selectedHtmlArtifact
    ? selectedHtmlArtifact.content
    : activeArtifactDoc === 'plan.md'
    ? planMarkdown
    : activeArtifactDoc === 'walkthrough.md'
    ? walkthroughMarkdown
    : taskMarkdown;

  const handleContentChange = (val: string) => {
    if (activeArtifactDoc === 'plan.md') setPlanMarkdown(val);
    else if (activeArtifactDoc === 'walkthrough.md') setWalkthroughMarkdown(val);
    else if (activeArtifactDoc === 'task.md') setTaskMarkdown(val);
    onSyncArtifact?.(activeArtifactDoc, val);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(activeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleProceed = async () => {
    if (activeRecord?.id) {
      clearArtifactFeedback(activeRecord.id);
      try {
        await fetch(`${apiBaseUrl}/api/artifacts/${encodeURIComponent(activeRecord.id)}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved: true }),
        });
      } catch {}
    }
    onProceedPlan?.('Approved. Proceed with executing the implementation plan step-by-step.');
  };

  const showProceedBanner = Boolean(activeRecord?.requestFeedback && onProceedPlan);

  return (
    <div className="flex-1 flex flex-col min-h-0 text-xs bg-[#131314]">
      {/* Artifact Switcher Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#161618] border-b border-[#222226] gap-2 shrink-0 select-none">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => {
              setActiveArtifactDoc('plan.md');
              setActiveArtifactId(null);
              setIsEditing(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium transition-colors cursor-pointer shrink-0 ${
              activeArtifactDoc === 'plan.md'
                ? 'bg-[#242529] text-[#E8EAED] border border-[#34363C]'
                : 'text-[#8E8E93] hover:text-[#E8EAED] hover:bg-[#1C1D20]'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            <span>plan.md</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveArtifactDoc('walkthrough.md');
              setActiveArtifactId(null);
              setIsEditing(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium transition-colors cursor-pointer shrink-0 ${
              activeArtifactDoc === 'walkthrough.md'
                ? 'bg-[#242529] text-[#E8EAED] border border-[#34363C]'
                : 'text-[#8E8E93] hover:text-[#E8EAED] hover:bg-[#1C1D20]'
            }`}
          >
            <BookOpenCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>walkthrough.md</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveArtifactDoc('task.md');
              setActiveArtifactId(null);
              setIsEditing(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium transition-colors cursor-pointer shrink-0 ${
              activeArtifactDoc === 'task.md'
                ? 'bg-[#242529] text-[#E8EAED] border border-[#34363C]'
                : 'text-[#8E8E93] hover:text-[#E8EAED] hover:bg-[#1C1D20]'
            }`}
          >
            <ListTodo className="w-3.5 h-3.5 text-[#8AB4F8]" />
            <span>task.md</span>
          </button>

          {htmlArtifacts.map((ha) => (
            <button
              key={ha.id}
              type="button"
              onClick={() => {
                setActiveArtifactId(ha.id);
                setActiveArtifactDoc(ha.id);
                setIsEditing(false);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium transition-colors cursor-pointer shrink-0 ${
                selectedHtmlArtifact?.id === ha.id
                  ? 'bg-[#242529] text-[#E8EAED] border border-[#34363C]'
                  : 'text-[#8E8E93] hover:text-[#E8EAED] hover:bg-[#1C1D20]'
              }`}
            >
              <Code2 className="w-3.5 h-3.5 text-[#C58AF9]" />
              <span className="truncate max-w-[110px]">{ha.title || `${ha.id}.html`}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#1C1D20] hover:bg-[#26272B] border border-[#2C2D32] text-[#9AA0A6] hover:text-[#E8EAED] text-[11px] transition-colors cursor-pointer"
            title="Copy Artifact Content"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>

          {!selectedHtmlArtifact && (
            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] transition-colors cursor-pointer ${
                isEditing
                  ? 'bg-[#8AB4F8]/20 border-[#8AB4F8] text-[#8AB4F8] font-medium'
                  : 'bg-[#1C1D20] hover:bg-[#26272B] border-[#2C2D32] text-[#9AA0A6] hover:text-[#E8EAED]'
              }`}
              title="Toggle Inline Markdown Editor"
            >
              <Edit3 className="w-3 h-3" />
              <span>{isEditing ? 'Done' : 'Edit'}</span>
            </button>
          )}
        </div>
      </div>

      {/* RequestFeedback Approval Banner — shown ONLY when artifact.requestFeedback === true */}
      {showProceedBanner && (
        <div className="px-3.5 py-2.5 bg-[#18191D] border-b border-[#25272C] flex items-center justify-between gap-2 shrink-0 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-3.5 h-3.5 text-[#8AB4F8] shrink-0" />
            <span className="text-[11.5px] text-[#C4C7C5] truncate">
              Review requested: approve to proceed with execution
            </span>
          </div>
          <button
            type="button"
            onClick={handleProceed}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#8AB4F8] hover:bg-[#A8C7FA] text-[#101114] font-semibold text-[11.5px] transition-colors shadow-xs cursor-pointer shrink-0"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Proceed</span>
          </button>
        </div>
      )}

      {/* Artifact Body: Sandboxed HTML iframe, Live Editor, or Rich Markdown */}
      {selectedHtmlArtifact ? (
        <iframe
          src={`${apiBaseUrl}/api/artifacts/${encodeURIComponent(selectedHtmlArtifact.id)}/raw`}
          title={selectedHtmlArtifact.title || selectedHtmlArtifact.id}
          sandbox="allow-scripts"
          className="flex-1 w-full border-0 bg-[#0c0d0e]"
        />
      ) : isEditing ? (
        <div className="flex-1 flex flex-col min-h-0 p-3">
          <textarea
            value={activeContent}
            onChange={(e) => handleContentChange(e.target.value)}
            className="flex-1 w-full bg-[#0E0F11] border border-[#2C2D32] focus:border-[#8AB4F8] rounded-xl p-3 font-mono text-xs text-[#E8EAED] outline-none resize-none leading-relaxed"
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 prose prose-invert prose-sm max-w-none text-[#E3E3E3] leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-3 border-[#8AB4F8] bg-[#8AB4F8]/10 pl-3.5 py-2 my-3 rounded-r-lg text-xs text-[#D2E3FC] not-italic">
                    {children}
                  </blockquote>
                );
              },
              code({ className, children, ...props }: any) {
                const isBlock =
                  Boolean(/language-(\w+)/.exec(className || '')) || String(children).includes('\n');
                return isBlock ? (
                  <pre className="p-3 my-2.5 rounded-lg bg-[#0D0E10] border border-[#26282D] font-mono text-[11.5px] text-[#E8EAED] overflow-x-auto">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                ) : (
                  <code
                    className="px-1.5 py-0.5 rounded bg-[#1E1F23] border border-[#2E3036] font-mono text-[11px] text-[#8AB4F8]"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
            }}
          >
            {activeContent}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
};
