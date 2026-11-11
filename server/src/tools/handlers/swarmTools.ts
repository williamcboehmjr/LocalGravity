import type { BuiltinToolHandler } from './types.js';
import { SwarmManager } from '../../swarm/swarmManager.js';

export const swarmTool: { name: string; execute: BuiltinToolHandler } = {
  name: 'swarm',
  execute: async (args, ctx) => {
    const startMs = Date.now();
    try {
      const mgr = SwarmManager.getInstance();
      const caller = ctx.swarmAgentName || 'coordinator';
      const result = mgr.handleSwarmTool(ctx.threadId, caller, ctx.workspaceRoot, args);
      return {
        stdout: JSON.stringify(result, null, 2),
        stderr: result.error ? String(result.error) : '',
        exitCode: result.error ? 1 : 0,
        durationMs: Date.now() - startMs,
      };
    } catch (err: any) {
      return {
        stdout: '',
        stderr: err?.message || String(err),
        exitCode: 1,
        durationMs: Date.now() - startMs,
      };
    }
  },
};

export const postMessageTool: { name: string; execute: BuiltinToolHandler } = {
  name: 'post_message',
  execute: async (args, ctx) => {
    const startMs = Date.now();
    const text = String(args.text || '').trim();
    if (!text) {
      return {
        stdout: '',
        stderr: 'post_message requires non-empty "text".',
        exitCode: 1,
        durationMs: Date.now() - startMs,
      };
    }
    try {
      const mgr = SwarmManager.getInstance();
      const agent = ctx.swarmAgentName || 'coordinator';
      const msg = mgr.postMessage(ctx.threadId, agent, text, {
        channel: args.channel ? String(args.channel) : undefined,
      });
      return {
        stdout: JSON.stringify({ status: 'posted', seq: msg.seq, message: msg }, null, 2),
        stderr: '',
        exitCode: 0,
        durationMs: Date.now() - startMs,
      };
    } catch (err: any) {
      return {
        stdout: '',
        stderr: err?.message || String(err),
        exitCode: 1,
        durationMs: Date.now() - startMs,
      };
    }
  },
};

export const readBoardTool: { name: string; execute: BuiltinToolHandler } = {
  name: 'read_board',
  execute: async (args, ctx) => {
    const startMs = Date.now();
    try {
      const mgr = SwarmManager.getInstance();
      const reader = ctx.swarmAgentName || 'coordinator';
      const res = mgr.readBoard(ctx.threadId, reader, {
        since: args.since !== undefined ? Number(args.since) : undefined,
        limit: args.limit !== undefined ? Number(args.limit) : undefined,
        seqs: Array.isArray(args.seqs) ? args.seqs.map(Number) : undefined,
        channel: args.channel ? String(args.channel) : undefined,
      });
      return {
        stdout: JSON.stringify(res, null, 2),
        stderr: '',
        exitCode: 0,
        durationMs: Date.now() - startMs,
      };
    } catch (err: any) {
      return {
        stdout: '',
        stderr: err?.message || String(err),
        exitCode: 1,
        durationMs: Date.now() - startMs,
      };
    }
  },
};

export const swarmWaitTool: { name: string; execute: BuiltinToolHandler } = {
  name: 'swarm_wait',
  execute: async (args, ctx) => {
    const startMs = Date.now();
    try {
      const mgr = SwarmManager.getInstance();
      const agent = ctx.swarmAgentName || 'coordinator';
      const since = Number(args.since ?? 0);
      const mentionsOnly = args.mentions_only !== undefined ? Boolean(args.mentions_only) : true;
      const res = mgr.waitBoard(ctx.threadId, agent, since, mentionsOnly);
      return {
        stdout: JSON.stringify(res, null, 2),
        stderr: '',
        exitCode: 0,
        durationMs: Date.now() - startMs,
      };
    } catch (err: any) {
      return {
        stdout: '',
        stderr: err?.message || String(err),
        exitCode: 1,
        durationMs: Date.now() - startMs,
      };
    }
  },
};
