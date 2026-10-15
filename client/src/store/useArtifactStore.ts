import { create } from 'zustand';

export interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
  category?: string;
}

interface ArtifactState {
  activeTab: 'tasks' | 'plan' | 'evidence';
  taskMarkdown: string;
  parsedTasks: TaskItem[];
  planMarkdown: string;
  evidenceItems: Array<{ id: string; type: 'screenshot' | 'log' | 'diff'; title: string; data: string; timestamp: number }>;

  setActiveTab: (tab: 'tasks' | 'plan' | 'evidence') => void;
  setTaskMarkdown: (md: string) => void;
  toggleTask: (taskId: string) => string; // Returns updated markdown for two-way sync
  setPlanMarkdown: (md: string) => void;
  addEvidence: (item: { type: 'screenshot' | 'log' | 'diff'; title: string; data: string }) => void;
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

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  activeTab: 'tasks',
  taskMarkdown: `# LocalGravity Tasks\n\n- [/] Initialize monorepo directory layout\n- [ ] Brain Scaffolding: Setup uv virtualenv and FastAPI\n- [ ] Client Scaffolding: Setup React 19 and Tailwind\n- [ ] Edge Reverse-RPC Runner implementation\n- [ ] 3-Pane Antigravity UI parity`,
  parsedTasks: [],
  planMarkdown: `# Implementation Plan\n\n*Reviewing plan blueprint...*`,
  evidenceItems: [],

  setActiveTab: (tab) => set({ activeTab: tab }),
  setTaskMarkdown: (md) => set({
    taskMarkdown: md,
    parsedTasks: parseTasksFromMarkdown(md),
  }),
  toggleTask: (taskId) => {
    const { parsedTasks } = get();
    const updated = parsedTasks.map((t) => t.id === taskId ? { ...t, completed: !t.completed } : t);

    // Reconstruct markdown
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
  addEvidence: (item) => set((state) => ({
    evidenceItems: [
      ...state.evidenceItems,
      { ...item, id: Math.random().toString(36).substring(2, 9), timestamp: Date.now() },
    ],
  })),
}));
