import React from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

export const PolicyToggle: React.FC = () => {
  const { executionPolicy, setExecutionPolicy } = useSessionStore();

  const isAlways = executionPolicy === 'always_proceed';

  return (
    <div className="flex items-center gap-1 p-0.5 sm:p-1 bg-surface border border-border-subtle rounded-lg text-xs shrink-0">
      <button
        onClick={() => setExecutionPolicy('always_proceed')}
        className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md text-[11px] sm:text-xs transition-colors ${
          isAlways
            ? 'bg-blue-950/60 text-blue-400 font-medium border border-blue-800/40 shadow-xs'
            : 'text-text-muted hover:text-text-secondary'
        }`}
        title="Always Proceed (Autonomous)"
      >
        <ShieldCheck className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
        <span className="hidden sm:inline">Always Proceed</span>
        <span className="sm:hidden">Auto</span>
      </button>

      <button
        onClick={() => setExecutionPolicy('request_review')}
        className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md text-[11px] sm:text-xs transition-colors ${
          !isAlways
            ? 'bg-amber-950/60 text-amber-400 font-medium border border-amber-800/40 shadow-xs'
            : 'text-text-muted hover:text-text-secondary'
        }`}
        title="Request Review before running tools"
      >
        <ShieldAlert className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
        <span className="hidden sm:inline">Request Review</span>
        <span className="sm:hidden">Review</span>
      </button>
    </div>
  );
};
