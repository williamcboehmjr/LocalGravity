import type { FastifyInstance } from 'fastify';
import type { LocalGravityDB, ModelTier, ThinkingBudget } from '../db/database.js';
import type { AutomationRecord } from '../routes/automations.js';

function matchCronField(field: string, value: number): boolean {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    if (part.startsWith('*/')) {
      const step = Number(part.slice(2));
      if (step > 0 && value % step === 0) return true;
    } else if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      if (!Number.isNaN(lo) && !Number.isNaN(hi) && value >= lo && value <= hi) return true;
    } else if (Number(part) === value) {
      return true;
    }
  }
  return false;
}

export function matchesCronExpression(cronExpr: string, now: Date): boolean {
  const parts = (cronExpr || '').trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return (
    matchCronField(parts[0], now.getMinutes()) &&
    matchCronField(parts[1], now.getHours()) &&
    matchCronField(parts[2], now.getDate()) &&
    matchCronField(parts[3], now.getMonth() + 1) &&
    matchCronField(parts[4], now.getDay())
  );
}

export function startAutomationCronRunner(opts: {
  app: FastifyInstance;
  db: LocalGravityDB;
  readAutomations: () => AutomationRecord[];
  writeAutomations: (items: AutomationRecord[]) => void;
  broadcastSync: (event: Record<string, any>) => void;
  activeAbortControllers?: Map<string, AbortController>;
  handlePromptTurn: (params: {
    threadId: string;
    prompt: string;
    tier: ModelTier;
    thinkingBudget: ThinkingBudget;
  }) => Promise<void>;
}): NodeJS.Timeout {
  const cronTimer = setInterval(() => {
    try {
      const now = new Date();
      const minuteKey = now.toISOString().slice(0, 16);
      const list = opts.readAutomations();
      let changed = false;
      for (const item of list) {
        if (!item.enabled || !item.prompt) continue;
        if (item.lastRunAt && item.lastRunAt.slice(0, 16) === minuteKey) continue;
        if (!matchesCronExpression(item.cron, now)) continue;
        item.lastRunAt = now.toISOString();
        changed = true;
        const threads = opts.db.listThreads();
        const targetThread = threads[0] || { id: 'thread-default' };
        opts.broadcastSync({
          type: 'TIMER_FIRED',
          payload: {
            taskId: item.id,
            automationId: item.id,
            thread_id: targetThread.id,
            title: item.name,
            prompt: item.prompt,
            timestamp: Date.now(),
          },
        });
        if (opts.activeAbortControllers?.has(targetThread.id)) {
          continue;
        }
        void opts
          .handlePromptTurn({
            threadId: targetThread.id,
            prompt: item.prompt,
            tier: item.tier || 'high',
            thinkingBudget: 'fast',
          })
          .catch((err) => console.error('[AutomationCron] Error running automation turn:', err));
      }
      if (changed) opts.writeAutomations(list);
    } catch (err) {
      console.error('[AutomationCron] Tick error:', err);
    }
  }, 60_000);

  cronTimer.unref?.();
  opts.app.addHook('onClose', async () => {
    clearInterval(cronTimer);
  });
  return cronTimer;
}
