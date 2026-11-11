export type GpuTurnPriority = 0 | 1 | 2; // 0 = coordinator/user, 1 = peer handoff, 2 = monitor/subagent

interface QueuedGpuJob {
  id: number;
  priority: GpuTurnPriority;
  label: string;
  enqueuedAt: number;
  run: () => Promise<void>;
}

/**
 * Single-GPU turn multiplexer for Strata (port 8080).
 * Guarantees maxConcurrentGpuTurns = 1 so swarm workers, subagents, and main turns
 * never VRAM-collide or thrash the KV prefix cache.
 */
export class SwarmTurnScheduler {
  private static instance: SwarmTurnScheduler | null = null;
  public readonly maxConcurrentGpuTurns = 1;
  private activeCount = 0;
  private activeLabel: string | null = null;
  private queue: QueuedGpuJob[] = [];
  private nextId = 1;

  public static getInstance(): SwarmTurnScheduler {
    if (!SwarmTurnScheduler.instance) {
      SwarmTurnScheduler.instance = new SwarmTurnScheduler();
    }
    return SwarmTurnScheduler.instance;
  }

  public acquireGpuTurn<T>(
    priority: GpuTurnPriority,
    label: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: QueuedGpuJob = {
        id: this.nextId++,
        priority,
        label,
        enqueuedAt: Date.now(),
        run: async () => {
          try {
            const res = await fn();
            resolve(res);
          } catch (err) {
            reject(err);
          }
        },
      };

      // Insert ordered by priority (lower number = higher priority), FIFO within same priority
      let inserted = false;
      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i].priority > priority) {
          this.queue.splice(i, 0, job);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        this.queue.push(job);
      }
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.activeCount >= this.maxConcurrentGpuTurns) return;
    const next = this.queue.shift();
    if (!next) return;

    this.activeCount++;
    this.activeLabel = next.label;
    try {
      await next.run();
    } finally {
      this.activeCount--;
      this.activeLabel = null;
      if (this.queue.length > 0) {
        void this.pump();
      }
    }
  }

  public getStatus(): {
    maxConcurrentGpuTurns: number;
    activeCount: number;
    activeLabel: string | null;
    queuedCount: number;
    queuedLabels: string[];
  } {
    return {
      maxConcurrentGpuTurns: this.maxConcurrentGpuTurns,
      activeCount: this.activeCount,
      activeLabel: this.activeLabel,
      queuedCount: this.queue.length,
      queuedLabels: this.queue.map((q) => q.label),
    };
  }
}
