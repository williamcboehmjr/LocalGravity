import { create } from 'zustand';

export interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
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

export type WorkbenchTab = 'none' | 'editor' | 'terminal' | 'preview' | 'harness' | 'tasks' | 'plan' | 'evidence';

interface ArtifactState {
  activeTab: WorkbenchTab;
  taskMarkdown: string;
  parsedTasks: TaskItem[];
  planMarkdown: string;
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
  setTaskMarkdown: (md: string) => void;
  toggleTask: (taskId: string) => string;
  setPlanMarkdown: (md: string) => void;
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
    const headerMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headerMatch) {
      currentCategory = headerMatch[1].trim();
      return;
    }

    const taskMatch = line.match(/^[-*]\s+\[([ xX/])\]\s+(.+)$/);
    if (taskMatch) {
      const isChecked = taskMatch[1].toLowerCase() === 'x';
      items.push({
        id: `task-${index}`,
        text: taskMatch[2].trim(),
        completed: isChecked,
        category: currentCategory,
      });
    }
  });

  return items;
}

const initialTaskMd = `# Antigravity 2.0 Hardening Checklist\n\n## Core Engine\n- [x] Dynamic Port Discovery (Never touch 5000/5001)\n- [x] TabbyAPI EXL2/EXL3 Integration (Q4 KV, N-gram x4)\n- [x] SysRAM Inactive Weight Pre-Warmer\n- [x] SQLite WAL Hierarchy (Projects -> Threads -> Messages -> Tools -> Checkpoints)\n- [x] 3-Pane Antigravity 2.0 Obsidian UI + Monaco Diff + xterm.js`;

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  activeTab: 'none',
  taskMarkdown: initialTaskMd,
  parsedTasks: parseTasksFromMarkdown(initialTaskMd),
  planMarkdown: `# LocalGravity 2.0 Architecture\n\n- **Backend**: Fastify Headless Core + WebSocket Multiplexer (\`/ws/sync\`, \`/ws/terminal\`)\n- **Inference**: TabbyAPI EXL2/EXL3 3-Tier Suite (\`Low 4B\`, \`Med 9B\`, \`High 27B VL\`) + 3x3 Thinking Matrix (\`Off\`, \`Fast\`, \`Deep\`)\n- **Persistence**: SQLite WAL with 250ms in-flight stream rehydration`,
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
  setTaskMarkdown: (md) =>
    set({
      taskMarkdown: md,
      parsedTasks: parseTasksFromMarkdown(md),
    }),
  toggleTask: (taskId) => {
    const { parsedTasks } = get();
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
