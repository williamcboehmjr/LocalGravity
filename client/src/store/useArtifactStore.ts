import { create } from 'zustand';

export interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
  inProgress?: boolean;
  category?: string;
}

export interface FileCheckpointItem {
  id: string;
  thread_id: string;
  message_id: string;
  file_path: string;
  previous_content_blob: string | null;
  new_content_blob: string;
  created_at: string;
}

export type WorkbenchTab =
  | 'none'
  | 'changes'
  | 'editor'
  | 'terminal'
  | 'extensions'
  | 'preview'
  | 'harness'
  | 'subagents'
  | 'tasks'
  | 'plan'
  | 'evidence'
  | 'swarm';
export type ArtifactDocType = 'plan.md' | 'walkthrough.md' | 'task.md' | string;

export interface ArtifactRecord {
  id: string;
  threadId?: string;
  title?: string;
  type: 'plan' | 'walkthrough' | 'task' | 'html' | string;
  content: string;
  summary?: string;
  filePath?: string;
  requestFeedback?: boolean;
  userFacing?: boolean;
  updatedAt?: number;
}

interface ArtifactState {
  activeTab: WorkbenchTab;
  activeArtifactDoc: ArtifactDocType;
  taskMarkdown: string;
  parsedTasks: TaskItem[];
  planMarkdown: string;
  walkthroughMarkdown: string;
  artifacts: ArtifactRecord[];
  activeArtifactId: string | null;
  evidenceItems: Array<{
    id: string;
    type: 'screenshot' | 'log' | 'diff';
    title: string;
    data: string;
    timestamp: number;
  }>;
  workspaceFiles: Array<{ path: string; name: string; type: 'file' | 'directory' }>;
  activeFilePath: string;
  activeFileContent: string;
  diffOriginalContent: string | null;
  activeCheckpoint: FileCheckpointItem | null;
  checkpoints: FileCheckpointItem[];
  latestVisionCapture: {
    base64DataUrl: string;
    activeWindowTitle: string;
    resolution?: string;
  } | null;
  previewUrl: string;

  setActiveTab: (tab: WorkbenchTab) => void;
  setActiveArtifactDoc: (doc: ArtifactDocType) => void;
  setTaskMarkdown: (md: string) => void;
  toggleTask: (taskId: string) => string;
  setPlanMarkdown: (md: string) => void;
  setWalkthroughMarkdown: (md: string) => void;
  upsertArtifact: (art: ArtifactRecord) => void;
  setArtifacts: (list: ArtifactRecord[]) => void;
  setActiveArtifactId: (id: string | null) => void;
  clearArtifactFeedback: (id: string) => void;
  addEvidence: (item: { type: 'screenshot' | 'log' | 'diff'; title: string; data: string }) => void;
  setWorkspaceFiles: (files: Array<{ path: string; name: string; type: 'file' | 'directory' }>) => void;
  setActiveFile: (path: string, content: string, diffOriginal?: string | null) => void;
  setCheckpoints: (checkpoints: FileCheckpointItem[]) => void;
  setActiveCheckpoint: (cp: FileCheckpointItem | null) => void;
  setLatestVisionCapture: (capture: {
    base64DataUrl: string;
    activeWindowTitle: string;
    resolution?: string;
  }) => void;
  setPreviewUrl: (url: string) => void;
}

function parseTasksFromMarkdown(md: string): TaskItem[] {
  const lines = md.split('\n');
  const items: TaskItem[] = [];
  let currentCategory = 'General';

  lines.forEach((line, index) => {
    const headerMatch = line.match(/^\s*#{1,3}\s+(.+)$/);
    if (headerMatch) {
      currentCategory = headerMatch[1].trim();
      return;
    }

    const taskMatch = line.match(/^(\s*[-*]\s+\[)([ xX/])(\]\s+)(.+)$/);
    if (taskMatch) {
      const mark = taskMatch[2].toLowerCase();
      const isChecked = mark === 'x';
      const isInProgress = mark === '/';
      items.push({
        id: `task-${index}`,
        text: taskMatch[4].trim(),
        completed: isChecked,
        inProgress: isInProgress,
        category: currentCategory,
      });
    }
  });

  return items;
}

const initialTaskMd = '';
const initialPlanMd = '';
const initialWalkthroughMd = '';

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  activeTab: 'none',
  activeArtifactDoc: 'plan.md',
  taskMarkdown: initialTaskMd,
  parsedTasks: parseTasksFromMarkdown(initialTaskMd),
  planMarkdown: initialPlanMd,
  walkthroughMarkdown: initialWalkthroughMd,
  artifacts: [],
  activeArtifactId: null,
  evidenceItems: [],
  workspaceFiles: [],
  activeFilePath: '',
  activeFileContent: '',
  diffOriginalContent: null,
  activeCheckpoint: null,
  checkpoints: [],
  latestVisionCapture: null,
  previewUrl: '',

  setActiveTab: (tab) => set({ activeTab: tab }),
  setActiveArtifactDoc: (doc) => set({ activeArtifactDoc: doc }),
  setTaskMarkdown: (md) =>
    set({
      taskMarkdown: md,
      parsedTasks: parseTasksFromMarkdown(md),
    }),
  toggleTask: (taskId) => {
    const { taskMarkdown, parsedTasks } = get();
    const lineIdxMatch = taskId.match(/^task-(\d+)$/);
    if (lineIdxMatch && taskMarkdown) {
      const lineIdx = Number(lineIdxMatch[1]);
      const lines = taskMarkdown.split('\n');
      if (lineIdx >= 0 && lineIdx < lines.length) {
        const line = lines[lineIdx];
        const taskMatch = line.match(/^(\s*[-*]\s+\[)([ xX/])(\]\s+.*)$/);
        if (taskMatch) {
          const wasChecked = taskMatch[2].toLowerCase() === 'x';
          const nextMark = wasChecked ? ' ' : 'x';
          lines[lineIdx] = `${taskMatch[1]}${nextMark}${taskMatch[3]}`;
          const newMd = lines.join('\n');
          set({
            taskMarkdown: newMd,
            parsedTasks: parseTasksFromMarkdown(newMd),
          });
          return newMd;
        }
      }
    }

    const updated = parsedTasks.map((t) =>
      t.id === taskId ? { ...t, completed: !t.completed } : t
    );

    let newMd = '';
    let lastCat = '';
    updated.forEach((t) => {
      if (t.category && t.category !== lastCat) {
        newMd += `\n## ${t.category}\n`;
        lastCat = t.category;
      }
      newMd += `- [${t.completed ? 'x' : ' '}] ${t.text}\n`;
    });

    set({ taskMarkdown: newMd, parsedTasks: updated });
    return newMd;
  },
  setPlanMarkdown: (md) => set({ planMarkdown: md }),
  setWalkthroughMarkdown: (md) => set({ walkthroughMarkdown: md }),
  upsertArtifact: (art) =>
    set((state) => {
      const idx = state.artifacts.findIndex((a) => a.id === art.id);
      const next = idx >= 0 ? state.artifacts.map((a, i) => (i === idx ? { ...a, ...art } : a)) : [art, ...state.artifacts];
      const updates: Partial<ArtifactState> = { artifacts: next, activeArtifactId: art.id };
      if (art.type === 'plan') {
        updates.planMarkdown = art.content;
        updates.activeArtifactDoc = 'plan.md';
      } else if (art.type === 'walkthrough') {
        updates.walkthroughMarkdown = art.content;
        updates.activeArtifactDoc = 'walkthrough.md';
      } else if (art.type === 'task') {
        updates.taskMarkdown = art.content;
        updates.parsedTasks = parseTasksFromMarkdown(art.content);
        updates.activeArtifactDoc = 'task.md';
      } else if (art.type === 'html') {
        updates.activeArtifactDoc = art.id;
      }
      return updates;
    }),
  setArtifacts: (list) => set({ artifacts: list }),
  setActiveArtifactId: (id) => set({ activeArtifactId: id }),
  clearArtifactFeedback: (id) =>
    set((state) => ({
      artifacts: state.artifacts.map((a) => (a.id === id ? { ...a, requestFeedback: false } : a)),
    })),
  addEvidence: (item) =>
    set((state) => ({
      evidenceItems: [
        ...state.evidenceItems,
        { ...item, id: Math.random().toString(36).substring(2, 9), timestamp: Date.now() },
      ],
    })),
  setWorkspaceFiles: (files) => set({ workspaceFiles: files }),
  setActiveFile: (path, content, diffOriginal = null) =>
    set({
      activeFilePath: path,
      activeFileContent: content,
      diffOriginalContent: diffOriginal,
    }),
  setCheckpoints: (checkpoints) => set({ checkpoints }),
  setActiveCheckpoint: (cp) =>
    set({
      activeCheckpoint: cp,
      ...(cp
        ? {
            activeFilePath: cp.file_path,
            activeFileContent: cp.new_content_blob,
            diffOriginalContent: cp.previous_content_blob ?? '',
            activeTab: 'editor',
          }
        : {}),
    }),
  setLatestVisionCapture: (capture) => set({ latestVisionCapture: capture }),
  setPreviewUrl: (url) => set({ previewUrl: url }),
}));
