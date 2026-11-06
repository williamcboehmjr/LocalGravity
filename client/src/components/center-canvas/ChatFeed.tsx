import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Terminal,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Globe,
  Loader2,
  FileCode2,
  ExternalLink,
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

const ToolExecutionPill: React.FC<{
  item: ToolCallItemData;
  onOpenInWorkbench: (item: ToolCallItemData) => void;
}> = ({ item, onOpenInWorkbench }) => {
  const [isOpen, setIsOpen] = useState(false);
  const cmdLower = item.command.toLowerCase();
  const isFileEdit =
    cmdLower.includes('write_file') ||
    cmdLower.includes('apply_diff') ||
    cmdLower.includes('read_file');
  const isSearch = cmdLower.includes('search') || cmdLower.includes('fetch') || cmdLower.includes('inspect');

  const formatPillLabel = () => {
    if (cmdLower.startsWith('run_terminal')) {
      return `⚡ ran powershell: ${item.command}`;
    }
    if (isFileEdit) {
      return `📄 file action: ${item.command}`;
    }
    return `⚡ ${item.command}`;
  };

  return (
    <div className="my-1 select-none">
      <div className="inline-flex items-center gap-1.5 bg-[#1C2029] border border-[#262B36] hover:border-[#8AB4F8]/50 rounded-xl px-2.5 py-1 text-xs transition-all">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-2 text-left cursor-pointer focus:outline-none"
        >
          {isFileEdit ? (
            <FileCode2 className="w-3.5 h-3.5 text-[#8AB4F8] shrink-0" />
          ) : isSearch ? (
            <Globe className="w-3.5 h-3.5 text-[#C58AF9] shrink-0" />
          ) : (
            <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          )}

          <span className="font-mono text-xs text-[#E8EAED] truncate max-w-xs sm:max-w-md">
            {formatPillLabel()}
          </span>

          {item.durationMs !== undefined && item.durationMs > 0 && (
            <span className="text-[10px] font-mono text-[#5F6368]">{item.durationMs}ms</span>
          )}

          {item.status === 'running' && (
            <Loader2 className="w-3 h-3 text-[#8AB4F8] animate-spin shrink-0" />
          )}
          {item.status === 'success' && (
            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
          )}
          {item.status === 'error' && (
            <AlertCircle className="w-3 h-3 text-[#F28B82] shrink-0" />
          )}

          {item.output &&
            (isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#9AA0A6]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#9AA0A6]" />
            ))}
        </button>

        <button
          type="button"
          onClick={() => onOpenInWorkbench(item)}
          className="ml-1 pl-1.5 border-l border-[#262B36] text-[10px] text-[#8AB4F8] hover:underline flex items-center gap-0.5"
          title="Open in Right Workbench"
        >
          <span>Workbench</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </button>
      </div>

      {isOpen && item.output && (
        <div className="mt-1.5 ml-1 pl-3 border-l-2 border-[#8AB4F8]/50 font-mono text-xs text-[#E8EAED] overflow-x-auto bg-[#111318] p-3 rounded-r-xl border-y border-r border-[#262B36] max-h-60">
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
    selectedTier,
    thinkingBudget,
  } = useSessionStore();

  const { setActiveTab } = useArtifactStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentStreamingThought]);

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
      className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5 bg-[#161920]"
    >
      {messages.length === 0 && (
        <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 select-none">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#8AB4F8]/20 via-[#C58AF9]/20 to-[#F28B82]/20 border border-[#8AB4F8]/40 flex items-center justify-center shadow-lg">
            <Sparkles className="w-7 h-7 text-[#8AB4F8] animate-sparkle" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-bold text-[#E8EAED] tracking-tight">
              Google Antigravity 2.0 • LocalGravity
            </h2>
            <p className="text-xs sm:text-sm text-[#9AA0A6] max-w-lg leading-relaxed">
              TabbyAPI EXL2/EXL3 3-Tier Engine (<code className="text-[#8AB4F8]">Low 4B</code>,{' '}
              <code className="text-[#8AB4F8]">Med 9B</code>,{' '}
              <code className="text-[#C58AF9]">High 27B VL</code>) with 128 GB System RAM Hot-Swap
              Cache, Decoupled 3×3 Thinking Matrix, and SQLite WAL Stream Rehydration.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-mono text-[#9AA0A6]">
            <span className="px-2.5 py-1 rounded-lg bg-[#1C2029] border border-[#262B36]">
              Active Tier: <strong className="text-[#8AB4F8]">{selectedTier.toUpperCase()}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-[#1C2029] border border-[#262B36]">
              Thinking Budget:{' '}
              <strong className="text-[#C58AF9]">{thinkingBudget.toUpperCase()}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-[#1C2029] border border-[#262B36]">
              KV Cache: <strong className="text-emerald-400">Q4 + N-gram x4</strong>
            </span>
          </div>
        </div>
      )}

      {messages.map((msg, index) => {
        const isLast = index === messages.length - 1;
        const isCurrentlyGenerating = isLast && isGenerating && msg.role === 'assistant';

        const { thought: parsedThought, content } = parseMessageContent(msg.content, msg.thought);
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

        return (
          <div key={msg.id} className="space-y-2">
            {/* Assistant Turn Header */}
            {msg.role === 'assistant' && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#1C2029] border border-[#262B36] text-[11px] font-mono text-[#8AB4F8]">
                  <Sparkles className="w-3 h-3 text-[#C58AF9]" />
                  <span className="font-semibold">{(msg.tier || selectedTier).toUpperCase()}</span>
                  <span className="text-[#5F6368]">•</span>
                  <span className="text-[#9AA0A6]">
                    {msg.modelName || 'Qwen3.5-9B-EXL3-4.0bpw'}
                  </span>
                </span>
                <span className="text-[11px] text-[#5F6368] font-mono">
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            )}

            {/* User Message Bubble */}
            {msg.role === 'user' && (
              <div className="flex justify-end">
                <div className="max-w-[90%] sm:max-w-2xl bg-[#1C2029] border border-[#262B36] rounded-2xl px-4 py-3 text-sm text-[#E8EAED] shadow-md space-y-2">
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {msg.images.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt="attachment"
                          className="w-24 h-24 object-cover rounded-lg border border-[#262B36]"
                        />
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                </div>
              </div>
            )}

            {/* Assistant Response + Thought Accordion + Nested Tool Execution Pills */}
            {msg.role === 'assistant' && (
              <div className="max-w-full sm:max-w-4xl space-y-2">
                {activeThought || isStreaming ? (
                  <ThoughtAccordion
                    thought={activeThought}
                    elapsedMs={activeElapsedMs}
                    tokenCount={activeTokens}
                    isStreaming={isStreaming}
                  />
                ) : null}

                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-1">
                    {msg.toolCalls.map((tc) => (
                      <ToolExecutionPill
                        key={tc.id}
                        item={tc}
                        onOpenInWorkbench={handleOpenInWorkbench}
                      />
                    ))}
                  </div>
                )}

                {content && (
                  <div className="prose prose-invert max-w-none text-[#E8EAED] leading-relaxed bg-[#1C2029] border border-[#262B36] rounded-2xl p-4 sm:p-5 text-sm shadow-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
