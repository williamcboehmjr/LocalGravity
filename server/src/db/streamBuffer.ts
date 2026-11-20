import type Database from 'better-sqlite3';

export interface InFlightStreamBuffer {
  messageId: string;
  threadId: string;
  content: string;
  thinkingContent: string;
  thinkingDurationMs: number;
  thinkingTokens: number;
  outputTokens: number;
  dirty: boolean;
  isFinished: boolean;
}

/**
 * Buffers high-frequency streaming thought/token deltas in memory and flushes
 * dirty rows to SQLite every 250ms in a single transaction.
 */
export class StreamBufferManager {
  private buffers = new Map<string, InFlightStreamBuffer>();
  private finalizedIds = new Set<string>();
  private static readonly MAX_FINALIZED_IDS = 500;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly db: Database.Database) {
    this.startFlushLoop();
  }

  private markFinalized(messageId: string): void {
    if (!messageId) return;
    if (this.finalizedIds.has(messageId)) {
      this.finalizedIds.delete(messageId);
    }
    this.finalizedIds.add(messageId);
    while (this.finalizedIds.size > StreamBufferManager.MAX_FINALIZED_IDS) {
      const oldest = this.finalizedIds.values().next().value;
      if (oldest === undefined) break;
      this.finalizedIds.delete(oldest);
    }
  }

  public isFinalized(messageId: string): boolean {
    return this.finalizedIds.has(messageId);
  }

  public get(messageId: string): InFlightStreamBuffer | undefined {
    return this.buffers.get(messageId);
  }

  public begin(messageId: string, threadId: string): void {
    this.finalizedIds.delete(messageId);
    this.buffers.set(messageId, {
      messageId,
      threadId,
      content: '',
      thinkingContent: '',
      thinkingDurationMs: 0,
      thinkingTokens: 0,
      outputTokens: 0,
      dirty: false,
      isFinished: false,
    });
  }

  public appendThoughtDelta(
    messageId: string,
    threadId: string,
    delta: string,
    durationMs: number,
    thinkingTokens: number
  ): InFlightStreamBuffer {
    if (this.finalizedIds.has(messageId)) {
      return {
        messageId,
        threadId,
        content: '',
        thinkingContent: '',
        thinkingDurationMs: durationMs,
        thinkingTokens,
        outputTokens: 0,
        dirty: false,
        isFinished: true,
      };
    }
    let buf = this.buffers.get(messageId);
    if (!buf) {
      buf = {
        messageId,
        threadId,
        content: '',
        thinkingContent: '',
        thinkingDurationMs: 0,
        thinkingTokens: 0,
        outputTokens: 0,
        dirty: true,
        isFinished: false,
      };
      this.buffers.set(messageId, buf);
    }
    buf.thinkingContent += delta;
    buf.thinkingDurationMs = durationMs;
    buf.thinkingTokens = thinkingTokens;
    buf.dirty = true;
    return buf;
  }

  public appendTokenDelta(
    messageId: string,
    threadId: string,
    delta: string,
    outputTokens: number
  ): InFlightStreamBuffer {
    if (this.finalizedIds.has(messageId)) {
      return {
        messageId,
        threadId,
        content: '',
        thinkingContent: '',
        thinkingDurationMs: 0,
        thinkingTokens: 0,
        outputTokens,
        dirty: false,
        isFinished: true,
      };
    }
    let buf = this.buffers.get(messageId);
    if (!buf) {
      buf = {
        messageId,
        threadId,
        content: '',
        thinkingContent: '',
        thinkingDurationMs: 0,
        thinkingTokens: 0,
        outputTokens: 0,
        dirty: true,
        isFinished: false,
      };
      this.buffers.set(messageId, buf);
    }
    buf.content += delta;
    buf.outputTokens = outputTokens;
    buf.dirty = true;
    return buf;
  }

  public resetContent(messageId: string, newContent = ''): void {
    const buf = this.buffers.get(messageId);
    if (buf) {
      buf.content = newContent;
      buf.dirty = true;
    }
    this.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(newContent, messageId);
  }

  public finalize(messageId: string): void {
    this.markFinalized(messageId);
    const buf = this.buffers.get(messageId);
    if (buf) {
      buf.isFinished = true;
      buf.dirty = true;
      this.flushNow();
      this.buffers.delete(messageId);
    }
  }

  public discardForThread(threadId: string): void {
    for (const [msgId, buf] of this.buffers.entries()) {
      if (buf.threadId === threadId) {
        this.markFinalized(msgId);
        this.buffers.delete(msgId);
      }
    }
  }

  public getActiveForThread(threadId: string): InFlightStreamBuffer[] {
    const active: InFlightStreamBuffer[] = [];
    for (const buf of this.buffers.values()) {
      if (buf.threadId === threadId && !buf.isFinished) {
        active.push({ ...buf });
      }
    }
    return active;
  }

  public flushNow(): void {
    let hasDirty = false;
    for (const buf of this.buffers.values()) {
      if (buf.dirty) {
        hasDirty = true;
        break;
      }
    }
    if (!hasDirty) return;

    const stmt = this.db.prepare(`
      UPDATE messages SET
        content = @content,
        thinking_content = @thinkingContent,
        thinking_duration_ms = @thinkingDurationMs,
        thinking_tokens = @thinkingTokens,
        output_tokens = @outputTokens
      WHERE id = @messageId
    `);

    const tx = this.db.transaction(() => {
      for (const buf of this.buffers.values()) {
        if (buf.dirty) {
          stmt.run({
            messageId: buf.messageId,
            content: buf.content,
            thinkingContent: buf.thinkingContent,
            thinkingDurationMs: buf.thinkingDurationMs,
            thinkingTokens: buf.thinkingTokens,
            outputTokens: buf.outputTokens,
          });
          buf.dirty = false;
        }
      }
    });

    tx();
  }

  private startFlushLoop(): void {
    this.flushTimer = setInterval(() => {
      try {
        this.flushNow();
      } catch {
        // Ignore transient lock errors
      }
    }, 250);
    this.flushTimer.unref();
  }

  public dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushNow();
  }
}
