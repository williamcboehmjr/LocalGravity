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
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly db: Database.Database) {
    this.startFlushLoop();
  }

  public get(messageId: string): InFlightStreamBuffer | undefined {
    return this.buffers.get(messageId);
  }

  public begin(messageId: string, threadId: string): void {
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
    const buf = this.buffers.get(messageId);
    if (buf) {
      buf.isFinished = true;
      buf.dirty = true;
      this.flushNow();
      this.buffers.delete(messageId);
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
