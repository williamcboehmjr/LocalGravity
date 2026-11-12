import type { TabbyEngine } from '../tabby/tabbyEngine.js';

export interface SubagentMessageRecord {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  timestamp: number;
}

export interface SubagentTaskRecord {
  id: string;
  threadId: string;
  role: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed';
  step: number;
  maxSteps: number;
  summary: string;
  resultText?: string;
  messages?: SubagentMessageRecord[];
  startedAt: number;
  completedAt?: number;
}

type SubagentListener = (task: SubagentTaskRecord) => void;

const RESEARCH_SAFE_TOOLS = new Set([
  'read_file',
  'find_files',
  'search_codebase',
  'code_outline',
  'list_directory',
  'search_web',
  'inspect_system',
  'inspect_file_metadata',
  'read_system_logs',
]);

export class SubagentManager {
  private static instance: SubagentManager | null = null;
  private tasks = new Map<string, SubagentTaskRecord>();
  private listeners = new Set<SubagentListener>();
  private seq = 1;
  private llmEngine: TabbyEngine | null = null;

  public setLlmEngine(engine: TabbyEngine): void {
    this.llmEngine = engine;
  }

  public getLlmEngine(): TabbyEngine | null {
    return this.llmEngine;
  }

  public static getInstance(): SubagentManager {
    if (!SubagentManager.instance) {
      SubagentManager.instance = new SubagentManager();
    }
    return SubagentManager.instance;
  }

  public onTaskUpdate(listener: SubagentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(task: SubagentTaskRecord) {
    for (const l of this.listeners) {
      try {
        l({ ...task });
      } catch {}
    }
  }

  public filterToolsForSubagent(allTools: any[], mode: 'research' | 'full' = 'research'): any[] {
    if (mode === 'full') {
      return allTools.filter((t) => t?.function?.name !== 'invoke_subagent');
    }
    return allTools.filter((t) => RESEARCH_SAFE_TOOLS.has(t?.function?.name));
  }

  public createSubagentTask(params: {
    threadId: string;
    role: string;
    prompt: string;
    maxSteps?: number;
  }): SubagentTaskRecord {
    const id = `subagent-${this.seq++}-${Date.now().toString(36)}`;
    const record: SubagentTaskRecord = {
      id,
      threadId: params.threadId,
      role: params.role || 'Research Subagent',
      prompt: params.prompt,
      status: 'running',
      step: 1,
      maxSteps: params.maxSteps ?? 4,
      summary: `Running ${params.role}: ${params.prompt.slice(0, 60)}...`,
      startedAt: Date.now(),
    };
    this.tasks.set(id, record);
    this.notify(record);
    return { ...record };
  }

  public updateSubagentStep(id: string, step: number, summary: string): SubagentTaskRecord | null {
    const rec = this.tasks.get(id);
    if (!rec) return null;
    rec.step = step;
    rec.summary = summary;
    this.notify(rec);
    return { ...rec };
  }

  public setSubagentMessages(id: string, messages: SubagentMessageRecord[]): SubagentTaskRecord | null {
    const rec = this.tasks.get(id);
    if (!rec) return null;
    rec.messages = messages;
    this.notify(rec);
    return { ...rec };
  }

  public getTask(id: string): SubagentTaskRecord | null {
    const rec = this.tasks.get(id);
    return rec ? { ...rec } : null;
  }

  public completeSubagentTask(
    id: string,
    resultText: string,
    status: 'completed' | 'failed' = 'completed'
  ): SubagentTaskRecord | null {
    const rec = this.tasks.get(id);
    if (!rec) return null;
    rec.status = status;
    rec.resultText = resultText;
    rec.completedAt = Date.now();
    rec.summary =
      status === 'completed'
        ? `Completed (${Math.max(1, Math.round((rec.completedAt - rec.startedAt) / 1000))}s): ${resultText
            .replace(/\s+/g, ' ')
            .slice(0, 90)}`
        : `Failed: ${resultText.slice(0, 90)}`;
    this.notify(rec);
    return { ...rec };
  }

  public listTasks(threadId?: string): SubagentTaskRecord[] {
    const all = Array.from(this.tasks.values());
    return threadId ? all.filter((t) => t.threadId === threadId) : all;
  }
}
