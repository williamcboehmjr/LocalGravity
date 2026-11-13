import React, { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import {
  X,
  Settings,
  Server,
  Cpu,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Download,
  ExternalLink,
  ZoomIn,
  KeyRound,
  Cloud,
} from 'lucide-react';
import {
  useSessionStore,
  GOOGLE_MODEL_OPTIONS,
  BrainProviderId,
  GoogleModelId,
} from '../../store/useSessionStore';
import { testBrainConnection, cleanHostAndPort } from '../../utils/connectionTester';
import {
  checkForAppUpdates,
  downloadAndApplyUpdate,
  UpdateInfo,
  isTauriEnvironment,
} from '../../services/updaterService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const {
    brainHost,
    brainPort,
    setBrainConnection,
    dpiScale,
    setDpiScale,
    executionPolicy,
    setExecutionPolicy,
    apiBaseUrl,
    brainProvider,
    selectedGoogleModel,
    googleHasApiKey,
    googleMaskedApiKey,
    setBrainProviderState,
  } = useSessionStore();

  const [inputHost, setInputHost] = useState(brainHost || '127.0.0.1');
  const [inputPort, setInputPort] = useState(brainPort || '3390');
  const [gpuActionStatus, setGpuActionStatus] = useState<string | null>(null);
  const [googleKeyInput, setGoogleKeyInput] = useState('');
  const [providerStatusMsg, setProviderStatusMsg] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);

  const [testState, setTestState] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error';
    message?: string;
    latency?: number;
  }>({ status: 'idle' });

  const [highModel, setHighModel] = useState('Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS (Strata + Vision • 64k)');
  const [ramdiskPath, setRamdiskPath] = useState('R:\\models');

  // Update State
  const [currentAppVersion, setCurrentAppVersion] = useState<string>('2.3.9');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'found' | 'up-to-date' | 'downloading' | 'error'>('idle');
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ percent: number; statusText: string }>({ percent: 0, statusText: '' });
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (isTauriEnvironment()) {
      getVersion()
        .then((v) => {
          if (v) setCurrentAppVersion(v);
        })
        .catch(() => {});
    }
    if (isOpen && apiBaseUrl) {
      fetch(`${apiBaseUrl}/api/brain/provider`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) setBrainProviderState(data);
        })
        .catch(() => {});
    }
  }, [isOpen, apiBaseUrl]);

  if (!isOpen) return null;

  const updateBrainProviderOnServer = async (patch: {
    provider?: BrainProviderId;
    googleApiKey?: string;
    selectedGoogleModel?: GoogleModelId;
  }) => {
    setSavingProvider(true);
    setProviderStatusMsg(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/brain/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setBrainProviderState(data);
        if (patch.googleApiKey) {
          setGoogleKeyInput('');
          setProviderStatusMsg('Google AI Studio key saved on Central Brain');
        } else if (patch.provider === 'google_ai_studio') {
          setProviderStatusMsg('Switched to Google AI Studio API (Strata bypassed)');
        } else if (patch.provider === 'strata') {
          setProviderStatusMsg('Switched to Strata Local GPU');
        } else {
          setProviderStatusMsg('Google AI Studio settings updated');
        }
      } else {
        setProviderStatusMsg('Failed to update provider on Central Brain');
      }
    } catch {
      setProviderStatusMsg('Central Brain unreachable');
    } finally {
      setSavingProvider(false);
    }
  };

  const isTauri = isTauriEnvironment();
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

  const handleCheckUpdates = async () => {
    setUpdateStatus('checking');
    setUpdateError(null);
    try {
      const info = await checkForAppUpdates();
      if (info.currentVersion) {
        setCurrentAppVersion(info.currentVersion);
      }
      if (info.available) {
        setAvailableUpdate(info);
        setUpdateStatus('found');
      } else {
        setAvailableUpdate(info);
        setUpdateStatus('up-to-date');
      }
    } catch (err: any) {
      setUpdateError(err?.message || 'Failed to check GitHub releases.');
      setUpdateStatus('error');
    }
  };

  const handleApplyUpdate = async () => {
    if (!availableUpdate) return;
    setUpdateStatus('downloading');
    setUpdateError(null);
    try {
      await downloadAndApplyUpdate(availableUpdate, (p) => {
        setDownloadProgress({
          percent: p.percent,
          statusText: p.statusText,
        });
      });
    } catch (err: any) {
      setUpdateError(err?.message || 'Update failed to download/install.');
      setUpdateStatus('error');
    }
  };

  const handleSave = () => {
    setBrainConnection(inputHost, inputPort);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg max-h-[90%] flex flex-col bg-surface border border-border-strong rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-muted shrink-0">
          <div className="flex items-center gap-2 font-medium text-text-primary text-sm">
            <Settings className="w-4 h-4 text-accent-blue" />
            <span>LocalGravity Settings</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-surface rounded text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs flex-1 min-h-0 overflow-y-auto">
          {/* Display & DPI Scaling */}
          <div className="space-y-2.5 p-3 rounded-lg bg-surface-muted/60 border border-border-subtle">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 font-semibold text-text-primary text-xs">
                <ZoomIn className="w-4 h-4 text-accent-blue" />
                <span>Display & DPI Scale</span>
              </label>
              <div className="flex items-center gap-1 font-mono text-[11px] text-accent-blue font-semibold">
                <span>{Math.round(dpiScale * 100)}%</span>
              </div>
            </div>

            <p className="text-[11px] text-text-muted leading-relaxed">
              Dynamically resize text, inputs, cards, and toolbars. Use <code className="text-text-primary">Ctrl +</code> and <code className="text-text-primary">Ctrl -</code> to scale on demand, or <code className="text-text-primary">Ctrl 0</code> to reset.
            </p>

            <div className="flex items-center gap-3 pt-1">
              <input
                type="range"
                min="0.75"
                max="1.75"
                step="0.05"
                value={dpiScale}
                onChange={(e) => setDpiScale(parseFloat(e.target.value))}
                className="flex-1 accent-[#8AB4F8] cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
              {[0.85, 1.0, 1.15, 1.30, 1.50].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDpiScale(preset)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                    Math.abs(dpiScale - preset) < 0.02
                      ? 'bg-accent-blue text-black font-semibold'
                      : 'bg-canvas hover:bg-surface border border-border-subtle text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {preset === 1.0 ? '100% (Default)' : `${Math.round(preset * 100)}%`}
                </button>
              ))}
            </div>
          </div>
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
                  className="px-2 py-0.5 rounded text-[10px] bg-canvas hover:bg-surface border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
                  title="Default to Localhost (127.0.0.1:3390)"
                >
                  Localhost
                </button>
              </div>
            </div>

            <p className="text-[11px] text-text-muted">
              Connect this client to your Central Brain over LAN or localhost. Model inference streams over this bridge while local files run on your host.
            </p>

            <div className="grid grid-cols-4 gap-2 pt-1">
              <div className="col-span-3 space-y-1">
                <label className="text-[10px] text-text-muted uppercase tracking-wider font-medium">PC IP / Host</label>
                <input
                  type="text"
                  value={inputHost}
                  onChange={(e) => setInputHost(e.target.value)}
                  placeholder="127.0.0.1 or LAN IP"
                  className="w-full bg-canvas border border-border-subtle rounded-md px-2.5 py-1.5 font-mono text-text-primary outline-none focus:border-accent-blue"
                />
              </div>
              <div className="col-span-1 space-y-1">
                <label className="text-[10px] text-text-muted uppercase tracking-wider font-medium">Port</label>
                <input
                  type="text"
                  value={inputPort}
                  onChange={(e) => setInputPort(e.target.value)}
                  placeholder="3390"
                  className="w-full bg-canvas border border-border-subtle rounded-md px-2.5 py-1.5 font-mono text-text-primary outline-none focus:border-accent-blue text-center"
                />
              </div>
            </div>

            {/* Test Connection Button */}
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
                    <p>1. Ensure LocalGravity is running on your PC.</p>
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

          {/* Brain Inference Provider (Strata Local GPU vs Google AI Studio API) */}
          <div className="space-y-2.5 pt-3 border-t border-border-subtle/50">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 font-semibold text-text-primary text-xs">
                <Cloud className="w-4 h-4 text-sky-400" />
                <span>Brain Inference Provider</span>
              </label>
              {providerStatusMsg ? (
                <span className="text-[10px] font-mono text-emerald-400 truncate max-w-[200px]">
                  {providerStatusMsg}
                </span>
              ) : (
                <span className="text-[10px] font-mono text-text-muted">
                  {brainProvider === 'google_ai_studio' ? 'Google AI API Active' : 'Strata Local GPU'}
                </span>
              )}
            </div>

            <p className="text-[11px] text-text-muted leading-relaxed">
              The Central Brain still manages workspaces, Harness², EdgeBridge tools, and thread state. Switch between local Strata GPU or Google AI Studio API.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={savingProvider}
                onClick={() => updateBrainProviderOnServer({ provider: 'strata' })}
                className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                  brainProvider === 'strata'
                    ? 'bg-emerald-500/15 border-emerald-500/60 text-text-primary'
                    : 'bg-canvas border-border-subtle text-text-secondary hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs">Strata (Local GPU)</span>
                  {brainProvider === 'strata' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">Swift 1.5 Flash-Next • Port 8080</div>
              </button>

              <button
                type="button"
                disabled={savingProvider}
                onClick={() => updateBrainProviderOnServer({ provider: 'google_ai_studio' })}
                className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                  brainProvider === 'google_ai_studio'
                    ? 'bg-sky-500/15 border-sky-500/60 text-text-primary'
                    : 'bg-canvas border-border-subtle text-text-secondary hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs">Google AI Studio API</span>
                  {brainProvider === 'google_ai_studio' && <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">Decisions Orchestrator • Gemini 4 / 3.8</div>
              </button>
            </div>

            {brainProvider === 'google_ai_studio' && (
              <div className="p-3 rounded-lg bg-canvas border border-sky-500/30 space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-text-primary">
                    <KeyRound className="w-3.5 h-3.5 text-sky-400" />
                    <span>Google AI Studio API Key</span>
                  </span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      googleHasApiKey
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {googleHasApiKey ? `Configured (${googleMaskedApiKey})` : 'API Key Required'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={googleKeyInput}
                    onChange={(e) => setGoogleKeyInput(e.target.value)}
                    placeholder={googleHasApiKey ? `Enter new key to replace ${googleMaskedApiKey}` : 'Paste AIza... API key'}
                    className="flex-1 bg-surface border border-border-subtle rounded-md px-2.5 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-sky-400"
                  />
                  <button
                    type="button"
                    disabled={savingProvider || !googleKeyInput.trim()}
                    onClick={() =>
                      updateBrainProviderOnServer({
                        provider: 'google_ai_studio',
                        googleApiKey: googleKeyInput.trim(),
                      })
                    }
                    className="px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-black font-semibold text-xs transition-colors cursor-pointer shrink-0"
                  >
                    Save Key
                  </button>
                </div>

                <div className="space-y-1 pt-1">
                  <label className="text-[10px] text-text-muted uppercase tracking-wider font-medium">
                    Active Google AI Studio Model
                  </label>
                  <select
                    value={selectedGoogleModel}
                    onChange={(e) =>
                      updateBrainProviderOnServer({
                        provider: 'google_ai_studio',
                        selectedGoogleModel: e.target.value as GoogleModelId,
                      })
                    }
                    className="w-full bg-surface border border-border-subtle rounded-md px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-sky-400 cursor-pointer"
                  >
                    {GOOGLE_MODEL_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name} — {opt.sub}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* App Updates Section */}
          <div className="space-y-2.5 pt-3 border-t border-border-subtle/50">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 font-semibold text-text-primary text-xs">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>LocalGravity Auto-Updates</span>
              </label>
              <span className="text-[11px] font-mono text-text-muted">
                v{availableUpdate?.currentVersion || currentAppVersion} ({isTauri ? 'Desktop Native' : 'Web Companion'})
              </span>
            </div>

            <p className="text-[11px] text-text-muted">
              Self-updates are cryptographically signed and pulled directly from GitHub Releases.
            </p>

            <div className="p-3 bg-canvas border border-border-subtle rounded-lg space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-text-primary text-xs">
                    {updateStatus === 'checking' && 'Checking GitHub for updates...'}
                    {updateStatus === 'up-to-date' && '✓ LocalGravity is up to date!'}
                    {updateStatus === 'found' && `Update v${availableUpdate?.version} available!`}
                    {updateStatus === 'downloading' && 'Downloading & applying update...'}
                    {updateStatus === 'error' && 'Failed to check updates'}
                    {updateStatus === 'idle' && 'Release Channel: Stable (GitHub)'}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    Endpoint: williamcboehmjr/LocalGravity/releases
                  </div>
                </div>

                {updateStatus === 'checking' ? (
                  <Loader2 className="w-4 h-4 text-accent-blue animate-spin" />
                ) : updateStatus === 'found' ? (
                  isTauri ? (
                    <button
                      type="button"
                      onClick={handleApplyUpdate}
                      className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#E3E3E3] text-[#101012] font-medium text-xs hover:bg-white transition-colors shadow-xs"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Update Now</span>
                    </button>
                  ) : (
                    <a
                      href={availableUpdate?.downloadUrl || 'https://github.com/williamcboehmjr/LocalGravity/releases/latest'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent-blue text-white font-medium text-xs hover:bg-accent-blue/90 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>View Release</span>
                    </a>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={handleCheckUpdates}
                    disabled={updateStatus === 'downloading'}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border-subtle text-text-primary hover:border-accent-blue text-xs transition-colors"
                  >
                    <RefreshCw className="w-3 h-3 text-text-muted" />
                    <span>Check Now</span>
                  </button>
                )}
              </div>

              {/* Progress bar when downloading */}
              {updateStatus === 'downloading' && (
                <div className="space-y-1.5 pt-1">
                  <div className="w-full bg-surface-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-accent-blue h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${downloadProgress.percent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-text-muted font-mono">
                    <span>{downloadProgress.statusText}</span>
                    <span>{downloadProgress.percent}%</span>
                  </div>
                </div>
              )}

              {updateError && (
                <div className="text-[11px] text-rose-400">
                  {updateError}
                </div>
              )}
            </div>
          </div>

          {/* Active Model */}
          <div className="space-y-2 pt-3 border-t border-border-subtle/50">
            <label className="flex items-center gap-1.5 font-medium text-text-primary">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>Active Strata Inference Engine Model</span>
            </label>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-20 font-mono text-emerald-400 font-semibold text-xs">Flagship:</span>
                <input
                  type="text"
                  value={highModel}
                  onChange={(e) => setHighModel(e.target.value)}
                  className="flex-1 bg-canvas border border-border-subtle rounded px-2 py-1 font-mono text-text-primary outline-none focus:border-accent-blue text-xs"
                />
              </div>
            </div>
          </div>

          {/* LocalGravity Agent Permissions & Smart GPU Controls */}
          <div className="space-y-2.5 pt-3 border-t border-border-subtle/50">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 font-medium text-text-primary">
                <Server className="w-3.5 h-3.5 text-emerald-400" />
                <span>Agent Execution Policy & Strata GPU Lifecycle</span>
              </label>
              {gpuActionStatus && (
                <span className="text-[11px] font-mono text-emerald-400">{gpuActionStatus}</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExecutionPolicy('always_proceed')}
                className={`flex-1 py-1.5 px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  executionPolicy === 'always_proceed'
                    ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                    : 'bg-canvas border-border-subtle text-text-muted hover:text-text-primary'
                }`}
              >
                ⚡ Turbo (Always Proceed)
              </button>
              <button
                type="button"
                onClick={() => setExecutionPolicy('request_review')}
                className={`flex-1 py-1.5 px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  executionPolicy === 'request_review'
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                    : 'bg-canvas border-border-subtle text-text-muted hover:text-text-primary'
                }`}
              >
                🛡️ Review Mode
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={async () => {
                  setGpuActionStatus('Waking GPU...');
                  try {
                    await fetch(`${apiBaseUrl}/api/gpu/wake`, { method: 'POST' });
                    setGpuActionStatus('Strata GPU Active!');
                  } catch {
                    setGpuActionStatus('Failed to wake');
                  }
                  setTimeout(() => setGpuActionStatus(null), 2500);
                }}
                className="py-1.5 px-2 rounded-lg bg-canvas hover:bg-surface border border-border-subtle text-text-primary text-[11px] font-medium transition-colors cursor-pointer"
              >
                🔥 Wake Strata GPU
              </button>
              <button
                type="button"
                onClick={async () => {
                  setGpuActionStatus('Offloading...');
                  try {
                    await fetch(`${apiBaseUrl}/api/gpu/offload`, { method: 'POST' });
                    setGpuActionStatus('Offloaded (0 MB VRAM)');
                  } catch {
                    setGpuActionStatus('Offload error');
                  }
                  setTimeout(() => setGpuActionStatus(null), 2500);
                }}
                className="py-1.5 px-2 rounded-lg bg-canvas hover:bg-surface border border-border-subtle text-text-primary text-[11px] font-medium transition-colors cursor-pointer"
              >
                💤 Offload GPU Now
              </button>
              <button
                type="button"
                onClick={async () => {
                  setGpuActionStatus('Restarting Brain...');
                  try {
                    await fetch(`${apiBaseUrl}/api/system/restart`, { method: 'POST' });
                  } catch {}
                }}
                className="py-1.5 px-2 rounded-lg bg-canvas hover:bg-rose-950/40 border border-border-subtle hover:border-rose-700/50 text-text-primary hover:text-rose-300 text-[11px] font-medium transition-colors cursor-pointer"
              >
                🔄 Restart Brain
              </button>
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
