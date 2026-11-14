import { create } from 'zustand';
import { ModelTier, ThinkingBudget, ModelStateStatus } from '../types/protocol';
import { cleanHostAndPort } from '../utils/connectionTester';

export type BrainProviderId = 'strata' | 'google_ai_studio';
export type GoogleModelId =
  | 'orchestrator'
  | 'gemini-4-hydrogen'
  | 'gemini-4-carbon'
  | 'gemini-4-argon'
  | 'gemini-3.8-flash';

export interface GoogleModelOption {
  id: GoogleModelId;
  name: string;
  shortName: string;
  sub: string;
}

export const GOOGLE_MODEL_OPTIONS: GoogleModelOption[] = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    shortName: 'Orchestrator',
    sub: 'Decisions API → Argon/Carbon Plan → Hydrogen Execute',
  },
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    shortName: 'Hydrogen',
    sub: 'Fast Execution & Tool Coding Model',
  },
  {
    id: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon',
    shortName: 'Carbon',
    sub: 'Deepest Frontier Reasoning & Architecture',
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    shortName: 'Argon',
    sub: 'Balanced Frontier Planning & Reasoning',
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    shortName: 'Flash 3.8',
    sub: 'Lightweight Fast Multimodal Flash',
  },
];

export const getGoogleModelOption = (id?: string): GoogleModelOption =>
  GOOGLE_MODEL_OPTIONS.find((m) => m.id === id) || GOOGLE_MODEL_OPTIONS[0];

export interface ToolCallItemData {
  id: string;
  toolName?: string;
  command: string;
  argumentsJson?: string;
  output?: string;
  exitCode?: number | null;
  durationMs?: number;
  status: 'running' | 'success' | 'error';
}

export interface FileAttachmentItem {
  id?: string;
  name: string;
  type: string;
  size: number;
  sizeHuman?: string;
  base64DataUrl?: string;
  savedPath?: string;
  url?: string;
  isImage?: boolean;
  sha256?: string;
  metadata?: Record<string, any>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thought?: string;
  thoughtElapsedMs?: number;
  thoughtTokenCount?: number;
  outputTokens?: number;
  tokensPerSec?: number;
  tier?: ModelTier;
  thinkingBudget?: ThinkingBudget;
  modelName?: string;
  timestamp: number;
  images?: string[];
  attachments?: FileAttachmentItem[];
  toolCommand?: string;
  toolOutput?: string;
  toolStatus?: 'running' | 'success' | 'error';
  toolCalls?: ToolCallItemData[];
  stepNotes?: string[];
}

export interface SubagentTaskItem {
  id: string;
  thread_id: string;
  message_id: string;
  role: string;
  prompt?: string;
  command: string;
  status: 'running' | 'completed' | 'error';
  step: number;
  maxSteps: number;
  summary: string;
  logs: string[];
  messageCount?: number;
  timestamp: number;
}

export interface QueuedMessage {
  id: string;
  text: string;
  images?: string[];
  attachments?: FileAttachmentItem[];
  tier: ModelTier;
  thinkingBudget: ThinkingBudget;
  timestamp: number;
}

export interface ProjectItem {
  id: string;
  name: string;
  root_path: string;
  host_name?: string;
  git_branch: string;
  default_model_tier: ModelTier;
  default_thinking_budget: ThinkingBudget;
  custom_instructions: string;
  enabled_mcp_servers: string;
  pinned_files: string;
  last_opened_at: string;
  created_at: string;
}

export interface ThreadItem {
  id: string;
  project_id: string;
  title: string;
  status: 'idle' | 'thinking' | 'executing_tool' | 'awaiting_approval' | 'error';
  active_model_tier: ModelTier;
  active_thinking_budget: ThinkingBudget;
  kv_prefix_hash: string;
  updated_at: string;
  created_at: string;
  pinned?: boolean;
}

export interface SessionItem {
  id: string;
  title: string;
  updated: string;
  status?: 'idle' | 'thinking' | 'executing_tool' | 'awaiting_approval' | 'error';
  messages: ChatMessage[];
  messageQueue?: QueuedMessage[];
}

export type TurnPhaseName =
  | 'queued'
  | 'prefilling'
  | 'thinking'
  | 'streaming_prose'
  | 'preparing_tool_call'
  | 'executing_tools'
  | 'synthesizing_final_prose'
  | 'completed'
  | 'aborted'
  | 'error';

export interface ActiveTurnState {
  turnId: string;
  threadId: string;
  messageId?: string;
  phase: string;
  isActive: boolean;
  statusLabel: string;
  step: number;
  maxSteps: number;
  thinkingFinished: boolean;
  activeToolId?: string;
  error?: string;
  seq: number;
}

export type SwarmMemberState = 'waiting' | 'working' | 'stopped' | 'killed';

export interface SwarmMemberItem {
  id: string;
  swarm_id?: string;
  name: string;
  added_by?: string;
  thread_id?: string;
  model?: string;
  state: SwarmMemberState;
  workspace_mode?: string;
  workspace_path?: string;
  channels?: string[];
  wait_since?: number;
  mentions_only?: boolean;
  last_read_seq?: number;
  last_post_seq?: number;
  brief?: string;
}

export interface SwarmMessageItem {
  seq: number;
  swarm_id?: string;
  channel: string;
  agent: string;
  text: string;
  kind?: string;
  mentions?: string[];
  created_at: string | number;
}

export interface SwarmState {
  id: string;
  title: string;
  status: string;
  head: number;
  members: SwarmMemberItem[];
  messages: SwarmMessageItem[];
}

export interface BackgroundTaskItem {
  taskId: string;
  type: 'command' | 'timer' | string;
  title: string;
  status: string;
  recentLogs: string[];
}

/** Single source of truth for 'is the active thread's turn running'. */
export const selectIsTurnActive = (s: { activeTurn: ActiveTurnState | null; isGenerating: boolean }): boolean =>
  s.activeTurn ? s.activeTurn.isActive : s.isGenerating;

export const selectStatusLabel = (s: { activeTurn: ActiveTurnState | null }): string =>
  s.activeTurn?.isActive ? s.activeTurn.statusLabel : '';

const PENDING_PREFIX = 'pending-';
// Highest seq seen per turn id (module scope; survives thread switches).
const turnSeqSeen = new Map<string, number>();
// Once any TURN_PHASE arrives it is authoritative; legacy handlers stop driving isGenerating.
let phaseProtocolSeen = false;
export const isPhaseProtocolActive = () => phaseProtocolSeen;
export const resetTurnProtocolState = () => {
  turnSeqSeen.clear();
  phaseProtocolSeen = false;
};

const findAssistantIdx = (list: ChatMessage[], messageId?: string): number => {
  if (messageId) {
    const i = list.findIndex((m) => m.id === messageId);
    if (i !== -1) return i;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'assistant') return i;
  }
  return -1;
};

const statusFromPhase = (phase: string, active: boolean): ThreadItem['status'] => {
  if (!active) return phase === 'error' ? 'error' : 'idle';
  return phase === 'executing_tools' || phase === 'preparing_tool_call' ? 'executing_tool' : 'thinking';
};

interface SessionState {
  projects: ProjectItem[];
  activeProjectId: string;
  threads: ThreadItem[];
  sessionId: string;
  sessions: SessionItem[];
  workspacePath: string;
  gitBranch: string;
  hostUrl: string;
  apiBaseUrl: string;
  brainHost: string;
  brainPort: string;
  isConnected: boolean;
  brainProvider: BrainProviderId;
  selectedGoogleModel: GoogleModelId;
  googleHasApiKey: boolean;
  googleMaskedApiKey: string;
  selectedTier: ModelTier;
  thinkingBudget: ThinkingBudget;
  executionPolicy: 'always_proceed' | 'request_review';
  modelStatus: ModelStateStatus;
  modelStatusText: string;
  activeModelName: string;
  messages: ChatMessage[];
  messageQueue: QueuedMessage[];
  currentStreamingThought: string;
  currentThoughtElapsedMs: number;
  currentThoughtTokens: number;
  isThinkingFinished: boolean;
  isGenerating: boolean;
  activeTurn: ActiveTurnState | null;
  subagentTasks: SubagentTaskItem[];
  selectedSubagentId: string | null;
  backgroundTasks: BackgroundTaskItem[];
  localHostName: string;
  brainHostname: string;
  edgeHosts: Array<{ clientId: string; hostname: string; platform: string }>;
  swarmState: SwarmState | null;
  dpiScale: number;
  threadHistory: string[];
  threadHistoryIndex: number;

  setProjects: (projects: ProjectItem[], activeId?: string) => void;
  setActiveProjectId: (projectId: string) => void;
  setSelectedSubagentId: (id: string | null) => void;
  setLocalHostName: (name: string) => void;
  setHostPresence: (
    brainHostname?: string,
    edgeHosts?: Array<{ clientId: string; hostname: string; platform: string }>
  ) => void;
  setThreads: (threads: ThreadItem[], activeThreadId?: string) => void;
  hydrateMessagesFromServer: (serverMsgs: any[], activeStreams?: any[], threadStatus?: string, serverActiveTurn?: any) => void;
  setWorkspacePath: (path: string) => void;
  setGitBranch: (branch: string) => void;
  setHostUrl: (url: string) => void;
  setApiBaseUrl: (url: string) => void;
  setBrainConnection: (host: string, port?: string) => void;
  setIsConnected: (connected: boolean) => void;
  setBrainProviderState: (patch: {
    provider?: BrainProviderId;
    selectedGoogleModel?: GoogleModelId;
    hasApiKey?: boolean;
    maskedApiKey?: string;
  }) => void;
  setSelectedTier: (tier: ModelTier) => void;
  setThinkingBudget: (budget: ThinkingBudget) => void;
  setExecutionPolicy: (policy: 'always_proceed' | 'request_review') => void;
  setModelState: (status: ModelStateStatus, modelName: string, text?: string) => void;
  setDpiScale: (scale: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  goBackThread: () => string | null;
  goForwardThread: () => string | null;
  addMessage: (msg: ChatMessage) => void;
  updateLastAssistantMessage: (contentDelta: string, outputTokens?: number, tokensPerSec?: number, messageId?: string) => void;
  updateLastAssistantTool: (
    command: string,
    output?: string,
    status?: 'running' | 'success' | 'error',
    meta?: { id?: string; toolName?: string; durationMs?: number; exitCode?: number | null; appendOutput?: boolean; messageId?: string }
  ) => void;
  finalizeAssistantMessage: (messageId?: string) => void;
  commitAssistantStepNote: (note: string, committedContent?: string, messageId?: string) => void;
  applyFinalContent: (content: string, messageId?: string) => void;
  reconcileAssistantId: (serverMessageId?: string) => void;
  applyTurnPhase: (payload: any) => void;
  startPendingTurn: () => void;
  applyLegacyTurnStart: (payload: any) => void;
  applyLegacyTurnEnd: (payload: any, phase: 'completed' | 'aborted' | 'error') => void;
  syncGenerating: (busy: boolean) => void;
  setThreadStatus: (threadId: string, status: ThreadItem['status']) => void;
  setSwarmState: (swarm: SwarmState | null) => void;
  applySwarmEvent: (
    type: 'SWARM_STATE' | 'SWARM_MESSAGE' | 'SWARM_MEMBER_UPDATED',
    payload: any
  ) => void;
  setBackgroundTasks: (tasks: BackgroundTaskItem[]) => void;
  upsertSubagentTask: (payload: any) => void;
  appendStreamingThought: (
    chunk: string,
    elapsedMs: number,
    tokenCount: number,
    finished: boolean
  ) => void;
  setIsGenerating: (generating: boolean) => void;
  clearMessages: () => void;
  enqueueMessage: (msg: Omit<QueuedMessage, 'id' | 'timestamp'>) => string;
  dequeueMessage: () => QueuedMessage | undefined;
  removeQueuedMessage: (id: string) => void;
  updateQueuedMessage: (id: string, newText: string) => void;
  clearQueue: () => void;
  createNewProject: () => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, newTitle: string) => void;
  autoNameSessionFromPrompt: (sessionId: string, promptText: string) => void;
}

export function applyDpiScaleToDom(scale: number) {
  if (typeof document === 'undefined') return;
  const clamped = Math.max(0.75, Math.min(1.75, Math.round(scale * 100) / 100));
  const root = document.getElementById('root');
  if (root) {
    root.style.setProperty('--dpi-scale', String(clamped));
    if (clamped === 1) {
      root.style.zoom = '';
      root.style.width = '100%';
      root.style.height = '100%';
      root.style.maxHeight = '100%';
      return;
    }
    const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X|iPad|iPhone/.test(navigator.userAgent);
    root.style.zoom = String(clamped);
    if (isMac) {
      // In Safari / WKWebView on macOS, zoom already scales coordinates, avoid 100vw/dvh divide which causes horizontal overflow
      root.style.width = '100%';
      root.style.height = '100%';
      root.style.maxHeight = '100%';
    } else {
      root.style.width = `calc(100vw / ${clamped})`;
      root.style.height = `calc(100dvh / ${clamped})`;
      root.style.maxHeight = `calc(100dvh / ${clamped})`;
    }
  }
}

const getInitialDpiScale = (): number => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('localgravity:dpiScale');
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 0.75 && parsed <= 1.75) {
        return parsed;
      }
    }
  }
  return 1.0;
};

const initialSessionId = 'thread-default';

const getInitialBrainSettings = () => {
  if (typeof window !== 'undefined') {
    // If loaded from the Central Brain web server directly, match its host and port
    if (window.location.port && window.location.port !== '5173') {
      return { host: window.location.hostname || '127.0.0.1', port: window.location.port };
    }
    const savedHost = localStorage.getItem('localgravity_brain_host');
    const savedPort = localStorage.getItem('localgravity_brain_port');
    if (savedHost) {
      return cleanHostAndPort(savedHost, savedPort || '3390');
    }
  }
  return { host: '127.0.0.1', port: '3390' };
};

const initialConn = getInitialBrainSettings();

export const useSessionStore = create<SessionState>((set, get) => ({
  projects: [
    {
      id: 'proj-default',
      name: 'LocalGravity',
      root_path: '.',
      git_branch: 'main',
      default_model_tier: 'high',
      default_thinking_budget: 'fast',
      custom_instructions: '',
      enabled_mcp_servers: '["local-fetch","filesystem"]',
      pinned_files: '["README.md","launch.py"]',
      last_opened_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ],
  activeProjectId: 'proj-default',
  threads: [],
  sessionId: initialSessionId,
  sessions: [{ id: initialSessionId, title: 'New Thread', updated: 'Just now', messages: [] }],
  workspacePath: '.',
  gitBranch: 'main',
  brainHost: initialConn.host,
  brainPort: initialConn.port,
  hostUrl: `ws://${initialConn.host}:${initialConn.port}`,
  apiBaseUrl: `http://${initialConn.host}:${initialConn.port}`,
  isConnected: false,
  brainProvider: 'strata',
  selectedGoogleModel: 'orchestrator',
  googleHasApiKey: false,
  googleMaskedApiKey: '',
  selectedTier: 'high',
  thinkingBudget: 'fast',
  executionPolicy: 'always_proceed',
  modelStatus: 'ready',
  modelStatusText: 'Strata Ready (Swift 1.5 Flash-Next • IQ2_XS + Vision • 64k)',
  activeModelName: 'swift-1.5-iq2_xs',
  messages: [],
  messageQueue: [],
  currentStreamingThought: '',
  currentThoughtElapsedMs: 0,
  currentThoughtTokens: 0,
  isThinkingFinished: false,
  isGenerating: false,
  activeTurn: null,
  subagentTasks: [],
  selectedSubagentId: null,
  backgroundTasks: [],
  localHostName: '',
  brainHostname: '',
  edgeHosts: [],
  swarmState: null,
  dpiScale: getInitialDpiScale(),
  threadHistory: [initialSessionId],
  threadHistoryIndex: 0,

  goBackThread: () => {
    const state = get();
    if (state.threadHistoryIndex > 0) {
      const nextIdx = state.threadHistoryIndex - 1;
      const targetId = state.threadHistory[nextIdx];
      const targetThread = state.threads.find((t) => t.id === targetId);
      const targetBusy = targetThread?.status === 'thinking' || targetThread?.status === 'executing_tool';
      set({
        threadHistoryIndex: nextIdx,
        sessionId: targetId,
        messages: [],
        currentStreamingThought: '',
        isGenerating: targetBusy,
        activeTurn: null,
        swarmState: null,
      });
      return targetId;
    }
    return null;
  },
  goForwardThread: () => {
    const state = get();
    if (state.threadHistoryIndex < state.threadHistory.length - 1) {
      const nextIdx = state.threadHistoryIndex + 1;
      const targetId = state.threadHistory[nextIdx];
      const targetThread = state.threads.find((t) => t.id === targetId);
      const targetBusy = targetThread?.status === 'thinking' || targetThread?.status === 'executing_tool';
      set({
        threadHistoryIndex: nextIdx,
        sessionId: targetId,
        messages: [],
        currentStreamingThought: '',
        isGenerating: targetBusy,
        activeTurn: null,
        swarmState: null,
      });
      return targetId;
    }
    return null;
  },

  setDpiScale: (scale: number) => {
    const clamped = Math.max(0.75, Math.min(1.75, Math.round(scale * 100) / 100));
    set({ dpiScale: clamped });
    if (typeof window !== 'undefined') {
      localStorage.setItem('localgravity:dpiScale', String(clamped));
    }
    applyDpiScaleToDom(clamped);
  },
  zoomIn: () => {
    const current = get().dpiScale;
    const next = Math.min(1.75, Math.round((current + 0.10) * 100) / 100);
    get().setDpiScale(next);
  },
  zoomOut: () => {
    const current = get().dpiScale;
    const next = Math.max(0.75, Math.round((current - 0.10) * 100) / 100);
    get().setDpiScale(next);
  },
  resetZoom: () => {
    get().setDpiScale(1.0);
  },

  setProjects: (projects, activeId) =>
    set((state) => {
      const targetId = activeId || state.activeProjectId || projects[0]?.id || '';
      const activeProj = projects.find((p) => p.id === targetId) || projects[0];
      return {
        projects,
        activeProjectId: activeProj ? activeProj.id : targetId,
        workspacePath: activeProj ? activeProj.root_path : state.workspacePath,
        gitBranch: activeProj ? activeProj.git_branch : state.gitBranch,
      };
    }),

  setActiveProjectId: (projectId) =>
    set((state) => {
      const proj = state.projects.find((p) => p.id === projectId);
      return {
        activeProjectId: projectId,
        workspacePath: proj ? proj.root_path : state.workspacePath,
        gitBranch: proj ? proj.git_branch : state.gitBranch,
      };
    }),
  setSelectedSubagentId: (id) => set({ selectedSubagentId: id }),
  setLocalHostName: (name) => set({ localHostName: name }),
  setHostPresence: (brainHostname, edgeHosts) =>
    set((state) => ({
      brainHostname: brainHostname ?? state.brainHostname,
      edgeHosts: edgeHosts ?? state.edgeHosts,
    })),

  setThreads: (threads, activeThreadId) =>
    set((state) => {
      const mappedSessions: SessionItem[] = threads.map((t) => ({
        id: t.id,
        title: t.title,
        updated: new Date(t.updated_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        status: t.status,
        messages: [],
      }));
      let candidateId = activeThreadId && activeThreadId !== initialSessionId
        ? activeThreadId
        : state.sessionId !== initialSessionId
        ? state.sessionId
        : threads[0]?.id || initialSessionId;
      if (threads.length > 0 && !threads.some((t) => t.id === candidateId)) {
        candidateId = threads[0].id;
      }
      return {
        threads,
        sessions: mappedSessions.length > 0 ? mappedSessions : state.sessions,
        sessionId: candidateId,
      };
    }),

  hydrateMessagesFromServer: (serverMsgs, activeStreams = [], threadStatus, serverActiveTurn) =>
    set((prev) => {
      const converted: ChatMessage[] = serverMsgs.map((m: any) => {
        let rawAtts: any[] = [];
        try {
          rawAtts =
            typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments || [];
        } catch {}
        const imageStrings: string[] = [];
        const fileAttachments: FileAttachmentItem[] = [];
        for (const a of rawAtts) {
          if (typeof a === 'string') {
            if (a.startsWith('data:image/') || a.startsWith('http://') || a.startsWith('https://')) {
              imageStrings.push(a);
            }
            fileAttachments.push({
              name: 'attachment',
              type: 'application/octet-stream',
              size: 0,
              url: a,
              base64DataUrl: a.startsWith('data:') ? a : undefined,
            });
          } else if (a && typeof a === 'object') {
            fileAttachments.push(a);
            if (a.isImage || (a.type && a.type.startsWith('image/')) || (a.savedPath && /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(a.savedPath))) {
              if (a.url) imageStrings.push(a.url);
              else if (a.base64DataUrl) imageStrings.push(a.base64DataUrl);
            }
          }
        }
        const toolCalls: ToolCallItemData[] = (m.tool_executions || []).map((te: any) => ({
          id: te.id,
          toolName: te.tool_name,
          command: `${te.tool_name}(${te.arguments_json || '{}'})`,
          argumentsJson: te.arguments_json,
          output: te.stdout_stream || te.stderr_stream || '',
          exitCode: te.exit_code,
          durationMs: te.duration_ms,
          status: te.status || 'success',
        }));

        return {
          id: m.id,
          role: m.role,
          content: m.content || '',
          thought: m.thinking_content || undefined,
          thoughtElapsedMs: m.thinking_duration_ms || 0,
          thoughtTokenCount: m.thinking_tokens || 0,
          outputTokens: m.output_tokens || 0,
          timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
          images: imageStrings.length > 0 ? imageStrings : undefined,
          attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
      });

      const activeStream = activeStreams[0];
      const serverBusy = threadStatus === 'thinking' || threadStatus === 'executing_tool';
      const normalized: ChatMessage[] = activeStream || serverBusy
        ? converted
        : converted.map((m) => {
            if (m.toolCalls && m.toolCalls.some((tc) => tc.status === 'running')) {
              return {
                ...m,
                toolCalls: m.toolCalls.map((tc): ToolCallItemData =>
                  tc.status === 'running'
                    ? { ...tc, status: tc.exitCode === 0 ? 'success' : 'error' }
                    : tc
                ),
              };
            }
            return m;
          });

      const lastMsg = normalized[normalized.length - 1];
      const hasRunningTool = Boolean(
        activeStream &&
          lastMsg?.role === 'assistant' &&
          lastMsg.toolCalls?.some((tc) => tc.status === 'running')
      );
      const hasPendingOptimistic = Boolean(
        prev.activeTurn &&
          prev.activeTurn.isActive &&
          prev.activeTurn.threadId === prev.sessionId &&
          prev.activeTurn.turnId.startsWith(PENDING_PREFIX) &&
          Date.now() - Number(prev.activeTurn.turnId.slice(PENDING_PREFIX.length)) < 4000
      );
      const hydratedTurn: ActiveTurnState | null = serverActiveTurn && (serverActiveTurn.turn_id || serverActiveTurn.turnId)
        ? {
            turnId: serverActiveTurn.turn_id || serverActiveTurn.turnId,
            threadId: serverActiveTurn.thread_id || serverActiveTurn.threadId || prev.sessionId,
            messageId: serverActiveTurn.message_id || serverActiveTurn.messageId,
            phase: serverActiveTurn.phase || 'thinking',
            isActive: Boolean(serverActiveTurn.is_active ?? serverActiveTurn.isActive),
            statusLabel: serverActiveTurn.status_label ?? serverActiveTurn.statusLabel ?? '',
            step: Number(serverActiveTurn.step ?? 0),
            maxSteps: Number(serverActiveTurn.max_steps ?? serverActiveTurn.maxSteps ?? 0),
            thinkingFinished: Boolean(serverActiveTurn.thinking_finished ?? serverActiveTurn.thinkingFinished ?? false),
            activeToolId: serverActiveTurn.active_tool_id ?? serverActiveTurn.activeToolId,
            error: serverActiveTurn.error,
            seq: Number(serverActiveTurn.seq ?? 0),
          }
        : null;
      const isBusy = Boolean(activeStream || hasRunningTool || serverBusy || hydratedTurn?.isActive);

      if (isBusy) {
        return {
          messages: normalized,
          isGenerating: true,
          currentStreamingThought: activeStream?.thinkingContent || lastMsg?.thought || '',
          currentThoughtElapsedMs: activeStream?.thinkingDurationMs || lastMsg?.thoughtElapsedMs || 0,
          currentThoughtTokens: activeStream?.thinkingTokens || lastMsg?.thoughtTokenCount || 0,
          isThinkingFinished: hydratedTurn ? hydratedTurn.thinkingFinished : false,
          activeTurn: hydratedTurn || (prev.activeTurn && prev.activeTurn.isActive && prev.activeTurn.threadId === prev.sessionId ? prev.activeTurn : null),
        };
      }
      if (hasPendingOptimistic) {
        return { messages: normalized };
      }
      return {
        messages: normalized,
        isGenerating: false,
        currentStreamingThought: '',
        isThinkingFinished: true,
        activeTurn: hydratedTurn || (prev.activeTurn && prev.activeTurn.isActive ? { ...prev.activeTurn, isActive: false, statusLabel: '' } : prev.activeTurn),
      };
    }),

  setWorkspacePath: (path) => set({ workspacePath: path }),
  setGitBranch: (branch) => set({ gitBranch: branch }),
  setBrainConnection: (host: string, port: string = '3390') => {
    const clean = cleanHostAndPort(host, port);
    const hostUrl = `ws://${clean.host}:${clean.port}`;
    const apiBaseUrl = `http://${clean.host}:${clean.port}`;
    if (typeof window !== 'undefined') {
      localStorage.setItem('localgravity_brain_host', clean.host);
      localStorage.setItem('localgravity_brain_port', clean.port);
    }
    set({
      brainHost: clean.host,
      brainPort: clean.port,
      hostUrl,
      apiBaseUrl,
    });
  },
  setHostUrl: (url) => {
    const clean = cleanHostAndPort(url);
    if (typeof window !== 'undefined') {
      localStorage.setItem('localgravity_brain_host', clean.host);
      localStorage.setItem('localgravity_brain_port', clean.port);
    }
    set({
      brainHost: clean.host,
      brainPort: clean.port,
      hostUrl: `ws://${clean.host}:${clean.port}`,
      apiBaseUrl: `http://${clean.host}:${clean.port}`,
    });
  },
  setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  setBrainProviderState: (patch) =>
    set(() => ({
      ...(patch.provider ? { brainProvider: patch.provider } : {}),
      ...(patch.selectedGoogleModel ? { selectedGoogleModel: patch.selectedGoogleModel } : {}),
      ...(patch.hasApiKey !== undefined ? { googleHasApiKey: patch.hasApiKey } : {}),
      ...(patch.maskedApiKey !== undefined ? { googleMaskedApiKey: patch.maskedApiKey } : {}),
    })),
  setSelectedTier: (tier) => set({ selectedTier: tier }),
  setThinkingBudget: (budget) => set({ thinkingBudget: budget }),
  setExecutionPolicy: (policy) => set({ executionPolicy: policy }),
  setModelState: (status, modelName, text) =>
    set({
      modelStatus: status,
      activeModelName: modelName,
      modelStatusText: text || status,
    }),

  addMessage: (msg) =>
    set((state) => {
      const newMessages = [...state.messages, msg];
      const updatedSessions = state.sessions.map((s) =>
        s.id === state.sessionId ? { ...s, messages: newMessages, updated: 'Just now' } : s
      );
      return {
        messages: newMessages,
        sessions: updatedSessions,
        ...(msg.role === 'user'
          ? {
              currentStreamingThought: '',
              currentThoughtElapsedMs: 0,
              currentThoughtTokens: 0,
              isThinkingFinished: false,
            }
          : {}),
      };
    }),

  updateLastAssistantMessage: (delta, outputTokens, tokensPerSec, messageId) =>
    set((state) => {
      const list = [...state.messages];
      const idx = findAssistantIdx(list, messageId);
      if (idx !== -1) {
        const last = { ...list[idx] };
        last.content += delta;
        if (outputTokens !== undefined) last.outputTokens = outputTokens;
        if (tokensPerSec !== undefined && tokensPerSec > 0) last.tokensPerSec = tokensPerSec;
        list[idx] = last;
        return { messages: list };
      }
      return state;
    }),

  updateLastAssistantTool: (command, output, status = 'success', meta) =>
    set((state) => {
      const list = [...state.messages];
      const idx = findAssistantIdx(list, meta?.messageId);
      if (idx !== -1) {
        const last = { ...list[idx] };
        last.toolCommand = command;
        if (output !== undefined) last.toolOutput = output;
        last.toolStatus = status;

        const existingCalls = last.toolCalls ? [...last.toolCalls] : [];
        const matchIdx = existingCalls.findIndex(
          (c) => (meta?.id && c.id === meta.id) || c.command === command
        );
        if (matchIdx !== -1) {
          const prevOut = existingCalls[matchIdx].output || '';
          existingCalls[matchIdx] = {
            ...existingCalls[matchIdx],
            output:
              output !== undefined
                ? meta?.appendOutput
                  ? prevOut + output
                  : output
                : existingCalls[matchIdx].output,
            status,
            durationMs: meta?.durationMs ?? existingCalls[matchIdx].durationMs,
            exitCode: meta?.exitCode !== undefined ? meta.exitCode : existingCalls[matchIdx].exitCode,
          };
        } else {
          existingCalls.push({
            id: meta?.id || 'tc-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
            toolName: meta?.toolName,
            command,
            output,
            status,
            durationMs: meta?.durationMs,
            exitCode: meta?.exitCode,
          });
        }
        last.toolCalls = existingCalls;
        list[idx] = last;
        return { messages: list };
      }
      return state;
    }),

  commitAssistantStepNote: (note, committedContent, messageId) =>
    set((state) => {
      const list = [...state.messages];
      const idx = findAssistantIdx(list, messageId);
      if (idx !== -1) {
        const last = { ...list[idx] };
        const notes = last.stepNotes ? [...last.stepNotes] : [];
        if (note && note.trim() && notes[notes.length - 1] !== note.trim()) {
          notes.push(note.trim());
        }
        last.stepNotes = notes;
        if (committedContent !== undefined) {
          last.content = committedContent;
        }
        list[idx] = last;
        return { messages: list };
      }
      return state;
    }),

  upsertSubagentTask: (payload) =>
    set((state) => {
      if (!payload || !payload.id) return state;
      const list = [...state.subagentTasks];
      const idx = list.findIndex((t) => t.id === payload.id);
      if (idx !== -1) {
        const existing = list[idx];
        const newLogs = [...existing.logs];
        if (payload.summary && newLogs[newLogs.length - 1] !== payload.summary) {
          newLogs.push(payload.summary);
        }
        list[idx] = {
          ...existing,
          status: payload.status || existing.status,
          step: payload.step ?? existing.step,
          maxSteps: payload.maxSteps ?? existing.maxSteps,
          prompt: payload.prompt ?? existing.prompt,
          summary: payload.summary || existing.summary,
          logs: newLogs.slice(-20),
          messageCount: payload.messageCount ?? existing.messageCount,
          timestamp: payload.timestamp || Date.now(),
        };
      } else {
        list.unshift({
          id: payload.id,
          thread_id: payload.thread_id || state.sessionId,
          message_id: payload.message_id || '',
          role: payload.role || 'Autonomous Engineer',
          prompt: payload.prompt,
          command: payload.command || 'autonomous',
          status: payload.status || 'running',
          step: payload.step || 1,
          maxSteps: payload.maxSteps || 32,
          summary: payload.summary || 'Starting task...',
          logs: payload.summary ? [payload.summary] : [],
          messageCount: payload.messageCount,
          timestamp: payload.timestamp || Date.now(),
        });
      }
      return { subagentTasks: list.slice(0, 15) };
    }),

  finalizeAssistantMessage: (messageId) =>
    set((state) => {
      const list = [...state.messages];
      const idx = findAssistantIdx(list, messageId);
      // Legacy fallback only: under TURN_PHASE the phase event owns isGenerating.
      const genPatch = phaseProtocolSeen ? {} : { isGenerating: false };
      if (idx !== -1) {
        const last = { ...list[idx] };
        if (state.currentStreamingThought) {
          last.thought = state.currentStreamingThought;
          last.thoughtElapsedMs = state.currentThoughtElapsedMs;
          last.thoughtTokenCount = state.currentThoughtTokens;
        }
        if (last.toolCalls && last.toolCalls.length > 0) {
          last.toolCalls = last.toolCalls.map((tc): ToolCallItemData =>
            tc.status === 'running'
              ? { ...tc, status: tc.exitCode === 0 ? 'success' : 'error' }
              : tc
          );
        }
        list[idx] = last;
        return {
          messages: list,
          currentStreamingThought: '',
          isThinkingFinished: true,
          ...genPatch,
        };
      }
      return {
        currentStreamingThought: '',
        isThinkingFinished: true,
        ...genPatch,
      };
    }),

  applyFinalContent: (content, messageId) =>
    set((state) => {
      if (!content) return state;
      const list = [...state.messages];
      const idx = findAssistantIdx(list, messageId);
      if (idx === -1) return state;
      if ((list[idx].content || '').trim().length >= content.trim().length) return state;
      list[idx] = { ...list[idx], content };
      return { messages: list };
    }),

  reconcileAssistantId: (serverMessageId) =>
    set((state) => {
      if (!serverMessageId) return state;
      if (state.messages.some((m) => m.id === serverMessageId)) return state;
      let idx = -1;
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].role === 'assistant') {
          idx = i;
          break;
        }
      }
      if (idx === -1 || !state.messages[idx].id.startsWith('assistant-')) return state;
      const list = [...state.messages];
      list[idx] = { ...list[idx], id: serverMessageId };
      return { messages: list };
    }),

    setThreadStatus: (threadId, status) =>
    set((state) => ({
      threads: state.threads.map((t) => (t.id === threadId ? { ...t, status } : t)),
      sessions: state.sessions.map((s) => (s.id === threadId ? { ...s, status } : s)),
    })),

  setBackgroundTasks: (tasks) => set({ backgroundTasks: tasks }),

  setSwarmState: (swarm) => set({ swarmState: swarm }),

  applySwarmEvent: (type, payload) =>
    set((state) => {
      if (!payload) return state;
      const evtThreadId = payload.thread_id || payload.threadId || payload.session_id;
      if (evtThreadId && evtThreadId !== state.sessionId) return state;

      if (type === 'SWARM_STATE') {
        return { swarmState: payload.swarm ?? null };
      }

      if (type === 'SWARM_MESSAGE') {
        const msg: SwarmMessageItem | undefined = payload.message;
        if (!msg) return state;
        const cur = state.swarmState;
        if (!cur) {
          return {
            swarmState: {
              id: payload.swarm_id || msg.swarm_id || 'swarm-' + state.sessionId,
              title: 'Swarm',
              status: 'active',
              head: msg.seq || 0,
              members: [],
              messages: [msg],
            },
          };
        }
        const exists = cur.messages.some((m) => m.seq === msg.seq);
        const nextMsgs = exists
          ? cur.messages.map((m) => (m.seq === msg.seq ? msg : m))
          : [...cur.messages, msg];
        return {
          swarmState: {
            ...cur,
            head: Math.max(cur.head || 0, msg.seq || 0),
            messages: nextMsgs,
          },
        };
      }

      if (type === 'SWARM_MEMBER_UPDATED') {
        const member: SwarmMemberItem | undefined = payload.member;
        if (!member) return state;
        const cur = state.swarmState;
        if (!cur) {
          return {
            swarmState: {
              id: payload.swarm_id || member.swarm_id || 'swarm-' + state.sessionId,
              title: 'Swarm',
              status: 'active',
              head: 0,
              members: [member],
              messages: [],
            },
          };
        }
        const idx = cur.members.findIndex(
          (m) => (member.id && m.id === member.id) || m.name === member.name
        );
        const nextMembers =
          idx !== -1
            ? cur.members.map((m, i) => (i === idx ? { ...m, ...member } : m))
            : [...cur.members, member];
        return { swarmState: { ...cur, members: nextMembers } };
      }

      return state;
    }),

  startPendingTurn: () =>
    set((state) => ({
      isGenerating: true,
      activeTurn: {
        turnId: PENDING_PREFIX + Date.now(),
        threadId: state.sessionId,
        phase: 'queued',
        isActive: true,
        statusLabel: 'Starting…',
        step: 0,
        maxSteps: 0,
        thinkingFinished: false,
        seq: 0,
      },
    })),

  applyTurnPhase: (payload) => {
    if (!payload) return;
    phaseProtocolSeen = true;
    const turnId: string = payload.turn_id || payload.turnId || '';
    const threadId: string = payload.thread_id || payload.threadId || payload.session_id || '';
    const seq = Number(payload.seq ?? 0);
    const phase: string = payload.phase || 'thinking';
    const isActive = payload.is_active !== undefined ? Boolean(payload.is_active) : !['completed', 'aborted', 'error'].includes(phase);
    const state = get();
    if (turnId) {
      const seen = turnSeqSeen.get(turnId);
      if (seen !== undefined && seq <= seen && seq !== 0) return;
      turnSeqSeen.set(turnId, Math.max(seq, seen ?? 0));
      if (turnSeqSeen.size > 200) {
        const first = turnSeqSeen.keys().next().value;
        if (first !== undefined) turnSeqSeen.delete(first);
      }
    }
    if (threadId && threadId !== state.sessionId) {
      get().setThreadStatus(threadId, statusFromPhase(phase, isActive));
      return;
    }
    const cur = state.activeTurn;
    // An old turn's event (esp. terminal) must never clobber a newer/different turn.
    if (cur && turnId && cur.turnId !== turnId && !isActive) return;

    const next: ActiveTurnState = {
      turnId: turnId || cur?.turnId || '',
      threadId: threadId || state.sessionId,
      messageId: payload.message_id || payload.messageId || cur?.messageId,
      phase,
      isActive,
      statusLabel: payload.status_label ?? payload.statusLabel ?? (isActive ? cur?.statusLabel || '' : ''),
      step: Number(payload.step ?? (cur && cur.turnId === turnId ? cur.step : 0)),
      maxSteps: Number(payload.max_steps ?? payload.maxSteps ?? (cur && cur.turnId === turnId ? cur.maxSteps : 0)),
      thinkingFinished: Boolean(payload.thinking_finished ?? payload.thinkingFinished ?? false),
      activeToolId: payload.active_tool_id ?? payload.activeToolId ?? undefined,
      error: payload.error || undefined,
      seq,
    };
    get().reconcileAssistantId(next.messageId);
    set({
      activeTurn: next,
      isGenerating: isActive,
      ...(isActive ? {} : { isThinkingFinished: true }),
    });
    if (!isActive) {
      if (payload.final_content) get().applyFinalContent(payload.final_content, next.messageId);
      get().finalizeAssistantMessage(next.messageId);
      get().setThreadStatus(next.threadId, statusFromPhase(phase, false));
    } else {
      get().setThreadStatus(next.threadId, statusFromPhase(phase, true));
    }
  },

  applyLegacyTurnStart: (payload) => {
    if (phaseProtocolSeen) {
      // Still reconcile ids; TURN_PHASE owns the rest.
      get().reconcileAssistantId(payload?.message_id);
      return;
    }
    const turnId: string = payload?.turn_id || payload?.turnId || '';
    const messageId: string | undefined = payload?.message_id || payload?.messageId;
    get().reconcileAssistantId(messageId);
    set((s) => ({
      isGenerating: true,
      activeTurn: {
        turnId: turnId || s.activeTurn?.turnId || PENDING_PREFIX + Date.now(),
        threadId: payload?.thread_id || payload?.threadId || s.sessionId,
        messageId,
        phase: 'thinking',
        isActive: true,
        statusLabel: s.activeTurn?.statusLabel || 'Working…',
        step: 0,
        maxSteps: 0,
        thinkingFinished: false,
        seq: 0,
      },
    }));
  },

  applyLegacyTurnEnd: (payload, phase) => {
    const turnId: string = payload?.turn_id || payload?.turnId || '';
    const msgId: string | undefined = payload?.message_id || payload?.messageId;
    const cur = get().activeTurn;
    // Guard: a terminal event for a different turn or message must not clear the current one.
    if (turnId && cur && !cur.turnId.startsWith(PENDING_PREFIX) && cur.turnId !== turnId) return;
    if (msgId && cur?.isActive && cur.messageId && cur.messageId !== msgId) return;
    const mid = msgId || cur?.messageId;
    if (payload?.final_content) get().applyFinalContent(payload.final_content, mid);
    if (phaseProtocolSeen) return; // TURN_PHASE is authoritative for the active flag
    get().finalizeAssistantMessage(mid);
    set((s) => ({
      isGenerating: false,
      activeTurn: s.activeTurn ? { ...s.activeTurn, isActive: false, phase, statusLabel: '' } : null,
    }));
  },

  /** Re-derive generating state from a server snapshot (SYNC_STATE / thread switch). */
  syncGenerating: (busy) => {
    const cur = get().activeTurn;
    if (busy) {
      set({
        isGenerating: true,
        activeTurn: cur && cur.isActive ? cur : null,
      });
      return;
    }
    // Do not wipe a turn the user just started optimistically (server snapshot may predate it).
    if (cur && cur.isActive && cur.turnId.startsWith(PENDING_PREFIX) && Date.now() - Number(cur.turnId.slice(PENDING_PREFIX.length)) < 4000) {
      return;
    }
    get().finalizeAssistantMessage();
    set({
      isGenerating: false,
      activeTurn: cur ? { ...cur, isActive: false, statusLabel: '' } : null,
    });
  },

  appendStreamingThought: (chunk, elapsedMs, tokenCount, finished) =>
    set((state) => ({
      currentStreamingThought: state.currentStreamingThought + chunk,
      currentThoughtElapsedMs: elapsedMs,
      currentThoughtTokens: tokenCount,
      isThinkingFinished: finished,
    })),

  setIsGenerating: (generating) =>
    set((s) => ({
      isGenerating: generating,
      ...(!generating && s.activeTurn?.isActive
        ? { activeTurn: { ...s.activeTurn, isActive: false, statusLabel: '' } }
        : {}),
    })),
  clearMessages: () =>
    set({
      messages: [],
      currentStreamingThought: '',
      isGenerating: false,
      activeTurn: null,
      isThinkingFinished: true,
      swarmState: null,
    }),

  enqueueMessage: (msg) => {
    const id = 'qmsg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const queuedItem: QueuedMessage = {
      ...msg,
      id,
      timestamp: Date.now(),
    };
    set((state) => ({
      messageQueue: [...state.messageQueue, queuedItem],
    }));
    return id;
  },

  dequeueMessage: () => {
    const state = get();
    if (state.messageQueue.length === 0) return undefined;
    const [first, ...rest] = state.messageQueue;
    set({ messageQueue: rest });
    return first;
  },

  removeQueuedMessage: (id) => {
    set((state) => ({
      messageQueue: state.messageQueue.filter((m) => m.id !== id),
    }));
  },

  updateQueuedMessage: (id, newText) => {
    set((state) => ({
      messageQueue: state.messageQueue.map((m) => (m.id === id ? { ...m, text: newText } : m)),
    }));
  },

  clearQueue: () => set({ messageQueue: [] }),

  createNewProject: () => {
    const newId = 'thread-' + Math.random().toString(36).substring(2, 9);
    const newSession: SessionItem = {
      id: newId,
      title: 'New Thread',
      updated: 'Just now',
      status: 'idle',
      messages: [],
      messageQueue: [],
    };
    set((state) => {
      const nextHist = [...state.threadHistory.slice(0, state.threadHistoryIndex + 1), newId];
      return {
        sessionId: newId,
        messages: [],
        messageQueue: [],
        sessions: [newSession, ...state.sessions],
        currentStreamingThought: '',
        isGenerating: false,
        activeTurn: null,
        swarmState: null,
        threadHistory: nextHist,
        threadHistoryIndex: nextHist.length - 1,
      };
    });
    return newId;
  },

  switchSession: (targetSessionId: string) => {
    const state = get();
    if (state.sessionId === targetSessionId) return;
    const targetThread = state.threads.find((t) => t.id === targetSessionId);
    const targetBusy = targetThread?.status === 'thinking' || targetThread?.status === 'executing_tool';
    const nextHist = [
      ...state.threadHistory.slice(0, state.threadHistoryIndex + 1),
      targetSessionId,
    ];
    set({
      sessionId: targetSessionId,
      messages: [],
      currentStreamingThought: '',
      isGenerating: targetBusy,
      activeTurn: null,
      swarmState: null,
      threadHistory: nextHist,
      threadHistoryIndex: nextHist.length - 1,
    });
  },

  deleteSession: (targetSessionId: string) => {
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== targetSessionId);
      const remainingThreads = state.threads.filter((t) => t.id !== targetSessionId);
      if (remaining.length === 0) {
        const fallbackId = 'thread-' + Math.random().toString(36).substring(2, 9);
        return {
          sessionId: fallbackId,
          messages: [],
          currentStreamingThought: '',
          isGenerating: false,
          activeTurn: null,
          swarmState: null,
          sessions: [{ id: fallbackId, title: 'New Thread', updated: 'Just now', messages: [] }],
          threads: remainingThreads,
        };
      }
      if (state.sessionId === targetSessionId) {
        const nextThread = remainingThreads.find((t) => t.id === remaining[0].id);
        const nextBusy = nextThread?.status === 'thinking' || nextThread?.status === 'executing_tool';
        return {
          sessionId: remaining[0].id,
          messages: [],
          currentStreamingThought: '',
          isGenerating: nextBusy,
          activeTurn: null,
          swarmState: null,
          sessions: remaining,
          threads: remainingThreads,
        };
      }
      return { sessions: remaining, threads: remainingThreads };
    });
  },

  renameSession: (targetSessionId: string, newTitle: string) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === targetSessionId ? { ...s, title: newTitle } : s
      ),
      threads: state.threads.map((t) =>
        t.id === targetSessionId ? { ...t, title: newTitle } : t
      ),
    }));
  },

  autoNameSessionFromPrompt: (targetSessionId: string, promptText: string) => {
    const state = get();
    const currentSession = state.sessions.find((s) => s.id === targetSessionId);
    if (
      !currentSession ||
      (currentSession.title !== 'New Thread' &&
        currentSession.title !== 'New Project' &&
        currentSession.title !== 'Initial Thread')
    ) {
      return;
    }
    const clean = promptText.replace(/\n+/g, ' ').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    let title = words.slice(0, 6).join(' ');
    if (words.length > 6) title += '...';
    if (title.length > 38) title = title.substring(0, 38) + '...';
    if (!title) title = 'New Thread';

    set({
      sessions: state.sessions.map((s) => (s.id === targetSessionId ? { ...s, title } : s)),
      threads: state.threads.map((t) => (t.id === targetSessionId ? { ...t, title } : t)),
    });
  },
}));

