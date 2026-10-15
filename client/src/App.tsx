import React, { useState, useEffect, useRef } from 'react';
import { Settings, PanelLeftClose, PanelRightClose, Sparkles, Smartphone, MessageSquare, ListTodo, Camera } from 'lucide-react';
import { useSessionStore, QueuedMessage } from './store/useSessionStore';
import { useArtifactStore } from './store/useArtifactStore';
import { useTelemetryStore } from './store/useTelemetryStore';
import { Splitter } from './components/common/Splitter';
import { Badge } from './components/common/Badge';
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
import { ModelTier, ThinkingBudget } from './types/protocol';

export const App: React.FC = () => {
  const {
    sessionId,
    workspacePath,
    hostUrl,
    setIsConnected,
    selectedTier,
    thinkingBudget,
    activeModelName,
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
  } = useSessionStore();

  const { activeTab, setActiveTab, setTaskMarkdown, setPlanMarkdown, parsedTasks } = useArtifactStore();
  const { setTelemetry } = useTelemetryStore();

  // Pane width state (resizable)
  const [leftRailWidth, setLeftRailWidth] = useState(260);
  const [rightDrawerWidth, setRightDrawerWidth] = useState(360);
  const [showLeftRail, setShowLeftRail] = useState(window.innerWidth > 900);
  const [showRightDrawer, setShowRightDrawer] = useState(window.innerWidth > 1100);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRemoteOpen, setIsRemoteOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'tasks' | 'evidence'>('chat');

  const wsRef = useRef<WebSocket | null>(null);

  // Initialize and maintain WebSocket connection to Central Brain
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;

    // Detect shared session ID from query string if connecting from mobile
    const params = new URLSearchParams(window.location.search);
    const querySession = params.get('session') || params.get('session_id');
    const effectiveSessionId = querySession || sessionId;

    // Determine host dynamically if accessed remotely
    let effectiveHost = hostUrl;
    if (window.location.host && !window.location.host.includes('localhost:5173')) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      effectiveHost = `${proto}//${window.location.host}`;
    }

    const connect = () => {
      try {
        const cleanHost = effectiveHost.replace(/^http/, 'ws');
        const url = `${cleanHost}/ws/agent/${effectiveSessionId}`;
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          ws?.send(
            JSON.stringify({
              id: 'init-' + Date.now(),
              type: 'SESSION_INIT',
              payload: {
                workspace_path: workspacePath,
                platform: 'windows',
                client_version: '0.1.0',
              },
            })
          );
        };

        ws.onclose = () => {
          setIsConnected(false);
          reconnectTimeout = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          setIsConnected(false);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            const { type, payload } = data;

            if (type === 'MODEL_STATE') {
              setModelState(payload.status, payload.active_model, payload.status_text);
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
                updateLastAssistantMessage(payload.chunk);
              }
            } else if (type === 'TOOL_EVENT') {
              updateLastAssistantTool(payload.command, payload.output, payload.status);
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
              });
            }
          } catch (e) {
            console.error('Failed to parse incoming WebSocket message', e);
          }
        };
      } catch (err) {
        console.error('WebSocket connection error:', err);
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [hostUrl, sessionId, workspacePath]);

  // Submit prompt to Brain
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
      tier: tier,
      modelName: activeModelName,
      timestamp: Date.now(),
    });

    // Auto-name project based on first message
    autoNameSessionFromPrompt(sessionId, text);

    setIsGenerating(true);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          id: 'prompt-' + Date.now(),
          type: 'PROMPT_SUBMIT',
          payload: {
            session_id: sessionId,
            prompt: text,
            tier: tier,
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
      thinkingBudget: thinkingBudget,
    });
  };

  const handleInterruptAndSend = (item: QueuedMessage) => {
    // 1. Remove from queue
    removeQueuedMessage(item.id);
    // 2. Stop active generation immediately
    handleStopGeneration();
    // 3. Immediately send prompt with its assigned tier & thinking budget
    setTimeout(() => {
      handleSendPrompt(item.text, item.images, item.tier, item.thinkingBudget);
    }, 60);
  };

  // Auto-dequeue next queued message when current turn finishes
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
          },
        })
      );
    }
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

  const totalTasks = parsedTasks.length;
  const completedTasks = parsedTasks.filter((t) => t.completed).length;

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-screen bg-canvas overflow-hidden font-sans">
      {/* 1. Left Navigation Rail (Desktop) */}
      {showLeftRail && (
        <aside
          style={{ width: `${leftRailWidth}px` }}
          className="shrink-0 h-full bg-surface border-r border-border-subtle hidden md:flex flex-col p-3 space-y-3 select-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-accent-blue/20 border border-accent-blue/40 flex items-center justify-center text-accent-blue">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="font-semibold text-sm tracking-tight text-text-primary">LocalGravity</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-1 hover:bg-surface-muted rounded text-text-muted hover:text-text-primary"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowLeftRail(false)}
                className="p-1 hover:bg-surface-muted rounded text-text-muted hover:text-text-primary"
                title="Collapse Rail"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          <WorkspacePicker />
          <NodeStatusBadge />
          <SessionList />
          <SkillsDrawer />
        </aside>
      )}

      {showLeftRail && (
        <Splitter onResize={(delta) => setLeftRailWidth((prev) => Math.max(200, Math.min(450, prev + delta)))} className="hidden md:flex" />
      )}

      {/* 2. Center Canvas */}
      <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-canvas relative">
        {/* Center Canvas Top Bar */}
        <header className="h-12 sm:h-13 shrink-0 border-b border-border-subtle px-3 sm:px-4 flex items-center justify-between bg-surface/60 z-10">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            {/* Desktop Left Rail Toggle */}
            {!showLeftRail && (
              <button
                onClick={() => setShowLeftRail(true)}
                className="p-1.5 hover:bg-surface rounded text-text-muted hover:text-text-primary mr-1 hidden md:block"
                title="Open Left Rail"
              >
                <Sparkles className="w-4 h-4 text-accent-blue" />
              </button>
            )}

            {/* Mobile Settings Trigger */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 hover:bg-surface rounded-lg text-text-muted hover:text-text-primary md:hidden"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>

            <span className="text-sm sm:text-base font-semibold tracking-tight text-text-primary truncate">
              LocalGravity
            </span>

            <Badge variant="blue" size="sm" className="hidden xs:inline-flex">
              ⚡ {selectedTier.toUpperCase()}
            </Badge>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Phone Remote Button */}
            <button
              onClick={() => setIsRemoteOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface border border-border-subtle hover:bg-surface-muted text-xs sm:text-sm text-text-secondary hover:text-text-primary transition-colors"
              title="Open Mobile Remote QR Code"
            >
              <Smartphone className="w-4 h-4 text-accent-blue" />
              <span className="hidden sm:inline">Phone Remote</span>
            </button>

            <PolicyToggle />

            {/* Desktop Right Drawer Toggle */}
            {!showRightDrawer && (
              <button
                onClick={() => setShowRightDrawer(true)}
                className="p-1.5 hover:bg-surface rounded text-text-muted hover:text-text-primary hidden md:block"
                title="Open Right Drawer"
              >
                <PanelRightClose className="w-4 h-4 rotate-180" />
              </button>
            )}
          </div>
        </header>

        {/* View Content (Desktop: ChatFeed, Mobile: Chat / Tasks / Evidence) */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          {/* Chat Tab (Default on Desktop) */}
          <div className={`flex-1 min-h-0 flex flex-col ${mobileTab === 'chat' ? 'flex' : 'hidden md:flex'}`}>
            <ChatFeed />
            <div className="shrink-0 p-2 sm:p-4 pt-1 bg-gradient-to-t from-canvas via-canvas to-transparent z-10">
              <PromptBar
                onSend={handleSendPrompt}
                onTierChange={handleTierSwitch}
                onStop={handleStopGeneration}
                onQueue={handleQueuePrompt}
                onInterruptAndSend={handleInterruptAndSend}
              />
            </div>
          </div>

          {/* Mobile Tasks Tab */}
          {mobileTab === 'tasks' && (
            <div className="flex-1 min-h-0 flex flex-col md:hidden bg-surface overflow-hidden">
              <TaskChecklist onSync={handleArtifactSync} />
            </div>
          )}

          {/* Mobile Evidence Tab */}
          {mobileTab === 'evidence' && (
            <div className="flex-1 min-h-0 flex flex-col md:hidden bg-surface overflow-hidden">
              <EvidenceDrawer />
            </div>
          )}
        </div>

        {/* Mobile Navigation Tabs (visible only on mobile screens < 768px) */}
        <nav className="h-15 shrink-0 border-t border-border-subtle flex md:hidden bg-surface pb-[env(safe-area-inset-bottom,0px)] z-20">
          <button
            onClick={() => setMobileTab('chat')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 text-xs transition-colors ${
              mobileTab === 'chat' ? 'text-accent-blue font-semibold' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            <span>Chat</span>
          </button>
          <button
            onClick={() => setMobileTab('tasks')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 text-xs relative transition-colors ${
              mobileTab === 'tasks' ? 'text-accent-blue font-semibold' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <div className="relative">
              <ListTodo className="w-5 h-5" />
              {totalTasks > 0 && (
                <span className="absolute -top-1.5 -right-2.5 text-[10px] px-1.5 py-0.2 rounded-full bg-accent-blue text-white font-mono font-bold leading-tight">
                  {completedTasks}/{totalTasks}
                </span>
              )}
            </div>
            <span>Tasks</span>
          </button>
          <button
            onClick={() => setMobileTab('evidence')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 text-xs transition-colors ${
              mobileTab === 'evidence' ? 'text-accent-blue font-semibold' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Camera className="w-5 h-5" />
            <span>Evidence</span>
          </button>
        </nav>
      </main>

      {showRightDrawer && (
        <Splitter onResize={(delta) => setRightDrawerWidth((prev) => Math.max(280, Math.min(600, prev - delta)))} className="hidden md:flex" />
      )}

      {/* 3. Right Canvas (Artifacts & Evidence Drawer - Desktop) */}
      {showRightDrawer && (
        <aside
          style={{ width: `${rightDrawerWidth}px` }}
          className="shrink-0 h-full bg-surface border-l border-border-subtle flex flex-col min-w-0 hidden md:flex"
        >
          {/* Tab Switcher Header */}
          <div className="h-12 border-b border-border-subtle px-3 flex items-center justify-between bg-surface-muted/40">
            <div className="flex items-center gap-1 bg-canvas p-0.5 rounded-lg border border-border-subtle text-xs">
              <button
                onClick={() => setActiveTab('tasks')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeTab === 'tasks' ? 'bg-surface-highlight text-text-primary font-medium' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Tasks
              </button>
              <button
                onClick={() => setActiveTab('plan')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeTab === 'plan' ? 'bg-surface-highlight text-text-primary font-medium' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Plan
              </button>
              <button
                onClick={() => setActiveTab('evidence')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  activeTab === 'evidence' ? 'bg-surface-highlight text-text-primary font-medium' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Evidence
              </button>
            </div>

            <button
              onClick={() => setShowRightDrawer(false)}
              className="p-1 hover:bg-surface rounded text-text-muted hover:text-text-primary"
              title="Collapse Drawer"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {activeTab === 'tasks' && <TaskChecklist onSync={handleArtifactSync} />}
            {activeTab === 'plan' && <PlanViewer />}
            {activeTab === 'evidence' && <EvidenceDrawer />}
          </div>
        </aside>
      )}

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Mobile Remote Modal */}
      <MobileRemoteModal isOpen={isRemoteOpen} onClose={() => setIsRemoteOpen(false)} />
    </div>
  );
};
export default App;
