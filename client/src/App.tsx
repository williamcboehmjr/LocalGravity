import React, { useState, useEffect, useRef, Suspense } from 'react';
import {
  ListTodo,
  PanelLeft,
  PanelRight,
  Download,
  Trash2,
  MessageSquare,
  Smartphone,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  Search,
  MoreHorizontal,
  FileText,
  ChevronRight,
  ChevronDown,
  X,
  Clock,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import {
  useSessionStore,
  FileAttachmentItem,
  QueuedMessage,
  selectIsTurnActive,
  selectStatusLabel,
  getGoogleModelOption,
} from './store/useSessionStore';
import { useArtifactStore } from './store/useArtifactStore';
import { SessionList } from './components/left-rail/SessionList';
import { SkillsDrawer } from './components/left-rail/SkillsDrawer';
import { NodeStatusBadge } from './components/left-rail/NodeStatusBadge';
import { ReconnectBadge } from './components/ReconnectBadge';
import { MobileRemoteModal } from './components/left-rail/MobileRemoteModal';
import { ChatFeed } from './components/center-canvas/ChatFeed';
import { PromptBar } from './components/center-canvas/PromptBar';
import { VisionPreviewTab } from './components/right-canvas/VisionPreviewTab';
import { HarnessWorkbenchTab } from './components/right-canvas/HarnessWorkbenchTab';
import { TaskChecklist } from './components/right-canvas/TaskChecklist';
import { PlanViewer } from './components/right-canvas/PlanViewer';
import { EvidenceDrawer } from './components/right-canvas/EvidenceDrawer';
import { OverviewSidebar } from './components/right-canvas/OverviewSidebar';
import { ExtensionsTab } from './components/right-canvas/ExtensionsTab';
import { SwarmBoardTab } from './components/right-canvas/SwarmBoardTab';
import { ChangesTab } from './components/right-canvas/ChangesTab';
import { SubagentsTab } from './components/right-canvas/SubagentsTab';
import { Splitter } from './components/common/Splitter';
import { ModelTier, ThinkingBudget } from './types/protocol';
import { UpdateNotificationBanner } from './components/common/UpdateNotificationBanner';
import { checkForAppUpdates, UpdateInfo } from './services/updaterService';
import { DpiScaleControl } from './components/center-canvas/DpiScaleControl';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useBrainSocket, getOrCreateEdgeClientId } from './hooks/useBrainSocket';

const SettingsModal = React.lazy(() =>
  import('./components/left-rail/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const AutomationsModal = React.lazy(() =>
  import('./components/left-rail/AutomationsModal').then((m) => ({ default: m.AutomationsModal }))
);
const WorkbenchEditor = React.lazy(() =>
  import('./components/right-canvas/WorkbenchEditor').then((m) => ({ default: m.WorkbenchEditor }))
);
const IntegratedTerminal = React.lazy(() =>
  import('./components/right-canvas/IntegratedTerminal').then((m) => ({ default: m.IntegratedTerminal }))
);

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
    selectedTier,
    thinkingBudget,
    messages,
    addMessage,
    updateLastAssistantMessage,
    finalizeAssistantMessage,
    appendStreamingThought,
    isGenerating,
    activeTurn,
    startPendingTurn,
    syncGenerating,
    setSwarmState,
    subagentTasks,
    backgroundTasks,
    setSelectedSubagentId,
    autoNameSessionFromPrompt,
    messageQueue,
    enqueueMessage,
    dequeueMessage,
    removeQueuedMessage,
    setThreads,
    hydrateMessagesFromServer,
    clearMessages,
    deleteSession,
    dpiScale,
    zoomIn,
    zoomOut,
    resetZoom,
    threadHistory,
    threadHistoryIndex,
    goBackThread,
    goForwardThread,
  } = useSessionStore();

  const {
    activeTab,
    setActiveTab,
    parsedTasks,
    setCheckpoints,
  } = useArtifactStore();

  const [leftRailWidth, setLeftRailWidth] = useState(250);
  const [rightDrawerWidth, setRightDrawerWidth] = useState(340);
  const [showLeftRail, setShowLeftRail] = useState(window.innerWidth > 900);
  const [showRightDrawer, setShowRightDrawer] = useState(window.innerWidth > 1100);

  useEffect(() => {
    let wasDesktop = window.innerWidth > 900;
    const onResize = () => {
      const isDesktop = window.innerWidth > 900;
      if (isDesktop !== wasDesktop) {
        setShowLeftRail(isDesktop);
        wasDesktop = isDesktop;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Refresh active thread messages when returning to the app (e.g., Android/mobile WebView resume)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const curState = useSessionStore.getState();
        if (
          curState.isConnected &&
          !curState.isGenerating &&
          curState.sessionId &&
          curState.sessionId !== 'thread-default'
        ) {
          handleSelectThread(curState.sessionId, { keepMobileDrawer: true });
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Auto-open Right Drawer when clicking file:// links or tool workbench shortcuts in ChatFeed
  useEffect(() => {
    const onOpenRightDrawer = () => setShowRightDrawer(true);
    window.addEventListener('localgravity:open-right-drawer', onOpenRightDrawer);
    return () => window.removeEventListener('localgravity:open-right-drawer', onOpenRightDrawer);
  }, []);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRemoteOpen, setIsRemoteOpen] = useState(false);
  const [isAutomationsOpen, setIsAutomationsOpen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [showSkillsDrawer, setShowSkillsDrawer] = useState(false);
  const [isActivityBarExpanded, setIsActivityBarExpanded] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'workbench' | 'tasks'>('chat');

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      checkForAppUpdates()
        .then((info) => {
          if (info.available) {
            setUpdateInfo(info);
          }
        })
        .catch(() => {});
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  // Global Keyboard Shortcuts for DPI / UI Zoom (+, -, 0)
  useGlobalShortcuts({ dpiScale, zoomIn, zoomOut, resetZoom });

  const isTurnActive = selectIsTurnActive({ activeTurn, isGenerating });
  const activeStatusLabel = selectStatusLabel({ activeTurn });
  const pendingInterruptRef = useRef<QueuedMessage | null>(null);

  // Initialize decoupled OS AppData state when running inside Tauri Desktop
  useEffect(() => {
    invoke('init_client_appdata').catch(() => {});
  }, []);

  // Auto-discover runtime ports from `/runtime-ports.json` whenever using localhost (unless user set a custom remote IP)
  useEffect(() => {
    const savedHost =
      typeof window !== 'undefined' ? localStorage.getItem('localgravity_brain_host') : null;
    if (savedHost && savedHost !== '127.0.0.1' && savedHost !== 'localhost') {
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
          const host = isRemote ? window.location.hostname : '127.0.0.1';
          const curPort = localStorage.getItem('localgravity_brain_port');
          if (!savedHost || curPort !== String(cfg.daemonPort)) {
            setBrainConnection(host, String(cfg.daemonPort));
          }
        }
      })
      .catch(() => {});
  }, []);

  const {
    wsRef,
    reconnectCountdown,
    reconnectAttempt,
    handleManualReconnect,
    timerCountdown,
    timerTotal,
    timerLabel,
    lastCompaction,
    adaptiveCotLabel,
  } = useBrainSocket({
    hostUrl,
    brainHost,
    brainPort,
    isConnected,
    onSelectThread: (tid, opts) => handleSelectThread(tid, opts),
    onOpenRightDrawer: () => setShowRightDrawer(true),
  });

  const handleSendPrompt = (
    text: string,
    images?: string[],
    tierOverride?: ModelTier,
    thinkingBudgetOverride?: ThinkingBudget,
    attachments?: FileAttachmentItem[]
  ) => {
    const storeSnap = useSessionStore.getState();
    const activeThreadId = storeSnap.sessionId;
    const policy = storeSnap.executionPolicy;
    const tier = tierOverride || selectedTier;
    const budget = thinkingBudgetOverride || thinkingBudget;

    addMessage({
      id: 'user-' + Date.now(),
      role: 'user',
      content: text,
      images,
      attachments,
      timestamp: Date.now(),
    });

    autoNameSessionFromPrompt(activeThreadId, text);

    addMessage({
      id: 'assistant-' + Date.now(),
      role: 'assistant',
      content: '',
      thought: '',
      tier,
      thinkingBudget: budget,
      modelName:
        storeSnap.brainProvider === 'google_ai_studio'
          ? getGoogleModelOption(storeSnap.selectedGoogleModel).name
          : tier === 'low'
          ? 'Qwen3.5-4B-EXL3-4.0bpw'
          : tier === 'medium'
          ? 'Qwen3.8-27B-EXL3-11.5GB'
          : 'Swift 1.5 Flash-Next',
      timestamp: Date.now(),
      toolCalls: [],
    });

    startPendingTurn();

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          id: 'prompt-' + Date.now(),
          type: 'PROMPT_SUBMIT',
          payload: {
            thread_id: activeThreadId,
            session_id: activeThreadId,
            client_id: getOrCreateEdgeClientId(),
            prompt: text,
            images,
            attachments,
            tier,
            thinking_budget: budget,
            brain_provider: storeSnap.brainProvider,
            google_model: storeSnap.selectedGoogleModel,
            execution_policy: policy,
            executionPolicy: policy,
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
        syncGenerating(false);
      }, 1500);
    }
  };

  // Auto-drain queued / interrupted messages strictly after the current turn reaches terminal phase
  useEffect(() => {
    if (isTurnActive) return;
    if (pendingInterruptRef.current) {
      const nextInterrupt = pendingInterruptRef.current;
      pendingInterruptRef.current = null;
      handleSendPrompt(
        nextInterrupt.text,
        nextInterrupt.images,
        nextInterrupt.tier,
        nextInterrupt.thinkingBudget,
        nextInterrupt.attachments
      );
      return;
    }
    if (messageQueue.length > 0) {
      const next = dequeueMessage();
      if (next) {
        handleSendPrompt(next.text, next.images, next.tier, next.thinkingBudget, next.attachments);
      }
    }
  }, [isTurnActive, messageQueue.length]);

  const handleStopGeneration = () => {
    const { sessionId: activeThreadId, activeTurn: curTurn } = useSessionStore.getState();
    const stopTurnId =
      curTurn?.turnId && !curTurn.turnId.startsWith('pending-') ? curTurn.turnId : undefined;
    const stopPayload = {
      thread_id: activeThreadId,
      session_id: activeThreadId,
      ...(stopTurnId ? { turn_id: stopTurnId } : {}),
    };
    const wsOpen = Boolean(wsRef.current && wsRef.current.readyState === WebSocket.OPEN);
    try {
      if (wsOpen && wsRef.current) {
        wsRef.current.send(
          JSON.stringify({
            id: 'stop-' + Date.now(),
            type: 'STOP_GENERATION',
            payload: stopPayload,
          })
        );
      }
    } catch (e) {
      console.warn('[App] WebSocket stop error:', e);
    }

    // One authoritative HTTP stop fallback
    fetch(`${apiBaseUrl}/api/threads/${activeThreadId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stopPayload),
    }).catch(() => {});

    if (wsOpen) {
      // Wait for server TURN_PHASE/TURN_ABORTED terminal event so queue drain cannot race
      useSessionStore.setState((s) =>
        s.activeTurn?.isActive
          ? { activeTurn: { ...s.activeTurn, statusLabel: 'Stopping…' } }
          : s
      );
    } else {
      syncGenerating(false);
    }
  };

  const handleQueuePrompt = (text: string, images?: string[], attachments?: FileAttachmentItem[]) => {
    enqueueMessage({
      text,
      images,
      attachments,
      tier: selectedTier,
      thinkingBudget,
    });
  };

  const handleInterruptAndSend = (item: QueuedMessage) => {
    removeQueuedMessage(item.id);
    pendingInterruptRef.current = item;
    handleStopGeneration();
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
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setShowLeftRail(false);
    }
    pendingInterruptRef.current = null;
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

  const handleDeleteThread = async (threadId: string) => {
    try {
      await fetch(`${apiBaseUrl}/api/threads/${threadId}`, { method: 'DELETE' });
    } catch {}
    deleteSession(threadId);
    if (sessionId === threadId) {
      const remaining = sessions.filter((s) => s.id !== threadId);
      if (remaining.length > 0) {
        handleSelectThread(remaining[0].id);
      } else {
        handleNewThread();
      }
    }
  };

  const handleSelectThread = async (threadId: string, opts?: { keepMobileDrawer?: boolean }) => {
    if (!opts?.keepMobileDrawer && typeof window !== 'undefined' && window.innerWidth < 768) {
      setShowLeftRail(false);
    }
    pendingInterruptRef.current = null;
    setSwarmState(null);
    try {
      const [msgRes, swarmRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/threads/${threadId}/messages`),
        fetch(`${apiBaseUrl}/api/swarm/${threadId}`).catch(() => null),
      ]);
      if (msgRes.ok) {
        const data = await msgRes.json();
        hydrateMessagesFromServer(
          data.messages || [],
          data.activeStreams || [],
          data.threadStatus || data.thread?.status,
          data.activeTurn
        );
        if (data.checkpoints) setCheckpoints(data.checkpoints);
      }
      if (swarmRes && swarmRes.ok && useSessionStore.getState().sessionId === threadId) {
        const sData = await swarmRes.json();
        setSwarmState(sData?.swarm ?? (sData?.id ? sData : null));
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

  return (
    <div className="flex flex-col h-full max-h-full w-full bg-[#131314] text-[#E3E3E3] overflow-hidden font-sans">
      {!updateDismissed && updateInfo && (
        <UpdateNotificationBanner
          updateInfo={updateInfo}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* 1. LEFT SIDEBAR (LocalGravity Navigation Rail) */}
      {showLeftRail && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-30 md:hidden"
            onClick={() => setShowLeftRail(false)}
          />
          <aside
            style={{ width: `${leftRailWidth}px` }}
            className="shrink-0 h-full bg-[#101012] border-r border-[#222225] flex fixed md:static inset-y-0 left-0 z-40 flex-col px-2.5 pb-2 pt-1.5 select-none shadow-2xl md:shadow-none"
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
                disabled={threadHistoryIndex <= 0}
                onClick={() => {
                  const target = goBackThread();
                  if (target) handleSelectThread(target);
                }}
                className="p-1 rounded-md text-[#6E6E73] hover:text-[#E3E3E3] hover:bg-[#1E1E20] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                title="Back in Conversation History"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={threadHistoryIndex >= threadHistory.length - 1}
                onClick={() => {
                  const target = goForwardThread();
                  if (target) handleSelectThread(target);
                }}
                className="p-1 rounded-md text-[#6E6E73] hover:text-[#E3E3E3] hover:bg-[#1E1E20] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                title="Forward in Conversation History"
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
            onDeleteThread={handleDeleteThread}
            onSelectProject={handleSelectProject}
            onOpenAutomations={() => setIsAutomationsOpen(true)}
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
          <NodeStatusBadge
            onOpenSettings={() => {
              setIsSettingsOpen(true);
              if (window.innerWidth < 900) setShowLeftRail(false);
            }}
          />
        </aside>
        </>
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
      <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#0c0d0e] relative">
        {/* Top Header Bar matching LocalGravity Mobile */}
        <header className="h-11 shrink-0 px-4 flex items-center justify-between bg-[#0c0d0e] border-b border-[#1f2023] z-10 select-none">
          <div className="flex items-center gap-2 min-w-0">
            {!showLeftRail && (
              <button
                type="button"
                onClick={() => setShowLeftRail(true)}
                className="p-1.5 hover:bg-[#1E1E20] rounded-md text-[#8E8E93] hover:text-[#E3E3E3] mr-0.5 shrink-0"
                title="Open Projects & Conversations"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}

            <div className="flex items-center gap-1.5 text-[14px] sm:text-[14.5px] min-w-0 truncate">
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
            {/* LocalGravity Inline Scheduled Timer Pill */}
            {timerCountdown > 0 && (
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-950/60 border border-sky-600/40 text-sky-200 text-xs shadow-xs animate-in fade-in duration-150"
                title={`Scheduled Timer active: "${timerLabel}". ${timerCountdown}s remaining of ${timerTotal || timerCountdown}s`}
              >
                <Clock className="w-3.5 h-3.5 text-sky-400 animate-spin" style={{ animationDuration: '6s' }} />
                <span className="font-mono font-semibold text-sky-300 text-[11px]">{timerCountdown}s</span>
                <span className="text-[11px] text-sky-100/80 truncate max-w-[130px] hidden sm:inline">
                  {timerLabel}
                </span>
              </div>
            )}

            {/* Auto-Compacted Working Memory Pill */}
            {lastCompaction && (
              <span
                className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-700/40 text-emerald-300 font-mono text-[10.5px]"
                title={`Auto-Compactor distilled working memory from ${lastCompaction.previousTokens} to ${lastCompaction.compactedTokens} tokens`}
              >
                ⚡ Compacted {lastCompaction.previousTokens}→{lastCompaction.compactedTokens} tok
              </span>
            )}

            {/* DPI / UI Scale Control Pill (+ / -) */}
            <div className="hidden sm:flex">
              <DpiScaleControl />
            </div>

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
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[#E3E3E3] hover:bg-[#28282C] text-left"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-[#8E8E93]" />
                    <span>Clear Conversation</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMoreMenu(false);
                      handleDeleteThread(sessionId);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-[#28282C] text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Conversation</span>
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
              onClick={() => setMobileTab(mobileTab === 'chat' ? 'tasks' : 'chat')}
              className="p-1.5 rounded-md hover:bg-[#1E1E20] text-[#8E8E93] hover:text-[#E3E3E3] transition-colors md:hidden"
              title={mobileTab === 'chat' ? 'View Review / Tasks' : 'Back to Chat'}
            >
              {mobileTab === 'chat' ? <ListTodo className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setShowRightDrawer(!showRightDrawer)}
              className={`p-1.5 rounded-md transition-colors shrink-0 ${
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

        {/* Reconnecting / Brain Offline Recovery Banner */}
        {!isConnected && (
          <div className="shrink-0 bg-gradient-to-r from-amber-950/90 via-amber-900/80 to-amber-950/90 border-b border-amber-600/40 px-4 py-2 flex items-center justify-between text-xs sm:text-sm text-amber-200 select-none z-20">
            <div className="flex items-center gap-2.5 min-w-0">
                            <ReconnectBadge secondsRemaining={reconnectCountdown} totalSeconds={3} attempt={reconnectAttempt} />
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping shrink-0" />

              <span className="font-semibold text-amber-100">Brain is offline or restarting</span>
              <span className="text-amber-400/60 hidden sm:inline">•</span>
              <span className="text-amber-300 font-mono text-[11.5px] sm:text-xs">
                {reconnectCountdown > 0
                  ? `Reconnecting in ${reconnectCountdown}s...`
                  : 'Probing connection...'}
                {reconnectAttempt > 0 && ` (Attempt #${reconnectAttempt})`}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleManualReconnect}
                className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-medium text-xs transition-colors cursor-pointer"
              >
                Reconnect Now
              </button>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="px-2 py-1 rounded-md text-amber-300/80 hover:text-amber-100 text-xs transition-colors"
                title="Configure host and port"
              >
                Settings
              </button>
            </div>
          </div>
        )}

        {/* Center Body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          {mobileTab !== 'chat' && (
            <div className="shrink-0 h-11 px-4 flex items-center justify-between border-b border-[#222225] bg-[#141518] md:hidden select-none">
              <button
                type="button"
                onClick={() => setMobileTab('chat')}
                className="flex items-center gap-1.5 text-xs text-[#8AB4F8] hover:underline"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Chat</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileTab(mobileTab === 'workbench' ? 'tasks' : 'workbench')}
                className="text-xs px-2.5 py-1 rounded-md bg-[#222327] text-[#E8EAED] border border-[#34363B]"
              >
                {mobileTab === 'workbench' ? 'Switch to Tasks' : 'Switch to Files'}
              </button>
            </div>
          )}

          <div
            className={`flex-1 min-h-0 flex flex-col ${
              mobileTab === 'chat' ? 'flex' : 'hidden md:flex'
            }`}
          >
            <ChatFeed onQuickSend={(p) => handleSendPrompt(p)} />
            <div className="shrink-0 max-w-3xl w-full mx-auto px-4 pb-4 pt-1 z-10">
              {/* Collapsible / Expandable Running Tasks & Subagents Bar (Antigravity-style) */}
              {(() => {
                const runningSubagents = subagentTasks.filter((s) => s.status === 'running');
                const runningBgTasks = backgroundTasks.filter((t) => t.status === 'running');
                const hasActivityItems =
                  totalTasks > 0 || runningSubagents.length > 0 || runningBgTasks.length > 0;
                if (!hasActivityItems) {
                  void isTurnActive;
                  void activeStatusLabel;
                  void adaptiveCotLabel;
                  return null;
                }

                const summaryParts: string[] = [];
                if (totalTasks > 0) {
                  summaryParts.push(`${totalTasks} task${totalTasks === 1 ? '' : 's'} (${completedTasks} completed)`);
                }
                if (runningSubagents.length > 0) {
                  summaryParts.push(
                    `${runningSubagents.length} subagent${runningSubagents.length === 1 ? '' : 's'} running`
                  );
                }
                if (runningBgTasks.length > 0) {
                  summaryParts.push(
                    `${runningBgTasks.length} background task${runningBgTasks.length === 1 ? '' : 's'}`
                  );
                }

                return (
                  <div className="mb-2 select-none bg-[#18191C] border border-[#2B2C30] rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setIsActivityBarExpanded((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-[#9AA0A6] hover:text-[#E8EAED] hover:bg-[#1F2024] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isActivityBarExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[#9AA0A6]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[#9AA0A6]" />
                        )}
                        <span className="truncate font-medium text-[#E8EAED]">
                          {summaryParts.join(' • ')}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#6E6E73] shrink-0">
                        {isActivityBarExpanded ? 'Hide' : 'Details'}
                      </span>
                    </button>

                    {isActivityBarExpanded && (
                      <div className="border-t border-[#242529] px-2 py-1.5 space-y-1 max-h-40 overflow-y-auto">
                        {totalTasks > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.innerWidth < 768) {
                                setMobileTab('tasks');
                              } else {
                                setActiveTab('tasks');
                                setShowRightDrawer(true);
                              }
                            }}
                            className="w-full flex items-center justify-between px-2 py-1 rounded-lg text-xs text-[#E8EAED] hover:bg-[#222327] transition-colors cursor-pointer"
                          >
                            <span>Task Checklist: {completedTasks}/{totalTasks} completed</span>
                            <ChevronRight className="w-3 h-3 text-[#9AA0A6]" />
                          </button>
                        )}

                        {runningSubagents.map((sa) => (
                          <button
                            key={sa.id}
                            type="button"
                            onClick={() => {
                              setSelectedSubagentId(sa.id);
                              setActiveTab('subagents');
                              if (window.innerWidth < 768) {
                                setMobileTab('workbench');
                              } else {
                                setShowRightDrawer(true);
                              }
                            }}
                            className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg text-xs text-[#E8EAED] hover:bg-[#222327] transition-colors cursor-pointer text-left"
                            title={`Inspect ${sa.role} conversation`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">{sa.role}</div>
                              {sa.summary && (
                                <div className="text-[11px] text-[#9AA0A6] truncate">{sa.summary}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono text-[#9AA0A6]">
                              <span>
                                {sa.step}/{sa.maxSteps}
                              </span>
                              <ChevronRight className="w-3 h-3" />
                            </div>
                          </button>
                        ))}

                        {runningBgTasks.map((bg) => (
                          <button
                            key={bg.taskId}
                            type="button"
                            onClick={() => {
                              setActiveTab('subagents');
                              if (window.innerWidth < 768) {
                                setMobileTab('workbench');
                              } else {
                                setShowRightDrawer(true);
                              }
                            }}
                            className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg text-xs text-[#E8EAED] hover:bg-[#222327] transition-colors cursor-pointer text-left"
                            title={`Inspect running task: ${bg.title}`}
                          >
                            <span className="truncate flex-1">{bg.title}</span>
                            <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-[#9AA0A6]">
                              <span>running</span>
                              <ChevronRight className="w-3 h-3" />
                            </div>
                          </button>
                        ))}

                        {isTurnActive && (adaptiveCotLabel || activeStatusLabel) && (
                          <div className="px-2 py-0.5 text-[11px] text-[#6E6E73] truncate">
                            {adaptiveCotLabel || activeStatusLabel}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              <PromptBar
                onSend={handleSendPrompt}
                onTierChange={handleTierSwitch}
                onStop={handleStopGeneration}
                onQueue={handleQueuePrompt}
                onClearContext={handleClearContext}
                onInterruptAndSend={handleInterruptAndSend}
              />
            </div>
          </div>

          {mobileTab === 'workbench' && (
            <div className="flex-1 min-h-0 flex flex-col md:hidden bg-[#131314] overflow-hidden">
              <Suspense
                fallback={
                  <div className="p-4 text-xs text-[#9AA0A6]">Loading workbench editor...</div>
                }
              >
                <WorkbenchEditor />
              </Suspense>
            </div>
          )}

          {mobileTab === 'tasks' && (
            <div className="flex-1 min-h-0 flex flex-col md:hidden bg-[#131314] overflow-hidden">
              <TaskChecklist onSync={handleArtifactSync} />
            </div>
          )}
        </div>
      </main>

      {showRightDrawer && (
        <Splitter
          onResize={(delta) =>
            setRightDrawerWidth((prev) => Math.max(260, Math.min(720, prev - delta)))
          }
          className="hidden md:flex"
        />
      )}

      {/* 3. RIGHT PANE (Compact AuxTabBar + Full-Height Workbench) */}
      {showRightDrawer && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-30 md:hidden"
            onClick={() => setShowRightDrawer(false)}
          />
          <aside
            style={{ width: `${rightDrawerWidth}px` }}
            className="shrink-0 h-full bg-[#131314] p-2.5 flex flex-col gap-2 min-w-0 fixed md:static inset-y-0 right-0 z-40 max-w-[92vw] md:max-w-none shadow-2xl md:shadow-none border-l border-[#222225] md:border-l-0"
          >
            <div className="flex items-center justify-between md:hidden px-1 pt-0.5">
              <span className="text-xs font-medium text-[#E3E3E3]">Workspace Pane</span>
              <button
                type="button"
                onClick={() => setShowRightDrawer(false)}
                className="p-1 rounded-md text-[#8E8E93] hover:text-[#E3E3E3] hover:bg-[#1E1E20]"
                title="Close Right Pane"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {activeTab === 'none' ? (
              <OverviewSidebar onCloseDrawer={() => setShowRightDrawer(false)} />
            ) : (
              <>
                <div className="flex items-center justify-between px-2 py-1 bg-[#18181B] border border-[#26262A] rounded-xl shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveTab('none')}
                    className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#A1A1AA] hover:text-[#E3E3E3] px-1.5 py-0.5 rounded-md hover:bg-[#222327] transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Overview</span>
                  </button>
                  <span className="text-[11px] font-medium text-[#8E8E93] pr-1.5">
                    {activeTab === 'changes'
                      ? 'Review'
                      : activeTab === 'editor'
                      ? 'Files'
                      : activeTab === 'terminal'
                      ? 'Terminal'
                      : activeTab === 'extensions'
                      ? 'Extensions'
                      : activeTab === 'subagents'
                      ? 'Subagents'
                      : activeTab === 'tasks'
                      ? 'Background Tasks'
                      : activeTab === 'plan'
                      ? 'Artifacts'
                      : activeTab === 'swarm'
                      ? 'Swarm Board'
                      : activeTab === 'preview'
                      ? 'Vision Preview'
                      : activeTab === 'harness'
                      ? 'Task Harness'
                      : activeTab === 'evidence'
                      ? 'Evidence'
                      : activeTab}
                  </span>
                </div>

                {/* Active Workbench View Card */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#18181B] border border-[#26262A] rounded-xl shadow-md">
                  {activeTab === 'changes' && <ChangesTab />}
                  {activeTab === 'editor' && (
                    <Suspense
                      fallback={<div className="p-4 text-xs text-[#9AA0A6]">Loading editor...</div>}
                    >
                      <WorkbenchEditor />
                    </Suspense>
                  )}
                  {activeTab === 'terminal' && (
                    <Suspense
                      fallback={<div className="p-4 text-xs text-[#9AA0A6]">Loading terminal...</div>}
                    >
                      <IntegratedTerminal />
                    </Suspense>
                  )}
                  {activeTab === 'extensions' && <ExtensionsTab />}
                  {activeTab === 'preview' && <VisionPreviewTab />}
                  {activeTab === 'harness' && <HarnessWorkbenchTab />}
                  {activeTab === 'subagents' && <SubagentsTab />}
                  {activeTab === 'tasks' && <TaskChecklist onSync={handleArtifactSync} />}
                  {activeTab === 'plan' && <PlanViewer onProceedPlan={(p) => handleSendPrompt(p)} />}
                  {activeTab === 'evidence' && <EvidenceDrawer />}
                  {activeTab === 'swarm' && <SwarmBoardTab />}
                </div>
              </>
            )}
        </aside>
        </>
      )}

      </div>

      {/* Modals */}
      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        </Suspense>
      )}
      <MobileRemoteModal isOpen={isRemoteOpen} onClose={() => setIsRemoteOpen(false)} />
      {isAutomationsOpen && (
        <Suspense fallback={null}>
          <AutomationsModal
            isOpen={isAutomationsOpen}
            onClose={() => setIsAutomationsOpen(false)}
            onRunAutomationNow={(prompt, tier) => handleSendPrompt(prompt, undefined, tier)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default App;

