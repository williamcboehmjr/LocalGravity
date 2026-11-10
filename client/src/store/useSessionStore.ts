import { create } from 'zustand';
import { ModelTier, ThinkingBudget, ModelStateStatus } from '../types/protocol';
import { cleanHostAndPort } from '../utils/connectionTester';

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
  command: string;
  status: 'running' | 'completed' | 'error';
  step: number;
  maxSteps: number;
  summary: string;
  logs: string[];
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
  subagentTasks: SubagentTaskItem[];
  dpiScale: number;
  threadHistory: string[];
  threadHistoryIndex: number;

  setProjects: (projects: ProjectItem[], activeId?: string) => void;
  setActiveProjectId: (projectId: string) => void;
  setThreads: (threads: ThreadItem[], activeThreadId?: string) => void;
  hydrateMessagesFromServer: (serverMsgs: any[], activeStreams?: any[]) => void;
  setWorkspacePath: (path: string) => void;
  setGitBranch: (branch: string) => void;
  setHostUrl: (url: string) => void;
  setApiBaseUrl: (url: string) => void;
  setBrainConnection: (host: string, port?: string) => void;
  setIsConnected: (connected: boolean) => void;
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
  updateLastAssistantMessage: (contentDelta: string, outputTokens?: number, tokensPerSec?: number) => void;
  updateLastAssistantTool: (
    command: string,
    output?: string,
    status?: 'running' | 'success' | 'error',
    meta?: { id?: string; toolName?: string; durationMs?: number; exitCode?: number | null; appendOutput?: boolean }
  ) => void;
  finalizeAssistantMessage: () => void;
  commitAssistantStepNote: (note: string, committedContent?: string) => void;
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
  subagentTasks: [],
  dpiScale: getInitialDpiScale(),
  threadHistory: [initialSessionId],
  threadHistoryIndex: 0,

  goBackThread: () => {
    const state = get();
    if (state.threadHistoryIndex > 0) {
      const nextIdx = state.threadHistoryIndex - 1;
      const targetId = state.threadHistory[nextIdx];
      set({
        threadHistoryIndex: nextIdx,
        sessionId: targetId,
        messages: [],
        currentStreamingThought: '',
        isGenerating: false,
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
      set({
        threadHistoryIndex: nextIdx,
        sessionId: targetId,
        messages: [],
        currentStreamingThought: '',
        isGenerating: false,
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

  hydrateMessagesFromServer: (serverMsgs, activeStreams = []) =>
    set(() => {
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
      const normalized: ChatMessage[] = activeStream
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
      return {
        messages: normalized,
        ...(activeStream || hasRunningTool
          ? {
              isGenerating: true,
              currentStreamingThought: activeStream?.thinkingContent || lastMsg?.thought || '',
              currentThoughtElapsedMs: activeStream?.thinkingDurationMs || lastMsg?.thoughtElapsedMs || 0,
              currentThoughtTokens: activeStream?.thinkingTokens || lastMsg?.thoughtTokenCount || 0,
              isThinkingFinished: false,
            }
          : {
              isGenerating: false,
              currentStreamingThought: '',
              isThinkingFinished: true,
            }),
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

  updateLastAssistantMessage: (delta, outputTokens, tokensPerSec) =>
    set((state) => {
      const list = [...state.messages];
      if (list.length > 0 && list[list.length - 1].role === 'assistant') {
        const last = { ...list[list.length - 1] };
        last.content += delta;
        if (outputTokens !== undefined) last.outputTokens = outputTokens;
        if (tokensPerSec !== undefined && tokensPerSec > 0) last.tokensPerSec = tokensPerSec;
        list[list.length - 1] = last;
        return { messages: list };
      }
      return state;
    }),

  updateLastAssistantTool: (command, output, status = 'success', meta) =>
    set((state) => {
      const list = [...state.messages];
      if (list.length > 0 && list[list.length - 1].role === 'assistant') {
        const last = { ...list[list.length - 1] };
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
        list[list.length - 1] = last;
        return { messages: list };
      }
      return state;
    }),

  commitAssistantStepNote: (note, committedContent) =>
    set((state) => {
      const list = [...state.messages];
      if (list.length > 0 && list[list.length - 1].role === 'assistant') {
        const last = { ...list[list.length - 1] };
        const notes = last.stepNotes ? [...last.stepNotes] : [];
        if (note && note.trim() && notes[notes.length - 1] !== note.trim()) {
          notes.push(note.trim());
        }
        last.stepNotes = notes;
        if (committedContent !== undefined) {
          last.content = committedContent;
        }
        list[list.length - 1] = last;
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
          summary: payload.summary || existing.summary,
          logs: newLogs.slice(-20),
          timestamp: payload.timestamp || Date.now(),
        };
      } else {
        list.unshift({
          id: payload.id,
          thread_id: payload.thread_id || state.sessionId,
          message_id: payload.message_id || '',
          role: payload.role || 'Autonomous Engineer',
          command: payload.command || 'autonomous',
          status: payload.status || 'running',
          step: payload.step || 1,
          maxSteps: payload.maxSteps || 32,
          summary: payload.summary || 'Starting task...',
          logs: payload.summary ? [payload.summary] : [],
          timestamp: payload.timestamp || Date.now(),
        });
      }
      return { subagentTasks: list.slice(0, 15) };
    }),

  finalizeAssistantMessage: () =>
    set((state) => {
      const list = [...state.messages];
      if (list.length > 0 && list[list.length - 1].role === 'assistant') {
        const last = { ...list[list.length - 1] };
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
        list[list.length - 1] = last;
        return {
          messages: list,
          currentStreamingThought: '',
          isThinkingFinished: true,
          isGenerating: false,
        };
      }
      return {
        currentStreamingThought: '',
        isThinkingFinished: true,
        isGenerating: false,
      };
    }),

  appendStreamingThought: (chunk, elapsedMs, tokenCount, finished) =>
    set((state) => ({
      currentStreamingThought: state.currentStreamingThought + chunk,
      currentThoughtElapsedMs: elapsedMs,
      currentThoughtTokens: tokenCount,
      isThinkingFinished: finished,
    })),

  setIsGenerating: (generating) => set({ isGenerating: generating }),
  clearMessages: () => set({ messages: [] }),

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
        threadHistory: nextHist,
        threadHistoryIndex: nextHist.length - 1,
      };
    });
    return newId;
  },

  switchSession: (targetSessionId: string) => {
    const state = get();
    if (state.sessionId === targetSessionId) return;
    const nextHist = [
      ...state.threadHistory.slice(0, state.threadHistoryIndex + 1),
      targetSessionId,
    ];
    set({
      sessionId: targetSessionId,
      messages: [],
      currentStreamingThought: '',
      isGenerating: false,
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
          sessions: [{ id: fallbackId, title: 'New Thread', updated: 'Just now', messages: [] }],
          threads: remainingThreads,
        };
      }
      if (state.sessionId === targetSessionId) {
        return {
          sessionId: remaining[0].id,
          messages: [],
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

