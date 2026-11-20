import fs from 'node:fs';
import path from 'node:path';
import type { ModelTier } from '../db/database.js';
import type { RouteContext } from './types.js';

export interface AutomationRecord {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  tier: ModelTier;
  enabled: boolean;
  lastRunAt: string | null;
}

export function createAutomationStore(repoRoot: string) {
  const automationsFilePath = path.join(repoRoot, '.localgravity', 'harness', 'automations.json');

  const readAutomations = (): AutomationRecord[] => {
    try {
      if (fs.existsSync(automationsFilePath)) {
        return JSON.parse(fs.readFileSync(automationsFilePath, 'utf-8'));
      }
    } catch {}
    const defaults: AutomationRecord[] = [
      {
        id: 'auto-strata-health',
        name: 'Strata & Vision Health Check',
        cron: '0 */6 * * *',
        prompt: '/vision Inspect Strata Qwen 3.8 Flash-Next health and verify vision readiness.',
        tier: 'high',
        enabled: true,
        lastRunAt: null,
      },
      {
        id: 'auto-harness-compact',
        name: 'Harness² Experience Compaction',
        cron: '0 3 * * *',
        prompt: '/learn Summarize recent tool lessons into .localgravity/harness/EXPERIENCE.md',
        tier: 'high',
        enabled: false,
        lastRunAt: null,
      },
    ];
    try {
      fs.mkdirSync(path.dirname(automationsFilePath), { recursive: true });
      fs.writeFileSync(automationsFilePath, JSON.stringify(defaults, null, 2), 'utf-8');
    } catch {}
    return defaults;
  };

  const writeAutomations = (items: AutomationRecord[]) => {
    try {
      fs.mkdirSync(path.dirname(automationsFilePath), { recursive: true });
      fs.writeFileSync(automationsFilePath, JSON.stringify(items, null, 2), 'utf-8');
    } catch {}
  };

  return { readAutomations, writeAutomations };
}

export function registerAutomationRoutes(
  ctx: RouteContext,
  store: ReturnType<typeof createAutomationStore>
): void {
  const { app } = ctx;

  app.get('/api/automations', async () => ({ automations: store.readAutomations() }));

  app.post('/api/automations', async (req) => {
    const body = (req.body || {}) as any;
    const list = store.readAutomations();
    const item: AutomationRecord = {
      id: 'auto-' + Date.now().toString(36),
      name: body.name || 'Scheduled Task',
      cron: body.cron || '0 9 * * *',
      prompt: body.prompt || '/goal Check project status',
      tier: (body.tier || 'high') as ModelTier,
      enabled: body.enabled ?? true,
      lastRunAt: null,
    };
    const next = [item, ...list];
    store.writeAutomations(next);
    return { automation: item, automations: next };
  });

  app.patch('/api/automations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as Record<string, unknown>;
    const patch: Partial<Omit<AutomationRecord, 'id'>> = {};
    if (typeof body.name === 'string') patch.name = body.name;
    if (typeof body.cron === 'string') patch.cron = body.cron;
    if (typeof body.prompt === 'string') patch.prompt = body.prompt;
    if (typeof body.tier === 'string') patch.tier = body.tier as ModelTier;
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (body.lastRunAt === null || typeof body.lastRunAt === 'string') patch.lastRunAt = body.lastRunAt;
    const list = store.readAutomations().map((a) => (a.id === id ? { ...a, ...patch } : a));
    store.writeAutomations(list);
    return { automations: list };
  });

  app.delete('/api/automations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const list = store.readAutomations().filter((a) => a.id !== id);
    store.writeAutomations(list);
    return { automations: list };
  });
}
