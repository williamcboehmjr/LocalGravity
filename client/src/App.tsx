import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  PanelLeftClose,
  PanelRightClose,
  Sparkles,
  Smartphone,
  MessageSquare,
  ListTodo,
  FileCode2,
  Terminal,
  Eye,
  ShieldCheck,
  Download,
  RotateCcw,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { useSessionStore, QueuedMessage } from './store/useSessionStore';
import { useArtifactStore, WorkbenchTab } from './store/useArtifactStore';
import { useTelemetryStore } from './store/useTelemetryStore';
import { Splitter } from './components/common/Splitter';
import { WorkspacePicker } from './components/left-rail/WorkspacePicker';
import { SessionList } from './components/left-rail/SessionList';
import { NodeStatusBadge } from './components/left-rail/NodeStatusBadge';
import { SkillsDrawer } from './components/left-rail/SkillsDrawer';
import { SettingsModal } from './components/left-rail/SettingsModal';
import { MobileRemoteModal } from './components/left-rail/MobileRemoteModal';
import { ChatFeed } from './components/center-canvas/ChatFeed';
import { PromptBar } from './components/center-canvas/PromptBar';
import { PolicyToggle } from './components/center-canvas/PolicyToggle';
import { TaskChecklist } from './components/right-canvas/TaskChecklist';
import { PlanViewer } from './components/right-canvas/PlanViewer';
import { EvidenceDrawer } from './components/right-canvas/EvidenceDrawer';
import { WorkbenchEditor } from './components/right-canvas/WorkbenchEditor';
import { IntegratedTerminal } from './components/right-canvas/IntegratedTerminal';
import { VisionPreviewTab } from './components/right-canvas/VisionPreviewTab';
import { HarnessWorkbenchTab } from './components/right-canvas/HarnessWorkbenchTab';
import { ModelTier, ThinkingBudget } from './types/protocol';

export const App: React.FC = () => {
  const {
    projects,
    activeProjectId,
    sessionId,
    sessions,
    workspacePath,
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
    activeModelName,
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
    setActiveCheckpoint,
    setLatestVisionCapture,
  } = useArtifactStore();

  const { setTelemetry, setMcpServers } = useTelemetryStore();

  const [leftRailWidth, setLeftRailWidth] = useState(275);
  const [rightDrawerWidth, setRightDrawerWidth] = useState(460);
  const [showLeftRail, setShowLeftRail] = useState(window.innerWidth > 900);
  const [showRightDrawer, setShowRightDrawer] = useState(window.innerWidth > 1100);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRemoteOpen, setIsRemoteOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'workbench' | 'tasks'>('chat');

  const wsRef = useRef<WebSocket | null>(null);

  // Auto-discover runtime ports from `/runtime-ports.json` if running via Vite dev or Tauri
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

  // Connect and multiplex state over `/ws/sync`
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;

    const effectiveHost = hostUrl;

    const connect = () => {
      try {
        const cleanHost = effectiveHost.replace(/^http/, 'ws');
        const url = `${cleanHost}/ws/sync`;
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          ws?.send(
            JSON.stringify({
              id: 'init-' + Date.now(),
              type: 'SESSION_INIT',
              payload: {
                thread_id: sessionId,
                project_id: activeProjectId,
                workspace_path: workspacePath,
                platform: navigator.userAgent.toLowerCase().includes('mac') ? 'macos' : 'windows',
                client_version: '2.0.0',
              },
            })
          );
        };

        ws.onclose = () => {
          setIsConnected(false);
          reconnectTimeout = setTimeout(connect, 2500);
        };

        ws.onerror = () => {
          setIsConnected(false);
        };

        ws.onmessage = (event) => {
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
        reconnectTimeout = setTimeout(connect, 2500);
      }
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [hostUrl, sessionId, activeProjectId]);

  const handleSendPrompt = (
    text: string,
    images?: string[],
    tierOverride?: ModelTier,
    thinkingBudgetOverride?: ThinkingBudget
  ) => {
    const tier = tierOverride || selectedTier;
    const budget = thinkingBudgetOverride || thinkingBudget;

    addMessage({
      id: 'msg-' + Date.now(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      images,
    });

    addMessage({
      id: 'msg-' + (Date.now() + 1),
      role: 'assistant',
      content: '',
      tier,
      modelName: activeModelName,
      timestamp: Date.now(),
    });

    autoNameSessionFromPrompt(sessionId, text);
    setIsGenerating(true);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          id: 'prompt-' + Date.now(),
          type: 'PROMPT_SUBMIT',
          payload: {
            session_id: sessionId,
            thread_id: sessionId,
            prompt: text,
            tier,
            thinking_budget: budget,
            images,
          },
        })
      );
    }
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
    }, 60);
  };

  const isDequeuingRef = useRef(false);
  useEffect(() => {
    if (!isGenerating && messageQueue.length > 0 && !isDequeuingRef.current) {
      isDequeuingRef.current = true;
      const nextMessage = dequeueMessage();
      if (nextMessage) {
        handleSendPrompt(
          nextMessage.text,
          nextMessage.images,
          nextMessage.tier,
          nextMessage.thinkingBudget
        );
      }
      setTimeout(() => {
        isDequeuingRef.current = false;
      }, 100);
    }
  }, [isGenerating, messageQueue.length]);

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

  const handleStopGeneration = () => {
    setIsGenerating(false);
    finalizeAssistantMessage();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          id: 'stop-' + Date.now(),
          type: 'STOP_GENERATION',
          payload: {
            session_id: sessionId,
            thread_id: sessionId,
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
          title: 'New Thread',
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

  const handleClearContext = async () => {
    clearMessages();
    try {
      await fetch(`${apiBaseUrl}/api/threads/${sessionId}/clear`, { method: 'POST' });
    } catch {}
  };

  const handleExportThread = () => {
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

  const workbenchTabs: Array<{ id: WorkbenchTab; label: string; icon: React.ReactNode }> = [
    { id: 'editor', label: 'Code & Diff', icon: <FileCode2 className="w-3.5 h-3.5" /> },
    { id: 'terminal', label: 'Terminal', icon: <Terminal className="w-3.5 h-3.5" /> },
    { id: 'preview', label: 'Vision / App', icon: <Eye className="w-3.5 h-3.5" /> },
    { id: 'harness', label: 'Harness²', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { id: 'tasks', label: 'Tasks', icon: <ListTodo className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-screen bg-[#0B0D11] text-[#E8EAED] overflow-hidden font-sans">
      {/* 1. LEFT PANE (Project & Thread Navigator - #111318) */}
      {showLeftRail && (
        <aside
          style={{ width: `${leftRailWidth}px` }}
          className="shrink-0 h-full bg-[#111318] border-r border-[#262B36] hidden md:flex flex-col p-3 space-y-3 select-none"
        >
          {/* Brand Header */}
          <div className="flex items-center justify-between pb-2 border-b border-[#262B36]">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#8AB4F8]/25 via-[#C58AF9]/25 to-[#F28B82]/25 border border-[#8AB4F8]/50 flex items-center justify-center text-[#8AB4F8]">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="font-semibold text-sm tracking-tight text-[#E8EAED]">
                Antigravity 2.0
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="p-1 hover:bg-[#1C2029] rounded text-[#9AA0A6] hover:text-[#E8EAED]"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowLeftRail(false)}
                className="p-1 hover:bg-[#1C2029] rounded text-[#9AA0A6] hover:text-[#E8EAED]"
                title="Collapse Left Pane"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Top Project / Workspace Switcher Dropdown */}
          <WorkspacePicker
            onSelectProject={async (projId) => {
              try {
                const res = await fetch(
                  `${apiBaseUrl}/api/threads?project_id=${encodeURIComponent(projId)}`
                );
                if (res.ok) {
                  const data = await res.json();
                  setThreads(data.threads || []);
                }
              } catch {}
            }}
          />

          {/* Chronological & Pinned Threads List + New Thread (Ctrl+N) */}
          <SessionList
            onNewThread={handleNewThread}
            onSelectThread={handleSelectThread}
          />

          {/* Skills Drawer */}
          <SkillsDrawer />

          {/* Bottom Hardware & MCP Telemetry Footer */}
          <NodeStatusBadge />
        </aside>
      )}

      {showLeftRail && (
        <Splitter
          onResize={(delta) =>
            setLeftRailWidth((prev) => Math.max(220, Math.min(420, prev + delta)))
          }
          className="hidden md:flex"
        />
      )}

      {/* 2. CENTER PANE (Agent Stream & Prompt Cockpit - #161920) */}
      <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#161920] relative">
        {/* Center Breadcrumb Header: Project Name / Thread Title */}
        <header className="h-12 shrink-0 border-b border-[#262B36] px-3 sm:px-4 flex items-center justify-between bg-[#111318]/90 z-10">
          <div className="flex items-center gap-2 min-w-0">
            {!showLeftRail && (
              <button
                type="button"
                onClick={() => setShowLeftRail(true)}
                className="p-1.5 hover:bg-[#1C2029] rounded text-[#9AA0A6] hover:text-[#E8EAED] mr-1 hidden md:block"
                title="Expand Left Navigator"
              >
                <Sparkles className="w-4 h-4 text-[#8AB4F8]" />
              </button>
            )}

            <div className="flex items-center gap-1.5 text-xs sm:text-sm min-w-0 truncate">
              <span className="font-semibold text-[#9AA0A6] truncate">
                {activeProject?.name || 'LocalGravity'}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-[#5F6368] shrink-0" />
              <span className="font-semibold text-[#E8EAED] truncate">
                {activeSession?.title || 'Active Thread'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {checkpoints.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveCheckpoint(checkpoints[0]);
                  setActiveTab('editor');
                  setShowRightDrawer(true);
                }}
                className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#1C2029] border border-[#262B36] hover:border-[#8AB4F8] text-xs text-[#8AB4F8] transition-colors"
                title="Inspect or Rollback Latest File Checkpoint"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Checkpoints ({checkpoints.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportThread}
              className="p-1.5 rounded-lg bg-[#1C2029] border border-[#262B36] hover:bg-[#262B36] text-[#9AA0A6] hover:text-[#E8EAED]"
              title="Export Thread JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleClearContext}
              className="p-1.5 rounded-lg bg-[#1C2029] border border-[#262B36] hover:bg-[#262B36] text-[#9AA0A6] hover:text-[#F28B82]"
              title="Clear Thread Context"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors ${
                isConnected
                  ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300 hover:bg-emerald-900/40'
                  : 'bg-amber-950/30 border-amber-800/40 text-amber-300 hover:bg-amber-900/40'
              }`}
              title={isConnected ? `Connected to Brain (${brainHost}:${brainPort})` : `Disconnected - Click to test connection`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isConnected ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-amber-400 animate-pulse'
                }`}
              />
              <span className="hidden sm:inline font-mono text-[11px]">
                {isConnected ? `${brainHost}:${brainPort}` : 'Disconnected'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsRemoteOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1C2029] border border-[#262B36] hover:border-[#8AB4F8] text-xs text-[#9AA0A6] hover:text-[#E8EAED] transition-colors"
              title="Open Remote Web / LAN Control QR"
            >
              <Smartphone className="w-3.5 h-3.5 text-[#8AB4F8]" />
              <span className="hidden lg:inline">LAN Web</span>
            </button>

            <PolicyToggle />

            {!showRightDrawer && (
              <button
                type="button"
                onClick={() => setShowRightDrawer(true)}
                className="p-1.5 hover:bg-[#1C2029] rounded text-[#9AA0A6] hover:text-[#E8EAED] hidden md:block"
                title="Open Right Workbench"
              >
                <PanelRightClose className="w-4 h-4 rotate-180" />
              </button>
            )}
          </div>
        </header>

        {!isConnected && (
          <div className="bg-amber-950/40 border-b border-amber-800/40 px-3 sm:px-4 py-2 flex items-center justify-between text-xs text-amber-200 shrink-0 z-10">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <span className="truncate">
                Disconnected from Brain at <code className="px-1.5 py-0.5 rounded bg-black/40 font-mono text-amber-300">{brainHost}:{brainPort}</code>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="shrink-0 px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-100 font-medium transition-colors text-[11px]"
            >
              Configure IP & Test
            </button>
          </div>
        )}

        {/* Center Body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          <div
            className={`flex-1 min-h-0 flex flex-col ${
              mobileTab === 'chat' ? 'flex' : 'hidden md:flex'
            }`}
          >
            <ChatFeed />
            <div className="shrink-0 p-3 sm:p-4 pt-1 bg-gradient-to-t from-[#0B0D11] via-[#161920] to-transparent z-10">
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
            <div className="flex-1 min-h-0 flex flex-col md:hidden bg-[#161920] overflow-hidden">
              <WorkbenchEditor />
            </div>
          )}

          {mobileTab === 'tasks' && (
            <div className="flex-1 min-h-0 flex flex-col md:hidden bg-[#161920] overflow-hidden">
              <TaskChecklist onSync={handleArtifactSync} />
            </div>
          )}
        </div>

        {/* Mobile Bottom Bar */}
        <nav className="h-14 shrink-0 border-t border-[#262B36] flex md:hidden bg-[#111318] z-20">
          <button
            type="button"
            onClick={() => setMobileTab('chat')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 text-xs ${
              mobileTab === 'chat' ? 'text-[#8AB4F8] font-semibold' : 'text-[#9AA0A6]'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Stream</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('workbench')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 text-xs ${
              mobileTab === 'workbench' ? 'text-[#8AB4F8] font-semibold' : 'text-[#9AA0A6]'
            }`}
          >
            <FileCode2 className="w-4 h-4" />
            <span>Workbench</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('tasks')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 text-xs ${
              mobileTab === 'tasks' ? 'text-[#8AB4F8] font-semibold' : 'text-[#9AA0A6]'
            }`}
          >
            <ListTodo className="w-4 h-4" />
            <span>
              Tasks ({completedTasks}/{totalTasks})
            </span>
          </button>
        </nav>
      </main>

      {showRightDrawer && (
        <Splitter
          onResize={(delta) =>
            setRightDrawerWidth((prev) => Math.max(320, Math.min(760, prev - delta)))
          }
          className="hidden md:flex"
        />
      )}

      {/* 3. RIGHT PANE (Multi-Tab Workbench & Live Environment - #161920) */}
      {showRightDrawer && (
        <aside
          style={{ width: `${rightDrawerWidth}px` }}
          className="shrink-0 h-full bg-[#161920] border-l border-[#262B36] flex flex-col min-w-0 hidden md:flex"
        >
          {/* Multi-Tab Workbench Header */}
          <div className="h-12 border-b border-[#262B36] px-2.5 flex items-center justify-between bg-[#111318] gap-1">
            <div className="flex items-center gap-1 overflow-x-auto py-1">
              {workbenchTabs.map((t) => {
                const isActive = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 shrink-0 transition-all cursor-pointer border ${
                      isActive
                        ? 'bg-[#1C2029] text-[#8AB4F8] border-[#8AB4F8]/50 shadow-sm'
                        : 'bg-transparent text-[#9AA0A6] border-transparent hover:bg-[#1C2029]/60 hover:text-[#E8EAED]'
                    }`}
                  >
                    {t.icon}
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setShowRightDrawer(false)}
              className="p-1 hover:bg-[#1C2029] rounded text-[#9AA0A6] hover:text-[#E8EAED] shrink-0"
              title="Collapse Right Workbench"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>

          {/* Workbench Body */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
