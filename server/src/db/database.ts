import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

export type ModelTier = 'low' | 'medium' | 'high';
export type ThinkingBudget = 'off' | 'fast' | 'deep';
export type ThreadStatus = 'idle' | 'thinking' | 'executing_tool' | 'awaiting_approval' | 'error';
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ProjectRecord {
  id: string;
  name: string;
  root_path: string;
  git_branch: string;
  default_model_tier: ModelTier;
  default_thinking_budget: ThinkingBudget;
  custom_instructions: string;
  enabled_mcp_servers: string; // JSON array
  pinned_files: string; // JSON array
  last_opened_at: string;
  created_at: string;
}

export interface ThreadRecord {
  id: string;
  project_id: string;
  title: string;
  status: ThreadStatus;
  active_model_tier: ModelTier;
  active_thinking_budget: ThinkingBudget;
  kv_prefix_hash: string;
  updated_at: string;
  created_at: string;
}

export interface MessageRecord {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  thinking_content: string;
  thinking_duration_ms: number;
  thinking_tokens: number;
  output_tokens: number;
  attachments: string; // JSON array
  created_at: string;
}

export interface ToolExecutionRecord {
  id: string;
  message_id: string;
  thread_id: string;
  tool_name: string;
  mcp_server: string | null;
  arguments_json: string;
  stdout_stream: string;
  stderr_stream: string;
  exit_code: number | null;
  status: 'running' | 'success' | 'error';
  duration_ms: number;
}

export interface FileCheckpointRecord {
  id: string;
  thread_id: string;
  message_id: string;
  file_path: string;
  previous_content_blob: string | null;
  new_content_blob: string;
  created_at: string;
}

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

export class LocalGravityDB {
  public db: Database.Database;
  public readonly dbPath: string;
  private streamBuffers = new Map<string, InFlightStreamBuffer>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ||
      path.join(process.cwd(), '..', '.runtime', 'localgravity.sqlite');
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.dbPath = resolvedPath;

    this.db = new Database(resolvedPath);

    // Enforce exact SQLite WAL + Foreign Key pragmas from Phase 4
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.initSchema();
    this.startStreamFlushLoop();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        git_branch TEXT NOT NULL DEFAULT 'main',
        default_model_tier TEXT NOT NULL DEFAULT 'high',
        default_thinking_budget TEXT NOT NULL DEFAULT 'fast',
        custom_instructions TEXT NOT NULL DEFAULT '',
        enabled_mcp_servers TEXT NOT NULL DEFAULT '[]',
        pinned_files TEXT NOT NULL DEFAULT '[]',
        last_opened_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        active_model_tier TEXT NOT NULL DEFAULT 'high',
        active_thinking_budget TEXT NOT NULL DEFAULT 'fast',
        kv_prefix_hash TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        thinking_content TEXT NOT NULL DEFAULT '',
        thinking_duration_ms INTEGER NOT NULL DEFAULT 0,
        thinking_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        attachments TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tool_executions (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        mcp_server TEXT,
        arguments_json TEXT NOT NULL DEFAULT '{}',
        stdout_stream TEXT NOT NULL DEFAULT '',
        stderr_stream TEXT NOT NULL DEFAULT '',
        exit_code INTEGER,
        status TEXT NOT NULL DEFAULT 'running',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS file_checkpoints (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        previous_content_blob TEXT,
        new_content_blob TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id);
      CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_tool_executions_message_id ON tool_executions(message_id);
      CREATE INDEX IF NOT EXISTS idx_tool_executions_thread_id ON tool_executions(thread_id);
      CREATE INDEX IF NOT EXISTS idx_file_checkpoints_thread_id ON file_checkpoints(thread_id);
    `);
  }

  public getPragmas(): { journal_mode: string; synchronous: number; foreign_keys: number } {
    const journal_mode = this.db.pragma('journal_mode', { simple: true }) as string;
    const synchronous = this.db.pragma('synchronous', { simple: true }) as number;
    const foreign_keys = this.db.pragma('foreign_keys', { simple: true }) as number;
    return { journal_mode, synchronous, foreign_keys };
  }

  public detectGitBranch(rootPath: string): string {
    try {
      if (fs.existsSync(rootPath)) {
        const out = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: rootPath,
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 1500,
        })
          .toString()
          .trim();
        if (out) return out;
      }
    } catch {
      // Fallback
    }
    return 'main';
  }

  // ==================== PROJECTS ====================
  public ensureDefaultProject(defaultWorkspacePath: string): ProjectRecord {
    const existing = this.listProjects();
    if (existing.length > 0) {
      return existing[0];
    }
    return this.createProject({
      name: path.basename(defaultWorkspacePath) || 'LocalGravity',
      root_path: defaultWorkspacePath.replace(/\\/g, '/'),
      default_model_tier: 'high',
      default_thinking_budget: 'fast',
      enabled_mcp_servers: ['local-fetch', 'filesystem'],
      pinned_files: ['README.md', 'launch.py', 'mcp_config.json'],
    });
  }

  public listProjects(): ProjectRecord[] {
    return this.db
      .prepare('SELECT * FROM projects ORDER BY last_opened_at DESC')
      .all() as ProjectRecord[];
  }

  public getProject(id: string): ProjectRecord | undefined {
    return this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as ProjectRecord | undefined;
  }

  public createProject(input: {
    id?: string;
    name: string;
    root_path: string;
    git_branch?: string;
    default_model_tier?: ModelTier;
    default_thinking_budget?: ThinkingBudget;
    custom_instructions?: string;
    enabled_mcp_servers?: string[];
    pinned_files?: string[];
  }): ProjectRecord {
    const id = input.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const normalizedPath = input.root_path.replace(/\\/g, '/');
    const gitBranch = input.git_branch || this.detectGitBranch(normalizedPath);

    const record: ProjectRecord = {
      id,
      name: input.name,
      root_path: normalizedPath,
      git_branch: gitBranch,
      default_model_tier: input.default_model_tier || 'high',
      default_thinking_budget: input.default_thinking_budget || 'fast',
      custom_instructions: input.custom_instructions || '',
      enabled_mcp_servers: JSON.stringify(input.enabled_mcp_servers || ['local-fetch', 'filesystem']),
      pinned_files: JSON.stringify(input.pinned_files || []),
      last_opened_at: now,
      created_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO projects (
          id, name, root_path, git_branch, default_model_tier, default_thinking_budget,
          custom_instructions, enabled_mcp_servers, pinned_files, last_opened_at, created_at
        ) VALUES (
          @id, @name, @root_path, @git_branch, @default_model_tier, @default_thinking_budget,
          @custom_instructions, @enabled_mcp_servers, @pinned_files, @last_opened_at, @created_at
        )`
      )
      .run(record);

    return record;
  }

  public updateProject(
    id: string,
    updates: Partial<{
      name: string;
      root_path: string;
      git_branch: string;
      default_model_tier: ModelTier;
      default_thinking_budget: ThinkingBudget;
      custom_instructions: string;
      enabled_mcp_servers: string[];
      pinned_files: string[];
    }>
  ): ProjectRecord | undefined {
    const existing = this.getProject(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const nextRoot = updates.root_path ? updates.root_path.replace(/\\/g, '/') : existing.root_path;
    const nextBranch =
      updates.git_branch ||
      (updates.root_path ? this.detectGitBranch(nextRoot) : existing.git_branch);

    const updated: ProjectRecord = {
      ...existing,
      name: updates.name ?? existing.name,
      root_path: nextRoot,
      git_branch: nextBranch,
      default_model_tier: updates.default_model_tier ?? existing.default_model_tier,
      default_thinking_budget: updates.default_thinking_budget ?? existing.default_thinking_budget,
      custom_instructions: updates.custom_instructions ?? existing.custom_instructions,
      enabled_mcp_servers: updates.enabled_mcp_servers
        ? JSON.stringify(updates.enabled_mcp_servers)
        : existing.enabled_mcp_servers,
      pinned_files: updates.pinned_files
        ? JSON.stringify(updates.pinned_files)
        : existing.pinned_files,
      last_opened_at: now,
    };

    this.db
      .prepare(
        `UPDATE projects SET
          name = @name,
          root_path = @root_path,
          git_branch = @git_branch,
          default_model_tier = @default_model_tier,
          default_thinking_budget = @default_thinking_budget,
          custom_instructions = @custom_instructions,
          enabled_mcp_servers = @enabled_mcp_servers,
          pinned_files = @pinned_files,
          last_opened_at = @last_opened_at
        WHERE id = @id`
      )
      .run(updated);

    return updated;
  }

  public deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  // ==================== THREADS ====================
  public listThreads(projectId?: string): ThreadRecord[] {
    if (projectId) {
      return this.db
        .prepare('SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC')
        .all(projectId) as ThreadRecord[];
    }
    return this.db
      .prepare('SELECT * FROM threads ORDER BY updated_at DESC')
      .all() as ThreadRecord[];
  }

  public getThread(id: string): ThreadRecord | undefined {
    return this.db
      .prepare('SELECT * FROM threads WHERE id = ?')
      .get(id) as ThreadRecord | undefined;
  }

  public createThread(input: {
    id?: string;
    project_id: string;
    title?: string;
    status?: ThreadStatus;
    active_model_tier?: ModelTier;
    active_thinking_budget?: ThinkingBudget;
    kv_prefix_hash?: string;
  }): ThreadRecord {
    const id = input.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const record: ThreadRecord = {
      id,
      project_id: input.project_id,
      title: input.title || 'New Thread',
      status: input.status || 'idle',
      active_model_tier: input.active_model_tier || 'high',
      active_thinking_budget: input.active_thinking_budget || 'fast',
      kv_prefix_hash: input.kv_prefix_hash || crypto.createHash('sha256').update(id).digest('hex').slice(0, 16),
      updated_at: now,
      created_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO threads (
          id, project_id, title, status, active_model_tier, active_thinking_budget,
          kv_prefix_hash, updated_at, created_at
        ) VALUES (
          @id, @project_id, @title, @status, @active_model_tier, @active_thinking_budget,
          @kv_prefix_hash, @updated_at, @created_at
        )`
      )
      .run(record);

    return record;
  }

  public updateThread(
    id: string,
    updates: Partial<{
      title: string;
      status: ThreadStatus;
      active_model_tier: ModelTier;
      active_thinking_budget: ThinkingBudget;
      kv_prefix_hash: string;
    }>
  ): ThreadRecord | undefined {
    const existing = this.getThread(id);
    if (!existing) return undefined;

    const updated: ThreadRecord = {
      ...existing,
      title: updates.title ?? existing.title,
      status: updates.status ?? existing.status,
      active_model_tier: updates.active_model_tier ?? existing.active_model_tier,
      active_thinking_budget: updates.active_thinking_budget ?? existing.active_thinking_budget,
      kv_prefix_hash: updates.kv_prefix_hash ?? existing.kv_prefix_hash,
      updated_at: new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE threads SET
          title = @title,
          status = @status,
          active_model_tier = @active_model_tier,
          active_thinking_budget = @active_thinking_budget,
          kv_prefix_hash = @kv_prefix_hash,
          updated_at = @updated_at
        WHERE id = @id`
      )
      .run(updated);

    return updated;
  }

  public deleteThread(id: string): void {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(id);
  }

  public clearThreadMessages(threadId: string): void {
    this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(threadId);
    this.updateThread(threadId, { status: 'idle' });
  }

  public compactThreadMessages(threadId: string, keepRecentCount = 4, summaryContent = ''): number {
    const msgs = this.db
      .prepare('SELECT id, role, content FROM messages WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId) as Array<{ id: string; role: string; content: string }>;

    if (msgs.length <= keepRecentCount) {
      return 0;
    }

    const toPrune = msgs.slice(0, msgs.length - keepRecentCount);
    const pruneIds = toPrune.map((m) => m.id);

    const tx = this.db.transaction(() => {
      const delMsg = this.db.prepare('DELETE FROM messages WHERE id = ?');
      const delTools = this.db.prepare('DELETE FROM tool_executions WHERE message_id = ?');
      for (const id of pruneIds) {
        delTools.run(id);
        delMsg.run(id);
      }
      if (summaryContent) {
        const now = new Date(Date.now() - 60000).toISOString();
        this.db
          .prepare(
            `INSERT INTO messages (
              id, thread_id, role, content, thinking_content, thinking_duration_ms,
              thinking_tokens, output_tokens, attachments, created_at
            ) VALUES (?, ?, 'system', ?, '', 0, 0, 0, '[]', ?)`
          )
          .run(crypto.randomUUID(), threadId, summaryContent, now);
      }
    });
    tx();
    return pruneIds.length;
  }

  // ==================== MESSAGES ====================
  public listMessages(threadId: string): Array<MessageRecord & { tool_executions: ToolExecutionRecord[] }> {
    const msgs = this.db
      .prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId) as MessageRecord[];

    const tools = this.db
      .prepare('SELECT * FROM tool_executions WHERE thread_id = ? ORDER BY rowid ASC')
      .all(threadId) as ToolExecutionRecord[];

    const toolsByMsg = new Map<string, ToolExecutionRecord[]>();
    for (const t of tools) {
      const arr = toolsByMsg.get(t.message_id) || [];
      arr.push(t);
      toolsByMsg.set(t.message_id, arr);
    }

    return msgs.map((m) => {
      // Overlay any un-flushed in-flight buffer
      const buf = this.streamBuffers.get(m.id);
      if (buf) {
        return {
          ...m,
          content: buf.content,
          thinking_content: buf.thinkingContent,
          thinking_duration_ms: buf.thinkingDurationMs,
          thinking_tokens: buf.thinkingTokens,
          output_tokens: buf.outputTokens,
          tool_executions: toolsByMsg.get(m.id) || [],
        };
      }
      return {
        ...m,
        tool_executions: toolsByMsg.get(m.id) || [],
      };
    });
  }

  public createMessage(input: {
    id?: string;
    thread_id: string;
    role: MessageRole;
    content?: string;
    thinking_content?: string;
    thinking_duration_ms?: number;
    thinking_tokens?: number;
    output_tokens?: number;
    attachments?: unknown[];
  }): MessageRecord {
    const id = input.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const record: MessageRecord = {
      id,
      thread_id: input.thread_id,
      role: input.role,
      content: input.content || '',
      thinking_content: input.thinking_content || '',
      thinking_duration_ms: input.thinking_duration_ms || 0,
      thinking_tokens: input.thinking_tokens || 0,
      output_tokens: input.output_tokens || 0,
      attachments: JSON.stringify(input.attachments || []),
      created_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO messages (
          id, thread_id, role, content, thinking_content, thinking_duration_ms,
          thinking_tokens, output_tokens, attachments, created_at
        ) VALUES (
          @id, @thread_id, @role, @content, @thinking_content, @thinking_duration_ms,
          @thinking_tokens, @output_tokens, @attachments, @created_at
        )`
      )
      .run(record);

    this.updateThread(input.thread_id, {});
    return record;
  }

  // ==================== 250ms STREAM REHYDRATION ENGINE ====================
  public beginStreamingMessage(messageId: string, threadId: string): void {
    this.streamBuffers.set(messageId, {
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
    let buf = this.streamBuffers.get(messageId);
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
      this.streamBuffers.set(messageId, buf);
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
    let buf = this.streamBuffers.get(messageId);
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
      this.streamBuffers.set(messageId, buf);
    }
    buf.content += delta;
    buf.outputTokens = outputTokens;
    buf.dirty = true;
    return buf;
  }

  public resetStreamingMessageContent(messageId: string, newContent = ''): void {
    const buf = this.streamBuffers.get(messageId);
    if (buf) {
      buf.content = newContent;
      buf.dirty = true;
    }
    this.db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(newContent, messageId);
  }

  public finalizeStreamingMessage(messageId: string): void {
    const buf = this.streamBuffers.get(messageId);
    if (buf) {
      buf.isFinished = true;
      buf.dirty = true;
      this.flushStreamBuffersNow();
      this.streamBuffers.delete(messageId);
    }
  }

  public getActiveStreamsForThread(threadId: string): InFlightStreamBuffer[] {
    const active: InFlightStreamBuffer[] = [];
    for (const buf of this.streamBuffers.values()) {
      if (buf.threadId === threadId && !buf.isFinished) {
        active.push({ ...buf });
      }
    }
    return active;
  }

  public flushStreamBuffersNow(): void {
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
      for (const buf of this.streamBuffers.values()) {
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

  private startStreamFlushLoop(): void {
    // Flush in-flight streaming tokens & thoughts to SQLite every 250ms
    this.flushTimer = setInterval(() => {
      try {
        this.flushStreamBuffersNow();
      } catch {
        // Ignore transient lock errors
      }
    }, 250);
    this.flushTimer.unref();
  }

  // ==================== TOOL EXECUTIONS ====================
  public createToolExecution(input: {
    id?: string;
    message_id: string;
    thread_id: string;
    tool_name: string;
    mcp_server?: string | null;
    arguments_json?: string;
  }): ToolExecutionRecord {
    const id = input.id || crypto.randomUUID();
    const record: ToolExecutionRecord = {
      id,
      message_id: input.message_id,
      thread_id: input.thread_id,
      tool_name: input.tool_name,
      mcp_server: input.mcp_server || null,
      arguments_json: input.arguments_json || '{}',
      stdout_stream: '',
      stderr_stream: '',
      exit_code: null,
      status: 'running',
      duration_ms: 0,
    };

    this.db
      .prepare(
        `INSERT INTO tool_executions (
          id, message_id, thread_id, tool_name, mcp_server, arguments_json,
          stdout_stream, stderr_stream, exit_code, status, duration_ms
        ) VALUES (
          @id, @message_id, @thread_id, @tool_name, @mcp_server, @arguments_json,
          @stdout_stream, @stderr_stream, @exit_code, @status, @duration_ms
        )`
      )
      .run(record);

    return record;
  }

  public updateToolExecution(
    id: string,
    updates: Partial<{
      stdout_stream: string;
      stderr_stream: string;
      exit_code: number | null;
      status: 'running' | 'success' | 'error';
      duration_ms: number;
    }>
  ): ToolExecutionRecord | undefined {
    const existing = this.db
      .prepare('SELECT * FROM tool_executions WHERE id = ?')
      .get(id) as ToolExecutionRecord | undefined;
    if (!existing) return undefined;

    const updated: ToolExecutionRecord = {
      ...existing,
      stdout_stream: updates.stdout_stream ?? existing.stdout_stream,
      stderr_stream: updates.stderr_stream ?? existing.stderr_stream,
      exit_code: updates.exit_code !== undefined ? updates.exit_code : existing.exit_code,
      status: updates.status ?? existing.status,
      duration_ms: updates.duration_ms ?? existing.duration_ms,
    };

    this.db
      .prepare(
        `UPDATE tool_executions SET
          stdout_stream = @stdout_stream,
          stderr_stream = @stderr_stream,
          exit_code = @exit_code,
          status = @status,
          duration_ms = @duration_ms
        WHERE id = @id`
      )
      .run(updated);

    return updated;
  }

  public finalizeRunningToolExecutions(messageId: string): number {
    const res = this.db
      .prepare(
        `UPDATE tool_executions 
         SET status = 'error',
             exit_code = COALESCE(exit_code, 1),
             stdout_stream = COALESCE(stdout_stream, ''),
             stderr_stream = COALESCE(stderr_stream, 'Interrupted or finalized before completion')
         WHERE message_id = ? AND status = 'running'`
      )
      .run(messageId);
    return res.changes;
  }

  public listToolExecutions(threadId: string): ToolExecutionRecord[] {
    return this.db
      .prepare('SELECT * FROM tool_executions WHERE thread_id = ? ORDER BY rowid ASC')
      .all(threadId) as ToolExecutionRecord[];
  }

  // ==================== FILE CHECKPOINTS (UNDO / TIME-TRAVEL) ====================
  public createFileCheckpoint(input: {
    id?: string;
    thread_id: string;
    message_id: string;
    file_path: string;
    previous_content_blob: string | null;
    new_content_blob: string;
  }): FileCheckpointRecord {
    const id = input.id || crypto.randomUUID();
    const record: FileCheckpointRecord = {
      id,
      thread_id: input.thread_id,
      message_id: input.message_id,
      file_path: input.file_path.replace(/\\/g, '/'),
      previous_content_blob: input.previous_content_blob,
      new_content_blob: input.new_content_blob,
      created_at: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO file_checkpoints (
          id, thread_id, message_id, file_path, previous_content_blob, new_content_blob, created_at
        ) VALUES (
          @id, @thread_id, @message_id, @file_path, @previous_content_blob, @new_content_blob, @created_at
        )`
      )
      .run(record);

    return record;
  }

  public listFileCheckpoints(threadId: string): FileCheckpointRecord[] {
    return this.db
      .prepare('SELECT * FROM file_checkpoints WHERE thread_id = ? ORDER BY created_at DESC')
      .all(threadId) as FileCheckpointRecord[];
  }

  public getFileCheckpoint(id: string): FileCheckpointRecord | undefined {
    return this.db
      .prepare('SELECT * FROM file_checkpoints WHERE id = ?')
      .get(id) as FileCheckpointRecord | undefined;
  }

  public revertFileCheckpoint(checkpointId: string): {
    reverted: boolean;
    filePath: string;
    restoredContent: string | null;
  } {
    const cp = this.getFileCheckpoint(checkpointId);
    if (!cp) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    if (cp.previous_content_blob === null) {
      if (fs.existsSync(cp.file_path)) {
        fs.unlinkSync(cp.file_path);
      }
      return { reverted: true, filePath: cp.file_path, restoredContent: null };
    } else {
      fs.mkdirSync(path.dirname(cp.file_path), { recursive: true });
      fs.writeFileSync(cp.file_path, cp.previous_content_blob, 'utf-8');
      return {
        reverted: true,
        filePath: cp.file_path,
        restoredContent: cp.previous_content_blob,
      };
    }
  }

  public close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushStreamBuffersNow();
    this.db.close();
  }
}
