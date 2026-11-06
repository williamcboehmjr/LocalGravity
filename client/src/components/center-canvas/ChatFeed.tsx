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
} from 'lucide-react';
import { useSessionStore, ToolCallItemData } from '../../store/useSessionStore';
import { useArtifactStore } from '../../store/useArtifactStore';
import { ThoughtAccordion } from './ThoughtAccordion';

function parseMessageContent(rawContent: string, existingThought?: string) {
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

  return { thought, content };
}

const ToolExecutionRow: React.FC<{
  item: ToolCallItemData;
  onOpenInWorkbench: (item: ToolCallItemData) => void;
}> = ({ item, onOpenInWorkbench }) => {
  const [isOpen, setIsOpen] = useState(false);
  const cmdLower = item.command.toLowerCase();
  const isRead = cmdLower.includes('read_file') || cmdLower.includes('view_file');
  const isEdit = cmdLower.includes('write_file') || cmdLower.includes('edit_file') || cmdLower.includes('apply_diff');
  const isSearch = cmdLower.includes('search') || cmdLower.includes('grep') || cmdLower.includes('find');

  const formatStepAction = () => {
    const cleanCmd = item.command
      .replace(/^run_terminal\s*/i, '')
      .replace(/^run_command\s*/i, '');
    if (isRead) {
      return { prefix: 'Analyzed', target: cleanCmd.replace(/^read_file\s*/i, '') };
    }
    if (isEdit) {
      return { prefix: 'Edited', target: cleanCmd.replace(/^(write_file|edit_file|apply_diff)\s*/i, ''), isDiff: true };
    }
    if (isSearch) {
      return { prefix: 'Searched', target: cleanCmd };
    }
    return { prefix: item.status === 'running' ? 'Running' : 'Ran', target: cleanCmd };
  };

  const { prefix, target, isDiff } = formatStepAction();

  return (
    <div className="my-1 select-none">
      <div className="inline-flex items-center gap-2 text-xs text-[#8E8E93] hover:text-[#E3E3E3] transition-colors py-0.5 max-w-full">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-1.5 text-left cursor-pointer focus:outline-none min-w-0"
        >
          {item.status === 'running' ? (
            <Loader2 className="w-3.5 h-3.5 text-[#8E8E93] animate-spin shrink-0" />
          ) : item.status === 'error' ? (
            <AlertCircle className="w-3.5 h-3.5 text-[#F87171] shrink-0" />
          ) : isRead || isEdit ? (
            <FileCode2 className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
          ) : isSearch ? (
            <Globe className="w-3.5 h-3.5 text-[#8E8E93] shrink-0" />
          ) : (
            <Terminal className="w-3.5 h-3.5 text-[#8E8E93] shrink-0" />
          )}

          <span className="text-[#8E8E93] shrink-0">{prefix}</span>

          <span className="font-mono text-xs text-[#C4C4C8] truncate max-w-xs sm:max-w-lg">
            {target}
          </span>

          {isDiff && item.status === 'success' && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] shrink-0 ml-0.5">
              <span className="text-emerald-400">+1</span>
              <span className="text-rose-400">-0</span>
            </span>
          )}

          {item.output &&
            (isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#6E6E73] shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#6E6E73] shrink-0" />
            ))}
        </button>

        <button
          type="button"
          onClick={() => onOpenInWorkbench(item)}
          className="opacity-0 hover:opacity-100 focus:opacity-100 text-[11px] text-[#6E6E73] hover:text-[#E3E3E3] flex items-center gap-0.5 transition-opacity shrink-0"
          title="Open in Right Pane"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {isOpen && item.output && (
        <div className="mt-1.5 ml-1 pl-3 border-l border-[#2C2C30] font-mono text-[11px] text-[#A0A0A5] overflow-x-auto bg-[#18181A] p-3 rounded-lg border border-[#242427] max-h-60 select-text">
          <pre className="whitespace-pre-wrap">{item.output}</pre>
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
      <div className="max-w-3xl mx-auto space-y-6">
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
                Ask anything, reference files with <code className="text-[#9A9A9E]">@</code>, or run workspace actions across your LocalGravity Brain.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, index) => {
          const isLast = index === messages.length - 1;
          const isCurrentlyGenerating = isLast && isGenerating && msg.role === 'assistant';

          const { thought: parsedThought, content } = parseMessageContent(
            msg.content,
            msg.thought
          );
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
              {/* Step Timeline: Thoughts & Tool Executions */}
              <div className="space-y-0.5">
                {(activeThought || isStreaming) && (
                  <ThoughtAccordion
                    thought={activeThought || ''}
                    elapsedMs={activeElapsedMs}
                    tokenCount={activeTokens}
                    isStreaming={isStreaming}
                  />
                )}

                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-0.5">
                    {msg.toolCalls.map((tc) => (
                      <ToolExecutionRow
                        key={tc.id}
                        item={tc}
                        onOpenInWorkbench={handleOpenInWorkbench}
                      />
                    ))}
                  </div>
                )}

                {isCurrentlyGenerating && !content && (
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

              {/* Markdown Assistant Output */}
              {content && (
                <div className="text-[13px] text-[#E3E3E3] leading-relaxed pt-1 prose prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        const isBlock = Boolean(match);
                        return isBlock ? (
                          <div className="my-3 rounded-xl overflow-hidden border border-[#262629] bg-[#18181A]">
                            <div className="px-3 py-1.5 bg-[#1E1E21] border-b border-[#262629] text-[11px] font-mono text-[#8E8E93] flex items-center justify-between select-none">
                              <span>{match?.[1]}</span>
                            </div>
                            <pre className="p-3.5 text-xs font-mono overflow-x-auto text-[#E3E3E3]">
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
                  <span>Working</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
