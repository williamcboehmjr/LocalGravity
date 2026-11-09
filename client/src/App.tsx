import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
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
import { useSessionStore,
  FileAttachmentItem, QueuedMessage } from './store/useSessionStore';
import { useArtifactStore, WorkbenchTab } from './store/useArtifactStore';
import { useTelemetryStore } from './store/useTelemetryStore';
import { SessionList } from './components/left-rail/SessionList';
import { SkillsDrawer } from './components/left-rail/SkillsDrawer';
import { NodeStatusBadge } from './components/left-rail/NodeStatusBadge';
import { ReconnectBadge } from './components/ReconnectBadge';
import { SettingsModal } from './components/left-rail/SettingsModal';
import { MobileRemoteModal } from './components/left-rail/MobileRemoteModal';
import { AutomationsModal } from './components/left-rail/AutomationsModal';
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
import { UpdateNotificationBanner } from './components/common/UpdateNotificationBanner';
import { checkForAppUpdates, UpdateInfo } from './services/updaterService';
import { DpiScaleControl } from './components/center-canvas/DpiScaleControl';
import { applyDpiScaleToDom } from './store/useSessionStore';

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
    commitAssistantStepNote,
    upsertSubagentTask,
    subagentTasks,
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
  const [isAutomationsOpen, setIsAutomationsOpen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [showSkillsDrawer, setShowSkillsDrawer] = useState(false);
  const [showSubagentDrawer, setShowSubagentDrawer] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'workbench' | 'tasks'>('chat');
  const [gpuStatus, setGpuStatus] = useState<{
    gpuState: 'active' | 'standby' | 'waking' | 'offline';
    secondsRemaining: number;
    idleTimeoutMinutes: number;
  }>({ gpuState: 'standby', secondsRemaining: 0, idleTimeoutMinutes: 15 });
  const [reconnectCountdown, setReconnectCountdown] = useState<number>(0);
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const [reconnectKey, setReconnectKey] = useState<number>(0);



  const handleManualReconnect = useCallback(() => {
    setReconnectCountdown(0);
    setReconnectKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const checkGpu = () => {
      fetch(`${apiBaseUrl}/api/gpu/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            setGpuStatus({
              gpuState: data.gpuState || 'standby',
              secondsRemaining: data.secondsRemaining || 0,
              idleTimeoutMinutes: data.idleTimeoutMinutes || 15,
            });
          }
        })
        .catch(() => {});
    };

    checkGpu();
    const interval = setInterval(checkGpu, 3000);
    return () => clearInterval(interval);
  }, [apiBaseUrl]);
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
          const host = isRemote ? window.location.hostname : '127.0.0.1';
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
        const cleanHost = effectiveHost.replace(/^http/, 'ws').replace('localhost', '127.0.0.1');
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
          setReconnectAttempt(0);
          setReconnectCountdown(0);
          // Note: The server automatically sends full initial SYNC_STATE on `/ws/sync` connect.
          // Do not send fake placeholder IDs (`thread-default`) which would overwrite server state.
        };

        ws.onclose = () => {
          if (isDisposed) return;
          setIsConnected(false);
          setReconnectAttempt((prev) => prev + 1);
          setReconnectCountdown(3);
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
              const hasActiveStream = Array.isArray(payload.activeStreams) && payload.activeStreams.length > 0;
              if (!hasActiveStream && isGenerating) {
                finalizeAssistantMessage();
                setIsGenerating(false);
              }
              if (payload.checkpoints) {
                setCheckpoints(payload.checkpoints);
              }
              if (payload.mcpServers) {
                setMcpServers(payload.mcpServers);
              }
              if (payload.tabby || payload.telemetry) {
                setTelemetry({
                  vramUsedGb: payload.telemetry?.vramUsedGb ?? 14.8,
                  vramTotalGb: payload.telemetry?.vramTotalGb ?? 16.0,
                  vramPercent: payload.telemetry?.vramPercent ?? 92,
                  hostRamUsedGb: payload.telemetry?.hostRamUsedGb ?? 24.0,
                  hostRamTotalGb: payload.telemetry?.hostRamTotalGb ?? 128.0,
                  hostRamPercent: payload.telemetry?.hostRamPercent ?? 19,
                  gpuUtilization: payload.telemetry?.gpuUtilization ?? 12,
                  cpuUtilization: payload.telemetry?.cpuUtilization ?? 8,
                  activeTier: payload.tabby?.activeTier || 'high',
                  activeModel: payload.tabby?.activeModel || 'qwen3.8-flash-next-iq3_s',
                  tokensPerSec: payload.tabby?.tokensPerSec ?? 74.2,
                  lastSwapDurationMs: payload.tabby?.lastSwapDurationMs ?? 840,
                  sysramCache: payload.tabby?.sysramCache,
                  daemonPort: payload.ports?.daemonPort ?? 3390,
                  tabbyPort: payload.ports?.tabbyPort ?? 8080,
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
              if (payload.tokens_per_sec) {
                setTelemetry({ tokensPerSec: payload.tokens_per_sec });
              }
              appendStreamingThought(
                payload.chunk,
                payload.elapsed_ms,
                payload.token_count,
                payload.is_finished
              );
            } else if (type === 'TOKEN_STREAM') {
              if (payload.tokens_per_sec) {
                setTelemetry({ tokensPerSec: payload.tokens_per_sec });
              }
              if (payload.is_finished) {
                finalizeAssistantMessage();
                setIsGenerating(false);
              } else {
                updateLastAssistantMessage(payload.chunk, payload.output_tokens, payload.tokens_per_sec);
              }
            } else if (type === 'TURN_COMPLETED' || type === 'TURN_ABORTED' || type === 'TURN_ERROR') {
              finalizeAssistantMessage();
              setIsGenerating(false);
            } else if (type === 'STEP_NOTE_COMMITTED') {
              commitAssistantStepNote(payload.note, payload.committed_content);
            } else if (type === 'SUBAGENT_EVENT') {
              upsertSubagentTask(payload);
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
              } else if (
                payload.artifact_name === 'implementation_plan.md' ||
                payload.artifact_name === 'plan.md'
              ) {
                setPlanMarkdown(payload.content);
                setActiveTab('plan');
                setShowRightDrawer(true);
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
          setReconnectAttempt((prev) => prev + 1);
          setReconnectCountdown(3);
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
  }, [hostUrl, reconnectKey]);

  // Reconnection countdown timer (ticks every second when disconnected)
  useEffect(() => {
    if (isConnected) {
      setReconnectCountdown(0);
      setReconnectAttempt(0);
      return;
    }

    if (reconnectCountdown <= 0) return;

    const timer = setInterval(() => {
      setReconnectCountdown((curr) => {
        if (curr <= 1) {
          handleManualReconnect();
          return 0;
        }
        return curr - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isConnected, reconnectCountdown, handleManualReconnect]);



  // Proactive HTTP health probe when disconnected: detects server recovery & auto-discovers port
  useEffect(() => {
    if (isConnected) return;
    let isDisposed = false;

    const probe = async () => {
      const candidatePorts = [brainPort, '3390', '3391', '3392', '3393'].filter(
        (v, i, a) => a.indexOf(v) === i
      );

      for (const p of candidatePorts) {
        if (isDisposed) return;
        try {
          const res = await fetch(`http://${brainHost}:${p}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(900),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.status === 'ok') {
              if (p !== brainPort) {
                setBrainConnection(brainHost, p);
              } else {
                handleManualReconnect();
              }
              return;
            }
          }
        } catch {}
      }
    };

    const interval = setInterval(probe, 1500);
    probe();

    return () => {
      isDisposed = true;
      clearInterval(interval);
    };
  }, [isConnected, brainHost, brainPort, handleManualReconnect, setBrainConnection]);

  const handleSendPrompt = (
    text: string,
    images?: string[],
    tierOverride?: ModelTier,
    thinkingBudgetOverride?: ThinkingBudget,
    attachments?: FileAttachmentItem[]
  ) => {
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
          ? 'Qwen3.5-4B-EXL3-4.0bpw'
          : tier === 'medium'
          ? 'Qwen3.8-27B-EXL3-11.5GB'
          : 'Qwen 3.8 Flash-Next (Strata IQ3_S + Vision)',
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
            attachments,
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
        handleSendPrompt(next.text, next.images, next.tier, next.thinkingBudget, next.attachments);
      }
    }
  }, [isGenerating, messageQueue.length]);

  const handleStopGeneration = () => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            id: 'stop-' + Date.now(),
            type: 'STOP_GENERATION',
            payload: { thread_id: sessionId, session_id: sessionId },
          })
        );
        wsRef.current.send(
          JSON.stringify({
            id: 'cancel-' + Date.now(),
            type: 'CANCEL_GENERATION',
            payload: { thread_id: sessionId, session_id: sessionId },
          })
        );
      }
    } catch (e) {
      console.warn('[App] WebSocket stop error:', e);
    }

    // HTTP Stop Fallback - fire both thread and universal endpoints immediately
    const stopUrl = `${apiBaseUrl}/api/threads/${sessionId}/stop`;
    fetch(stopUrl, { method: 'POST' }).catch(() => {});
    fetch(`${apiBaseUrl}/api/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: sessionId, session_id: sessionId }),
    }).catch(() => {});

    finalizeAssistantMessage();
    setIsGenerating(false);
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
    handleStopGeneration();
    setTimeout(() => {
      handleSendPrompt(item.text, item.images, item.tier, item.thinkingBudget, item.attachments);
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
    <div className="flex flex-col h-full max-h-full w-full bg-[#131314] text-[#E3E3E3] overflow-hidden font-sans">
      {!updateDismissed && updateInfo && (
        <UpdateNotificationBanner
          updateInfo={updateInfo}
          onDismiss={() => setUpdateDismissed(true)}
        />
      )}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
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
      <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#0c0d0e] relative">
        {/* Top Header Bar matching Antigravity Mobile */}
        <header className="h-11 shrink-0 px-4 flex items-center justify-between bg-[#0c0d0e] border-b border-[#1f2023] z-10 select-none">
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
            {/* DPI / UI Scale Control Pill (+ / -) */}
            <DpiScaleControl />

            {/* Brain & GPU Lifecycle Status Pill */}
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border ${
                isConnected
                  ? gpuStatus.gpuState === 'active'
                    ? 'bg-[#1A1A1D] border-[#2A2A2E] text-[#A0A0A5] hover:text-[#E3E3E3] hover:border-[#3E3E44]'
                    : 'bg-[#151821] border-[#252E3E] text-[#7DD3FC] hover:text-[#BAE6FD]'
                  : 'bg-amber-950/40 border-amber-700/50 text-amber-300 hover:bg-amber-900/50'
              }`}
              title={
                !isConnected
                  ? `Disconnected from ${brainHost}:${brainPort} — Click to configure & test`
                  : gpuStatus.gpuState === 'active'
                  ? `Connected (${brainHost}:${brainPort}) — GPU Active in VRAM. Auto-offloads after ${gpuStatus.idleTimeoutMinutes}m idle to free 100% VRAM.`
                  : gpuStatus.gpuState === 'waking'
                  ? `Connected (${brainHost}:${brainPort}) — ⚡ Waking Strata GPU Engine...`
                  : `Connected (${brainHost}:${brainPort}) — 🌙 Standby (0 MB VRAM). Automatically wakes into GPU when you send a prompt!`
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  !isConnected
                    ? 'bg-amber-400 animate-pulse'
                    : gpuStatus.gpuState === 'active'
                    ? 'bg-emerald-400'
                    : gpuStatus.gpuState === 'waking'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-sky-400'
                }`}
              />
              <span className="hidden sm:inline font-mono">
                {!isConnected
                  ? 'Connect Brain'
                  : gpuStatus.gpuState === 'active'
                  ? `${brainHost}:${brainPort} • GPU Active${gpuStatus.secondsRemaining > 0 ? ` (${Math.ceil(gpuStatus.secondsRemaining / 60)}m)` : ''}`
                  : gpuStatus.gpuState === 'waking'
                  ? `${brainHost}:${brainPort} • Waking GPU...`
                  : `${brainHost}:${brainPort} • Standby (0 MB)`}
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
              {/* Antigravity Floating Pills (Review & Status) */}
              {(totalTasks > 0 || isGenerating) && (
                <div className="flex items-center gap-2 mb-2 select-none overflow-x-auto">
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
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-[#E8EAED] bg-[#1C1D20] border border-[#2B2C30] hover:bg-[#25262B] transition-colors shadow-sm cursor-pointer"
                    >
                      <span>{totalTasks} tasks ({completedTasks} completed)</span>
                      <ChevronRight className="w-3 h-3 text-[#9AA0A6]" />
                    </button>
                  )}
                  {isGenerating && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-[#8AB4F8] bg-[#8AB4F8]/10 border border-[#8AB4F8]/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#8AB4F8] animate-ping" />
                      <span>Reasoning active</span>
                    </div>
                  )}
                </div>
              )}
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
              <WorkbenchEditor />
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
                  onClick={() => setActiveTab(activeTab === 'preview' ? 'none' : 'preview')}
                  className={`p-1 rounded hover:bg-[#242428] transition-colors ${
                    activeTab === 'preview' ? 'text-[#E3E3E3]' : 'text-[#6E6E73] hover:text-[#E3E3E3]'
                  }`}
                  title="Vision / App Preview"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab(activeTab === 'harness' ? 'none' : 'harness')}
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
                    onClick={() => setActiveTab(activeTab === item.id ? 'none' : item.id)}
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

            <div className="mt-2 pt-2 border-t border-[#242428]">
              <button
                type="button"
                onClick={() => setShowSubagentDrawer(!showSubagentDrawer)}
                className="w-full flex items-center justify-between px-1.5 py-1 rounded-lg hover:bg-[#202024] text-[11px] text-[#8E8E93] hover:text-[#E3E3E3] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <span>Task Subagents & Logs</span>
                  {isGenerating && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#60A5FA] animate-ping" />
                  )}
                </div>
                <span className="px-1.5 py-0.5 rounded-full bg-[#242428] text-[#A0A0A5] font-mono text-[10px]">
                  {subagentTasks.filter((t) => t.status === 'running').length || mcpServers.filter((s) => s.enabled).length} • {tokensPerSec > 0 ? tokensPerSec.toFixed(1) : '—'} tok/s
                </span>
              </button>

              {(showSubagentDrawer || isGenerating) && subagentTasks.length > 0 && (
                <div className="mt-1.5 space-y-1.5 max-h-48 overflow-y-auto px-1 pt-1">
                  {subagentTasks.slice(0, 4).map((task) => (
                    <div
                      key={task.id}
                      className="p-2 rounded-lg bg-[#131316] border border-[#242429] text-[11px] space-y-1"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              task.status === 'running'
                                ? 'bg-[#60A5FA] animate-pulse'
                                : 'bg-emerald-400'
                            }`}
                          />
                          <span className="font-medium text-[#E3E3E3] truncate">
                            {task.role}
                          </span>
                        </div>
                        <span className="font-mono text-[9.5px] text-[#6E6E73] shrink-0">
                          Step {task.step}/{task.maxSteps}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-[#8E8E93] truncate">
                        {task.summary}
                      </div>
                      {task.status === 'running' && task.logs.length > 1 && (
                        <div className="pl-2 border-l border-[#26262C] space-y-0.5 pt-0.5">
                          {task.logs.slice(-3, -1).map((lg, i) => (
                            <div
                              key={i}
                              className="font-mono text-[9.5px] text-[#5E5E66] truncate"
                            >
                              {lg}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Active Workbench View Card */}
          {activeTab !== 'none' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#18181B] border border-[#26262A] rounded-xl shadow-md">
              {activeTab === 'editor' && <WorkbenchEditor />}
              {activeTab === 'terminal' && <IntegratedTerminal />}
              {activeTab === 'preview' && <VisionPreviewTab />}
              {activeTab === 'harness' && <HarnessWorkbenchTab />}
              {activeTab === 'tasks' && <TaskChecklist onSync={handleArtifactSync} />}
              {activeTab === 'plan' && <PlanViewer onProceedPlan={(p) => handleSendPrompt(p)} />}
              {activeTab === 'evidence' && <EvidenceDrawer />}
            </div>
          )}
        </aside>
      )}

      </div>

      {/* Modals */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <MobileRemoteModal isOpen={isRemoteOpen} onClose={() => setIsRemoteOpen(false)} />
      <AutomationsModal
        isOpen={isAutomationsOpen}
        onClose={() => setIsAutomationsOpen(false)}
        onRunAutomationNow={(prompt, tier) => handleSendPrompt(prompt, undefined, tier)}
      />
    </div>
  );
};

export default App;

