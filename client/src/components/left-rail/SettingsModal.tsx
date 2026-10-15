import React, { useState } from 'react';
import { X, Settings, Server, Cpu, HardDrive } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { hostUrl, setHostUrl } = useSessionStore();
  const [tempHost, setTempHost] = useState(hostUrl);
  const [lowModel, setLowModel] = useState('qwen3.5:4b');
  const [medModel, setMedModel] = useState('qwen3.5:9b');
  const [highModel, setHighModel] = useState('qwen3.8-27b-vl:latest');
  const [ramdiskPath, setRamdiskPath] = useState('R:\\models');

  if (!isOpen) return null;

  const handleSave = () => {
    setHostUrl(tempHost);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs">
      <div className="w-full max-w-md bg-surface border border-border-strong rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-muted">
          <div className="flex items-center gap-2 font-medium text-text-primary text-sm">
            <Settings className="w-4 h-4 text-accent-blue" />
            <span>LocalGravity Settings</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface rounded text-text-muted hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          {/* Host connection */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 font-medium text-text-primary">
              <Server className="w-3.5 h-3.5 text-accent-cyan" />
              <span>Central Brain WebSocket URL</span>
            </label>
            <input
              type="text"
              value={tempHost}
              onChange={(e) => setTempHost(e.target.value)}
              className="w-full bg-canvas border border-border-subtle rounded-md px-3 py-1.5 font-mono text-text-primary outline-none focus:border-accent-blue"
            />
          </div>

          {/* Model tier mappings */}
          <div className="space-y-2 pt-2 border-t border-border-subtle/50">
            <label className="flex items-center gap-1.5 font-medium text-text-primary">
              <Cpu className="w-3.5 h-3.5 text-purple-400" />
              <span>Tiered Model Mappings (Ollama Tags)</span>
            </label>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-16 font-mono text-blue-400">Low:</span>
                <input
                  type="text"
                  value={lowModel}
                  onChange={(e) => setLowModel(e.target.value)}
                  className="flex-1 bg-canvas border border-border-subtle rounded px-2 py-1 font-mono text-text-primary outline-none focus:border-accent-blue"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="w-16 font-mono text-amber-400">Medium:</span>
                <input
                  type="text"
                  value={medModel}
                  onChange={(e) => setMedModel(e.target.value)}
                  className="flex-1 bg-canvas border border-border-subtle rounded px-2 py-1 font-mono text-text-primary outline-none focus:border-accent-blue"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="w-16 font-mono text-rose-400">High:</span>
                <input
                  type="text"
                  value={highModel}
                  onChange={(e) => setHighModel(e.target.value)}
                  className="flex-1 bg-canvas border border-border-subtle rounded px-2 py-1 font-mono text-text-primary outline-none focus:border-accent-blue"
                />
              </div>
            </div>
          </div>

          {/* RAMDisk configuration */}
          <div className="space-y-1.5 pt-2 border-t border-border-subtle/50">
            <label className="flex items-center gap-1.5 font-medium text-text-primary">
              <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
              <span>Host RAMDisk Path (Optional)</span>
            </label>
            <input
              type="text"
              value={ramdiskPath}
              onChange={(e) => setRamdiskPath(e.target.value)}
              placeholder="e.g. R:\models"
              className="w-full bg-canvas border border-border-subtle rounded-md px-3 py-1.5 font-mono text-text-primary outline-none focus:border-accent-blue"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-surface-muted border-t border-border-subtle">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-blue-600 transition-colors shadow-sm"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
