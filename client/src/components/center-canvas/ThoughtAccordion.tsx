import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Loader2, Brain } from 'lucide-react';

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
  // Auto-expand while streaming, auto-collapse once done (unless user manually toggled)
  const [isOpen, setIsOpen] = useState<boolean>(isStreaming);
  const [userToggled, setUserToggled] = useState<boolean>(false);
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

  // Auto-expand while streaming, auto-collapse when done
  useEffect(() => {
    if (isStreaming) {
      if (!userToggled) setIsOpen(true);
    } else {
      setIsOpen(false);
      setUserToggled(false);
    }
  }, [isStreaming]);

  // Auto-scroll the thought body to the bottom as new tokens arrive
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
    <div className="my-1 select-none">
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setIsOpen(!isOpen);
        }}
        className="group inline-flex items-center gap-1.5 text-xs text-[#8E8E93] hover:text-[#E3E3E3] transition-colors py-1 cursor-pointer focus:outline-none"
      >
        {isStreaming ? (
          <Loader2 className="w-3 h-3 text-[#8E8E93] animate-spin shrink-0" />
        ) : (
          <Brain className="w-3 h-3 text-[#6E6E73] shrink-0" />
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

      {/* Expanded Thought Body */}
      {isOpen && (
        <div
          ref={scrollRef}
          className={`mt-1 ml-1 pl-3 border-l text-xs leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto py-1 select-text transition-colors ${
            isStreaming
              ? 'border-[#3A3A40] text-[#B0B0B5] bg-[#1A1A1D] rounded-r-lg'
              : 'border-[#2C2C30] text-[#9A9A9E]'
          }`}
        >
          {thought || 'Thinking...'}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3 bg-[#8E8E93] animate-pulse ml-0.5 align-middle" />
          )}
        </div>
      )}
    </div>
  );
};