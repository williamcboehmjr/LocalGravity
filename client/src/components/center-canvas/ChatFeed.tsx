import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Terminal, CheckCircle2, AlertCircle, Sparkles, ChevronRight, ChevronDown, Globe, Loader2 } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';
import { ThoughtAccordion } from './ThoughtAccordion';
import { Badge } from '../common/Badge';

function parseMessageContent(rawContent: string, existingThought?: string) {
  let thought = existingThought || '';
  let content = rawContent || '';

  // Extract closed thought tags
  const thoughtMatch = content.match(/<(thought|think)>([\s\S]*?)<\/(thought|think)>/i);
  if (thoughtMatch) {
    if (!thought) {
      thought = thoughtMatch[2].trim();
    }
    content = content.replace(thoughtMatch[0], '').trim();
  }

  // Extract unclosed thought tags
  const openMatch = content.match(/<(thought|think)>([\s\S]*)/i);
  if (openMatch) {
    if (!thought) {
      thought = openMatch[2].trim();
    }
    content = content.replace(openMatch[0], '').trim();
  }

  return { thought, content };
}

// Sleek single-line Tool Call Item (Antigravity parity with web search support)
const ToolCallItem: React.FC<{ command: string; output?: string; status?: 'running' | 'success' | 'error' }> = ({
  command,
  output,
  status = 'success',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const isSearch = command.includes('search') || command.includes('fetch');

  return (
    <div className="my-1.5 select-none">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group inline-flex items-center gap-2 text-xs sm:text-sm text-text-secondary hover:text-text-primary transition-colors py-1 px-1.5 rounded-md hover:bg-surface/60 cursor-pointer focus:outline-none"
      >
        {isSearch ? (
          <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        ) : (
          <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        )}

        <span
          className={`font-mono text-xs sm:text-sm truncate max-w-xs sm:max-w-md ${
            isSearch
              ? 'text-cyan-300/90 group-hover:text-cyan-200'
              : 'text-emerald-300/90 group-hover:text-emerald-200'
          }`}
        >
          {command}
        </span>

        {status === 'running' && <Loader2 className="w-3 h-3 text-cyan-400 animate-spin shrink-0" />}
        {status === 'success' && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
        {status === 'error' && <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />}
        {output && (
          isOpen ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted group-hover:translate-x-0.5" />
        )}
      </button>

      {isOpen && output && (
        <div
          className={`mt-1.5 ml-1 pl-3.5 border-l-2 font-mono text-xs sm:text-sm text-zinc-200 overflow-x-auto bg-surface/60 p-3 rounded-r-lg border-y border-r border-border-subtle/40 shadow-inner max-h-60 ${
            isSearch ? 'border-cyan-500/40' : 'border-emerald-500/40'
          }`}
        >
          <pre className="whitespace-pre-wrap">{output}</pre>
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

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentStreamingThought]);

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4">
      {messages.length === 0 && (
        <div className="h-full flex flex-col items-center justify-center text-center p-6 sm:p-8 space-y-3.5 select-none">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-accent-blue/20 to-purple-500/20 border border-accent-blue/30 flex items-center justify-center text-accent-blue shadow-lg">
            <Sparkles className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-text-primary tracking-tight">LocalGravity 2.0</h2>
          <p className="text-sm sm:text-base text-text-secondary max-w-md leading-relaxed">
            Local-first Antigravity engine powered by local Ollama models.
            Reverse-RPC execution runs natively on your machine with high-speed model switching and multimodal vision.
          </p>
        </div>
      )}

      {messages.map((msg, index) => {
        const isLast = index === messages.length - 1;
        const isCurrentlyGenerating = isLast && isGenerating && msg.role === 'assistant';

        const { thought: parsedThought, content } = parseMessageContent(msg.content, msg.thought);
        const activeThought = isCurrentlyGenerating ? (currentStreamingThought || parsedThought) : (msg.thought || parsedThought);
        const activeElapsedMs = isCurrentlyGenerating ? currentThoughtElapsedMs : msg.thoughtElapsedMs;
        const activeTokens = isCurrentlyGenerating ? currentThoughtTokens : msg.thoughtTokenCount;
        const isStreaming = isCurrentlyGenerating && !isThinkingFinished;

        return (
          <div key={msg.id} className="space-y-1.5">
            {/* Turn Metadata Header for Assistant */}
            {msg.role === 'assistant' && (
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="blue" size="sm">
                  <span className="font-semibold">⚡ {msg.tier?.toUpperCase() || 'LOW'}</span>
                  <span className="text-text-muted">•</span>
                  <span>{msg.modelName || 'qwen3.5:4b'}</span>
                </Badge>
                <span className="text-xs text-text-muted">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}

            {/* User Message */}
            {msg.role === 'user' && (
              <div className="flex justify-end">
                <div className="max-w-[90%] sm:max-w-2xl bg-surface-highlight border border-border-strong rounded-2xl px-4 py-3 text-sm sm:text-base text-zinc-100 shadow-md space-y-2.5">
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {msg.images.map((img, i) => (
                        <img key={i} src={img} alt="user visual" className="w-24 h-24 sm:w-28 sm:h-28 object-cover rounded-lg border border-border-subtle shadow-xs" />
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                </div>
              </div>
            )}

            {/* Assistant Message with Thought Accordion and Tool Calls */}
            {msg.role === 'assistant' && (
              <div className="max-w-full sm:max-w-3xl space-y-1.5">
                {/* Collapsed single-line thought like Antigravity */}
                {activeThought ? (
                  <ThoughtAccordion
                    thought={activeThought}
                    elapsedMs={activeElapsedMs}
                    tokenCount={activeTokens}
                    isStreaming={isStreaming}
                  />
                ) : isCurrentlyGenerating && !content && !msg.toolCommand ? (
                  <div className="inline-flex items-center gap-2 py-1.5 px-3 rounded-lg text-xs font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                ) : null}

                {/* Collapsed single-line tool calls (shows all tools executed during the turn) */}
                {msg.toolCalls && msg.toolCalls.length > 0 ? (
                  <div className="space-y-1 my-1">
                    {msg.toolCalls.map((tc) => (
                      <ToolCallItem
                        key={tc.id}
                        command={tc.command}
                        output={tc.output}
                        status={tc.status}
                      />
                    ))}
                  </div>
                ) : msg.toolCommand ? (
                  <ToolCallItem
                    command={msg.toolCommand}
                    output={msg.toolOutput}
                    status={msg.toolStatus}
                  />
                ) : null}

                {/* Markdown Content */}
                {content && (
                  <div className="prose prose-invert max-w-none text-zinc-100 leading-relaxed bg-surface/50 border border-border-subtle rounded-2xl p-4 sm:p-5 text-sm sm:text-base shadow-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {content}
                    </ReactMarkdown>
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
