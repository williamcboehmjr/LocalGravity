import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

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

  const seconds = Math.max(0.1, liveMs / 1000);
  const formattedTime = seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
  const effectiveTokens = tokenCount || Math.max(1, Math.ceil((thought || '').length / 4));

  return (
    <div className="my-1 select-none">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group inline-flex items-center gap-1.5 text-xs text-[#8E8E93] hover:text-[#E3E3E3] transition-colors py-1 cursor-pointer focus:outline-none"
      >
        {isStreaming && (
          <Loader2 className="w-3 h-3 text-[#8E8E93] animate-spin shrink-0" />
        )}

        <span className="font-sans">
          {isStreaming ? `Thinking for ${formattedTime}` : `Thought for ${formattedTime}`}
        </span>

        {effectiveTokens > 0 && (
          <span className="text-[11px] text-[#5E5E63] hidden sm:inline">
            ({effectiveTokens} tok)
          </span>
        )}

        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-[#6E6E73] group-hover:text-[#9A9A9E] transition-transform" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[#6E6E73] group-hover:text-[#9A9A9E] transition-transform group-hover:translate-x-0.5" />
        )}
      </button>

      {isOpen && (
        <div className="mt-1 ml-1 pl-3 border-l border-[#2C2C30] text-xs text-[#9A9A9E] leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto py-1 select-text">
          {thought || 'Thinking...'}
        </div>
      )}
    </div>
  );
};
