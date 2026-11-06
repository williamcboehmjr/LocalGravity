import React, { useState, useEffect, useRef } from 'react';
import {
  FileCode2,
  Terminal,
  ListTodo,
  PanelLeft,
  PanelRight,
  Download,
  Trash2,
  MessageSquare,
  Smartphone,
  Eye,
  RotateCcw,
  ShieldCheck,
  ArrowLeft,
  ArrowRight,
  Search,
  MoreHorizontal,
  FileText,
  Blocks,
  ChevronRight,
  X,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore, QueuedMessage } from './store/useSessionStore';
import { useArtifactStore, WorkbenchTab } from './store/useArtifactStore';
import { useTelemetryStore } from './store/useTelemetryStore';
import { SessionList } from './components/left-rail/SessionList';
import { SkillsDrawer } from './components/left-rail/SkillsDrawer';
import { NodeStatusBadge } from './components/left-rail/NodeStatusBadge';
import { SettingsModal } from './components/left-rail/SettingsModal';
import { MobileRemoteModal } from './components/left-rail/MobileRemoteModal';
import { ChatFeed } from './components/center-canvas/ChatFeed';
import { PromptBar } from './components/center-canvas/PromptBar';
import { WorkbenchEditor } from './components/right-canvas/WorkbenchEditor';
import { IntegratedTerminal } from './components/right-canvas/IntegratedTerminal';
import { VisionPreviewTab } from './components/right-canvas/VisionPreviewTab';
import { HarnessWorkbenchTab } from './components/right-canvas/HarnessWorkbenchTab';
import { TaskChecklist } from './components/right-canvas/TaskChecklist';
import { PlanViewer } from './components/right-canvas/PlanViewer';
import { EvidenceDrawer } from './components/right-canvas/EvidenceDrawer';
import { Splitter } from './components/common/Splitter';
import { ModelTier, ThinkingBudget } from './types/protocol';

export const App: React.FC = () => {
  const {
    projects,
    activeProjectId,
    sessionId,
    sessions,
    hostUrl,
    apiBaseUrl,
    brainHost,
    brainPort,
    isConnected,
    setBrainConnection,
    setIsConnected,
    selectedTier,
    setSelectedTier,
    thinkingBudget,
    messages,
    addMessage,
    updateLastAssistantMessage,
    updateLastAssistantTool,
    finalizeAssistantMessage,
    appendStreamingThought,
    isGenerating,
    setIsGenerating,
    setModelState,
    autoNameSessionFromPrompt,
    messageQueue,
    enqueueMessage,
    dequeueMessage,
    removeQueuedMessage,
    setProjects,
    setThreads,
    hydrateMessagesFromServer,
    clearMessages,
  } = useSessionStore();

  const {
    activeTab,
    setActiveTab,
    setTaskMarkdown,
    setPlanMarkdown,
    parsedTasks,
    checkpoints,
    setCheckpoints,
    setLatestVisionCapture,
  } = useArtifactStore();

  const { setTelemetry, setMcpServers, mcpServers, tokensPerSec } = useTelemetryStore();

  const [leftRailWidth, setLeftRailWidth] = useState(250);
  const [rightDrawerWidth, setRightDrawerWidth] = useState(340);
  const [showLeftRail, setShowLeftRail] = useState(window.innerWidth > 900);
  const [showRightDrawer, setShowRightDrawer] = useState(window.innerWidth > 1100);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRemoteOpen, setIsRemoteOpen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [showSkillsDrawer, setShowSkillsDrawer] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'workbench' | 'tasks'>('chat');

  const wsRef = useRef<WebSocket | null>(null);

  // Initialize decoupled OS AppData state when running inside Tauri Desktop
  useEffect(() => {
    invoke('init_client_appdata').catch(() => {});
  }, []);

  // Auto-discover runtime ports from `/runtime-ports.json` if user hasn't configured a custom host
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('localgravity_brain_host')) {
      return;
    }
    fetch('/runtime-ports.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg && cfg.daemonPort && cfg.daemonPort !== 5000 && cfg.daemonPort !== 5001) {
          const isRemote =
            window.location.hostname &&
            window.location.hostname !== 'localhost' &&
            window.location.hostname !== '127.0.0.1' &&
            window.location.hostname !== 'tauri.localhost';
          const host = isRemote ? window.location.hostname : 'localhost';
          setBrainConnection(host, String(cfg.daemonPort));
        }
      })
      .catch(() => {});
  }, []);

  // Connect and multiplex state over `/ws/sync` (depends strictly on hostUrl)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let isDisposed = false;

    const effectiveHost = hostUrl;

    const connect = () => {
      if (isDisposed) return;

      try {
        const cleanHost = effectiveHost.replace(/^http/, 'ws');
        const url = `${cleanHost}/ws/sync`;
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isDisposed) {
            try {
              ws?.close();
            } catch {}
            return;
          }
          setIsConnected(true);
          // Note: The server automatically sends full initial SYNC_STATE on `/ws/sync` connect.
          // Do not send fake placeholder IDs (`thread-default`) which would overwrite server state.
        };

        ws.onclose = () => {
          if (isDisposed) return;
          setIsConnected(false);
          reconnectTimeout = setTimeout(connect, 2500);
        };

        ws.onerror = () => {
          if (isDisposed) return;
          setIsConnected(false);
        };

        ws.onmessage = (event) => {
          if (isDisposed) return;
          try {
            const data = JSON.parse(event.data);
            const { type, payload } = data;

            if (type === 'SYNC_STATE') {
              if (payload.projects?.length > 0) {
                setProjects(payload.projects, payload.activeProject?.id);
              }
              if (payload.threads) {
                setThreads(payload.threads, payload.activeThreadId);
              }
              if (payload.messages) {
                hydrateMessagesFromServer(payload.messages, payload.activeStreams || []);
              }
              if (payload.checkpoints) {
                setCheckpoints(payload.checkpoints);
              }
              if (payload.mcpServers) {
                setMcpServers(payload.mcpServers);
              }
              if (payload.tabby || payload.telemetry) {
                setTelemetry({
                  vramUsedGb: payload.telemetry?.vramUsedGb ?? 6.8,
                  vramTotalGb: payload.telemetry?.vramTotalGb ?? 16.0,
                  vramPercent: payload.telemetry?.vramPercent ?? 42,
                  hostRamUsedGb: payload.telemetry?.hostRamUsedGb ?? 24.0,
                  hostRamTotalGb: payload.telemetry?.hostRamTotalGb ?? 128.0,
                  hostRamPercent: payload.telemetry?.hostRamPercent ?? 19,
                  gpuUtilization: payload.telemetry?.gpuUtilization ?? 12,
                  cpuUtilization: payload.telemetry?.cpuUtilization ?? 8,
                  activeTier: payload.tabby?.activeTier || 'medium',
                  activeModel: payload.tabby?.activeModel || 'Qwen3.5-9B-EXL3-4.0bpw',
                  tokensPerSec: payload.tabby?.tokensPerSec ?? 74.2,
                  lastSwapDurationMs: payload.tabby?.lastSwapDurationMs ?? 840,
                  sysramCache: payload.tabby?.sysramCache,
                  daemonPort: payload.ports?.daemonPort ?? 3390,
                  tabbyPort: payload.ports?.tabbyPort ?? 3450,
                  lanUrl: payload.ports?.lanUrl ?? window.location.origin,
                });
              }
            } else if (type === 'MODEL_STATE') {
              setModelState(payload.status, payload.active_model, payload.status_text);
              if (payload.active_tier) setSelectedTier(payload.active_tier);
              setTelemetry({
                activeTier: payload.active_tier,
                activeModel: payload.active_model,
                ...(payload.tokens_per_sec ? { tokensPerSec: payload.tokens_per_sec } : {}),
                ...(payload.swap_duration_ms ? { lastSwapDurationMs: payload.swap_duration_ms } : {}),
                ...(payload.sysram_cache ? { sysramCache: payload.sysram_cache } : {}),
              });
            } else if (type === 'THOUGHT_STREAM') {
              appendStreamingThought(
                payload.chunk,
                payload.elapsed_ms,
                payload.token_count,
                payload.is_finished
              );
            } else if (type === 'TOKEN_STREAM') {
              if (payload.is_finished) {
                finalizeAssistantMessage();
                setIsGenerating(false);
              } else {
                updateLastAssistantMessage(payload.chunk, payload.output_tokens);
              }
            } else if (type === 'TOOL_EVENT') {
              updateLastAssistantTool(payload.command, payload.output, payload.status, {
                id: payload.tool_execution_id,
                toolName: payload.tool_name,
                durationMs: payload.duration_ms,
                exitCode: payload.exit_code,
              });
            } else if (type === 'CHECKPOINT_CREATED') {
              if (payload.checkpoint) {
                setCheckpoints([payload.checkpoint, ...checkpoints]);
              }
            } else if (type === 'VISION_CAPTURE') {
              if (payload?.base64DataUrl) {
                setLatestVisionCapture(payload);
              }
            } else if (type === 'ARTIFACT_SYNC') {
              if (payload.artifact_name === 'task.md') {
                setTaskMarkdown(payload.content);
              } else if (payload.artifact_name === 'implementation_plan.md') {
                setPlanMarkdown(payload.content);
              }
            } else if (type === 'TELEMETRY') {
              setTelemetry({
                vramUsedGb: payload.vram_used_gb,
                vramTotalGb: payload.vram_total_gb,
                vramPercent: payload.vram_percent,
                hostRamUsedGb: payload.host_ram_used_gb,
                hostRamTotalGb: payload.host_ram_total_gb,
                gpuUtilization: payload.gpu_utilization_percent,
                cpuUtilization: payload.cpu_utilization_percent,
                ...(payload.tokens_per_sec ? { tokensPerSec: payload.tokens_per_sec } : {}),
                ...(payload.swap_duration_ms ? { lastSwapDurationMs: payload.swap_duration_ms } : {}),
                ...(payload.sysram_cache ? { sysramCache: payload.sysram_cache } : {}),
              });
            }
          } catch (e) {
            console.error('Failed to parse incoming WebSocket message', e);
          }
        };
      } catch {
        if (!isDisposed) {
          setIsConnected(false);
          reconnectTimeout = setTimeout(connect, 2500);
        }
      }
    };

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        try {
          ws.close();
        } catch {}
      }
    };
  }, [hostUrl]);

  const handleSendPrompt = (
    text: string,
    images?: string[],
    tierOverride?: ModelTier,
    thinkingBudgetOverride?: ThinkingBudget
  ) => {
    const tier = tierOverride || selectedTier;
    const budget = thinkingBudgetOverride || thinkingBudget;

    addMessage({
      id: 'user-' + Date.now(),
      role: 'user',
      content: text,
      images,
      timestamp: Date.now(),
    });

    autoNameSessionFromPrompt(sessionId, text);

    addMessage({
      id: 'assistant-' + Date.now(),
      role: 'assistant',
      content: '',
      thought: '',
      tier,
      thinkingBudget: budget,
      modelName:
        tier === 'low'
          ? 'Qwen3.5-4B-EXL3-4.5bpw'
          : tier === 'medium'
          ? 'Qwen3.5-9B-EXL3-4.0bpw'
          : 'Qwen3.8-27B-VL-EXL3-3.5bpw',
      timestamp: Date.now(),
      toolCalls: [],
    });

    setIsGenerating(true);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          id: 'prompt-' + Date.now(),
          type: 'PROMPT_SUBMIT',
          payload: {
            thread_id: sessionId,
            session_id: sessionId,
            prompt: text,
            images,
            tier,
            thinking_budget: budget,
          },
        })
      );
    } else {
      setTimeout(() => {
        appendStreamingThought(
          `1. Analyzing workspace request: "${text}"\n2. Routing to ${tier.toUpperCase()} tier (${budget.toUpperCase()} thinking)...`,
          850,
          38,
          false
        );
      }, 300);

      setTimeout(() => {
        appendStreamingThought('\n3. Preparing execution plan...', 1420, 64, true);
        updateLastAssistantMessage(
          `Processed request on **${tier.toUpperCase()}** tier (**${budget.toUpperCase()}** thinking).\n\n> Connect to your PC Brain in **Settings** to run live inference.`,
          42
        );
        finalizeAssistantMessage();
        setIsGenerating(false);
      }, 1500);
    }
  };

  // Auto-drain queued messages when generation finishes
  useEffect(() => {
    if (!isGenerating && messageQueue.length > 0) {
      const next = dequeueMessage();
      if (next) {
        handleSendPrompt(next.text, next.images, next.tier, next.thinkingBudget);
      }
    }
  }, [isGenerating, messageQueue.length]);

  const handleStopGeneration = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          id: 'cancel-' + Date.now(),
          type: 'CANCEL_GENERATION',
          payload: { thread_id: sessionId, session_id: sessionId },
        })
      );
    }
    finalizeAssistantMessage();
    setIsGenerating(false);
  };

  const handleQueuePrompt = (text: string, images?: string[]) => {
    enqueueMessage({
      text,
      images,
      tier: selectedTier,
      thinkingBudget,
    });
  };

  const handleInterruptAndSend = (item: QueuedMessage) => {
    removeQueuedMessage(item.id);
    handleStopGeneration();
    setTimeout(() => {
      handleSendPrompt(item.text, item.images, item.tier, item.thinkingBudget);
    }, 80);
  };

  const handleTierSwitch = (newTier: ModelTier) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          id: 'tier-' + Date.now(),
          type: 'TIER_SWITCH',
          payload: {
            session_id: sessionId,
            thread_id: sessionId,
            new_tier: newTier,
          },
        })
      );
    }
  };

  const handleNewThread = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: activeProjectId,
          title: 'New Conversation',
          active_model_tier: selectedTier,
          active_thinking_budget: thinkingBudget,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.thread) {
          const listRes = await fetch(
            `${apiBaseUrl}/api/threads?project_id=${encodeURIComponent(activeProjectId)}`
          );
          if (listRes.ok) {
            const listData = await listRes.json();
            setThreads(listData.threads || [data.thread], data.thread.id);
            clearMessages();
          }
        }
      }
    } catch {}
  };

  const handleSelectThread = async (threadId: string) => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/threads/${threadId}/messages`);
      if (res.ok) {
        const data = await res.json();
        hydrateMessagesFromServer(data.messages || [], data.activeStreams || []);
        if (data.checkpoints) setCheckpoints(data.checkpoints);
      }
    } catch {}
  };

  const handleSelectProject = async (projId: string) => {
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/threads?project_id=${encodeURIComponent(projId)}`
      );
      if (res.ok) {
        const data = await res.json();
        const threadsList = data.threads || [];
        setThreads(threadsList, threadsList[0]?.id);
        if (threadsList[0]?.id) {
          handleSelectThread(threadsList[0].id);
        } else {
          clearMessages();
        }
      }
    } catch {}
  };

  const handleClearContext = async () => {
    clearMessages();
    setShowMoreMenu(false);
    try {
      await fetch(`${apiBaseUrl}/api/threads/${sessionId}/clear`, { method: 'POST' });
    } catch {}
  };

  const handleExportThread = () => {
    setShowMoreMenu(false);
    const blob = new Blob([JSON.stringify({ sessionId, messages }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `localgravity-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleArtifactSync = (newMarkdown: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          id: 'sync-' + Date.now(),
          type: 'ARTIFACT_SYNC',
          payload: {
            session_id: sessionId,
            artifact_name: 'task.md',
            content: newMarkdown,
            version: Date.now(),
          },
        })
      );
    }
  };

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const activeSession = sessions.find((s) => s.id === sessionId);
  const totalTasks = parsedTasks.length;
  const completedTasks = parsedTasks.filter((t) => t.completed).length;

  const overviewItems: Array<{
    id: WorkbenchTab;
    label: string;
    icon: React.ReactNode;
    hasSubmenu?: boolean;
  }> = [
    { id: 'tasks', label: 'Review', icon: <RotateCcw className="w-3.5 h-3.5" /> },
    { id: 'editor', label: 'Files', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'terminal', label: 'Terminal', icon: <Terminal className="w-3.5 h-3.5" /> },
    {
      id: 'harness',
      label: 'Extensions',
      icon: <Blocks className="w-3.5 h-3.5" />,
      hasSubmenu: true,
    },
  ];

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-screen bg-[#131314] text-[#E3E3E3] overflow-hidden font-sans">
      {/* 1. LEFT SIDEBAR (Google Antigravity 2.0 Navigation Rail) */}
      {showLeftRail && (
        <aside
          style={{ width: `${leftRailWidth}px` }}
          className="shrink-0 h-full bg-[#101012] border-r border-[#222225] hidden md:flex flex-col px-2.5 pb-2 pt-1.5 select-none"
        >
          {/* Top Utility Toolbar matching Screenshot 1 (Sidebar toggle, Back, Forward, Search) */}
          <div className="h-8 flex items-center justify-between px-1 mb-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowLeftRail(false)}
                className="p-1 rounded-md text-[#8E8E93] hover:text-[#E3E3E3] hover:bg-[#1E1E20] transition-colors"
                title="Collapse Sidebar"
              >
                <PanelLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="p-1 rounded-md text-[#6E6E73] hover:text-[#E3E3E3] hover:bg-[#1E1E20] transition-colors"
                title="Back"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="p-1 rounded-md text-[#6E6E73] hover:text-[#E3E3E3] hover:bg-[#1E1E20] transition-colors"
                title="Forward"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSearchBar(!showSearchBar);
                  if (showSearchBar) setSearchFilter('');
                }}
                className={`p-1 rounded-md transition-colors ${
                  showSearchBar
                    ? 'bg-[#262629] text-[#E3E3E3]'
                    : 'text-[#8E8E93] hover:text-[#E3E3E3] hover:bg-[#1E1E20]'
                }`}
                title="Search Conversations"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Optional Search Input */}
          {showSearchBar && (
            <div className="mb-2 px-0.5">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filter conversations..."
                  autoFocus
                  className="w-full bg-[#1A1A1D] border border-[#2C2C30] rounded-lg pl-2.5 pr-6 py-1 text-xs text-[#E3E3E3] outline-none focus:border-[#4E4E54]"
                />
                {searchFilter && (
                  <button
                    type="button"
                    onClick={() => setSearchFilter('')}
                    className="absolute right-1.5 text-[#6E6E73] hover:text-[#E3E3E3]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Main Navigation + Projects & Threads Tree */}
          <SessionList
            onNewThread={handleNewThread}
            onSelectThread={handleSelectThread}
            onSelectProject={handleSelectProject}
            onOpenAutomations={() => {
              setActiveTab('harness');
              setShowRightDrawer(true);
            }}
            onOpenCustomizations={() => setShowSkillsDrawer(!showSkillsDrawer)}
            searchFilter={searchFilter}
          />

          {/* Collapsible Customizations (Skills & MCP) */}
          {showSkillsDrawer && (
            <div className="my-1.5">
              <SkillsDrawer />
            </div>
          )}

          {/* Bottom Settings & Brain Status Bar */}
          <NodeStatusBadge onOpenSettings={() => setIsSettingsOpen(true)} />
        </aside>
      )}

      {showLeftRail && (
        <Splitter
          onResize={(delta) =>
            setLeftRailWidth((prev) => Math.max(210, Math.min(380, prev + delta)))
          }
          className="hidden md:flex"
        />
      )}

      {/* 2. CENTER PANE (Conversation Stream & Composer) */}
      <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#131314] relative">
        {/* Top Header Bar matching Screenshot 1 */}
        <header className="h-10 shrink-0 px-4 flex items-center justify-between bg-[#131314] z-10 select-none">
          <div className="flex items-center gap-2 min-w-0">
            {!showLeftRail && (
              <button
                type="button"
                onClick={() => setShowLeftRail(true)}
                className="p-1 hover:bg-[#1E1E20] rounded-md text-[#8E8E93] hover:text-[#E3E3E3] mr-1 hidden md:block"
                title="Expand Sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}

            <div className="flex items-center gap-1.5 text-xs min-w-0 truncate">
              <span className="text-[#8E8E93] truncate">
                {activeProject?.name || 'LocalGravity'}
              </span>
              <span className="text-[#4E4E52] shrink-0">/</span>
              <span className="text-[#E3E3E3] font-medium truncate">
                {activeSession?.title || 'New Conversation'}
              </span>
            </div>
          </div>

          {/* Right Top Controls matching Screenshot 1 */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Subtle Brain Connection Pill */}
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border ${
                isConnected
                  ? 'bg-[#1A1A1D] border-[#2A2A2E] text-[#A0A0A5] hover:text-[#E3E3E3] hover:border-[#3E3E44]'
                  : 'bg-amber-950/40 border-amber-700/50 text-amber-300 hover:bg-amber-900/50'
              }`}
              title={
                isConnected
                  ? `Connected to Brain (${brainHost}:${brainPort}) — Click to configure`
                  : `Disconnected from ${brainHost}:${brainPort} — Click to configure & test`
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                }`}
              />
              <span className="hidden sm:inline">
                {isConnected ? `${brainHost}:${brainPort}` : 'Connect Brain'}
              </span>
            </button>

            {/* More Actions Menu (⋮) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="p-1.5 rounded-md hover:bg-[#1E1E20] text-[#8E8E93] hover:text-[#E3E3E3] transition-colors"
                title="Conversation Options"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {showMoreMenu && (
                <div className="absolute right-0 mt-1 w-44 bg-[#1E1E20] border border-[#2E2E32] rounded-xl shadow-2xl p-1 z-50 text-xs space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMoreMenu(false);
                      setIsRemoteOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[#E3E3E3] hover:bg-[#28282C] text-left"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-[#8E8E93]" />
                    <span>LAN Remote QR</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportThread}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[#E3E3E3] hover:bg-[#28282C] text-left"
                  >
                    <Download className="w-3.5 h-3.5 text-[#8E8E93]" />
                    <span>Export Conversation</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearContext}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-[#28282C] text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Conversation</span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setActiveTab('plan');
                setShowRightDrawer(true);
              }}
              className="p-1.5 rounded-md hover:bg-[#1E1E20] text-[#8E8E93] hover:text-[#E3E3E3] transition-colors hidden sm:block"
              title="Artifacts & Implementation Plan"
            >
              <FileText className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setShowRightDrawer(!showRightDrawer)}
              className={`p-1.5 rounded-md transition-colors hidden md:block ${
                showRightDrawer
                  ? 'bg-[#222226] text-[#E3E3E3]'
                  : 'hover:bg-[#1E1E20] text-[#8E8E93] hover:text-[#E3E3E3]'
              }`}
              title="Toggle Right Overview Pane"
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Center Body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          <div
            className={`flex-1 min-h-0 flex flex-col ${
              mobileTab === 'chat' ? 'flex' : 'hidden md:flex'
            }`}
          >
            <ChatFeed />
            <div className="shrink-0 max-w-3xl w-full mx-auto px-4 pb-4 pt-1 z-10">
              <PromptBar
                onSend={handleSendPrompt}
                onTierChange={handleTierSwitch}
                onStop={handleStopGeneration}
                onQueue={handleQueuePrompt}
                onInterruptAndSend={handleInterruptAndSend}
              />
            </div>
          </div>

          {mobileTab === 'workbench' && (
            <div className="flex-1 min-h-0 flex flex-col md:hidden bg-[#131314] overflow-hidden">
              <WorkbenchEditor />
            </div>
          )}

          {mobileTab === 'tasks' && (
            <div className="flex-1 min-h-0 flex flex-col md:hidden bg-[#131314] overflow-hidden">
              <TaskChecklist onSync={handleArtifactSync} />
            </div>
          )}
        </div>

        {/* Mobile Bottom Bar */}
        <nav className="h-12 shrink-0 border-t border-[#222225] flex md:hidden bg-[#101012] z-20 select-none">
          <button
            type="button"
            onClick={() => setMobileTab('chat')}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${
              mobileTab === 'chat' ? 'text-[#E3E3E3] font-medium' : 'text-[#6E6E73]'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chat</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('workbench')}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${
              mobileTab === 'workbench' ? 'text-[#E3E3E3] font-medium' : 'text-[#6E6E73]'
            }`}
          >
            <FileCode2 className="w-4 h-4" />
            <span>Files</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('tasks')}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${
              mobileTab === 'tasks' ? 'text-[#E3E3E3] font-medium' : 'text-[#6E6E73]'
            }`}
          >
            <ListTodo className="w-4 h-4" />
            <span>
              Review ({completedTasks}/{totalTasks})
            </span>
          </button>
        </nav>
      </main>

      {showRightDrawer && (
        <Splitter
          onResize={(delta) =>
            setRightDrawerWidth((prev) => Math.max(260, Math.min(720, prev - delta)))
          }
          className="hidden md:flex"
        />
      )}

      {/* 3. RIGHT PANE (Google Antigravity 2.0 "Overview" Card + Workbench) */}
      {showRightDrawer && (
        <aside
          style={{ width: `${rightDrawerWidth}px` }}
          className="shrink-0 h-full bg-[#131314] p-2.5 flex flex-col gap-2.5 min-w-0 hidden md:flex"
        >
          {/* Floating "Overview" Navigation Card matching Screenshot 1 */}
          <div className="bg-[#18181B] border border-[#26262A] rounded-xl p-2.5 shrink-0 select-none shadow-md">
            <div className="flex items-center justify-between px-1.5 pb-1.5">
              <span className="text-xs font-medium text-[#8E8E93]">Overview</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`p-1 rounded hover:bg-[#242428] transition-colors ${
                    activeTab === 'preview' ? 'text-[#E3E3E3]' : 'text-[#6E6E73] hover:text-[#E3E3E3]'
                  }`}
                  title="Vision / App Preview"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('harness')}
                  className={`p-1 rounded hover:bg-[#242428] transition-colors ${
                    activeTab === 'harness' ? 'text-[#E3E3E3]' : 'text-[#6E6E73] hover:text-[#E3E3E3]'
                  }`}
                  title="Harness² Self-Healing"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-0.5">
              {overviewItems.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[#26262A] text-[#E3E3E3] font-medium'
                        : 'text-[#A0A0A5] hover:bg-[#202024] hover:text-[#E3E3E3]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-[#8E8E93]">{item.icon}</span>
                      <span>{item.label}</span>
                    </div>
                    {item.hasSubmenu && <ChevronRight className="w-3.5 h-3.5 text-[#5E5E63]" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 pt-2 border-t border-[#242428] flex items-center justify-between px-1.5 text-[11px] text-[#8E8E93]">
              <span>Background Tasks</span>
              <span className="px-1.5 py-0.5 rounded-full bg-[#242428] text-[#A0A0A5] font-mono text-[10px]">
                {mcpServers.filter((s) => s.enabled).length} • {tokensPerSec.toFixed(0)} tok/s
              </span>
            </div>
          </div>

          {/* Active Workbench View Card */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#18181B] border border-[#26262A] rounded-xl shadow-md">
            {activeTab === 'editor' && <WorkbenchEditor />}
            {activeTab === 'terminal' && <IntegratedTerminal />}
            {activeTab === 'preview' && <VisionPreviewTab />}
            {activeTab === 'harness' && <HarnessWorkbenchTab />}
            {activeTab === 'tasks' && <TaskChecklist onSync={handleArtifactSync} />}
            {activeTab === 'plan' && <PlanViewer />}
            {activeTab === 'evidence' && <EvidenceDrawer />}
          </div>
        </aside>
      )}

      {/* Modals */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <MobileRemoteModal isOpen={isRemoteOpen} onClose={() => setIsRemoteOpen(false)} />
    </div>
  );
};

export default App;
