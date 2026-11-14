import React, { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import {
  X,
  SlidersHorizontal,
  Sparkles,
  ShieldCheck,
  Server,
  Cloud,
  Cpu,
  Moon,
  RotateCw,
  RefreshCw,
  Download,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  KeyRound,
  ChevronRight,
} from 'lucide-react';
import {
  useSessionStore,
  GOOGLE_MODEL_OPTIONS,
  getGoogleModelOption,
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

type SettingsTab = 'general' | 'models' | 'agent' | 'connection';

const NAV_TABS: Array<{
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'models', label: 'Models & AI', icon: Sparkles },
  { id: 'agent', label: 'Agent & GPU', icon: ShieldCheck },
  { id: 'connection', label: 'Connection', icon: Server },
];

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

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [inputHost, setInputHost] = useState(brainHost || '127.0.0.1');
  const [inputPort, setInputPort] = useState(brainPort || '3390');
  const [gpuActionStatus, setGpuActionStatus] = useState<string | null>(null);
  const [googleKeyInput, setGoogleKeyInput] = useState('');
  const [providerStatusMsg, setProviderStatusMsg] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [showOtherEngineConfig, setShowOtherEngineConfig] = useState(false);

  const [testState, setTestState] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error';
    message?: string;
    latency?: number;
  }>({ status: 'idle' });

  const [highModel, setHighModel] = useState(
    'Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS (Strata + Vision • 64k)'
  );
  const [ramdiskPath, setRamdiskPath] = useState('R:\\models');

  const [currentAppVersion, setCurrentAppVersion] = useState<string>('2.3.12');
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'found' | 'up-to-date' | 'downloading' | 'error'
  >('idle');
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ percent: number; statusText: string }>({
    percent: 0,
    statusText: '',
  });
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (isTauriEnvironment()) {
      getVersion()
        .then((v) => {
          if (v) setCurrentAppVersion(v);
        })
        .catch(() => {});
    }
    if (isOpen) {
      setInputHost(brainHost || '127.0.0.1');
      setInputPort(brainPort || '3390');
      setTestState({ status: 'idle' });
      setProviderStatusMsg(null);
      setShowOtherEngineConfig(false);
      if (apiBaseUrl) {
        fetch(`${apiBaseUrl}/api/brain/provider`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data) setBrainProviderState(data);
          })
          .catch(() => {});
      }
    }
  }, [isOpen, apiBaseUrl, brainHost, brainPort, setBrainProviderState]);

  if (!isOpen) return null;

  const isTauri = isTauriEnvironment();
  const { host: resolvedHost, port: resolvedPort } = cleanHostAndPort(inputHost, inputPort);
  const selectedGoogleOpt = getGoogleModelOption(selectedGoogleModel);

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
          setProviderStatusMsg('Google AI Studio key saved.');
        } else if (patch.provider === 'google_ai_studio') {
          setProviderStatusMsg('Switched to Google AI Studio.');
        } else if (patch.provider === 'strata') {
          setProviderStatusMsg('Switched to Local GPU.');
        } else {
          setProviderStatusMsg('Model preference updated.');
        }
      } else {
        setProviderStatusMsg('Could not save setting on server.');
      }
    } catch {
      setProviderStatusMsg('Central Brain server unreachable.');
    } finally {
      setSavingProvider(false);
    }
  };

  const handleTest = async () => {
    setTestState({ status: 'testing' });
    try {
      const result = await testBrainConnection(inputHost, inputPort);
      setTestState({
        status: result.ok ? 'success' : 'error',
        message: result.message,
        latency: result.latency,
      });
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

  const handleCheckUpdates = async () => {
    setUpdateStatus('checking');
    setUpdateError(null);
    try {
      const info = await checkForAppUpdates();
      setAvailableUpdate(info);
      setUpdateStatus(info.available ? 'found' : 'up-to-date');
    } catch (err: any) {
      setUpdateError(err?.message || 'Could not reach GitHub Releases.');
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
      setUpdateError(err?.message || 'Update failed to download or install.');
      setUpdateStatus('error');
    }
  };

  const handleWakeGpu = async () => {
    setGpuActionStatus('Waking GPU...');
    try {
      const r = await fetch(`${apiBaseUrl}/api/gpu/wake`, { method: 'POST' });
      setGpuActionStatus(r.ok ? 'GPU active.' : 'Could not wake GPU.');
    } catch {
      setGpuActionStatus('Server unreachable.');
    }
    setTimeout(() => setGpuActionStatus(null), 2500);
  };

  const handleOffloadGpu = async () => {
    setGpuActionStatus('Freeing VRAM...');
    try {
      const r = await fetch(`${apiBaseUrl}/api/gpu/offload`, { method: 'POST' });
      setGpuActionStatus(r.ok ? 'GPU asleep (0 MB VRAM).' : 'Could not sleep GPU.');
    } catch {
      setGpuActionStatus('Server unreachable.');
    }
    setTimeout(() => setGpuActionStatus(null), 2500);
  };

  const handleRestartServer = async () => {
    setGpuActionStatus('Restarting server...');
    try {
      await fetch(`${apiBaseUrl}/api/system/restart`, { method: 'POST' });
    } catch {}
    setTimeout(() => setGpuActionStatus('Server restarted.'), 2500);
  };

  const showGoogleSection = brainProvider === 'google_ai_studio' || showOtherEngineConfig;
  const showLocalSection = brainProvider === 'strata' || showOtherEngineConfig;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-3xl h-[min(86vh,640px)] bg-[#111215] border border-[#24262B] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1E2025] shrink-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[15px] font-semibold text-[#F4F4F5] tracking-tight">Settings</h2>
            <span className="text-[11px] text-[#71717A] font-mono">
              v{availableUpdate?.currentVersion || currentAppVersion}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8E8E93] hover:text-white hover:bg-[#1E2025] transition-colors cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Left Navigation + Main Content */}
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          <nav className="sm:w-48 bg-[#0D0E10]/70 border-b sm:border-b-0 sm:border-r border-[#1E2025] p-2.5 flex sm:flex-col gap-1 overflow-x-auto sm:overflow-x-visible shrink-0">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    isSelected
                      ? 'bg-[#1C1E24] text-white'
                      : 'text-[#8E8E93] hover:text-[#E4E4E7] hover:bg-[#16171C]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
            {/* TAB 1: GENERAL */}
            {activeTab === 'general' && (
              <>
                <section className="space-y-3">
                  <div>
                    <h3 className="text-[13.5px] font-medium text-[#F4F4F5]">Interface Zoom</h3>
                    <p className="text-[12px] text-[#8E8E93] mt-0.5">
                      Adjust text and panel sizing across the workspace. Shortcuts: Ctrl +, Ctrl -, Ctrl 0.
                    </p>
                  </div>
                  <div className="bg-[#17181C] border border-[#24262B] rounded-xl p-4 space-y-3.5">
                    <div className="flex items-center justify-between gap-4">
                      <input
                        type="range"
                        min={0.75}
                        max={1.75}
                        step={0.05}
                        value={dpiScale}
                        onChange={(e) => setDpiScale(parseFloat(e.target.value))}
                        className="flex-1 accent-[#8AB4F8] cursor-pointer"
                      />
                      <span className="text-[12.5px] font-mono text-[#E4E4E7] w-12 text-right">
                        {Math.round(dpiScale * 100)}%
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[0.85, 1.0, 1.15, 1.3, 1.5].map((preset) => {
                        const isActive = Math.abs(dpiScale - preset) < 0.02;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setDpiScale(preset)}
                            className={`px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-[#8AB4F8]/15 text-[#8AB4F8] border border-[#8AB4F8]/40'
                                : 'bg-[#111215] text-[#9AA0A6] border border-[#24262B] hover:text-white'
                            }`}
                          >
                            {preset === 1.0 ? '100% (Default)' : `${Math.round(preset * 100)}%`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <div>
                    <h3 className="text-[13.5px] font-medium text-[#F4F4F5]">App Updates</h3>
                    <p className="text-[12px] text-[#8E8E93] mt-0.5">
                      Check for newer releases and install updates in place.
                    </p>
                  </div>
                  <div className="bg-[#17181C] border border-[#24262B] rounded-xl p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-[13px] font-medium text-[#E4E4E7]">
                          LocalGravity v{availableUpdate?.currentVersion || currentAppVersion}{' '}
                          <span className="text-[#71717A] font-normal">
                            ({isTauri ? 'Desktop' : 'Web Companion'})
                          </span>
                        </div>
                        <div className="text-[12px] text-[#8E8E93]">
                          {updateStatus === 'checking' && 'Checking GitHub Releases...'}
                          {updateStatus === 'up-to-date' && 'You are on the latest version.'}
                          {updateStatus === 'found' && `Update v${availableUpdate?.version} is ready to install.`}
                          {updateStatus === 'downloading' && 'Downloading and installing update...'}
                          {updateStatus === 'error' && 'Could not complete update check.'}
                          {updateStatus === 'idle' && 'Channel: Stable (GitHub Releases)'}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={handleCheckUpdates}
                          disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2A2D35] bg-[#1F2127] hover:bg-[#272A32] text-[12px] font-medium text-[#E4E4E7] transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {updateStatus === 'checking' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          <span>Check for Updates</span>
                        </button>

                        {updateStatus === 'found' && (
                          <button
                            type="button"
                            onClick={handleApplyUpdate}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8AB4F8] hover:bg-[#A6C8FF] text-[#0C0D0E] text-[12px] font-semibold transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Install v{availableUpdate?.version}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {updateStatus === 'downloading' && (
                      <div className="space-y-1.5 pt-1">
                        <div className="h-1.5 w-full rounded-full bg-[#111215] overflow-hidden">
                          <div
                            className="h-full bg-[#8AB4F8] transition-all duration-200"
                            style={{ width: `${downloadProgress.percent}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px] text-[#8E8E93]">
                          <span>{downloadProgress.statusText}</span>
                          <span className="font-mono">{downloadProgress.percent}%</span>
                        </div>
                      </div>
                    )}

                    {updateError && (
                      <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{updateError}</span>
                      </div>
                    )}

                    <div className="pt-1">
                      <a
                        href={
                          availableUpdate?.downloadUrl ||
                          'https://github.com/williamcboehmjr/LocalGravity/releases/latest'
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11.5px] text-[#8AB4F8] hover:underline"
                      >
                        <span>View releases on GitHub</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* TAB 2: MODELS & AI */}
            {activeTab === 'models' && (
              <>
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[13.5px] font-medium text-[#F4F4F5]">AI Engine</h3>
                      <p className="text-[12px] text-[#8E8E93] mt-0.5">
                        Choose whether prompts run in the cloud or on your local workstation GPU.
                      </p>
                    </div>
                    {(savingProvider || providerStatusMsg) && (
                      <span className="text-[11.5px] text-[#8AB4F8] font-medium shrink-0">
                        {savingProvider ? 'Saving...' : providerStatusMsg}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={savingProvider}
                      onClick={() => updateBrainProviderOnServer({ provider: 'google_ai_studio' })}
                      className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                        brainProvider === 'google_ai_studio'
                          ? 'bg-[#1A202C]/70 border-[#8AB4F8]/60'
                          : 'bg-[#17181C] border-[#24262B] hover:border-[#343740]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[13px] font-medium text-[#F4F4F5]">
                          <Cloud className="w-4 h-4 text-[#8AB4F8]" />
                          <span>Google AI Studio</span>
                        </div>
                        {brainProvider === 'google_ai_studio' && (
                          <CheckCircle2 className="w-4 h-4 text-[#8AB4F8]" />
                        )}
                      </div>
                      <p className="text-[12px] text-[#8E8E93] mt-1.5 leading-relaxed">
                        Cloud Gemini models with orchestrator support. Keeps local VRAM free.
                      </p>
                    </button>

                    <button
                      type="button"
                      disabled={savingProvider}
                      onClick={() => updateBrainProviderOnServer({ provider: 'strata' })}
                      className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                        brainProvider === 'strata'
                          ? 'bg-[#15221D]/70 border-emerald-400/50'
                          : 'bg-[#17181C] border-[#24262B] hover:border-[#343740]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[13px] font-medium text-[#F4F4F5]">
                          <Cpu className="w-4 h-4 text-emerald-400" />
                          <span>Local GPU (Strata)</span>
                        </div>
                        {brainProvider === 'strata' && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        )}
                      </div>
                      <p className="text-[12px] text-[#8E8E93] mt-1.5 leading-relaxed">
                        Private on-device inference powered by your workstation GPU.
                      </p>
                    </button>
                  </div>
                </section>

                {showGoogleSection && (
                  <section className="space-y-3">
                    <div>
                      <h3 className="text-[13.5px] font-medium text-[#F4F4F5]">Google AI Studio</h3>
                      <p className="text-[12px] text-[#8E8E93] mt-0.5">
                        Configure your default model and API key stored on Central Brain.
                      </p>
                    </div>
                    <div className="bg-[#17181C] border border-[#24262B] rounded-xl p-4 space-y-4">
                      <div className="space-y-1.5">
                        <label className="block text-[12px] font-medium text-[#D4D4D8]">
                          Default Model
                        </label>
                        <select
                          value={selectedGoogleModel}
                          disabled={savingProvider}
                          onChange={(e) =>
                            updateBrainProviderOnServer({
                              selectedGoogleModel: e.target.value as GoogleModelId,
                            })
                          }
                          className="w-full bg-[#0F1013] border border-[#272A31] rounded-lg px-3 py-2 text-[13px] text-[#F4F4F5] outline-none focus:border-[#8AB4F8]/60 cursor-pointer"
                        >
                          {GOOGLE_MODEL_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11.5px] text-[#8E8E93]">{selectedGoogleOpt.sub}</p>
                      </div>

                      <div className="space-y-1.5 pt-1 border-t border-[#22242A]">
                        <div className="flex items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#D4D4D8]">
                            <KeyRound className="w-3.5 h-3.5 text-[#8E8E93]" />
                            <span>API Key</span>
                          </label>
                          <span
                            className={`text-[11px] font-mono ${
                              googleHasApiKey ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {googleHasApiKey ? `Saved (${googleMaskedApiKey})` : 'Not configured'}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={googleKeyInput}
                            onChange={(e) => setGoogleKeyInput(e.target.value)}
                            placeholder={
                              googleHasApiKey
                                ? `Enter new key to replace ${googleMaskedApiKey}`
                                : 'Paste AIza... Google AI Studio key'
                            }
                            className="flex-1 min-w-0 bg-[#0F1013] border border-[#272A31] rounded-lg px-3 py-2 text-[13px] text-[#F4F4F5] placeholder:text-[#52525B] outline-none focus:border-[#8AB4F8]/60"
                          />
                          <button
                            type="button"
                            disabled={savingProvider || !googleKeyInput.trim()}
                            onClick={() =>
                              updateBrainProviderOnServer({ googleApiKey: googleKeyInput.trim() })
                            }
                            className="px-3.5 py-2 rounded-lg bg-[#8AB4F8] hover:bg-[#A6C8FF] disabled:bg-[#23252C] text-[#0C0D0E] disabled:text-[#71717A] text-[12.5px] font-semibold transition-colors cursor-pointer shrink-0"
                          >
                            Save Key
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {showLocalSection && (
                  <section className="space-y-3">
                    <div>
                      <h3 className="text-[13.5px] font-medium text-[#F4F4F5]">Local GPU (Strata)</h3>
                      <p className="text-[12px] text-[#8E8E93] mt-0.5">
                        Primary local model identifier and fast RAMDisk cache directory.
                      </p>
                    </div>
                    <div className="bg-[#17181C] border border-[#24262B] rounded-xl p-4 space-y-3.5">
                      <div className="space-y-1.5">
                        <label className="block text-[12px] font-medium text-[#D4D4D8]">
                          Primary Model
                        </label>
                        <input
                          type="text"
                          value={highModel}
                          onChange={(e) => setHighModel(e.target.value)}
                          className="w-full bg-[#0F1013] border border-[#272A31] rounded-lg px-3 py-2 text-[13px] text-[#F4F4F5] outline-none focus:border-[#8AB4F8]/60"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-[12px] font-medium text-[#D4D4D8]">
                          Model Cache Path (RAMDisk)
                        </label>
                        <input
                          type="text"
                          value={ramdiskPath}
                          onChange={(e) => setRamdiskPath(e.target.value)}
                          className="w-full bg-[#0F1013] border border-[#272A31] rounded-lg px-3 py-2 text-[13px] font-mono text-[#F4F4F5] outline-none focus:border-[#8AB4F8]/60"
                        />
                      </div>
                    </div>
                  </section>
                )}

                <button
                  type="button"
                  onClick={() => setShowOtherEngineConfig(!showOtherEngineConfig)}
                  className="inline-flex items-center gap-1.5 text-[12px] text-[#8E8E93] hover:text-[#E4E4E7] transition-colors cursor-pointer"
                >
                  <ChevronRight
                    className={`w-3.5 h-3.5 transition-transform ${
                      showOtherEngineConfig ? 'rotate-90' : ''
                    }`}
                  />
                  <span>
                    {showOtherEngineConfig
                      ? 'Hide inactive engine settings'
                      : `Configure ${
                          brainProvider === 'google_ai_studio' ? 'Local GPU' : 'Google AI Studio'
                        } settings`}
                  </span>
                </button>
              </>
            )}

            {/* TAB 3: AGENT & GPU */}
            {activeTab === 'agent' && (
              <>
                <section className="space-y-3">
                  <div>
                    <h3 className="text-[13.5px] font-medium text-[#F4F4F5]">Autonomy Mode</h3>
                    <p className="text-[12px] text-[#8E8E93] mt-0.5">
                      Control whether the agent can run terminal commands and edit files without asking first.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setExecutionPolicy('always_proceed')}
                      className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                        executionPolicy === 'always_proceed'
                          ? 'bg-[#1A202C]/70 border-[#8AB4F8]/60'
                          : 'bg-[#17181C] border-[#24262B] hover:border-[#343740]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-[#F4F4F5]">Auto-Proceed</span>
                        {executionPolicy === 'always_proceed' && (
                          <CheckCircle2 className="w-4 h-4 text-[#8AB4F8]" />
                        )}
                      </div>
                      <p className="text-[12px] text-[#8E8E93] mt-1.5 leading-relaxed">
                        Runs commands, edits code, and continues through multi-step tasks automatically.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExecutionPolicy('request_review')}
                      className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                        executionPolicy === 'request_review'
                          ? 'bg-[#1A202C]/70 border-[#8AB4F8]/60'
                          : 'bg-[#17181C] border-[#24262B] hover:border-[#343740]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-[#F4F4F5]">
                          Ask Before Running
                        </span>
                        {executionPolicy === 'request_review' && (
                          <CheckCircle2 className="w-4 h-4 text-[#8AB4F8]" />
                        )}
                      </div>
                      <p className="text-[12px] text-[#8E8E93] mt-1.5 leading-relaxed">
                        Pauses for your approval before running shell commands or major changes.
                      </p>
                    </button>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[13.5px] font-medium text-[#F4F4F5]">GPU & Server Controls</h3>
                      <p className="text-[12px] text-[#8E8E93] mt-0.5">
                        Load or offload workstation VRAM, or restart the Central Brain service.
                      </p>
                    </div>
                    {gpuActionStatus && (
                      <span className="text-[11.5px] font-medium text-emerald-400 shrink-0">
                        {gpuActionStatus}
                      </span>
                    )}
                  </div>
                  <div className="bg-[#17181C] border border-[#24262B] rounded-xl p-4 flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      onClick={handleWakeGpu}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#2A2D35] bg-[#1F2127] hover:bg-[#272A32] text-[12.5px] font-medium text-[#E4E4E7] transition-colors cursor-pointer"
                    >
                      <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Wake GPU</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleOffloadGpu}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#2A2D35] bg-[#1F2127] hover:bg-[#272A32] text-[12.5px] font-medium text-[#E4E4E7] transition-colors cursor-pointer"
                    >
                      <Moon className="w-3.5 h-3.5 text-sky-400" />
                      <span>Sleep GPU (Free VRAM)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleRestartServer}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#2A2D35] bg-[#1F2127] hover:bg-[#272A32] text-[12.5px] font-medium text-[#E4E4E7] transition-colors cursor-pointer"
                    >
                      <RotateCw className="w-3.5 h-3.5 text-amber-400" />
                      <span>Restart Server</span>
                    </button>
                  </div>
                </section>
              </>
            )}

            {/* TAB 4: CONNECTION */}
            {activeTab === 'connection' && (
              <section className="space-y-3">
                <div>
                  <h3 className="text-[13.5px] font-medium text-[#F4F4F5]">Central Brain Address</h3>
                  <p className="text-[12px] text-[#8E8E93] mt-0.5">
                    Connect this client to your local workstation or remote LAN server.
                  </p>
                </div>

                <div className="bg-[#17181C] border border-[#24262B] rounded-xl p-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="block text-[12px] font-medium text-[#D4D4D8]">
                        Host / IP
                      </label>
                      <input
                        type="text"
                        value={inputHost}
                        onChange={(e) => setInputHost(e.target.value)}
                        placeholder="127.0.0.1 or 192.168.1.50"
                        className="w-full bg-[#0F1013] border border-[#272A31] rounded-lg px-3 py-2 text-[13px] font-mono text-[#F4F4F5] outline-none focus:border-[#8AB4F8]/60"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-[12px] font-medium text-[#D4D4D8]">Port</label>
                      <input
                        type="text"
                        value={inputPort}
                        onChange={(e) => setInputPort(e.target.value)}
                        placeholder="3390"
                        className="w-full bg-[#0F1013] border border-[#272A31] rounded-lg px-3 py-2 text-[13px] font-mono text-[#F4F4F5] outline-none focus:border-[#8AB4F8]/60"
                      />
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#0F1013] border border-[#202228] px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11.5px] font-mono text-[#8E8E93]">
                    <span>ws://{resolvedHost}:{resolvedPort}</span>
                    <span>http://{resolvedHost}:{resolvedPort}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleTest}
                      disabled={testState.status === 'testing'}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#2A2D35] bg-[#1F2127] hover:bg-[#272A32] text-[12.5px] font-medium text-[#E4E4E7] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {testState.status === 'testing' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Server className="w-3.5 h-3.5 text-[#8AB4F8]" />
                      )}
                      <span>Test Connection</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSave}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#8AB4F8] hover:bg-[#A6C8FF] text-[#0C0D0E] text-[12.5px] font-semibold transition-colors cursor-pointer"
                    >
                      <span>Save & Connect</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {testState.status !== 'idle' && testState.status !== 'testing' && (
                    <div
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] ${
                        testState.status === 'success'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                      }`}
                    >
                      {testState.status === 'success' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      )}
                      <span>
                        {testState.message}
                        {testState.latency !== undefined ? ` (${testState.latency}ms)` : ''}
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#1E2025] bg-[#0D0E10]/50 shrink-0">
          <span className="text-[11.5px] text-[#71717A] hidden sm:inline">
            Model and autonomy changes apply immediately.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-4 py-1.5 rounded-lg border border-[#2A2D35] bg-[#1C1E24] hover:bg-[#252830] text-[12.5px] font-medium text-[#E4E4E7] transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
