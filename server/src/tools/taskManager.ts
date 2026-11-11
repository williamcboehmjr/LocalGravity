import { spawn, ChildProcess } from 'node:child_process';

export interface BackgroundTaskInfo {
  taskId: string;
  type: 'command' | 'timer';
  title: string;
  commandOrPrompt: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  startedAt: number;
  completedAt: number | null;
  durationSeconds?: number;
  recentLogs: string[];
}

type TaskEventListener = (event: {
  type: 'BACKGROUND_TASK_UPDATED' | 'TIMER_FIRED' | 'COUNTDOWN';
  payload: any;
}) => void;

export class BackgroundTaskManager {
  private static instance: BackgroundTaskManager | null = null;
  private tasks = new Map<string, BackgroundTaskInfo>();
  private processes = new Map<string, ChildProcess>();
  private timers = new Map<string, NodeJS.Timeout>();
  private listeners = new Set<TaskEventListener>();
  private seq = 1;

  public static getInstance(): BackgroundTaskManager {
    if (!BackgroundTaskManager.instance) {
      BackgroundTaskManager.instance = new BackgroundTaskManager();
    }
    return BackgroundTaskManager.instance;
  }

  public onEvent(listener: TaskEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(type: 'BACKGROUND_TASK_UPDATED' | 'TIMER_FIRED' | 'COUNTDOWN', payload: any) {
    for (const listener of this.listeners) {
      try {
        listener({ type, payload });
      } catch {}
    }
  }

  private appendLog(task: BackgroundTaskInfo, text: string) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    for (const line of lines) {
      task.recentLogs.push(line.slice(0, 500));
      if (task.recentLogs.length > 80) {
        task.recentLogs.shift();
      }
    }
  }

  public startBackgroundCommand(params: {
    command: string;
    title?: string;
    cwd?: string;
  }): BackgroundTaskInfo {
    const taskId = `task-${this.seq++}`;
    const task: BackgroundTaskInfo = {
      taskId,
      type: 'command',
      title: params.title || params.command.slice(0, 48),
      commandOrPrompt: params.command,
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      completedAt: null,
      recentLogs: [],
    };
    this.tasks.set(taskId, task);

    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : '/bin/sh';
    const shellArgs = isWin
      ? ['-NoProfile', '-NonInteractive', '-Command', params.command]
      : ['-c', params.command];

    const child = spawn(shell, shellArgs, {
      cwd: params.cwd || process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.processes.set(taskId, child);

    child.stdout?.on('data', (chunk) => {
      this.appendLog(task, chunk.toString());
      this.emit('BACKGROUND_TASK_UPDATED', { task: { ...task }, allTasks: this.listTasks() });
    });

    child.stderr?.on('data', (chunk) => {
      this.appendLog(task, `[stderr] ${chunk.toString()}`);
      this.emit('BACKGROUND_TASK_UPDATED', { task: { ...task }, allTasks: this.listTasks() });
    });

    child.on('close', (code) => {
      this.processes.delete(taskId);
      if (task.status === 'cancelled') return;
      task.exitCode = code ?? 0;
      task.status = code === 0 ? 'completed' : 'failed';
      task.completedAt = Date.now();
      this.emit('BACKGROUND_TASK_UPDATED', { task: { ...task }, allTasks: this.listTasks() });
    });

    child.on('error', (err) => {
      this.processes.delete(taskId);
      this.appendLog(task, `[error] ${err.message}`);
      task.exitCode = 1;
      task.status = 'failed';
      task.completedAt = Date.now();
      this.emit('BACKGROUND_TASK_UPDATED', { task: { ...task }, allTasks: this.listTasks() });
    });

    this.emit('BACKGROUND_TASK_UPDATED', { task: { ...task }, allTasks: this.listTasks() });
    return { ...task };
  }

  public scheduleTimer(params: {
    durationSeconds: number;
    prompt: string;
    title?: string;
  }): BackgroundTaskInfo {
    const durationSec = Math.max(1, Math.min(86400, Math.round(params.durationSeconds)));
    const taskId = `timer-${this.seq++}`;
    const task: BackgroundTaskInfo = {
      taskId,
      type: 'timer',
      title: params.title || `Timer (${durationSec}s): ${params.prompt.slice(0, 36)}`,
      commandOrPrompt: params.prompt,
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      completedAt: null,
      durationSeconds: durationSec,
      recentLogs: [`Scheduled timer for ${durationSec}s: "${params.prompt}"`],
    };
    this.tasks.set(taskId, task);

    // Emit initial countdown event for GUI badge
    this.emit('COUNTDOWN', {
      taskId,
      label: task.title,
      secondsRemaining: durationSec,
      totalSeconds: durationSec,
    });
    this.emit('BACKGROUND_TASK_UPDATED', { task: { ...task }, allTasks: this.listTasks() });

    const timeout = setTimeout(() => {
      this.timers.delete(taskId);
      if (task.status === 'cancelled') return;
      task.status = 'completed';
      task.exitCode = 0;
      task.completedAt = Date.now();
      task.recentLogs.push(`Timer fired at ${new Date().toISOString()}: ${params.prompt}`);
      this.emit('TIMER_FIRED', {
        taskId,
        prompt: params.prompt,
        title: task.title,
        timestamp: Date.now(),
      });
      this.emit('BACKGROUND_TASK_UPDATED', { task: { ...task }, allTasks: this.listTasks() });
    }, durationSec * 1000);
    timeout.unref?.();
    this.timers.set(taskId, timeout);

    return { ...task };
  }

  public listTasks(): BackgroundTaskInfo[] {
    return Array.from(this.tasks.values())
      .slice(-25)
      .map((t) => ({ ...t, recentLogs: [...t.recentLogs] }));
  }

  public getTask(taskId: string): BackgroundTaskInfo | null {
    const t = this.tasks.get(taskId);
    return t ? { ...t, recentLogs: [...t.recentLogs] } : null;
  }

  public killTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const proc = this.processes.get(taskId);
    if (proc) {
      try {
        proc.kill();
      } catch {}
      this.processes.delete(taskId);
    }

    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }

    task.status = 'cancelled';
    task.completedAt = Date.now();
    task.recentLogs.push('Task cancelled by user/agent.');
    this.emit('BACKGROUND_TASK_UPDATED', { task: { ...task }, allTasks: this.listTasks() });
    return true;
  }

  public sendInputToTask(taskId: string, input: string): boolean {
    const proc = this.processes.get(taskId);
    const task = this.tasks.get(taskId);
    if (!proc || !proc.stdin || !task || task.status !== 'running') return false;
    try {
      proc.stdin.write(input.endsWith('\n') ? input : `${input}\n`);
      task.recentLogs.push(`[stdin] ${input}`);
      this.emit('BACKGROUND_TASK_UPDATED', { task: { ...task }, allTasks: this.listTasks() });
      return true;
    } catch {
      return false;
    }
  }
}
