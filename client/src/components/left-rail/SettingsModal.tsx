import React, { useState } from 'react';
import {
  X,
  Settings,
  Server,
  Cpu,
  HardDrive,
  Wifi,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';
import { testBrainConnection, cleanHostAndPort } from '../../utils/connectionTester';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { brainHost, brainPort, setBrainConnection } = useSessionStore();

  const [inputHost, setInputHost] = useState(brainHost || '127.0.0.1');
  const [inputPort, setInputPort] = useState(brainPort || '3390');

  const [testState, setTestState] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error';
    message?: string;
    latency?: number;
  }>({ status: 'idle' });

  const [lowModel, setLowModel] = useState('qwen3.5:4b');
  const [medModel, setMedModel] = useState('qwen3.5:9b');
  const [highModel, setHighModel] = useState('qwen3.8-27b-vl:latest');
  const [ramdiskPath, setRamdiskPath] = useState('R:\\models');

  if (!isOpen) return null;

  const { host: resolvedHost, port: resolvedPort } = cleanHostAndPort(inputHost, inputPort);

  const handleTest = async () => {
    setTestState({ status: 'testing' });
    try {
      const result = await testBrainConnection(inputHost, inputPort);
      if (result.ok) {
        setTestState({
          status: 'success',
          message: result.message,
          latency: result.latency,
        });
      } else {
        setTestState({
          status: 'error',
          message: result.message,
        });
      }
    } catch (err: any) {
      setTestState({
        status: 'error',
        message: err?.message || 'Unexpected error during connection test.',
      });
    }
  };

  const handleSave = () => {
    setBrainConnection(inputHost, inputPort);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-surface border border-border-strong rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-muted">
          <div className="flex items-center gap-2 font-medium text-text-primary text-sm">
            <Settings className="w-4 h-4 text-accent-blue" />
            <span>LocalGravity Settings</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-surface rounded text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
          {/* PC Brain Connection Config */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 font-semibold text-text-primary text-xs">
                <Server className="w-4 h-4 text-accent-cyan" />
                <span>Central Brain (Windows PC)</span>
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setInputHost('127.0.0.1');
                    setInputPort('3390');
                  }}
                  className="px-2 py-0.5 rounded text-[10px] font-mono bg-canvas border border-border-subtle text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
                >
                  Localhost
                </button>
              </div>
            </div>

            <p className="text-[11px] text-text-muted leading-relaxed">
              Enter the LAN IP and port of the Windows PC running LocalGravity Brain.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="sm:col-span-3 space-y-1">
                <span className="text-[10px] text-text-muted font-medium">PC IP Address or Hostname</span>
                <div className="relative flex items-center">
                  <Wifi className="w-3.5 h-3.5 absolute left-2.5 text-text-muted" />
                  <input
                    type="text"
                    value={inputHost}
                    onChange={(e) => {
                      setInputHost(e.target.value);
                      setTestState({ status: 'idle' });
                    }}
                    placeholder="e.g. 192.168.1.150"
                    className="w-full bg-canvas border border-border-subtle rounded-md pl-8 pr-3 py-1.5 font-mono text-text-primary outline-none focus:border-accent-blue"
                  />
                </div>
              </div>

              <div className="sm:col-span-1 space-y-1">
                <span className="text-[10px] text-text-muted font-medium">Port</span>
                <input
                  type="text"
                  value={inputPort}
                  onChange={(e) => {
                    setInputPort(e.target.value);
                    setTestState({ status: 'idle' });
                  }}
                  placeholder="3390"
                  className="w-full bg-canvas border border-border-subtle rounded-md px-2.5 py-1.5 font-mono text-text-primary outline-none focus:border-accent-blue text-center"
                />
              </div>
            </div>

            {/* Test Connection Button & Status */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleTest}
                disabled={testState.status === 'testing'}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-surface border border-border-strong hover:border-accent-blue text-text-primary font-medium transition-all shadow-xs disabled:opacity-50"
              >
                {testState.status === 'testing' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-blue" />
                    <span>Testing Connection to {resolvedHost}:{resolvedPort}...</span>
                  </>
                ) : (
                  <>
                    <Server className="w-3.5 h-3.5 text-accent-blue" />
                    <span>Test Connection</span>
                  </>
                )}
              </button>

              {/* Live Test Feedback */}
              {testState.status === 'success' && (
                <div className="mt-2.5 p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 animate-in fade-in duration-150">
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Connected Successfully! ({testState.latency}ms)</span>
                  </div>
                  <p className="mt-1 text-[11px] text-emerald-400/90 pl-6">
                    WebSocket sync and API services responded on {resolvedHost}:{resolvedPort}.
                  </p>
                </div>
              )}

              {testState.status === 'error' && (
                <div className="mt-2.5 p-3 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-300 animate-in fade-in duration-150">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>Connection Failed</span>
                  </div>
                  <p className="mt-1 text-[11px] text-rose-300/90 pl-6 leading-relaxed">
                    {testState.message}
                  </p>
                  <div className="mt-2 pl-6 pt-2 border-t border-rose-900/50 text-[10px] text-rose-300/80 space-y-1">
                    <div className="font-semibold text-rose-200">Troubleshooting checklist:</div>
                    <p>1. Ensure LocalGravity is running on your PC (run <code>.\start_localgravity.ps1</code>).</p>
                    <p>2. Verify your Mac and PC are connected to the same Wi-Fi / Local Network.</p>
                    <p>3. On PC, check Windows Firewall allows inbound TCP port {resolvedPort}.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Resolved URL Preview */}
            <div className="bg-canvas border border-border-subtle/60 rounded-md p-2 space-y-1 text-[10px] text-text-muted font-mono">
              <div className="flex items-center justify-between">
                <span>WS URL:</span>
                <span className="text-accent-cyan truncate">ws://{resolvedHost}:{resolvedPort}/ws/sync</span>
              </div>
              <div className="flex items-center justify-between">
                <span>HTTP API:</span>
                <span className="text-accent-blue truncate">http://{resolvedHost}:{resolvedPort}</span>
              </div>
            </div>
          </div>

          {/* Model tier mappings */}
          <div className="space-y-2 pt-3 border-t border-border-subtle/50">
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
          <div className="space-y-1.5 pt-3 border-t border-border-subtle/50">
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
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-[#E3E3E3] text-[#101012] hover:bg-white transition-colors shadow-sm"
          >
            <span>Save & Connect</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};


