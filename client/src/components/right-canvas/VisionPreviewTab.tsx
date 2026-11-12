import React, { useState } from 'react';
import { Camera, Globe, RefreshCw, Eye } from 'lucide-react';
import { useArtifactStore } from '../../store/useArtifactStore';
import { useSessionStore } from '../../store/useSessionStore';

export const VisionPreviewTab: React.FC = () => {
  const {
    latestVisionCapture,
    setLatestVisionCapture,
    previewUrl,
    setPreviewUrl,
  } = useArtifactStore();
  const { apiBaseUrl } = useSessionStore();
  const [urlInput, setUrlInput] = useState(previewUrl || '');
  const [isCapturing, setIsCapturing] = useState(false);

  const handleCaptureScreen = async () => {
    setIsCapturing(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/vision/capture`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setLatestVisionCapture(data);
      }
    } catch {}
    setIsCapturing(false);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#131314] overflow-y-auto p-3 space-y-4">
      {/* 1. Vision-Language Grounding Capture */}
      <div className="p-3 rounded-xl bg-[#18181B] border border-[#222226] space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E3E3E3]">
            <Eye className="w-4 h-4 text-[#C58AF9]" />
            <span>Vision-Language Grounding (What Qwen VL Sees)</span>
          </div>
          <button
            type="button"
            onClick={handleCaptureScreen}
            disabled={isCapturing}
            className="px-2.5 py-1 rounded-lg bg-[#242427] hover:bg-[#2E2E32] border border-[#34343A] text-[#E3E3E3] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{isCapturing ? 'Capturing...' : 'Capture Screen'}</span>
          </button>
        </div>

        {latestVisionCapture ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#9A9A9E]">
              <span>{latestVisionCapture.activeWindowTitle}</span>
              <span>{latestVisionCapture.resolution || '1920x1080'}</span>
            </div>
            <div className="rounded-lg overflow-hidden border border-[#2C2C30] bg-[#101012]">
              <img
                src={latestVisionCapture.base64DataUrl}
                alt="Desktop Grounding Capture"
                className="w-full max-h-56 object-contain"
              />
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-[#9A9A9E] border border-dashed border-[#2C2C30] rounded-lg">
            Click <strong>Capture Screen</strong> or ask the agent to inspect the screen to view live
            VL grounding frames.
          </div>
        )}
      </div>

      {/* 2. Live Web App Iframe Preview */}
      <div className="flex-1 flex flex-col min-h-[260px] rounded-xl bg-[#18181B] border border-[#222226] overflow-hidden">
        <div className="p-2 bg-[#101012] border-b border-[#222226] flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5 text-[#8AB4F8] shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setPreviewUrl(urlInput);
            }}
            placeholder="Enter local web app URL to preview..."
            className="flex-1 bg-[#18181B] border border-[#2C2C30] focus:border-[#8AB4F8] rounded px-2 py-1 text-xs font-mono text-[#E3E3E3] outline-none"
          />
          <button
            type="button"
            onClick={() => setPreviewUrl(urlInput)}
            className="p-1.5 rounded bg-[#242427] hover:bg-[#2E2E32] text-[#E3E3E3]"
            title="Load Preview"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {previewUrl ? (
          <iframe
            src={previewUrl}
            title="Live App Preview"
            className="flex-1 w-full bg-white border-0"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-[#6E6E73] p-6 text-center">
            Enter a URL above to preview a running web application inside the Right Workbench.
          </div>
        )}
      </div>
    </div>
  );
};
