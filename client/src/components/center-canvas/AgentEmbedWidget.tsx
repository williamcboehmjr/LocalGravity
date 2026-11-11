import React, { useState, useRef, useEffect } from 'react';
import { Maximize2, Code2, ExternalLink } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';
import { useArtifactStore } from '../../store/useArtifactStore';

interface AgentEmbedWidgetProps {
  src: string;
  fallbackText?: string;
}

/**
 * Sandboxed generative UI embed rendered inline for <agent-embed src="...">.
 * Resolves local artifact IDs/paths to /api/artifacts/:id/raw or /api/workspace/file.
 */
export const AgentEmbedWidget: React.FC<AgentEmbedWidgetProps> = ({ src, fallbackText }) => {
  const apiBaseUrl = useSessionStore((s) => s.apiBaseUrl);
  const { artifacts, setActiveArtifactId, setActiveArtifactDoc, setActiveTab } = useArtifactStore();
  const [height, setHeight] = useState(260);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const normalizePath = (v: string) =>
    v.replace(/^file:\/\/\/?/i, '').replace(/^\/([a-zA-Z]:)/, '$1').replace(/\\/g, '/').toLowerCase();
  const normSrc = normalizePath(src);

  const matchedArtifact = artifacts.find(
    (a) =>
      a.id === src ||
      a.title === src ||
      (a.filePath && normalizePath(a.filePath) === normSrc)
  );

  let resolvedSrc = src;
  if (matchedArtifact) {
    resolvedSrc = `${apiBaseUrl}/api/artifacts/${encodeURIComponent(matchedArtifact.id)}/raw`;
  } else if (/^artifact:\/\//i.test(src)) {
    const id = src.replace(/^artifact:\/\//i, '');
    resolvedSrc = `${apiBaseUrl}/api/artifacts/${encodeURIComponent(id)}/raw`;
  } else if (/^file:\/\//i.test(src)) {
    const p = src.replace(/^file:\/\/\/?/i, '');
    resolvedSrc = `${apiBaseUrl}/api/workspace/file?path=${encodeURIComponent(p)}`;
  } else if (!/^https?:\/\//i.test(src) && !src.startsWith('/')) {
    resolvedSrc = `${apiBaseUrl}/api/artifacts/${encodeURIComponent(src)}/raw`;
  } else if (src.startsWith('/')) {
    resolvedSrc = `${apiBaseUrl}${src}`;
  }

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const h = Number(e.data?.height || e.data?.embedHeight);
      if (Number.isFinite(h) && h > 40) {
        setHeight(Math.min(500, Math.max(120, Math.round(h))));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const el = iframeRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      try {
        const doc = el.contentDocument;
        if (doc?.body) {
          const sh = doc.body.scrollHeight;
          if (sh > 40) setHeight(Math.min(500, Math.max(120, sh + 16)));
        }
      } catch {}
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleExpand = () => {
    if (matchedArtifact) {
      setActiveArtifactId(matchedArtifact.id);
      setActiveArtifactDoc(matchedArtifact.id);
    }
    setActiveTab('plan');
  };

  return (
    <div className="my-3 rounded-xl border border-[#2D2F34] bg-[#141518] overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1C1D20] border-b border-[#2D2F34] text-[11.5px] text-[#9AA0A6] select-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <Code2 className="w-3.5 h-3.5 text-[#8AB4F8] shrink-0" />
          <span className="truncate font-mono text-[#E8EAED]">
            {matchedArtifact?.title || src}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleExpand}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#282A2E] text-[#8AB4F8] text-[11px] transition-colors cursor-pointer"
            title="Expand in Side Pane"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Expand in Side Pane</span>
          </button>
          <a
            href={resolvedSrc}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-[#282A2E] text-[#9AA0A6] hover:text-[#E8EAED]"
            title="Open raw"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      <iframe
        ref={iframeRef}
        src={resolvedSrc}
        title={matchedArtifact?.title || src}
        sandbox="allow-scripts"
        style={{ height: `${height}px` }}
        className="w-full max-h-[500px] border-0 bg-[#0c0d0e] block"
      />
      {fallbackText && (
        <div className="px-3 py-1 text-[11px] text-[#6E6E73] border-t border-[#222327]">
          {fallbackText}
        </div>
      )}
    </div>
  );
};
