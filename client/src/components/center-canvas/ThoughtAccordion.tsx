import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ThoughtAccordionProps {
  thought: string;
  elapsedMs?: number;
  tokenCount?: number;
  isStreaming?: boolean;
  /** Open by default (e.g. when this is the latest, active timeline step). User toggle wins. */
  defaultOpen?: boolean;
}

export const ThoughtAccordion: React.FC<ThoughtAccordionProps> = ({
  thought,
  elapsedMs = 0,
  tokenCount = 0,
  isStreaming = false,
  defaultOpen = false,
}) => {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const isOpen = userOpen ?? defaultOpen;
  const setIsOpen = (v: boolean) => setUserOpen(v);
  const [liveMs, setLiveMs] = useState(elapsedMs);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync live elapsed timer while streaming
  useEffect(() => {
    setLiveMs(elapsedMs);
    if (!isStreaming) return;
    const startWall = performance.now() - elapsedMs;
    const interval = setInterval(() => {
      setLiveMs(Math.round(performance.now() - startWall));
    }, 100);
    return () => clearInterval(interval);
  }, [isStreaming, elapsedMs]);

  // Auto-scroll the thought body to the bottom as new tokens arrive if user has it open
  useEffect(() => {
    if (isOpen && isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thought, isOpen, isStreaming]);

  if (!thought && !isStreaming) return null;

  const seconds = Math.max(0.1, liveMs / 1000);
  const formattedTime = seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
  const effectiveTokens = tokenCount || Math.max(1, Math.ceil((thought || '').length / 4));

  return (
    <div className="py-0.5 select-none">
      {/* Minimalist Antigravity Thought Row */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group inline-flex items-center gap-1.5 text-[13px] text-[#8E8E93] hover:text-[#E8EAED] transition-colors py-0.5 cursor-pointer focus:outline-none"
      >
        <span className="font-sans">
          {isStreaming ? `Thinking (${formattedTime})` : `Thought for ${formattedTime}`}
        </span>

        {effectiveTokens > 0 && (
          <span className="text-[11.5px] text-[#5F6368] hidden sm:inline">
            ({effectiveTokens} tok)
          </span>
        )}

        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-[#70757A] group-hover:text-[#9AA0A6] shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[#70757A] group-hover:text-[#9AA0A6] shrink-0" />
        )}
      </button>

      {/* Expanded Thought Body (On demand) */}
      {isOpen && (
        <div
          ref={scrollRef}
          className={`mt-1.5 pl-3 border-l text-[13px] leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto py-1.5 select-text transition-colors ${
            isStreaming
              ? 'border-[#3C4043] text-[#BDC1C6]'
              : 'border-[#2D2F34] text-[#9AA0A6]'
          }`}
        >
          {thought || 'Analyzing request and context...'}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 bg-[#8AB4F8] animate-pulse ml-1 align-middle" />
          )}
        </div>
      )}
    </div>
  );
};
