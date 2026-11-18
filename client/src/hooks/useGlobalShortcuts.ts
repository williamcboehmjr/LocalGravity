import { useEffect } from 'react';
import { applyDpiScaleToDom } from '../store/useSessionStore';

interface UseGlobalShortcutsOptions {
  dpiScale: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export function useGlobalShortcuts({
  dpiScale,
  zoomIn,
  zoomOut,
  resetZoom,
}: UseGlobalShortcutsOptions): void {
  useEffect(() => {
    applyDpiScaleToDom(dpiScale);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomIn();
        } else if (e.key === '-') {
          e.preventDefault();
          zoomOut();
        } else if (e.key === '0') {
          e.preventDefault();
          resetZoom();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dpiScale, zoomIn, zoomOut, resetZoom]);
}
