import { create } from 'zustand';
import { ModelTier, ThinkingBudget, ModelStateStatus } from '../types/protocol';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thought?: string;
  thoughtElapsedMs?: number;
  thoughtTokenCount?: number;
  tier?: ModelTier;
  modelName?: string;
  timestamp: number;
  images?: string[];
  toolCommand?: string;
  toolOutput?: string;
  toolStatus?: 'running' | 'success' | 'error';
  toolCalls?: ToolCallItemData[];
}

export interface ToolCallItemData {
  id: string;
  command: string;
  output?: string;
  status: 'running' | 'success' | 'error';
}

export interface QueuedMessage {
  id: string;
  text: string;
  images?: string[];
  tier: ModelTier;
  thinkingBudget: ThinkingBudget;
  timestamp: number;
}

export interface SessionItem {
  id: string;
  title: string;
  updated: string;
  messages: ChatMessage[];
  messageQueue?: QueuedMessage[];
}

interface SessionState {
  sessionId: string;
  sessions: SessionItem[];
  workspacePath: string;
  hostUrl: string;
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

  setWorkspacePath: (path: string) => void;
  setHostUrl: (url: string) => void;
  setIsConnected: (connected: boolean) => void;
  setSelectedTier: (tier: ModelTier) => void;
  setThinkingBudget: (budget: ThinkingBudget) => void;
  setExecutionPolicy: (policy: 'always_proceed' | 'request_review') => void;
  setModelState: (status: ModelStateStatus, modelName: string, text?: string) => void;
  addMessage: (msg: ChatMessage) => void;
  updateLastAssistantMessage: (contentDelta: string) => void;
  updateLastAssistantTool: (command: string, output?: string, status?: 'running' | 'success' | 'error') => void;
  finalizeAssistantMessage: () => void;
  appendStreamingThought: (chunk: string, elapsedMs: number, tokenCount: number, finished: boolean) => void;
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

const initialSessionId = 'session-' + Math.random().toString(36).substring(2, 9);

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: initialSessionId,
  sessions: [
    { id: initialSessionId, title: 'New Project', updated: 'Just now', messages: [] },
  ],
  workspacePath: 'C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity',
  hostUrl: 'ws://localhost:3390',
  isConnected: false,
  selectedTier: 'low',
  thinkingBudget: 'fast',
  executionPolicy: 'always_proceed',
  modelStatus: 'idle',
  modelStatusText: 'Connecting to Brain...',
  activeModelName: 'qwen3.5:4b',
  messages: [],
  messageQueue: [],
  currentStreamingThought: '',
  currentThoughtElapsedMs: 0,
  currentThoughtTokens: 0,
  isThinkingFinished: false,
  isGenerating: false,

  setWorkspacePath: (path) => set({ workspacePath: path }),
  setHostUrl: (url) => set({ hostUrl: url }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  setSelectedTier: (tier) => set({ selectedTier: tier }),
  setThinkingBudget: (budget) => set({ thinkingBudget: budget }),
  setExecutionPolicy: (policy) => set({ executionPolicy: policy }),
  setModelState: (status, modelName, text) => set({
    modelStatus: status,
    activeModelName: modelName,
    modelStatusText: text || status,
  }),
  addMessage: (msg) => set((state) => {
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
  updateLastAssistantMessage: (delta) => set((state) => {
    const list = [...state.messages];
    if (list.length > 0 && list[list.length - 1].role === 'assistant') {
      const last = { ...list[list.length - 1] };
      last.content += delta;
      list[list.length - 1] = last;
      const updatedSessions = state.sessions.map((s) =>
        s.id === state.sessionId ? { ...s, messages: list } : s
      );
      return { messages: list, sessions: updatedSessions };
    }
    return state;
  }),
  updateLastAssistantTool: (command, output, status = 'success') => set((state) => {
    const list = [...state.messages];
    if (list.length > 0 && list[list.length - 1].role === 'assistant') {
      const last = { ...list[list.length - 1] };
      last.toolCommand = command;
      if (output !== undefined) last.toolOutput = output;
      last.toolStatus = status;

      const existingCalls = last.toolCalls ? [...last.toolCalls] : [];
      const matchIdx = existingCalls.findIndex((c) => c.command === command);
      if (matchIdx !== -1) {
        existingCalls[matchIdx] = {
          ...existingCalls[matchIdx],
          output: output !== undefined ? output : existingCalls[matchIdx].output,
          status,
        };
      } else {
        existingCalls.push({
          id: 'tc-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          command,
          output,
          status,
        });
      }
      last.toolCalls = existingCalls;

      list[list.length - 1] = last;
      const updatedSessions = state.sessions.map((s) =>
        s.id === state.sessionId ? { ...s, messages: list } : s
      );
      return { messages: list, sessions: updatedSessions };
    }
    return state;
  }),
  finalizeAssistantMessage: () => set((state) => {
    const list = [...state.messages];
    if (list.length > 0 && list[list.length - 1].role === 'assistant') {
      const last = { ...list[list.length - 1] };
      if (state.currentStreamingThought) {
        last.thought = state.currentStreamingThought;
        last.thoughtElapsedMs = state.currentThoughtElapsedMs;
        last.thoughtTokenCount = state.currentThoughtTokens;
      }
      list[list.length - 1] = last;
      const updatedSessions = state.sessions.map((s) =>
        s.id === state.sessionId ? { ...s, messages: list } : s
      );
      return {
        messages: list,
        sessions: updatedSessions,
        currentStreamingThought: '',
        isThinkingFinished: true,
      };
    }
    return {
      currentStreamingThought: '',
      isThinkingFinished: true,
    };
  }),
  appendStreamingThought: (chunk, elapsedMs, tokenCount, finished) => set((state) => ({
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
    set((state) => {
      const newQueue = [...state.messageQueue, queuedItem];
      const updatedSessions = state.sessions.map((s) =>
        s.id === state.sessionId ? { ...s, messageQueue: newQueue } : s
      );
      return { messageQueue: newQueue, sessions: updatedSessions };
    });
    return id;
  },

  dequeueMessage: () => {
    const state = get();
    if (state.messageQueue.length === 0) return undefined;
    const [first, ...rest] = state.messageQueue;
    const updatedSessions = state.sessions.map((s) =>
      s.id === state.sessionId ? { ...s, messageQueue: rest } : s
    );
    set({ messageQueue: rest, sessions: updatedSessions });
    return first;
  },

  removeQueuedMessage: (id) => {
    set((state) => {
      const newQueue = state.messageQueue.filter((m) => m.id !== id);
      const updatedSessions = state.sessions.map((s) =>
        s.id === state.sessionId ? { ...s, messageQueue: newQueue } : s
      );
      return { messageQueue: newQueue, sessions: updatedSessions };
    });
  },

  updateQueuedMessage: (id, newText) => {
    set((state) => {
      const newQueue = state.messageQueue.map((m) =>
        m.id === id ? { ...m, text: newText } : m
      );
      const updatedSessions = state.sessions.map((s) =>
        s.id === state.sessionId ? { ...s, messageQueue: newQueue } : s
      );
      return { messageQueue: newQueue, sessions: updatedSessions };
    });
  },

  clearQueue: () => {
    set((state) => {
      const updatedSessions = state.sessions.map((s) =>
        s.id === state.sessionId ? { ...s, messageQueue: [] } : s
      );
      return { messageQueue: [], sessions: updatedSessions };
    });
  },

  createNewProject: () => {
    const newId = 'session-' + Math.random().toString(36).substring(2, 9);
    const newProject: SessionItem = {
      id: newId,
      title: 'New Project',
      updated: 'Just now',
      messages: [],
      messageQueue: [],
    };
    set((state) => ({
      sessionId: newId,
      messages: [],
      messageQueue: [],
      sessions: [newProject, ...state.sessions],
      currentStreamingThought: '',
      isGenerating: false,
    }));
    return newId;
  },

  switchSession: (targetSessionId: string) => {
    const state = get();
    if (state.sessionId === targetSessionId) return;
    const target = state.sessions.find((s) => s.id === targetSessionId);
    if (target) {
      set({
        sessionId: target.id,
        messages: target.messages || [],
        messageQueue: target.messageQueue || [],
        currentStreamingThought: '',
        isGenerating: false,
      });
    }
  },

  deleteSession: (targetSessionId: string) => {
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== targetSessionId);
      if (remaining.length === 0) {
        const fallbackId = 'session-' + Math.random().toString(36).substring(2, 9);
        const fallbackProject: SessionItem = {
          id: fallbackId,
          title: 'New Project',
          updated: 'Just now',
          messages: [],
        };
        return {
          sessionId: fallbackId,
          messages: [],
          sessions: [fallbackProject],
        };
      }
      if (state.sessionId === targetSessionId) {
        const nextActive = remaining[0];
        return {
          sessionId: nextActive.id,
          messages: nextActive.messages || [],
          sessions: remaining,
        };
      }
      return { sessions: remaining };
    });
  },

  renameSession: (targetSessionId: string, newTitle: string) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === targetSessionId ? { ...s, title: newTitle } : s
      ),
    }));
  },

  autoNameSessionFromPrompt: (targetSessionId: string, promptText: string) => {
    const state = get();
    const currentSession = state.sessions.find((s) => s.id === targetSessionId);
    if (!currentSession || (currentSession.title !== 'New Project' && currentSession.title !== 'New Task')) {
      return;
    }
    // Generate clean concise 3-5 word name from first sentence
    const clean = promptText.replace(/\n+/g, ' ').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    let title = words.slice(0, 5).join(' ');
    if (words.length > 5) title += '...';
    if (title.length > 35) title = title.substring(0, 35) + '...';
    if (!title) title = 'New Project';
    
    set({
      sessions: state.sessions.map((s) =>
        s.id === targetSessionId ? { ...s, title } : s
      ),
    });
  },
}));
