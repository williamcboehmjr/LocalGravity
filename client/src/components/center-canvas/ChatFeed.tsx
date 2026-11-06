import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Terminal,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Globe,
  Loader2,
  FileCode2,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  FolderOpen,
  Layers,
} from 'lucide-react';
import { useSessionStore, ToolCallItemData } from '../../store/useSessionStore';
import { useArtifactStore } from '../../store/useArtifactStore';
import { ThoughtAccordion } from './ThoughtAccordion';

function shortenPath(rawPath: string): string {
  if (!rawPath) return '.';
  const normalized = rawPath.replace(/\\/g, '/');
  const markers = ['/LocalGravity/', '/scratch/'];
  for (const m of markers) {
    const idx = normalized.indexOf(m);
    if (idx !== -1) {
      const rel = normalized.slice(idx + m.length);
      return rel || '.';
    }
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length > 3) {
    return parts.slice(-3).join('/');
  }
  return normalized;
}

function formatCompactToolLabel(item: ToolCallItemData): {
  prefix: string;
  target: string;
  isRead: boolean;
  isEdit: boolean;
  isDir: boolean;
  isSearch: boolean;
} {
  const rawCmd = item.command || '';
  const match = rawCmd.match(/^([a-zA-Z0-9_:-]+)\(([\s\S]*)\)$/);
  const toolName = (item.toolName || (match ? match[1] : '')).toLowerCase();
  let args: any = null;
  if (match && match[2]) {
    try {
      args = JSON.parse(match[2]);
    } catch {}
  } else if (item.argumentsJson) {
    try {
      args = JSON.parse(item.argumentsJson);
    } catch {}
  }

  if (toolName === 'read_file' || rawCmd.toLowerCase().startsWith('read_file')) {
    const p = args?.path ? shortenPath(String(args.path)) : rawCmd.replace(/^read_file\s*/i, '');
    const range =
      args?.start_line || args?.end_line
        ? ` (L${args.start_line || 1}–${args.end_line || 'end'})`
        : '';
    return {
      prefix: 'Analyzed',
      target: `${p}${range}`,
      isRead: true,
      isEdit: false,
      isDir: false,
      isSearch: false,
    };
  }

  if (
    toolName === 'write_file' ||
    toolName === 'apply_diff' ||
    rawCmd.toLowerCase().startsWith('write_file') ||
    rawCmd.toLowerCase().startsWith('apply_diff')
  ) {
    const p = args?.path ? shortenPath(String(args.path)) : rawCmd;
    return {
      prefix: 'Edited',
      target: p,
      isRead: false,
      isEdit: true,
      isDir: false,
      isSearch: false,
    };
  }

  if (toolName === 'list_directory' || rawCmd.toLowerCase().startsWith('list_directory')) {
    const p = args?.path ? shortenPath(String(args.path)) : '.';
    return {
      prefix: 'Listed',
      target: p,
      isRead: false,
      isEdit: false,
      isDir: true,
      isSearch: false,
    };
  }

  if (toolName === 'browse_url' || rawCmd.toLowerCase().startsWith('browse_url')) {
    const u = args?.url ? String(args.url) : rawCmd;
    return {
      prefix: 'Browsed',
      target: u,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'run_terminal' || rawCmd.toLowerCase().startsWith('run_terminal')) {
    const cmdStr = args?.command
      ? String(args.command).replace(/\s+/g, ' ').trim()
      : rawCmd.replace(/^run_terminal\s*/i, '');
    return {
      prefix: item.status === 'running' ? 'Running' : 'Ran',
      target: cmdStr.length > 72 ? cmdStr.slice(0, 72) + '…' : cmdStr,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: false,
    };
  }

  const cleanCmd = rawCmd.replace(/\s+/g, ' ').trim();
  return {
    prefix: item.status === 'running' ? 'Running' : 'Ran',
    target: cleanCmd.length > 72 ? cleanCmd.slice(0, 72) + '…' : cleanCmd,
    isRead: false,
    isEdit: false,
    isDir: false,
    isSearch: false,
  };
}

function parseMessageContent(
  rawContent: string,
  existingThought?: string,
  existingStepNotes?: string[],
  hasTools?: boolean
) {
  let thought = existingThought || '';
  let content = rawContent || '';

  const thoughtMatch = content.match(/<(thought|think)>([\s\S]*?)<\/(thought|think)>/i);
  if (thoughtMatch) {
    if (!thought) {
      thought = thoughtMatch[2].trim();
    }
    content = content.replace(thoughtMatch[0], '').trim();
  }

  const openMatch = content.match(/<(thought|think)>([\s\S]*)/i);
  if (openMatch) {
    if (!thought) {
      thought = openMatch[2].trim();
    }
    content = content.replace(openMatch[0], '').trim();
  }

  // Strip any raw <tool_call> tags if present
  content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();

  // Separate leading intermediate step-chatter lines ("Let me read...", "The read_file tool...", etc.)
  // when tool calls exist so historical messages also collapse cleanly
  const stepNotes: string[] = [...(existingStepNotes || [])];
  if (hasTools && content) {
    const lines = content.split(/\r?\n/);
    const remainingLines: string[] = [];
    let stillInLeadingChatter = true;

    const chatterRegex =
      /^(let me\s+|now let me\s+|now i have\s+|i'll\s+|i will\s+|the file is large|the tool output|the read_file tool|the read tool|both tools truncate|small chunks work|the \$ is being)/i;

    for (let i = 0; i < lines.length; i++) {
      const trimmedLine = lines[i].trim();
      if (!trimmedLine) {
        if (!stillInLeadingChatter) remainingLines.push(lines[i]);
        continue;
      }
      if (
        stillInLeadingChatter &&
        trimmedLine.length < 180 &&
        !trimmedLine.startsWith('#') &&
        !trimmedLine.startsWith('-') &&
        !trimmedLine.startsWith('*') &&
        !trimmedLine.startsWith('1.') &&
        chatterRegex.test(trimmedLine)
      ) {
        if (!stepNotes.includes(trimmedLine)) {
          stepNotes.push(trimmedLine);
        }
      } else {
        stillInLeadingChatter = false;
        remainingLines.push(lines[i]);
      }
    }

    const candidate = remainingLines.join('\n').trim();
    // Only strip leading chatter if there is actual final content left, or if all lines were just tool-step chatter
    content = candidate;
  }

  return { thought, content, stepNotes };
}

const ToolExecutionRow: React.FC<{
  item: ToolCallItemData;
  onOpenInWorkbench: (item: ToolCallItemData) => void;
}> = ({ item, onOpenInWorkbench }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { prefix, target, isRead, isEdit, isDir, isSearch } = formatCompactToolLabel(item);

  return (
    <div className="py-0.5 select-none">
      <div className="flex items-center justify-between gap-2 text-[11px] text-[#9A9A9E] hover:text-[#E3E3E3] transition-colors px-1.5 py-0.5 rounded hover:bg-[#222226] max-w-full">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-1.5 text-left cursor-pointer focus:outline-none min-w-0 flex-1"
        >
          {item.status === 'running' ? (
            <Loader2 className="w-3 h-3 text-[#60A5FA] animate-spin shrink-0" />
          ) : item.status === 'error' ? (
            <AlertCircle className="w-3 h-3 text-[#F87171] shrink-0" />
          ) : isRead || isEdit ? (
            <FileCode2 className="w-3 h-3 text-[#60A5FA] shrink-0" />
          ) : isDir ? (
            <FolderOpen className="w-3 h-3 text-[#FBBF24] shrink-0" />
          ) : isSearch ? (
            <Globe className="w-3 h-3 text-[#34D399] shrink-0" />
          ) : (
            <Terminal className="w-3 h-3 text-[#A78BFA] shrink-0" />
          )}

          <span className="text-[#8E8E93] font-medium shrink-0">{prefix}</span>

          <span className="font-mono text-[11px] text-[#D4D4D8] truncate">
            {target}
          </span>

          {item.durationMs !== undefined && item.status !== 'running' && (
            <span className="text-[10px] text-[#5E5E63] shrink-0 ml-auto pl-2">
              {item.durationMs < 1000
                ? `${item.durationMs}ms`
                : `${(item.durationMs / 1000).toFixed(1)}s`}
            </span>
          )}

          {item.output &&
            (isOpen ? (
              <ChevronDown className="w-3 h-3 text-[#6E6E73] shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-[#6E6E73] shrink-0" />
            ))}
        </button>

        <button
          type="button"
          onClick={() => onOpenInWorkbench(item)}
          className="opacity-60 hover:opacity-100 text-[10px] text-[#6E6E73] hover:text-[#E3E3E3] flex items-center gap-0.5 transition-opacity shrink-0"
          title="Open in Right Pane"
        >
          <ExternalLink className="w-2.5 h-2.5" />
        </button>
      </div>

      {isOpen && item.output && (
        <div className="mt-1 ml-4 pl-2.5 border-l border-[#2C2C30] font-mono text-[10.5px] text-[#A0A0A5] overflow-x-auto bg-[#141416] p-2.5 rounded-lg border border-[#242427] max-h-48 select-text">
          <pre className="whitespace-pre-wrap">{item.output}</pre>
        </div>
      )}
    </div>
  );
};

/**
 * Antigravity-Style Collapsible Running Activity Box:
 * - While running (`isCurrentlyGenerating`): Expanded compact scrollable window showing live tool steps & notes.
 * - Once finished (`!isCurrentlyGenerating`): Automatically collapses into a 1-line summary bar.
 */
const AgentActivityBox: React.FC<{
  toolCalls: ToolCallItemData[];
  stepNotes: string[];
  isCurrentlyGenerating: boolean;
  onOpenInWorkbench: (item: ToolCallItemData) => void;
}> = ({ toolCalls, stepNotes, isCurrentlyGenerating, onOpenInWorkbench }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(isCurrentlyGenerating);
  const [userToggled, setUserToggled] = useState<boolean>(false);
  const listScrollRef = useRef<HTMLDivElement>(null);

  // Auto-expand while running, and auto-collapse once generation completes (unless manually toggled after completion)
  useEffect(() => {
    if (isCurrentlyGenerating) {
      if (!userToggled) setIsExpanded(true);
    } else {
      setIsExpanded(false);
      setUserToggled(false);
    }
  }, [isCurrentlyGenerating]);

  // Auto-scroll the running list window as new tool calls or step notes arrive
  useEffect(() => {
    if (isExpanded && listScrollRef.current) {
      listScrollRef.current.scrollTop = listScrollRef.current.scrollHeight;
    }
  }, [toolCalls.length, stepNotes.length, isExpanded]);

  const totalActions = toolCalls.length;
  if (totalActions === 0 && stepNotes.length === 0) return null;

  const runningTool = toolCalls.find((t) => t.status === 'running');
  const lastTool = toolCalls[toolCalls.length - 1];
  const lastNote = stepNotes[stepNotes.length - 1];

  const readCount = toolCalls.filter((t) =>
    (t.toolName || t.command).toLowerCase().includes('read_file')
  ).length;
  const dirCount = toolCalls.filter((t) =>
    (t.toolName || t.command).toLowerCase().includes('list_directory')
  ).length;
  const editCount = toolCalls.filter((t) => {
    const c = (t.toolName || t.command).toLowerCase();
    return c.includes('write_file') || c.includes('apply_diff');
  }).length;
  const cmdCount = Math.max(0, totalActions - readCount - dirCount - editCount);

  const summaryParts: string[] = [];
  if (readCount > 0) summaryParts.push(`${readCount} file${readCount > 1 ? 's' : ''} analyzed`);
  if (dirCount > 0) summaryParts.push(`${dirCount} dir${dirCount > 1 ? 's' : ''} listed`);
  if (editCount > 0) summaryParts.push(`${editCount} edit${editCount > 1 ? 's' : ''}`);
  if (cmdCount > 0) summaryParts.push(`${cmdCount} cmd${cmdCount > 1 ? 's' : ''} run`);

  const activeHeadline = runningTool
    ? (() => {
        const { prefix, target } = formatCompactToolLabel(runningTool);
        return `${prefix} ${target}`;
      })()
    : lastTool
    ? (() => {
        const { prefix, target } = formatCompactToolLabel(lastTool);
        return `${prefix} ${target}`;
      })()
    : lastNote || 'Executing steps...';

  return (
    <div className="my-1.5 rounded-xl border border-[#26262A] bg-[#17171A] overflow-hidden shadow-sm transition-all">
      {/* Header Bar (Click to Expand / Collapse) */}
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setIsExpanded(!isExpanded);
        }}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left hover:bg-[#1E1E22] transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isCurrentlyGenerating ? (
            <Loader2 className="w-3.5 h-3.5 text-[#60A5FA] animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          )}

          {isCurrentlyGenerating ? (
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="font-medium text-[#E3E3E3] shrink-0">Working</span>
              <span className="text-[#5E5E63] shrink-0">•</span>
              <span className="font-mono text-[11px] text-[#9A9A9E] truncate">
                {activeHeadline}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="font-medium text-[#C4C4C8] shrink-0">
                Completed {totalActions} action{totalActions === 1 ? '' : 's'}
              </span>
              {summaryParts.length > 0 && (
                <span className="text-[11px] text-[#6E6E73] truncate">
                  ({summaryParts.join(', ')})
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {stepNotes.length > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#222226] text-[10px] text-[#8E8E93]">
              <Layers className="w-2.5 h-2.5" />
              {stepNotes.length} note{stepNotes.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="text-[11px] text-[#6E6E73] flex items-center gap-0.5">
            {isExpanded ? (
              <>
                <span>Hide</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <span>Details</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </>
            )}
          </span>
        </div>
      </button>

      {/* Running / Expandable Activity Stream Window */}
      {isExpanded && (
        <div
          ref={listScrollRef}
          className="px-2.5 pb-2 pt-1 border-t border-[#222226] max-h-44 overflow-y-auto space-y-0.5 bg-[#141417]"
        >
          {toolCalls.map((tc) => (
            <ToolExecutionRow
              key={tc.id}
              item={tc}
              onOpenInWorkbench={onOpenInWorkbench}
            />
          ))}

          {stepNotes.length > 0 && (
            <div className="pt-1 mt-1 border-t border-[#1F1F23] space-y-0.5">
              {stepNotes.slice(-4).map((note, idx) => (
                <div
                  key={idx}
                  className="text-[11px] text-[#7E7E85] px-1.5 py-0.5 flex items-start gap-1.5 leading-snug"
                >
                  <span className="text-[#525258] shrink-0">↳</span>
                  <span className="truncate">{note}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ChatFeed: React.FC = () => {
  const {
    messages,
    currentStreamingThought,
    currentThoughtElapsedMs,
    currentThoughtTokens,
    isThinkingFinished,
    isGenerating,
  } = useSessionStore();

  const { setActiveTab } = useArtifactStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, currentStreamingThought, isGenerating]);

  const handleOpenInWorkbench = (tc: ToolCallItemData) => {
    const cmd = tc.command.toLowerCase();
    if (cmd.includes('write_file') || cmd.includes('apply_diff') || cmd.includes('read_file')) {
      setActiveTab('editor');
    } else if (cmd.includes('capture_screen') || cmd.includes('inspect')) {
      setActiveTab('preview');
    } else {
      setActiveTab('terminal');
    }
  };

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6 bg-[#131314]"
    >
      <div className="max-w-4xl mx-auto space-y-3.5 px-2 sm:px-4">
        {messages.length === 0 && (
          <div className="min-h-[55vh] flex flex-col items-center justify-center text-center p-6 space-y-3 select-none">
            <div className="w-10 h-10 rounded-xl bg-[#1E1E20] border border-[#2C2C30] flex items-center justify-center text-[#9A9A9E]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-medium text-[#E3E3E3] tracking-tight">
                What would you like to build?
              </h2>
              <p className="text-xs text-[#6E6E73] max-w-md leading-relaxed">
                Ask anything, reference files with <code className="text-[#9A9A9E]">@</code>, or trigger autonomous workflows with <code className="text-[#9A9A9E]">/goal</code>, <code className="text-[#9A9A9E]">/plan</code>, <code className="text-[#9A9A9E]">/boost</code>.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, index) => {
          const isLast = index === messages.length - 1;
          const isCurrentlyGenerating = isLast && isGenerating && msg.role === 'assistant';
          const hasTools = Boolean(msg.toolCalls && msg.toolCalls.length > 0);

          const {
            thought: parsedThought,
            content,
            stepNotes,
          } = parseMessageContent(msg.content, msg.thought, msg.stepNotes, hasTools);

          const activeThought = isCurrentlyGenerating
            ? currentStreamingThought || parsedThought
            : msg.thought || parsedThought;
          const activeElapsedMs = isCurrentlyGenerating
            ? currentThoughtElapsedMs
            : msg.thoughtElapsedMs;
          const activeTokens = isCurrentlyGenerating
            ? currentThoughtTokens
            : msg.thoughtTokenCount;
          const isStreaming = isCurrentlyGenerating && !isThinkingFinished;

          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="w-full">
                <div className="w-full bg-[#1E1E20] border border-[#2A2A2E] rounded-xl px-4 py-3 text-[13px] text-[#E3E3E3] space-y-2">
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {msg.images.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt="attachment"
                          className="w-20 h-20 object-cover rounded-lg border border-[#2C2C30]"
                        />
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="space-y-2 pl-1">
              {/* Step Timeline: Thoughts & Collapsible Activity Window */}
              <div className="space-y-1">
                {(activeThought || isStreaming) && (
                  <ThoughtAccordion
                    thought={activeThought || ''}
                    elapsedMs={activeElapsedMs}
                    tokenCount={activeTokens}
                    isStreaming={isStreaming}
                  />
                )}

                {((msg.toolCalls && msg.toolCalls.length > 0) || stepNotes.length > 0) && (
                  <AgentActivityBox
                    toolCalls={msg.toolCalls || []}
                    stepNotes={stepNotes}
                    isCurrentlyGenerating={isCurrentlyGenerating}
                    onOpenInWorkbench={handleOpenInWorkbench}
                  />
                )}

                {isCurrentlyGenerating &&
                  !content &&
                  (!msg.toolCalls || msg.toolCalls.length === 0) && (
                    <div className="flex items-center gap-2 text-xs text-[#8E8E93] py-1 select-none">
                      <span>Working</span>
                      <span className="inline-flex gap-0.5">
                        <span className="w-1 h-1 rounded-full bg-[#8E8E93] animate-bounce" />
                        <span className="w-1 h-1 rounded-full bg-[#8E8E93] animate-bounce [animation-delay:150ms]" />
                        <span className="w-1 h-1 rounded-full bg-[#8E8E93] animate-bounce [animation-delay:300ms]" />
                      </span>
                    </div>
                  )}
              </div>

              {/* Clean Final Markdown Assistant Output */}
              {content && (
                <div className="text-[13px] text-[#E3E3E3] leading-relaxed pt-1 prose prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p({ children }) {
                        return <p className="my-1 leading-relaxed text-[13px] text-[#D8D8DC]">{children}</p>;
                      },
                      ul({ children }) {
                        return <ul className="list-disc pl-5 my-1 space-y-0.5 text-[13px] text-[#D8D8DC] marker:text-[#8E8E93]">{children}</ul>;
                      },
                      ol({ children }) {
                        return <ol className="list-decimal pl-5 my-1 space-y-0.5 text-[13px] text-[#D8D8DC] marker:text-[#8E8E93]">{children}</ol>;
                      },
                      li({ children }) {
                        return <li className="leading-snug text-[#D8D8DC] pl-0.5">{children}</li>;
                      },
                      h1({ children }) {
                        return <h1 className="text-sm font-semibold text-white mt-2.5 mb-1 pb-0.5 border-b border-[#262629]">{children}</h1>;
                      },
                      h2({ children }) {
                        return <h2 className="text-[13px] font-semibold text-white mt-2 mb-0.5">{children}</h2>;
                      },
                      h3({ children }) {
                        return <h3 className="text-xs font-medium text-[#A0A0A5] uppercase tracking-wider mt-1.5 mb-0.5">{children}</h3>;
                      },
                      hr() {
                        return <hr className="my-2 border-[#262629]" />;
                      },
                      strong({ children }) {
                        return <strong className="font-semibold text-white">{children}</strong>;
                      },
                      table({ children }) {
                        return (
                          <div className="my-2 overflow-x-auto rounded-lg border border-[#262629]">
                            <table className="w-full text-left text-xs border-collapse">{children}</table>
                          </div>
                        );
                      },
                      th({ children }) {
                        return <th className="bg-[#1A1A1D] px-3 py-1.5 font-semibold text-white border-b border-[#262629]">{children}</th>;
                      },
                      td({ children }) {
                        return <td className="px-3 py-1.5 border-b border-[#222225] text-[#C4C4C8]">{children}</td>;
                      },
                      code({ className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        const isBlock = Boolean(match);
                        return isBlock ? (
                          <div className="my-2.5 rounded-lg overflow-hidden border border-[#262629] bg-[#161618]">
                            <div className="px-3 py-1 bg-[#1C1C1F] border-b border-[#262629] text-[10px] font-mono text-[#8E8E93] flex items-center justify-between select-none">
                              <span>{match?.[1]}</span>
                            </div>
                            <pre className="p-3 text-xs font-mono overflow-x-auto text-[#E3E3E3]">
                              <code className={className} {...props}>
                                {children}
                              </code>
                            </pre>
                          </div>
                        ) : (
                          <code
                            className="px-1.5 py-0.5 rounded bg-[#222226] text-[#E3E3E3] font-mono text-xs"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </div>
              )}

              {isCurrentlyGenerating && content && (
                <div className="flex items-center gap-1.5 text-xs text-[#6E6E73] pt-1 select-none">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Synthesizing response…</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
