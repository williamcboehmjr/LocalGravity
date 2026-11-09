import fs from 'node:fs';
import path from 'node:path';

export type ArtifactKind = 'plan' | 'walkthrough' | 'report' | 'code' | 'diff';

export interface ArtifactItem {
  id: string;
  threadId: string;
  title: string;
  type: ArtifactKind;
  content: string;
  summary: string;
  filePath: string;
  createdAt: number;
  updatedAt: number;
}

type ArtifactListener = (artifact: ArtifactItem, all: ArtifactItem[]) => void;

export class ArtifactManager {
  private static instance: ArtifactManager | null = null;
  private artifacts = new Map<string, ArtifactItem>();
  private listeners = new Set<ArtifactListener>();
  private storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir =
      storageDir || path.resolve(process.cwd(), '..', '.localgravity', 'artifacts');
    try {
      fs.mkdirSync(this.storageDir, { recursive: true });
    } catch {}
  }

  public static getInstance(): ArtifactManager {
    if (!ArtifactManager.instance) {
      ArtifactManager.instance = new ArtifactManager();
    }
    return ArtifactManager.instance;
  }

  public onArtifactUpdate(listener: ArtifactListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(artifact: ArtifactItem) {
    const all = this.listArtifacts();
    for (const l of this.listeners) {
      try {
        l({ ...artifact }, all);
      } catch {}
    }
  }

  public upsertArtifact(params: {
    id?: string;
    threadId: string;
    title: string;
    type?: ArtifactKind;
    content: string;
    summary?: string;
  }): ArtifactItem {
    const slug = params.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'artifact';
    const id = params.id || `artifact-${slug}`;
    const existing = this.artifacts.get(id);
    const now = Date.now();
    const filePath = path.join(this.storageDir, `${slug}.md`);

    try {
      fs.mkdirSync(this.storageDir, { recursive: true });
      fs.writeFileSync(filePath, params.content, 'utf8');
    } catch {}

    const item: ArtifactItem = {
      id,
      threadId: params.threadId || existing?.threadId || 'default',
      title: params.title,
      type: params.type || existing?.type || 'report',
      content: params.content,
      summary: params.summary || params.content.replace(/\s+/g, ' ').trim().slice(0, 140),
      filePath: filePath.replace(/\\/g, '/'),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.artifacts.set(id, item);
    this.notify(item);
    return { ...item };
  }

  public getArtifact(id: string): ArtifactItem | null {
    const item = this.artifacts.get(id);
    return item ? { ...item } : null;
  }

  public listArtifacts(threadId?: string): ArtifactItem[] {
    const list = Array.from(this.artifacts.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    return threadId ? list.filter((a) => a.threadId === threadId || a.threadId === 'default') : list;
  }
}
