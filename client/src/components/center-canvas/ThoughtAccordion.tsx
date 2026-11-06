import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';

interface ThoughtAccordionProps {
  thought: string;
  elapsedMs?: number;
  tokenCount?: number;
  isStreaming?: boolean;
}

export const ThoughtAccordion: React.FC<ThoughtAccordionProps> = ({
  thought,
  elapsedMs = 0,
  tokenCount = 0,
  isStreaming = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [liveMs, setLiveMs] = useState(elapsedMs);

  // Real-time millisecond stopwatch while actively thinking
  useEffect(() => {
    setLiveMs(elapsedMs);
    if (!isStreaming) return;
    const startWall = performance.now() - elapsedMs;
    const interval = setInterval(() => {
      setLiveMs(Math.round(performance.now() - startWall));
    }, 100);
    return () => clearInterval(interval);
  }, [isStreaming, elapsedMs]);

  if (!thought && !isStreaming) return null;

  const formattedSeconds = (Math.max(100, liveMs) / 1000).toFixed(1);
  const effectiveTokens = tokenCount || Math.max(1, Math.ceil((thought || '').length / 4));
  const headerText = isStreaming
    ? `Thinking for ${formattedSeconds}s • ${effectiveTokens} tokens`
    : `Thought for ${formattedSeconds}s • ${effectiveTokens} tokens`;

  return (
    <div className="my-1.5 select-none">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group inline-flex items-center gap-2 text-xs text-[#9AA0A6] hover:text-[#E8EAED] transition-all py-1.5 px-2.5 rounded-xl bg-[#1C2029] hover:bg-[#262B36] border border-[#262B36] cursor-pointer focus:outline-none"
      >
        <span
          className={`w-4 h-4 rounded-md flex items-center justify-center bg-gradient-to-br from-[#8AB4F8] via-[#C58AF9] to-[#F28B82] text-[#0B0D11] shrink-0 ${
            isStreaming ? 'animate-sparkle' : ''
          }`}
        >
          <Sparkles className="w-2.5 h-2.5" />
        </span>

        <span
          className={`font-sans font-medium ${
            isStreaming ? 'antigravity-gradient-text font-semibold' : 'text-[#E8EAED]'
          }`}
        >
          {headerText}
        </span>

        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-[#9AA0A6] transition-transform" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[#9AA0A6] transition-transform group-hover:translate-x-0.5" />
        )}
      </button>

      {isOpen && (
        <div className="mt-1.5 ml-1 pl-3.5 border-l-2 border-[#C58AF9]/60 font-mono text-xs text-[#9AA0A6] leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto bg-[#1C2029]/90 p-3 rounded-r-xl border-y border-r border-[#262B36] shadow-inner">
          {thought || 'Initializing chain-of-thought reasoning...'}
        </div>
      )}
    </div>
  );
};
