import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { LocalGravityDB, ModelTier, SwarmMemberRecord, SwarmMessageRecord, SwarmWorkspaceMode } from '../db/database.js';
import type { TabbyEngine } from '../tabby/tabbyEngine.js';
import type { BuiltinToolExecutor } from '../tools/builtinTools.js';
import { BUILTIN_TOOLS_SCHEMA } from '../tools/builtinToolsSchema.js';
import { SWARM_TOOLS_SCHEMA } from '../tools/builtinToolsSchema.js';
import { SwarmTurnScheduler } from './swarmScheduler.js';

export interface FormattedSwarmMessage {
  seq: number;
  channel: string;
  agent: string;
  text: string;
  kind: string;
  mentions: string[];
  created_at: number;
}

export interface FormattedSwarmMember {
  id: string;
  swarm_id: string;
  name: string;
  added_by: string;
  thread_id: string;
  model: string;
  state: string;
  workspace_mode: SwarmWorkspaceMode;
  workspace_path: string;
  channels: string[];
  wait_since: number;
  mentions_only: boolean;
  last_read_seq: number;
  last_post_seq: number;
  brief: string;
}

export interface SwarmSnapshot {
  id: string;
  title: string;
  status: string;
  head: number;
  members: FormattedSwarmMember[];
  messages: FormattedSwarmMessage[];
}

export interface SwarmWorkerRuntimeDeps {
  tabby: TabbyEngine;
  tools: BuiltinToolExecutor;
  repoRoot: string;
  sharedSystemPrefix?: string;
}

const MAX_WORKER_STEPS = 12;

export function parseBoardMentions(text: string): string[] {
  const out = new Set<string>();
  const regex = /@([a-zA-Z0-9_#-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text || '')) !== null) {
    out.add(m[1].toLowerCase());
  }
  return Array.from(out);
}

export class SwarmManager {
  private static instance: SwarmManager | null = null;
  private db: LocalGravityDB | null = null;
  private broadcastSync: ((event: Record<string, any>) => void) | null = null;
  private runtimeDeps: SwarmWorkerRuntimeDeps | null = null;
  private scheduler = SwarmTurnScheduler.getInstance();
  private queuedWorkers = new Set<string>();

  public static getInstance(): SwarmManager {
    if (!SwarmManager.instance) {
      SwarmManager.instance = new SwarmManager();
    }
    return SwarmManager.instance;
  }

  public configure(params: {
    db: LocalGravityDB;
    broadcastSync: (event: Record<string, any>) => void;
    runtimeDeps?: SwarmWorkerRuntimeDeps;
  }): void {
    this.db = params.db;
    this.broadcastSync = params.broadcastSync;
    if (params.runtimeDeps) {
      this.runtimeDeps = params.runtimeDeps;
    }
  }

  public setRuntimeDeps(deps: SwarmWorkerRuntimeDeps): void {
    this.runtimeDeps = deps;
  }

  public hasActiveSwarm(parentThreadId: string): boolean {
    if (!this.db) return false;
    const sess = this.db.getSwarmSessionByThread(parentThreadId);
    return Boolean(sess && sess.status === 'active');
  }

  private formatMember(m: SwarmMemberRecord): FormattedSwarmMember {
    let channels: string[] = ['main'];
    try {
      channels = JSON.parse(m.channels_json || '["main"]');
    } catch {}
    return {
      id: m.id,
      swarm_id: m.swarm_id,
      name: m.name,
      added_by: m.added_by,
      thread_id: m.thread_id,
      model: m.model,
      state: m.state,
      workspace_mode: m.workspace_mode,
      workspace_path: m.workspace_path,
      channels,
      wait_since: m.wait_since,
      mentions_only: Boolean(m.mentions_only),
      last_read_seq: m.last_read_seq,
      last_post_seq: m.last_post_seq,
      brief: m.brief,
    };
  }

  private formatMessage(msg: SwarmMessageRecord): FormattedSwarmMessage {
    let mentions: string[] = [];
    try {
      mentions = JSON.parse(msg.mentions_json || '[]');
    } catch {}
    return {
      seq: msg.seq,
      channel: msg.channel,
      agent: msg.agent,
      text: msg.text,
      kind: msg.kind,
      mentions,
      created_at: msg.created_at,
    };
  }

  public getSwarmSnapshot(parentThreadId: string): SwarmSnapshot | null {
    if (!this.db) return null;
    const sess = this.db.getSwarmSessionByThread(parentThreadId);
    if (!sess) return null;
    const members = this.db.listSwarmMembers(sess.id).map((m) => this.formatMember(m));
    const messages = this.db.readSwarmMessages(sess.id, { limit: 100 }).map((m) => this.formatMessage(m));
    const head = this.db.getSwarmHead(sess.id);
    return {
      id: sess.id,
      title: sess.title,
      status: sess.status,
      head,
      members,
      messages,
    };
  }

  private emitSwarmState(parentThreadId: string): void {
    const snap = this.getSwarmSnapshot(parentThreadId);
    if (!snap || !this.broadcastSync) return;
    this.broadcastSync({
      type: 'SWARM_STATE',
      payload: {
        thread_id: parentThreadId,
        swarm: snap,
      },
    });
  }

  private ensureCoordinatorMember(swarmId: string, parentThreadId: string): void {
    if (!this.db) return;
    if (!this.db.getSwarmMember(swarmId, 'coordinator')) {
      this.db.upsertSwarmMember({
        swarm_id: swarmId,
        name: 'coordinator',
        added_by: 'system',
        thread_id: parentThreadId,
        model: 'strata-high',
        state: 'waiting',
        workspace_mode: 'inherit',
        workspace_path: this.runtimeDeps?.repoRoot || '',
        brief: 'Swarm coordinator',
      });
    }
  }

  private provisionWorkspace(
    swarmId: string,
    memberName: string,
    mode: SwarmWorkspaceMode,
    baseRoot: string
  ): string {
    if (mode === 'inherit' || !baseRoot) return baseRoot;
    const targetDir = path.join(os.tmpdir(), 'lg-swarm', swarmId, memberName);
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch {}
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });

    let isGit = false;
    try {
      const out = execSync('git rev-parse --is-inside-work-tree', {
        cwd: baseRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
        windowsHide: true,
      })
        .toString()
        .trim();
      isGit = out === 'true';
    } catch {}

    if (isGit) {
      try {
        const branchName = `lg-swarm-${memberName}-${Date.now().toString(36)}`;
        execSync(`git worktree add -b "${branchName}" "${targetDir}" HEAD`, {
          cwd: baseRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 8000,
          windowsHide: true,
        });
        return targetDir;
      } catch {
        // Fallback to filtered copy below
      }
    }

    try {
      fs.cpSync(baseRoot, targetDir, {
        recursive: true,
        filter: (src) => {
          const base = path.basename(src);
          return base !== 'node_modules' && base !== '.git' && base !== 'dist' && base !== 'target';
        },
      });
      return targetDir;
    } catch {
      return baseRoot;
    }
  }

  private cleanupWorkspace(workspaceMode: SwarmWorkspaceMode, workspacePath: string, baseRoot: string): void {
    if (workspaceMode === 'inherit' || !workspacePath || workspacePath === baseRoot) return;
    if (!workspacePath.includes('lg-swarm')) return;
    try {
      execSync(`git worktree remove --force "${workspacePath}"`, {
        cwd: baseRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4000,
        windowsHide: true,
      });
    } catch {}
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch {}
  }

  public postMessage(
    parentThreadId: string,
    agent: string,
    text: string,
    opts: { channel?: string; kind?: string; triggerWakeups?: boolean } = {}
  ): FormattedSwarmMessage {
    if (!this.db) throw new Error('SwarmManager not configured');
    const sess = this.db.createOrGetSwarmSession(parentThreadId);
    this.ensureCoordinatorMember(sess.id, parentThreadId);

    const mentions = parseBoardMentions(text);
    const channel = opts.channel || 'main';
    const rawMsg = this.db.appendSwarmMessage({
      swarm_id: sess.id,
      channel,
      agent,
      text,
      kind: opts.kind || 'message',
      mentions,
    });

    if (this.db.getSwarmMember(sess.id, agent)) {
      const updated = this.db.updateSwarmMember(sess.id, agent, {
        last_post_seq: rawMsg.seq,
        last_read_seq: rawMsg.seq,
      });
      if (updated && this.broadcastSync) {
        this.broadcastSync({
          type: 'SWARM_MEMBER_UPDATED',
          payload: {
            thread_id: parentThreadId,
            swarm_id: sess.id,
            member: this.formatMember(updated),
          },
        });
      }
    }

    const formatted = this.formatMessage(rawMsg);
    if (this.broadcastSync) {
      this.broadcastSync({
        type: 'SWARM_MESSAGE',
        payload: {
          thread_id: parentThreadId,
          swarm_id: sess.id,
          message: formatted,
        },
      });
    }
    this.emitSwarmState(parentThreadId);

    if (opts.triggerWakeups !== false) {
      this.wakeMatchingWorkers(parentThreadId, sess.id, formatted);
    }

    return formatted;
  }

  public readBoard(
    parentThreadId: string,
    readerAgent: string,
    opts: { since?: number; limit?: number; seqs?: number[]; channel?: string } = {}
  ): { head: number; messages: FormattedSwarmMessage[] } {
    if (!this.db) throw new Error('SwarmManager not configured');
    const sess = this.db.createOrGetSwarmSession(parentThreadId);
    const msgs = this.db.readSwarmMessages(sess.id, opts).map((m) => this.formatMessage(m));
    const head = this.db.getSwarmHead(sess.id);
    if (msgs.length > 0 && this.db.getSwarmMember(sess.id, readerAgent)) {
      const maxSeq = msgs[msgs.length - 1].seq;
      const existing = this.db.getSwarmMember(sess.id, readerAgent)!;
      if (maxSeq > existing.last_read_seq) {
        this.db.updateSwarmMember(sess.id, readerAgent, { last_read_seq: maxSeq });
      }
    }
    return { head, messages: msgs };
  }

  public waitBoard(
    parentThreadId: string,
    agent: string,
    since: number,
    mentionsOnly = true
  ): { waiting: boolean; since: number; mentions_only: boolean } {
    if (!this.db) throw new Error('SwarmManager not configured');
    const sess = this.db.createOrGetSwarmSession(parentThreadId);
    const updated = this.db.updateSwarmMember(sess.id, agent, {
      state: 'waiting',
      wait_since: since,
      mentions_only: mentionsOnly,
    });
    if (updated && this.broadcastSync) {
      this.broadcastSync({
        type: 'SWARM_MEMBER_UPDATED',
        payload: {
          thread_id: parentThreadId,
          swarm_id: sess.id,
          member: this.formatMember(updated),
        },
      });
    }
    this.emitSwarmState(parentThreadId);
    return { waiting: true, since, mentions_only: mentionsOnly };
  }

  public killMember(
    parentThreadId: string,
    name: string,
    callerAgent: string
  ): { killed: boolean; reason?: string } {
    if (!this.db) throw new Error('SwarmManager not configured');
    const sess = this.db.getSwarmSessionByThread(parentThreadId);
    if (!sess) return { killed: false, reason: 'No active swarm for thread' };
    if (name === 'coordinator') return { killed: false, reason: 'Cannot kill coordinator' };

    const member = this.db.getSwarmMember(sess.id, name);
    if (!member) return { killed: false, reason: `Member "${name}" not found` };
    if (callerAgent !== 'coordinator' && callerAgent !== 'user' && member.added_by !== callerAgent) {
      return { killed: false, reason: `Only coordinator or ${member.added_by} can kill ${name}` };
    }

    const baseRoot = this.runtimeDeps?.repoRoot || process.cwd();
    this.cleanupWorkspace(member.workspace_mode, member.workspace_path, baseRoot);
    const updated = this.db.updateSwarmMember(sess.id, name, { state: 'killed' });
    if (updated && this.broadcastSync) {
      this.broadcastSync({
        type: 'SWARM_MEMBER_UPDATED',
        payload: {
          thread_id: parentThreadId,
          swarm_id: sess.id,
          member: this.formatMember(updated),
        },
      });
    }
    this.emitSwarmState(parentThreadId);
    return { killed: true };
  }

  public handleSwarmTool(
    parentThreadId: string,
    callerAgent: string,
    workspaceRoot: string,
    args: Record<string, any>
  ): Record<string, any> {
    if (!this.db) throw new Error('SwarmManager not configured');
    const action = String(args.action || 'status').toLowerCase();
    const sess = this.db.createOrGetSwarmSession(parentThreadId, args.title || 'Swarm Session');
    this.ensureCoordinatorMember(sess.id, parentThreadId);

    if (action === 'title') {
      if (callerAgent !== 'coordinator' && callerAgent !== 'user') {
        return { error: 'Only coordinator can rename the swarm title.' };
      }
      const nextTitle = String(args.title || '').trim() || 'Swarm Session';
      this.db.updateSwarmSession(sess.id, { title: nextTitle });
      this.emitSwarmState(parentThreadId);
      return { ok: true, title: nextTitle };
    }

    if (action === 'models') {
      return {
        models: [
          { name: 'strata-high', displayName: 'Strata Qwen 3.8 Flash-Next (High)', default: true },
          { name: 'tabby-medium', displayName: 'TabbyAPI Medium Tier' },
          { name: 'tabby-low', displayName: 'TabbyAPI Low Tier' },
        ],
      };
    }

    if (action === 'status') {
      return {
        swarm: this.getSwarmSnapshot(parentThreadId),
        scheduler: this.scheduler.getStatus(),
      };
    }

    if (action === 'model') {
      const targetName = String(args.name || callerAgent);
      const nextModel = String(args.model || 'strata-high');
      const m = this.db.updateSwarmMember(sess.id, targetName, { model: nextModel });
      if (!m) return { error: `Member "${targetName}" not found` };
      if (this.broadcastSync) {
        this.broadcastSync({
          type: 'SWARM_MEMBER_UPDATED',
          payload: { thread_id: parentThreadId, swarm_id: sess.id, member: this.formatMember(m) },
        });
      }
      this.emitSwarmState(parentThreadId);
      return { ok: true, member: this.formatMember(m) };
    }

    if (action === 'kill') {
      const targetName = String(args.name || '').trim();
      if (!targetName) return { error: 'kill requires "name"' };
      return this.killMember(parentThreadId, targetName, callerAgent);
    }

    if (action === 'add') {
      const baseName = String(args.name || 'worker')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '') || 'worker';
      const brief = String(args.brief || '').trim();
      if (!brief) return { error: 'add requires a non-empty "brief"' };

      const mode: SwarmWorkspaceMode =
        args.workspace === 'share' || args.workspace === 'branch' ? args.workspace : 'inherit';
      const isGoogleProvider =
        this.runtimeDeps?.tabby.getBrainProviderConfig().provider === 'google_ai_studio';
      const model = args.model
        ? String(args.model)
        : isGoogleProvider
        ? this.runtimeDeps!.tabby.getGoogleEngine().resolveSwarmWorkerModel(baseName).modelId
        : 'strata-high';
      const tasks: string[] = Array.isArray(args.tasks) ? args.tasks.map(String) : [];
      const count = tasks.length > 0 ? tasks.length : Math.max(1, Number(args.n || 1));
      const created: FormattedSwarmMember[] = [];

      for (let i = 0; i < count; i++) {
        const name = count > 1 ? `${baseName}-${i + 1}` : baseName;
        const memberBrief = tasks.length > 0 ? `${brief}\n\nAssigned slice: ${tasks[i]}` : brief;
        const wsPath = this.provisionWorkspace(sess.id, name, mode, workspaceRoot);
        const rec = this.db.upsertSwarmMember({
          swarm_id: sess.id,
          name,
          added_by: callerAgent,
          thread_id: `${parentThreadId}::${name}`,
          model,
          state: 'waiting',
          workspace_mode: mode,
          workspace_path: wsPath,
          wait_since: this.db.getSwarmHead(sess.id),
          mentions_only: true,
          brief: memberBrief,
        });
        const formatted = this.formatMember(rec);
        created.push(formatted);
        if (this.broadcastSync) {
          this.broadcastSync({
            type: 'SWARM_MEMBER_UPDATED',
            payload: { thread_id: parentThreadId, swarm_id: sess.id, member: formatted },
          });
        }
        // Posting the brief @mentions the worker and queues its first turn via SwarmTurnScheduler
        this.postMessage(parentThreadId, callerAgent, `@${name} ${memberBrief}`, {
          kind: 'brief',
        });
      }

      return { ok: true, added: created, swarm: this.getSwarmSnapshot(parentThreadId) };
    }

    return { error: `Unknown swarm action: ${action}` };
  }

  private wakeMatchingWorkers(parentThreadId: string, swarmId: string, msg: FormattedSwarmMessage): void {
    if (!this.db) return;
    const members = this.db.listSwarmMembers(swarmId);
    const mentions = new Set(msg.mentions.map((m) => m.toLowerCase()));
    const isAll = mentions.has('all');
    const channelMention = mentions.has(`#${msg.channel.toLowerCase()}`);

    for (const m of members) {
      if (m.name === 'coordinator' || m.name === msg.agent) continue;
      if (m.state === 'killed' || m.state === 'working') continue;
      if (msg.seq <= m.wait_since) continue;

      const mentioned = isAll || channelMention || mentions.has(m.name.toLowerCase());
      const shouldWake = mentioned || m.mentions_only === 0;
      if (!shouldWake) continue;

      this.scheduleWorkerTurn(parentThreadId, swarmId, m.name);
    }
  }

  public scheduleWorkerTurn(parentThreadId: string, swarmId: string, memberName: string): void {
    if (!this.db || !this.runtimeDeps) return;
    const key = `${swarmId}:${memberName}`;
    if (this.queuedWorkers.has(key)) return;
    this.queuedWorkers.add(key);

    const isGoogleProvider =
      this.runtimeDeps.tabby.getBrainProviderConfig().provider === 'google_ai_studio';

    if (isGoogleProvider) {
      // Cloud Google AI Studio requests don't contend for local VRAM: run swarm workers concurrently
      void this.executeWorkerTurn(parentThreadId, swarmId, memberName)
        .catch((err) => {
          console.warn(`[SwarmManager] Parallel Google worker ${memberName} error:`, err?.message);
        })
        .finally(() => {
          this.queuedWorkers.delete(key);
        });
      return;
    }

    const priority = memberName === 'monitor' ? 2 : 1;
    void this.scheduler
      .acquireGpuTurn(priority, `swarm:${memberName}`, async () => {
        await this.executeWorkerTurn(parentThreadId, swarmId, memberName);
      })
      .finally(() => {
        this.queuedWorkers.delete(key);
      });
  }

  private async executeWorkerTurn(parentThreadId: string, swarmId: string, memberName: string): Promise<void> {
    if (!this.db || !this.runtimeDeps) return;
    const member = this.db.getSwarmMember(swarmId, memberName);
    if (!member || member.state === 'killed') return;

    const workingRec = this.db.updateSwarmMember(swarmId, memberName, { state: 'working' });
    if (workingRec && this.broadcastSync) {
      this.broadcastSync({
        type: 'SWARM_MEMBER_UPDATED',
        payload: { thread_id: parentThreadId, swarm_id: swarmId, member: this.formatMember(workingRec) },
      });
    }
    this.emitSwarmState(parentThreadId);

    const { tabby, tools, sharedSystemPrefix } = this.runtimeDeps;
    const unread = this.db
      .readSwarmMessages(swarmId, { since: member.last_read_seq, limit: 30 })
      .map((m) => `[#${m.seq} ${m.agent}]: ${m.text}`)
      .join('\n\n');

    // Append worker persona at the TAIL of the system prompt for Strata KV prefix-cache reuse
    const prefix =
      sharedSystemPrefix ||
      `You are a specialized LocalGravity Swarm Worker collaborating via the shared message board.\nWorkspace: ${member.workspace_path || this.runtimeDeps.repoRoot}`;
    const workerSystem =
      `${prefix}\n\n` +
      `=== SWARM WORKER PERSONA ===\n` +
      `Name: @${member.name} (added by @${member.added_by})\n` +
      `Workspace Path: ${member.workspace_path || this.runtimeDeps.repoRoot}\n` +
      `Assignment Brief: ${member.brief}\n` +
      `Protocol: Use read_board, post_message (always @mention who needs to act next, e.g. @coordinator), and call swarm_wait when finished or waiting on another agent.`;

    const messages: Array<{ role: string; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [
      { role: 'system', content: workerSystem },
      {
        role: 'user',
        content: unread
          ? `New board messages since #${member.last_read_seq}:\n\n${unread}\n\nExecute your assigned work and post your result to the board.`
          : `Execute your assigned brief:\n${member.brief}`,
      },
    ];

    const workerTools = [...BUILTIN_TOOLS_SCHEMA, ...SWARM_TOOLS_SCHEMA];
    const tier: ModelTier = member.model.includes('low')
      ? 'low'
      : member.model.includes('medium')
      ? 'medium'
      : 'high';

    const isGoogleProvider = tabby.getBrainProviderConfig().provider === 'google_ai_studio';
    const googleRoute = isGoogleProvider
      ? tabby.getGoogleEngine().resolveSwarmWorkerModel(memberName, member.model)
      : null;

    let calledWait = false;
    let lastContent = '';

    try {
      for (let step = 1; step <= MAX_WORKER_STEPS; step++) {
        const curState = this.db.getSwarmMember(swarmId, memberName);
        if (!curState || curState.state === 'killed') break;

        const executed: Array<{ id: string; name: string; args: any; output: string }> = [];
        const isFinal = step === MAX_WORKER_STEPS;

        const res = await tabby.streamChatCompletion({
          tier,
          thinkingBudget: googleRoute ? googleRoute.thinkingBudget : 'fast',
          googleModelOverride: googleRoute?.modelId,
          stepIndex: step,
          messages,
          tools: isFinal ? undefined : workerTools,
          skipGpuLock: true,
          onThoughtDelta: () => {},
          onTokenDelta: () => {},
          onToolCallRequest: isFinal
            ? undefined
            : async (toolName, toolArgs) => {
                if (toolName === 'swarm_wait') {
                  calledWait = true;
                }
                const execRes = await tools.executeTool(toolName, toolArgs, {
                  threadId: parentThreadId,
                  messageId: `${swarmId}:${memberName}:${step}`,
                  workspaceRoot: member.workspace_path || this.runtimeDeps!.repoRoot,
                  swarmAgentName: memberName,
                });
                executed.push({
                  id: `sw-${step}-${executed.length + 1}`,
                  name: toolName,
                  args: toolArgs,
                  output: execRes.stdout || execRes.stderr || 'ok',
                });
              },
        });

        lastContent = (res.content || '').trim();
        if (calledWait || executed.length === 0) break;

        messages.push({
          role: 'assistant',
          content: res.content || '',
          tool_calls: executed.map((e) => ({
            id: e.id,
            type: 'function',
            function: { name: e.name, arguments: JSON.stringify(e.args) },
          })),
        });
        for (const e of executed) {
          messages.push({
            role: 'tool',
            tool_call_id: e.id,
            name: e.name,
            content: e.output,
          });
        }
      }

      if (!calledWait && lastContent) {
        const cur = this.db.getSwarmMember(swarmId, memberName);
        if (cur && cur.state !== 'killed' && cur.last_post_seq < this.db.getSwarmHead(swarmId)) {
          this.postMessage(parentThreadId, memberName, `@${member.added_by} ${lastContent.slice(0, 1500)}`);
        }
      }
    } catch (err: any) {
      this.postMessage(
        parentThreadId,
        memberName,
        `@${member.added_by} Worker hit error: ${err?.message || String(err)}`,
        { kind: 'error', triggerWakeups: false }
      );
    } finally {
      const cur = this.db.getSwarmMember(swarmId, memberName);
      if (cur && cur.state !== 'killed' && !calledWait) {
        const head = this.db.getSwarmHead(swarmId);
        const parked = this.db.updateSwarmMember(swarmId, memberName, {
          state: 'waiting',
          wait_since: head,
        });
        if (parked && this.broadcastSync) {
          this.broadcastSync({
            type: 'SWARM_MEMBER_UPDATED',
            payload: { thread_id: parentThreadId, swarm_id: swarmId, member: this.formatMember(parked) },
          });
        }
        this.emitSwarmState(parentThreadId);
      }
    }
  }
}
