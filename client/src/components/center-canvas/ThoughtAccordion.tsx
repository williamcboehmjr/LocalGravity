import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const NESTED_PIN_THRESHOLD_PX = 28;

interface ThoughtAccordionProps {
  thought: string;
  elapsedMs?: number;
  tokenCount?: number;
  isStreaming?: boolean;
  /** Open by default (e.g. when this is the latest, active timeline step). User toggle wins. */
  defaultOpen?: boolean;
  onInspectChange?: (panelId: string, paused: boolean) => void;
  onCollapseReset?: (panelId: string) => void;
}

export const ThoughtAccordion: React.FC<ThoughtAccordionProps> = ({
  thought,
  elapsedMs = 0,
  tokenCount = 0,
  isStreaming = false,
  defaultOpen = false,
  onInspectChange,
  onCollapseReset,
}) => {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const isOpen = userOpen ?? defaultOpen;
  const [liveMs, setLiveMs] = useState(elapsedMs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const panelId = useId();
  const elapsedMsRef = useRef(elapsedMs);
  elapsedMsRef.current = elapsedMs;

  const isPinnedRef = useRef(true);
  const prevScrollTopRef = useRef(0);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticRafRef = useRef<number | null>(null);
  const prevIsStreamingRef = useRef(isStreaming);
  const userOpenRef = useRef(userOpen);
  userOpenRef.current = userOpen;

  const pinToBottom = useCallback((el: HTMLDivElement | null) => {
    if (!el || el.clientHeight === 0) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    prevScrollTopRef.current = el.scrollTop;
    if (programmaticRafRef.current !== null) {
      cancelAnimationFrame(programmaticRafRef.current);
    }
    programmaticRafRef.current = requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
      programmaticRafRef.current = null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (programmaticRafRef.current !== null) {
        cancelAnimationFrame(programmaticRafRef.current);
      }
      onInspectChange?.(panelId, false);
    };
  }, [onInspectChange, panelId]);

  // Sync authoritative elapsed time when not actively streaming
  useEffect(() => {
    if (!isStreaming) {
      setLiveMs(elapsedMs);
    }
  }, [isStreaming, elapsedMs]);

  // Run interval ONLY keyed on [isStreaming] so incoming chunks never recreate the timer
  useEffect(() => {
    if (!isStreaming) return;
    const initialElapsed = elapsedMsRef.current;
    setLiveMs(initialElapsed);
    const startWall = performance.now() - initialElapsed;
    const interval = setInterval(() => {
      setLiveMs(Math.max(elapsedMsRef.current, Math.round(performance.now() - startWall)));
    }, 100);
    return () => clearInterval(interval);
  }, [isStreaming]);

  // Reset userOpen to null ONLY when isStreaming transitions true -> false
  useEffect(() => {
    if (prevIsStreamingRef.current && !isStreaming) {
      setUserOpen(null);
      isPinnedRef.current = true;
      onInspectChange?.(panelId, false);
    }
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming, onInspectChange, panelId]);

  // Independent ResizeObserver auto-scroll for the thought body while open and streaming
  useEffect(() => {
    if (!isOpen || !isStreaming) return;
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    if (isPinnedRef.current) {
      pinToBottom(el);
    }
    const ro = new ResizeObserver(() => {
      if (isPinnedRef.current) {
        pinToBottom(el);
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [isOpen, isStreaming, pinToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    const curTop = el.scrollTop;
    const prevTop = prevScrollTopRef.current;
    prevScrollTopRef.current = curTop;
    const distanceFromBottom = el.scrollHeight - curTop - el.clientHeight;
    const atBottom = distanceFromBottom <= NESTED_PIN_THRESHOLD_PX;
    const scrolledUp = curTop < prevTop - 1;

    if (scrolledUp && !atBottom) {
      isPinnedRef.current = false;
      onInspectChange?.(panelId, true);
    } else if (isProgrammaticScrollRef.current) {
      return;
    } else if (atBottom) {
      isPinnedRef.current = true;
      if (userOpenRef.current !== true) {
        onInspectChange?.(panelId, false);
      }
    } else {
      isPinnedRef.current = false;
    }
  }, [onInspectChange, panelId]);

  const handleToggle = () => {
    const nextOpen = !isOpen;
    setUserOpen(nextOpen);
    isPinnedRef.current = true;
    if (nextOpen) {
      onInspectChange?.(panelId, true);
      requestAnimationFrame(() => pinToBottom(scrollRef.current));
    } else {
      onCollapseReset?.(panelId);
    }
  };

  if (!thought && !isStreaming) return null;

  const seconds = Math.max(0.1, liveMs / 1000);
  const formattedTime = seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
  const effectiveTokens = tokenCount || Math.max(1, Math.ceil((thought || '').length / 4));

  return (
    <div className="py-0.5 select-none">
      {/* Minimalist Antigravity Thought Row */}
      <button
        type="button"
        onClick={handleToggle}
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
          onScroll={handleScroll}
          className={`mt-1.5 pl-3 border-l text-[13px] leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto overscroll-contain py-1.5 select-text transition-colors ${
            isStreaming
              ? 'border-[#3C4043] text-[#BDC1C6]'
              : 'border-[#2D2F34] text-[#9AA0A6]'
          }`}
        >
          <div ref={contentRef}>
            {thought || 'Analyzing request and context...'}
            {isStreaming && (
              <span className="inline-block w-1.5 h-3.5 bg-[#8AB4F8] animate-pulse ml-1 align-middle" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
