import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string; // For SSE transport
  transport?: 'stdio' | 'sse';
  enabled?: boolean;
}

export interface McpToolDefinition {
  name: string;
  serverName: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface McpServerStatus {
  name: string;
  transport: 'stdio' | 'sse';
  command: string;
  args: string[];
  enabled: boolean;
  status: 'connected' | 'ready' | 'disabled' | 'error';
  toolsCount: number;
  tools: McpToolDefinition[];
  lastCheckedAt: string;
}

export class McpClientManager {
  private configPath: string;
  private servers = new Map<string, McpServerStatus>();

  constructor(repoRoot: string) {
    this.configPath = path.join(repoRoot, 'mcp_config.json');
    this.loadConfig();
  }

  public loadConfig(): McpServerStatus[] {
    this.servers.clear();
    if (!fs.existsSync(this.configPath)) {
      return [];
    }

    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      const mcpServers: Record<string, McpServerConfig> = raw.mcpServers || {};

      for (const [name, cfg] of Object.entries(mcpServers)) {
        const transport: 'stdio' | 'sse' = cfg.url ? 'sse' : cfg.transport || 'stdio';
        const enabled = cfg.enabled !== false;
        const defaultTools = this.getDefaultToolsForServer(name);

        this.servers.set(name, {
          name,
          transport,
          command: cfg.command || cfg.url || '',
          args: cfg.args || [],
          enabled,
          status: enabled ? 'ready' : 'disabled',
          toolsCount: defaultTools.length,
          tools: defaultTools,
          lastCheckedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Failed to parse mcp_config.json:', err);
    }

    return this.listServers();
  }

  private getDefaultToolsForServer(serverName: string): McpToolDefinition[] {
    if (serverName.includes('fetch')) {
      return [
        {
          name: 'mcp_fetch_url',
          serverName,
          description: 'Fetch a URL and extract its contents as markdown via MCP fetch server.',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to fetch' },
              max_length: { type: 'number', description: 'Maximum length of returned content' },
            },
            required: ['url'],
          },
        },
      ];
    }
    if (serverName.includes('filesystem')) {
      return [
        {
          name: 'mcp_fs_read_file',
          serverName,
          description: 'Read complete contents of a file via MCP filesystem server.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path to read' },
            },
            required: ['path'],
          },
        },
        {
          name: 'mcp_fs_list_directory',
          serverName,
          description: 'List directory contents via MCP filesystem server.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Directory path' },
            },
            required: ['path'],
          },
        },
      ];
    }
    return [
      {
        name: `mcp_${serverName.replace(/[^a-zA-Z0-9_]/g, '_')}_invoke`,
        serverName,
        description: `Invoke tool on MCP server ${serverName}`,
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            payload: { type: 'object' },
          },
        },
      },
    ];
  }

  /**
   * Probes stdio MCP server via JSON-RPC `initialize` + `tools/list` with a short non-blocking timeout.
   */
  public async discoverServerTools(serverName: string): Promise<McpToolDefinition[]> {
    const srv = this.servers.get(serverName);
    if (!srv || !srv.enabled) return [];

    if (srv.transport === 'stdio' && srv.command) {
      try {
        const discovered = await this.probeStdioServer(srv.command, srv.args, serverName, 2500);
        if (discovered.length > 0) {
          srv.tools = discovered;
          srv.toolsCount = discovered.length;
          srv.status = 'connected';
          srv.lastCheckedAt = new Date().toISOString();
          return discovered;
        }
      } catch {
        // Keep fallback schema definitions if binary isn't cached yet
      }
    }

    srv.status = 'ready';
    srv.lastCheckedAt = new Date().toISOString();
    return srv.tools;
  }

  private probeStdioServer(
    command: string,
    args: string[],
    serverName: string,
    timeoutMs: number
  ): Promise<McpToolDefinition[]> {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (tools: McpToolDefinition[]) => {
        if (!resolved) {
          resolved = true;
          resolve(tools);
        }
      };

      const child = spawn(command, args, {
        shell: process.platform === 'win32',
        stdio: ['pipe', 'pipe', 'ignore'],
      });

      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        done([]);
      }, timeoutMs);

      let stdoutBuf = '';
      child.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() || '';
        for (const line of lines) {
          try {
            const msg = JSON.parse(line.trim());
            if (msg.id === 1 && msg.result) {
              // Send tools/list
              child.stdin.write(
                JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n'
              );
            } else if (msg.id === 2 && msg.result?.tools) {
              clearTimeout(timer);
              const tools: McpToolDefinition[] = msg.result.tools.map((t: any) => ({
                name: t.name,
                serverName,
                description: t.description || '',
                inputSchema: t.inputSchema || { type: 'object', properties: {} },
              }));
              try {
                child.kill();
              } catch {}
              done(tools);
            }
          } catch {}
        }
      });

      child.on('error', () => {
        clearTimeout(timer);
        done([]);
      });

      // Send MCP initialize
      try {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'LocalGravity', version: '2.0.0' },
            },
          }) + '\n'
        );
      } catch {
        clearTimeout(timer);
        done([]);
      }
    });
  }

  public toggleServer(serverName: string, enabled?: boolean): McpServerStatus | undefined {
    const srv = this.servers.get(serverName);
    if (!srv) return undefined;
    srv.enabled = enabled !== undefined ? enabled : !srv.enabled;
    srv.status = srv.enabled ? 'ready' : 'disabled';
    srv.lastCheckedAt = new Date().toISOString();
    return srv;
  }

  public listServers(): McpServerStatus[] {
    return Array.from(this.servers.values());
  }

  public listActiveTools(): McpToolDefinition[] {
    const tools: McpToolDefinition[] = [];
    for (const srv of this.servers.values()) {
      if (srv.enabled) {
        tools.push(...srv.tools);
      }
    }
    return tools;
  }
}
