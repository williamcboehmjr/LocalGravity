import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';

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
  // Always collapsed by default, just like in Antigravity
  const [isOpen, setIsOpen] = useState(false);

  if (!thought && !isStreaming) return null;

  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  const label = isStreaming ? 'Thinking...' : `Thought for ${seconds}s`;

  return (
    <div className="my-1.5 select-none">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group inline-flex items-center gap-2 text-xs sm:text-sm text-text-secondary hover:text-text-primary transition-colors py-1 px-1.5 rounded-md hover:bg-surface/60 cursor-pointer focus:outline-none"
      >
        <Brain className="w-3.5 h-3.5 text-cyan-400/80 shrink-0" />
        <span className="font-sans font-medium text-text-secondary group-hover:text-text-primary transition-colors">
          {label}
        </span>
        {tokenCount > 0 && !isStreaming && (
          <span className="text-[11px] sm:text-xs text-text-muted font-mono">
            ({tokenCount}t)
          </span>
        )}
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted transition-transform" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted transition-transform group-hover:translate-x-0.5" />
        )}
      </button>

      {isOpen && (
        <div className="mt-1.5 ml-1 pl-3.5 border-l-2 border-cyan-500/40 font-mono text-xs sm:text-sm text-text-secondary leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto bg-surface/50 p-3 rounded-r-lg border-y border-r border-border-subtle/40 shadow-inner">
          {thought}
        </div>
      )}
    </div>
  );
};

