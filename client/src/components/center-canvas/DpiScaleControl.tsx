import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

export const DpiScaleControl: React.FC = () => {
  const { dpiScale, zoomIn, zoomOut, resetZoom } = useSessionStore();
  const percentage = Math.round(dpiScale * 100);

  return (
    <div
      className="flex items-center rounded-full bg-[#18191C] border border-[#2B2C32] p-0.5 text-xs text-[#9AA0A6] select-none shadow-xs transition-colors hover:border-[#3C3E45]"
      title="UI / DPI Scale (Ctrl + to zoom in, Ctrl - to zoom out, Ctrl 0 to reset)"
    >
      <button
        type="button"
        onClick={zoomOut}
        disabled={dpiScale <= 0.75}
        className="p-1 rounded-full hover:bg-[#25262B] hover:text-[#E8EAED] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#9AA0A6] transition-colors cursor-pointer"
        aria-label="Zoom Out"
        title="Zoom Out (Ctrl -)"
      >
        <Minus className="w-3 h-3" />
      </button>

      <button
        type="button"
        onClick={resetZoom}
        className="px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#BDC1C6] hover:text-[#8AB4F8] transition-colors cursor-pointer"
        title="Click to reset to 100% (Ctrl 0)"
      >
        {percentage}%
      </button>

      <button
        type="button"
        onClick={zoomIn}
        disabled={dpiScale >= 1.75}
        className="p-1 rounded-full hover:bg-[#25262B] hover:text-[#E8EAED] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#9AA0A6] transition-colors cursor-pointer"
        aria-label="Zoom In"
        title="Zoom In (Ctrl +)"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
};
