import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import type { BuiltinToolResult } from '../tools/builtinTools.js';

export interface EdgeClientInfo {
  clientId: string;
  hostname: string;
  platform: string;
  homeDir?: string;
  socket: WebSocket;
  connectedAt: number;
}

interface PendingRequest {
  resolve: (result: BuiltinToolResult) => void;
  timeout: NodeJS.Timeout;
  startedAt: number;
}

const HOST_TOOLS = new Set([
  'read_file',
  'write_file',
  'apply_diff',
  'list_directory',
  'find_files',
  'search_codebase',
  'manage_files',
  'run_terminal',
  'inspect_file_metadata',
]);

export class EdgeBridgeManager {
  private static instance: EdgeBridgeManager | null = null;
  private clients = new Map<string, EdgeClientInfo>();
  private socketToClientId = new Map<WebSocket, string>();
  private threadToClientId = new Map<string, string>();
  private pending = new Map<string, PendingRequest>();

  public static getInstance(): EdgeBridgeManager {
    if (!EdgeBridgeManager.instance) {
      EdgeBridgeManager.instance = new EdgeBridgeManager();
    }
    return EdgeBridgeManager.instance;
  }

  public isHostTool(toolName: string): boolean {
    return HOST_TOOLS.has(toolName);
  }

  public registerClient(
    clientId: string,
    socket: WebSocket,
    info: { hostname: string; platform: string; homeDir?: string }
  ): EdgeClientInfo {
    const record: EdgeClientInfo = {
      clientId,
      hostname: info.hostname || 'unknown-host',
      platform: info.platform || 'unknown',
      homeDir: info.homeDir,
      socket,
      connectedAt: Date.now(),
    };
    this.clients.set(clientId, record);
    this.socketToClientId.set(socket, clientId);
    console.log(`[EdgeBridge] Registered client "${clientId}" (${record.hostname} / ${record.platform})`);
    return record;
  }

  public unregisterSocket(socket: WebSocket): void {
    const clientId = this.socketToClientId.get(socket);
    if (!clientId) return;
    this.socketToClientId.delete(socket);
    const current = this.clients.get(clientId);
    if (current && current.socket === socket) {
      this.clients.delete(clientId);
      console.log(`[EdgeBridge] Disconnected client "${clientId}" (${current.hostname})`);
    }
  }

  public bindThread(threadId: string, clientId?: string): void {
    if (!threadId || !clientId) return;
    if (this.clients.has(clientId)) {
      this.threadToClientId.set(threadId, clientId);
    }
  }

  public getBrainHostname(): string {
    return os.hostname();
  }

  public isRemoteHost(hostName?: string): boolean {
    if (!hostName || !hostName.trim()) return false;
    return hostName.trim().toLowerCase() !== os.hostname().toLowerCase();
  }

  public getClientByHost(hostName: string): EdgeClientInfo | null {
    const target = hostName.trim().toLowerCase();
    if (!target || target === os.hostname().toLowerCase()) return null;
    for (const client of this.clients.values()) {
      if (client.hostname.trim().toLowerCase() === target) {
        return client;
      }
    }
    return null;
  }

  public getRemoteClientForThread(threadId: string): EdgeClientInfo | null {
    const clientId = this.threadToClientId.get(threadId);
    if (!clientId) return null;
    const client = this.clients.get(clientId);
    if (!client) return null;
    // If client is on a different machine than Central Brain, route host tools to it.
    if (client.hostname.toLowerCase() !== os.hostname().toLowerCase()) {
      return client;
    }
    return null;
  }

  public listClients(): Array<Omit<EdgeClientInfo, 'socket'>> {
    return Array.from(this.clients.values()).map(({ socket: _s, ...rest }) => rest);
  }

  public handleToolResult(payload: {
    request_id?: string;
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    duration_ms?: number;
  }): boolean {
    const reqId = payload?.request_id;
    if (!reqId) return false;
    const entry = this.pending.get(reqId);
    if (!entry) return false;
    clearTimeout(entry.timeout);
    this.pending.delete(reqId);
    entry.resolve({
      stdout: String(payload.stdout ?? ''),
      stderr: String(payload.stderr ?? ''),
      exitCode: typeof payload.exit_code === 'number' ? payload.exit_code : 0,
      durationMs:
        typeof payload.duration_ms === 'number' ? payload.duration_ms : Date.now() - entry.startedAt,
    });
    return true;
  }

  public async executeRemoteTool(
    client: EdgeClientInfo,
    toolName: string,
    args: Record<string, any>,
    workspaceRoot: string,
    abortSignal?: AbortSignal,
    timeoutMs = 120_000
  ): Promise<BuiltinToolResult> {
    if (abortSignal?.aborted) {
      return {
        stdout: '',
        stderr: 'Tool execution aborted by user.',
        exitCode: 130,
        durationMs: 0,
      };
    }

    const requestId = `edge-${randomUUID()}`;
    const startedAt = Date.now();

    return new Promise<BuiltinToolResult>((resolve) => {
      const onAbort = () => {
        const entry = this.pending.get(requestId);
        if (entry) {
          clearTimeout(entry.timeout);
          this.pending.delete(requestId);
        }
        resolve({
          stdout: '',
          stderr: 'Tool execution aborted by user.',
          exitCode: 130,
          durationMs: Date.now() - startedAt,
        });
      };

      if (abortSignal) {
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        resolve({
          stdout: '',
          stderr: `Remote host (${client.hostname}) timed out after ${Math.round(timeoutMs / 1000)}s executing ${toolName}.`,
          exitCode: 124,
          durationMs: Date.now() - startedAt,
        });
      }, timeoutMs);

      this.pending.set(requestId, {
        startedAt,
        timeout,
        resolve: (res) => {
          if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
          resolve(res);
        },
      });

      try {
        client.socket.send(
          JSON.stringify({
            type: 'EDGE_TOOL_REQUEST',
            payload: {
              request_id: requestId,
              tool_name: toolName,
              args,
              workspace_root: workspaceRoot,
            },
          })
        );
      } catch (err: any) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        resolve({
          stdout: '',
          stderr: `Failed to dispatch ${toolName} to remote host ${client.hostname}: ${err?.message || String(err)}`,
          exitCode: 1,
          durationMs: Date.now() - startedAt,
        });
      }
    });
  }
}
