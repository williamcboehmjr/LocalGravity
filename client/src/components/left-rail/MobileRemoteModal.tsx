import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Smartphone, Copy, Check, Wifi } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

interface MobileRemoteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MobileRemoteModal: React.FC<MobileRemoteModalProps> = ({ isOpen, onClose }) => {
  const { sessionId } = useSessionStore();
  const [copied, setCopied] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState(`http://192.168.0.2:3390/?session=${sessionId}`);
  const [primaryIp, setPrimaryIp] = useState('192.168.0.2');

  useEffect(() => {
    // Query Central Brain for detected network IP
    fetch('/api/remote/info')
      .then((res) => res.json())
      .then((data) => {
        if (data.remote_url) {
          setRemoteUrl(`${data.remote_url}/?session=${sessionId}`);
          setPrimaryIp(data.primary_ip);
        }
      })
      .catch(() => {
        // Fallback using current hostname
        const host = window.location.hostname === 'localhost' ? '192.168.0.2' : window.location.hostname;
        setRemoteUrl(`http://${host}:3390/?session=${sessionId}`);
      });
  }, [sessionId, isOpen]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(remoteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs">
      <div className="w-full max-w-sm bg-surface border border-border-strong rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-muted">
          <div className="flex items-center gap-2 font-medium text-text-primary text-sm">
            <Smartphone className="w-4 h-4 text-accent-blue" />
            <span>Mobile Remote Companion</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface rounded-lg text-text-muted hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col items-center text-center space-y-4">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-950/60 text-blue-400 border border-blue-800/40 text-[11px] font-mono">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span>LAN: {primaryIp}:3390</span>
          </div>

          {/* QR Code Container */}
          <div className="p-3.5 bg-white rounded-xl shadow-inner border border-border-strong/20">
            <QRCodeSVG
              value={remoteUrl}
              size={180}
              level="M"
              includeMargin={false}
            />
          </div>

          <p className="text-xs text-text-secondary leading-relaxed">
            Scan with your phone's camera on the same Wi-Fi network to monitor conversations, thoughts, and tasks in real time.
          </p>

          {/* URL Box & Copy */}
          <div className="w-full flex items-center gap-1.5 bg-canvas border border-border-subtle rounded-lg p-1.5 pl-3">
            <span className="flex-1 font-mono text-[11px] text-text-primary truncate text-left select-all">
              {remoteUrl}
            </span>
            <button
              onClick={handleCopy}
              className="p-1.5 hover:bg-surface rounded-md text-text-muted hover:text-text-primary transition-colors shrink-0"
              title="Copy URL"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-surface-muted/60 border-t border-border-subtle text-[11px] text-text-muted text-center">
          Tip: Tap "Add to Home Screen" on iOS/Android for a fullscreen native app experience.
        </div>
      </div>
    </div>
  );
};
