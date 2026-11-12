import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  isPhaseProtocolActive,
  applyDpiScaleToDom,
} from './store/useSessionStore';
import { useArtifactStore } from './store/useArtifactStore';
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
import { AuxTabBar } from './components/right-canvas/AuxTabBar';
import { SwarmBoardTab } from './components/right-canvas/SwarmBoardTab';
import { ChangesTab } from './components/right-canvas/ChangesTab';
import { SubagentsTab } from './components/right-canvas/SubagentsTab';
import { Splitter } from './components/common/Splitter';
import { ModelTier, ThinkingBudget } from './types/protocol';
import { UpdateNotificationBanner } from './components/common/UpdateNotificationBanner';
import { checkForAppUpdates, UpdateInfo } from './services/updaterService';
import { DpiScaleControl } from './components/center-canvas/DpiScaleControl';

const getOrCreateEdgeClientId = (): string => {
  try {
    const existing = localStorage.getItem('lg_edge_client_id');
    if (existing) return existing;
    const created = `edge-${crypto.randomUUID()}`;
    localStorage.setItem('lg_edge_client_id', created);
    return created;
  } catch {
    return `edge-${Date.now()}`;
  }
};

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
    appendStreamingThought,
    isGenerating,
    activeTurn,
    setIsGenerating,
    applyTurnPhase,
    startPendingTurn,
    applyLegacyTurnStart,
    applyLegacyTurnEnd,
    syncGenerating,
    setSwarmState,
    applySwarmEvent,
    setBackgroundTasks,
    subagentTasks,
    backgroundTasks,
    setSelectedSubagentId,
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
    setWalkthroughMarkdown,
    setActiveArtifactDoc,
    setActiveArtifactId,
    upsertArtifact,
    setArtifacts,
    parsedTasks,
    setCheckpoints,
    setLatestVisionCapture,
  } = useArtifactStore();

  const { setTelemetry, setMcpServers } = useTelemetryStore();

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
  const [mobileTab, setMobileTab] = useState<'chat' | 'workbench' | 'tasks'>('chat');
  const [gpuStatus, setGpuStatus] = useState<{
    gpuState: 'active' | 'standby' | 'waking' | 'offline';
    secondsRemaining: number;
    idleTimeoutMinutes: number;
  }>({ gpuState: 'standby', secondsRemaining: 0, idleTimeoutMinutes: 15 });
  const [reconnectCountdown, setReconnectCountdown] = useState<number>(0);
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const [reconnectKey, setReconnectKey] = useState<number>(0);

  // Antigravity 6-Pillar Live Sync State
  const [timerCountdown, setTimerCountdown] = useState<number>(0);
  const [timerTotal, setTimerTotal] = useState<number>(0);
  const [timerLabel, setTimerLabel] = useState<string>('Timer');
  const [lastCompaction, setLastCompaction] = useState<{
    previousTokens: number;
    compactedTokens: number;
  } | null>(null);
  const [adaptiveCotLabel, setAdaptiveCotLabel] = useState<string>('');



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

  const isTurnActive = selectIsTurnActive({ activeTurn, isGenerating });
  const activeStatusLabel = selectStatusLabel({ activeTurn });
  const wsRef = useRef<WebSocket | null>(null);
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
          // Register this Tauri desktop host with Central Brain for Remote Host Bridge execution
          if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
            import('@tauri-apps/api/core')
              .then(({ invoke }) => invoke<{ hostname: string; platform: string; home_dir: string }>('get_edge_identity'))
              .then((identity) => {
                if (!isDisposed && ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: 'EDGE_REGISTER',
                      payload: {
                        client_id: getOrCreateEdgeClientId(),
                        hostname: identity.hostname,
                        platform: identity.platform,
                        home_dir: identity.home_dir,
                      },
                    })
                  );
                }
              })
              .catch(() => {});
          }
          // Note: The server automatically sends full initial SYNC_STATE on `/ws/sync` connect.
          // Do not send fake placeholder IDs (`thread-default`) which would overwrite server state.
        };

        ws.onclose = () => {
          if (isDisposed) return;
          setIsConnected(false);
          setReconnectAttempt((prev) => prev + 1);
          setReconnectCountdown(3);
          if ((brainHost === '127.0.0.1' || brainHost === 'localhost') && brainPort !== '3390') {
            fetch('http://127.0.0.1:3390/health', { signal: AbortSignal.timeout(1200) })
              .then((r) => {
                if (!isDisposed && r.ok) setBrainConnection('127.0.0.1', '3390');
              })
              .catch(() => {});
          }
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
            const store = useSessionStore.getState();
            const activeThreadId = store.sessionId;
            const evtThreadId: string | undefined =
              payload?.thread_id || payload?.threadId || payload?.session_id;
            const isForActiveThread = !evtThreadId || evtThreadId === activeThreadId;
            const evtTurnId: string | undefined = payload?.turn_id || payload?.turnId;
            const evtMessageId: string | undefined = payload?.message_id || payload?.messageId;
            const curTurn = store.activeTurn;
            const isStaleTurnEvent = Boolean(
              (evtTurnId &&
                curTurn?.turnId &&
                !curTurn.turnId.startsWith('pending-') &&
                curTurn.turnId !== evtTurnId) ||
                (evtMessageId &&
                  curTurn?.isActive &&
                  curTurn.messageId &&
                  curTurn.messageId !== evtMessageId)
            );

            if (type === 'EDGE_TOOL_REQUEST') {
              const reqId = payload?.request_id;
              const toolName = payload?.tool_name;
              const toolArgs = payload?.args || {};
              const wsRoot = payload?.workspace_root || useSessionStore.getState().workspacePath || '.';
              if (reqId && toolName && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
                import('@tauri-apps/api/core')
                  .then(({ invoke }) =>
                    invoke<{ stdout: string; stderr: string; exit_code: number; duration_ms: number }>(
                      'execute_edge_tool',
                      {
                        toolName,
                        args: toolArgs,
                        workspaceRoot: wsRoot,
                      }
                    )
                  )
                  .then((res) => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        JSON.stringify({
                          type: 'EDGE_TOOL_RESULT',
                          payload: {
                            request_id: reqId,
                            stdout: res.stdout,
                            stderr: res.stderr,
                            exit_code: res.exit_code,
                            duration_ms: res.duration_ms,
                          },
                        })
                      );
                    }
                  })
                  .catch((err) => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        JSON.stringify({
                          type: 'EDGE_TOOL_RESULT',
                          payload: {
                            request_id: reqId,
                            stdout: '',
                            stderr: `Tauri edge tool error: ${err?.message || String(err)}`,
                            exit_code: 1,
                            duration_ms: 0,
                          },
                        })
                      );
                    }
                  });
              }
              return;
            }

            if (type === 'SYNC_STATE') {
              if (payload.projects?.length > 0) {
                setProjects(payload.projects, payload.activeProject?.id);
              }
              if (payload.threads) {
                setThreads(payload.threads, payload.activeThreadId);
              }
              const resolvedThreadId = useSessionStore.getState().sessionId;
              const activeThreadObj = Array.isArray(payload.threads)
                ? payload.threads.find((t: any) => t.id === resolvedThreadId)
                : null;
              const matchingStreams = Array.isArray(payload.activeStreams)
                ? payload.activeStreams.filter(
                    (s: any) => !s?.thread_id || s.thread_id === resolvedThreadId
                  )
                : [];
              if (payload.messages) {
                hydrateMessagesFromServer(
                  payload.messages,
                  matchingStreams,
                  activeThreadObj?.status,
                  payload.activeTurn
                );
              }
              const isServerThreadBusy =
                activeThreadObj?.status === 'thinking' || activeThreadObj?.status === 'executing_tool';
              const hasActiveStream = matchingStreams.length > 0 || isServerThreadBusy;
              if (payload.activeTurn && (!payload.activeTurn.thread_id || payload.activeTurn.thread_id === resolvedThreadId)) {
                applyTurnPhase(payload.activeTurn);
                if (!payload.activeTurn.is_active) setAdaptiveCotLabel('');
              } else {
                syncGenerating(hasActiveStream);
                if (!hasActiveStream) setAdaptiveCotLabel('');
              }
              if (payload.checkpoints) {
                setCheckpoints(payload.checkpoints);
              }
              if (Array.isArray(payload.artifacts)) {
                setArtifacts(payload.artifacts);
              }
              if (payload.mcpServers) {
                setMcpServers(payload.mcpServers);
              }
              if (Array.isArray(payload.backgroundTasks)) {
                setBackgroundTasks(payload.backgroundTasks);
              }
              if (payload.swarm !== undefined) {
                setSwarmState(payload.swarm || null);
              } else {
                setSwarmState(null);
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
            } else if (type === 'TURN_PHASE') {
              applyTurnPhase(payload);
              if (isForActiveThread && !payload?.is_active) {
                setAdaptiveCotLabel('');
              }
            } else if (type === 'TURN_STARTED') {
              if (!isForActiveThread) {
                store.setThreadStatus(evtThreadId!, 'thinking');
                return;
              }
              applyLegacyTurnStart(payload);
            } else if (type === 'THOUGHT_STREAM') {
              if (!isForActiveThread) {
                store.setThreadStatus(evtThreadId!, 'thinking');
                return;
              }
              if (isStaleTurnEvent) return;
              if (!isPhaseProtocolActive()) setIsGenerating(true);
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
              if (!isForActiveThread) return;
              if (isStaleTurnEvent) return;
              if (payload.tokens_per_sec) {
                setTelemetry({ tokensPerSec: payload.tokens_per_sec });
              }
              if (payload.chunk) {
                updateLastAssistantMessage(
                  payload.chunk,
                  payload.output_tokens,
                  payload.tokens_per_sec,
                  payload.message_id
                );
              }
              if (payload.is_finished) {
                finalizeAssistantMessage(payload.message_id);
                if (!isPhaseProtocolActive()) {
                  setIsGenerating(false);
                }
                setAdaptiveCotLabel('');
              } else if (!isPhaseProtocolActive()) {
                setIsGenerating(true);
              }
            } else if (type === 'TURN_COMPLETED' || type === 'TURN_ABORTED' || type === 'TURN_ERROR') {
              const phase =
                type === 'TURN_ABORTED' ? 'aborted' : type === 'TURN_ERROR' ? 'error' : 'completed';
              if (!isForActiveThread) {
                store.setThreadStatus(evtThreadId!, phase === 'error' ? 'error' : 'idle');
                return;
              }
              applyLegacyTurnEnd(payload, phase);
              if (!isStaleTurnEvent) setAdaptiveCotLabel('');
            } else if (type === 'STEP_NOTE_COMMITTED') {
              if (!isForActiveThread || isStaleTurnEvent) return;
              if (!isPhaseProtocolActive()) setIsGenerating(true);
              commitAssistantStepNote(payload.note, payload.committed_content, payload.message_id);
            } else if (type === 'SUBAGENT_EVENT') {
              if (!isForActiveThread) return;
              if (!isPhaseProtocolActive()) {
                if (payload?.status === 'running') {
                  setIsGenerating(true);
                } else if (payload?.status === 'completed' || payload?.status === 'error') {
                  if (!store.activeTurn?.isActive) setIsGenerating(false);
                }
              }
              upsertSubagentTask(payload);
            } else if (type === 'TOOL_EVENT') {
              if (!isForActiveThread) {
                store.setThreadStatus(
                  evtThreadId!,
                  payload?.status === 'running' ? 'executing_tool' : 'thinking'
                );
                return;
              }
              if (isStaleTurnEvent) return;
              if (!isPhaseProtocolActive() && payload?.status === 'running') {
                setIsGenerating(true);
              }
              updateLastAssistantTool(payload.command, payload.output, payload.status, {
                id: payload.tool_execution_id,
                toolName: payload.tool_name,
                durationMs: payload.duration_ms,
                exitCode: payload.exit_code,
                messageId: payload.message_id,
              });
            } else if (type === 'TOOL_STREAM') {
              if (!isForActiveThread || isStaleTurnEvent) return;
              if (!isPhaseProtocolActive()) setIsGenerating(true);
              if (payload?.chunk) {
                updateLastAssistantTool(
                  payload.tool_name || '',
                  payload.chunk,
                  'running',
                  {
                    id: payload.tool_execution_id,
                    appendOutput: true,
                    messageId: payload.message_id,
                  }
                );
              }
            } else if (type === 'CHECKPOINT_CREATED') {
              if (!isForActiveThread) return;
              if (payload.checkpoint) {
                const latestCheckpoints = useArtifactStore.getState().checkpoints;
                setCheckpoints([payload.checkpoint, ...latestCheckpoints]);
              }
            } else if (type === 'VISION_CAPTURE') {
              if (payload?.base64DataUrl) {
                setLatestVisionCapture(payload);
              }
            } else if (type === 'ARTIFACT_SYNC') {
              const syncId = payload.id || payload.artifact_name || 'art-' + Date.now();
              const syncType =
                payload.type ||
                (payload.artifact_name === 'walkthrough.md'
                  ? 'walkthrough'
                  : payload.artifact_name === 'task.md'
                  ? 'task'
                  : payload.artifact_name?.endsWith('.html')
                  ? 'html'
                  : 'plan');
              if (payload.id || payload.requestFeedback !== undefined || syncType === 'html') {
                upsertArtifact({
                  id: syncId,
                  threadId: evtThreadId || activeThreadId,
                  title: payload.title || payload.artifact_name,
                  type: syncType,
                  content: payload.content || '',
                  requestFeedback: Boolean(payload.requestFeedback),
                  userFacing: payload.userFacing,
                  updatedAt: Date.now(),
                });
              }
              if (payload.artifact_name === 'task.md' || syncType === 'task') {
                setTaskMarkdown(payload.content);
              } else if (payload.artifact_name === 'walkthrough.md' || syncType === 'walkthrough') {
                setWalkthroughMarkdown(payload.content);
                setActiveArtifactDoc('walkthrough.md');
                if (payload.id) setActiveArtifactId(syncId);
                setActiveTab('plan');
                setShowRightDrawer(true);
              } else if (syncType === 'html') {
                setActiveArtifactId(syncId);
                setActiveArtifactDoc(syncId);
                setActiveTab('plan');
                setShowRightDrawer(true);
              } else if (
                payload.artifact_name === 'implementation_plan.md' ||
                payload.artifact_name === 'plan.md' ||
                syncType === 'plan'
              ) {
                setPlanMarkdown(payload.content);
                setActiveArtifactDoc('plan.md');
                if (payload.id) setActiveArtifactId(syncId);
                setActiveTab('plan');
                setShowRightDrawer(true);
              }
            } else if (type === 'ARTIFACT_UPDATED') {
              const art = payload?.artifact;
              if (art) {
                const artId = art.id || art.title || 'art-' + Date.now();
                upsertArtifact({
                  id: artId,
                  threadId: art.threadId || art.thread_id || evtThreadId || activeThreadId,
                  title: art.title,
                  type: art.type,
                  content: art.content || '',
                  summary: art.summary,
                  filePath: art.filePath || art.file_path,
                  requestFeedback: Boolean(art.requestFeedback),
                  userFacing: art.userFacing,
                  updatedAt: art.updatedAt || Date.now(),
                });
                if (art.type === 'plan') {
                  setPlanMarkdown(art.content);
                  setActiveArtifactId(artId);
                  setActiveArtifactDoc('plan.md');
                  setActiveTab('plan');
                  setShowRightDrawer(true);
                } else if (art.type === 'walkthrough') {
                  setWalkthroughMarkdown(art.content);
                  setActiveArtifactId(artId);
                  setActiveArtifactDoc('walkthrough.md');
                  setActiveTab('plan');
                  setShowRightDrawer(true);
                } else if (art.type === 'html') {
                  setActiveArtifactId(artId);
                  setActiveArtifactDoc(artId);
                  setActiveTab('plan');
                  setShowRightDrawer(true);
                } else if (art.type === 'task') {
                  setTaskMarkdown(art.content);
                }
              }
            } else if (type === 'COUNTDOWN') {
              const rem = Number(payload?.secondsRemaining || 0);
              const tot = Number(payload?.totalSeconds || rem || 10);
              setTimerCountdown(rem);
              setTimerTotal(tot);
              setTimerLabel(payload?.label || 'Timer');
            } else if (type === 'TIMER_FIRED') {
              setTimerCountdown(0);
              if (payload?.prompt) {
                addMessage({
                  id: 'sys-timer-' + Date.now(),
                  role: 'system',
                  content: `⏰ **Scheduled Timer Fired:** ${payload.prompt}`,
                  timestamp: Date.now(),
                });
              }
            } else if (
              type === 'SWARM_STATE' ||
              type === 'SWARM_MESSAGE' ||
              type === 'SWARM_MEMBER_UPDATED'
            ) {
              if (!isForActiveThread) return;
              applySwarmEvent(type, payload);
            } else if (type === 'BACKGROUND_TASK_UPDATED') {
              if (Array.isArray(payload?.allTasks)) {
                setBackgroundTasks(payload.allTasks);
              }
            } else if (type === 'CONTEXT_COMPACTED') {
              setLastCompaction({
                previousTokens: payload?.previousTokens || 0,
                compactedTokens: payload?.compactedTokens || 0,
              });
            } else if (type === 'ADAPTIVE_COT_STATE') {
              if (!isForActiveThread) return;
              if (!isPhaseProtocolActive()) setIsGenerating(true);
              setAdaptiveCotLabel(payload?.modeLabel || '');
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

  // Scheduled Timer live countdown effect
  useEffect(() => {
    if (timerCountdown <= 0) return;
    const t = setInterval(() => {
      setTimerCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [timerCountdown]);



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
        tier === 'low'
          ? 'Qwen3.5-4B-EXL3-4.0bpw'
          : tier === 'medium'
          ? 'Qwen3.8-27B-EXL3-11.5GB'
          : 'Qwen 3.8 Flash-Next (Strata IQ3_S + Vision)',
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

  const handleSelectThread = async (threadId: string) => {
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
            {/* Antigravity Inline Scheduled Timer Pill */}
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
              {/* Antigravity Floating Pills (Pinned Tasks, Subagents & Status) */}
              {(totalTasks > 0 || isTurnActive || subagentTasks.length > 0 || backgroundTasks.some((t) => t.status === 'running')) && (
                <div className="flex items-center gap-2 mb-2 select-none overflow-x-auto pb-0.5">
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
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-[#E8EAED] bg-[#1C1D20] border border-[#2B2C30] hover:bg-[#25262B] transition-colors shadow-sm cursor-pointer shrink-0"
                    >
                      <span>{totalTasks} tasks ({completedTasks} completed)</span>
                      <ChevronRight className="w-3 h-3 text-[#9AA0A6]" />
                    </button>
                  )}
                  {subagentTasks.slice(0, 3).map((sa) => (
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
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors shadow-sm cursor-pointer shrink-0 ${
                        sa.status === 'running'
                          ? 'text-[#C58AF9] bg-[#C58AF9]/10 border-[#C58AF9]/30 hover:bg-[#C58AF9]/20'
                          : sa.status === 'error'
                            ? 'text-rose-300 bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20'
                            : 'text-[#E8EAED] bg-[#1C1D20] border-[#2B2C30] hover:bg-[#25262B]'
                      }`}
                      title={`Inspect ${sa.role} conversation`}
                    >
                      {sa.status === 'running' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#C58AF9] animate-ping" />
                      )}
                      <span className="truncate max-w-[140px]">{sa.role}</span>
                      <span className="text-[10px] font-mono opacity-75">
                        {sa.step}/{sa.maxSteps}
                      </span>
                      <ChevronRight className="w-3 h-3 opacity-70" />
                    </button>
                  ))}
                  {backgroundTasks
                    .filter((t) => t.status === 'running')
                    .slice(0, 2)
                    .map((bg) => (
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
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 transition-colors shadow-sm cursor-pointer shrink-0"
                        title={`Inspect running task: ${bg.title}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        <span className="truncate max-w-[130px]">{bg.title}</span>
                        <ChevronRight className="w-3 h-3 opacity-70" />
                      </button>
                    ))}
                  {isTurnActive && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-[#8AB4F8] bg-[#8AB4F8]/10 border border-[#8AB4F8]/20 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#8AB4F8] animate-ping" />
                      <span>{activeStatusLabel || adaptiveCotLabel || 'Reasoning active'}</span>
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

      {/* 3. RIGHT PANE (Compact AuxTabBar + Full-Height Workbench) */}
      {showRightDrawer && (
        <aside
          style={{ width: `${rightDrawerWidth}px` }}
          className="shrink-0 h-full bg-[#131314] p-2.5 flex flex-col gap-2 min-w-0 hidden md:flex"
        >
          <AuxTabBar />

          {/* Active Workbench View Card */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#18181B] border border-[#26262A] rounded-xl shadow-md">
            {activeTab === 'none' && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3 text-[#8E8E93]">
                <div className="text-xs font-medium text-[#E3E3E3]">Workspace Auxiliary Pane</div>
                <p className="text-[11.5px] leading-relaxed max-w-[230px]">
                  Pick a view above to inspect file diffs, artifacts, workspace files, terminal, subagents, or the swarm board.
                </p>
                <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                  {(['changes', 'plan', 'editor', 'terminal', 'subagents', 'swarm'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className="px-2.5 py-1 rounded-lg bg-[#222327] hover:bg-[#2A2B30] text-[11px] text-[#E3E3E3] border border-[#32343A] cursor-pointer capitalize"
                    >
                      {tab === 'changes' ? 'Review' : tab === 'plan' ? 'Artifacts' : tab === 'editor' ? 'Files' : tab}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {activeTab === 'changes' && <ChangesTab />}
            {activeTab === 'editor' && <WorkbenchEditor />}
            {activeTab === 'terminal' && <IntegratedTerminal />}
            {activeTab === 'preview' && <VisionPreviewTab />}
            {activeTab === 'harness' && <HarnessWorkbenchTab />}
            {activeTab === 'subagents' && <SubagentsTab />}
            {activeTab === 'tasks' && <TaskChecklist onSync={handleArtifactSync} />}
            {activeTab === 'plan' && <PlanViewer onProceedPlan={(p) => handleSendPrompt(p)} />}
            {activeTab === 'evidence' && <EvidenceDrawer />}
            {activeTab === 'swarm' && <SwarmBoardTab />}
          </div>
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

