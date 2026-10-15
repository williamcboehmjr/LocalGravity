import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { useArtifactStore } from '../../store/useArtifactStore';

export const PlanViewer: React.FC = () => {
  const { planMarkdown } = useArtifactStore();

  return (
    <div className="flex-1 flex flex-col min-h-0 text-xs">
      <div className="flex items-center justify-between p-3 bg-surface border-b border-border-subtle">
        <div className="flex items-center gap-1.5 font-medium text-text-primary">
          <FileText className="w-3.5 h-3.5 text-cyan-400" />
          <span>Implementation Plan (implementation_plan.md)</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 prose prose-invert prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {planMarkdown}
        </ReactMarkdown>
      </div>
    </div>
  );
};
