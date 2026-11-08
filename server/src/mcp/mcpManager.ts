import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string; // For SSE/HTTP transport
  transport?: 'stdio' | 'sse' | 'http';
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
  transport: 'stdio' | 'sse' | 'http';
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  status: 'connected' | 'ready' | 'disabled' | 'error';
  toolsCount: number;
  tools: McpToolDefinition[];
  lastCheckedAt: string;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
  outputText: string;
}

export class McpClientManager {
  private localConfigPath: string;
  private globalConfigPath: string;
  private servers = new Map<string, McpServerStatus>();

  constructor(repoRoot: string) {
    this.localConfigPath = path.join(repoRoot, 'mcp_config.json');
    this.globalConfigPath = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
    this.loadConfig();
  }

  /**
   * Loads and merges MCP configurations from both workspace and global Antigravity config.
   */
  public loadConfig(): McpServerStatus[] {
    this.servers.clear();

    const configsToLoad = [
      { path: this.globalConfigPath, source: 'global' },
      { path: this.localConfigPath, source: 'local' },
    ];

    for (const src of configsToLoad) {
      if (!fs.existsSync(src.path)) continue;

      try {
        const raw = JSON.parse(fs.readFileSync(src.path, 'utf-8'));
        const mcpServers: Record<string, McpServerConfig> = raw.mcpServers || {};

        for (const [name, cfg] of Object.entries(mcpServers)) {
          const transport: 'stdio' | 'sse' | 'http' = cfg.url ? 'sse' : cfg.transport || 'stdio';
          const enabled = cfg.enabled !== false;
          const defaultTools = this.getDefaultToolsForServer(name);

          this.servers.set(name, {
            name,
            transport,
            command: cfg.command || cfg.url || '',
            args: cfg.args || [],
            env: cfg.env,
            enabled,
            status: enabled ? 'ready' : 'disabled',
            toolsCount: defaultTools.length,
            tools: defaultTools,
            lastCheckedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error(`[McpClientManager] Failed to parse ${src.path}:`, err);
      }
    }

    return this.listServers();
  }

  private getDefaultToolsForServer(serverName: string): McpToolDefinition[] {
    if (serverName.includes('puppeteer') || serverName.includes('playwright')) {
      return [
        {
          name: 'puppeteer_navigate',
          serverName,
          description: 'Navigate headless browser to a URL.',
          inputSchema: {
            type: 'object',
            properties: { url: { type: 'string', description: 'Target URL' } },
            required: ['url'],
          },
        },
        {
          name: 'puppeteer_screenshot',
          serverName,
          description: 'Capture screenshot of current browser viewport.',
          inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' }, selector: { type: 'string' } },
          },
        },
        {
          name: 'puppeteer_click',
          serverName,
          description: 'Click an element matching selector.',
          inputSchema: {
            type: 'object',
            properties: { selector: { type: 'string' } },
            required: ['selector'],
          },
        },
        {
          name: 'puppeteer_fill',
          serverName,
          description: 'Fill an input element.',
          inputSchema: {
            type: 'object',
            properties: { selector: { type: 'string' }, value: { type: 'string' } },
            required: ['selector', 'value'],
          },
        },
        {
          name: 'puppeteer_evaluate',
          serverName,
          description: 'Execute JavaScript code in browser console context.',
          inputSchema: {
            type: 'object',
            properties: { script: { type: 'string' } },
            required: ['script'],
          },
        },
      ];
    }

    if (serverName.includes('comfy')) {
      return [
        {
          name: 'run_workflow',
          serverName,
          description: 'Run a ComfyUI workflow JSON graph.',
          inputSchema: {
            type: 'object',
            properties: { workflow: { type: 'object' }, prompt: { type: 'string' } },
          },
        },
        {
          name: 'generate_image',
          serverName,
          description: 'Generate an image with ComfyUI using text prompt.',
          inputSchema: {
            type: 'object',
            properties: { prompt: { type: 'string' }, negative_prompt: { type: 'string' } },
            required: ['prompt'],
          },
        },
        {
          name: 'fetch_outputs',
          serverName,
          description: 'Fetch generated image outputs from ComfyUI.',
          inputSchema: {
            type: 'object',
            properties: { prompt_id: { type: 'string' } },
          },
        },
        {
          name: 'system_stats',
          serverName,
          description: 'Get live ComfyUI GPU/VRAM and system stats.',
          inputSchema: { type: 'object', properties: {} },
        },
      ];
    }

    if (serverName.includes('memory')) {
      return [
        {
          name: 'create_entities',
          serverName,
          description: 'Create multiple new entities in the knowledge graph.',
          inputSchema: {
            type: 'object',
            properties: { entities: { type: 'array', items: { type: 'object' } } },
            required: ['entities'],
          },
        },
        {
          name: 'create_relations',
          serverName,
          description: 'Create relations between entities in the knowledge graph.',
          inputSchema: {
            type: 'object',
            properties: { relations: { type: 'array', items: { type: 'object' } } },
            required: ['relations'],
          },
        },
        {
          name: 'add_observations',
          serverName,
          description: 'Add new observations to existing entities in the knowledge graph.',
          inputSchema: {
            type: 'object',
            properties: {
              entityName: { type: 'string' },
              contents: { type: 'array', items: { type: 'string' } },
            },
            required: ['entityName', 'contents'],
          },
        },
        {
          name: 'read_graph',
          serverName,
          description: 'Read the complete knowledge graph.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'search_nodes',
          serverName,
          description: 'Search the knowledge graph for entities matching query.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
        {
          name: 'open_nodes',
          serverName,
          description: 'Retrieve specific entities by exact name.',
          inputSchema: {
            type: 'object',
            properties: { names: { type: 'array', items: { type: 'string' } } },
            required: ['names'],
          },
        },
      ];
    }

    if (serverName.includes('fetch')) {
      return [
        {
          name: 'fetch',
          serverName,
          description: 'Fetch a web page and convert its content to clean markdown.',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to fetch' },
              max_length: { type: 'number', description: 'Max characters to return' },
              start_index: { type: 'number' },
            },
            required: ['url'],
          },
        },
      ];
    }

    if (serverName.includes('sqlite')) {
      return [
        {
          name: 'read_query',
          serverName,
          description: 'Execute a SELECT SQL query against SQLite database.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
        {
          name: 'list_tables',
          serverName,
          description: 'List all tables in SQLite database.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'describe_table',
          serverName,
          description: 'Get schema for a table in SQLite database.',
          inputSchema: {
            type: 'object',
            properties: { table_name: { type: 'string' } },
            required: ['table_name'],
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
   * Executes an MCP tool via live JSON-RPC 2.0 `tools/call`.
   */
  public async callMcpTool(
    serverName: string,
    toolName: string,
    toolArgs: Record<string, any>,
    timeoutMs = 30000
  ): Promise<McpToolCallResult> {
    let srv = this.servers.get(serverName);

    // If exact name didn't match, attempt fuzzy lookup
    if (!srv) {
      for (const [k, v] of this.servers.entries()) {
        if (k.toLowerCase() === serverName.toLowerCase() || serverName.includes(k) || k.includes(serverName)) {
          srv = v;
          break;
        }
      }
    }

    if (!srv) {
      return {
        content: [],
        isError: true,
        outputText: `Error: MCP server "${serverName}" is not configured in mcp_config.json. Available: ${Array.from(this.servers.keys()).join(', ')}`,
      };
    }

    if (!srv.enabled) {
      return {
        content: [],
        isError: true,
        outputText: `Error: MCP server "${serverName}" is currently disabled. Toggle it in Settings or via /api/mcp/toggle.`,
      };
    }

    // Strip mcp_<serverName>_ prefix if present
    const cleanToolName = toolName
      .replace(new RegExp(`^mcp_${srv.name}_`, 'i'), '')
      .replace(/^mcp_/, '');

    if (srv.transport === 'stdio' && srv.command) {
      return this.executeStdioToolCall(srv, cleanToolName, toolArgs, timeoutMs);
    }

    return {
      content: [],
      isError: true,
      outputText: `Transport ${srv.transport} for ${serverName} is not yet supported.`,
    };
  }

  private executeStdioToolCall(
    srv: McpServerStatus,
    toolName: string,
    toolArgs: Record<string, any>,
    timeoutMs: number
  ): Promise<McpToolCallResult> {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = (res: McpToolCallResult) => {
        if (!resolved) {
          resolved = true;
          resolve(res);
        }
      };

      const env = {
        ...process.env,
        ...(srv.env || {}),
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      };

      // Handle Windows binary execution with spaces and .cmd/.bat scripts
      let cmd = srv.command;
      let args = [...srv.args];
      const isCmdOrBat = cmd.endsWith('.cmd') || cmd.endsWith('.bat');
      const useShell = process.platform === 'win32' && isCmdOrBat;
      if (useShell && cmd.includes(' ')) {
        cmd = `"${cmd}"`;
      }

      const child = spawn(cmd, args, {
        shell: useShell,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        finish({
          content: [],
          isError: true,
          outputText: `MCP tool execution timed out after ${timeoutMs}ms for ${srv.name}:${toolName}`,
        });
      }, timeoutMs);

      let stdoutBuf = '';
      let stderrBuf = '';

      child.stderr.on('data', (d) => {
        stderrBuf += d.toString();
      });

      child.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.id === 1 && msg.result) {
              // Initialized! Send tools/call
              child.stdin.write(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: 2,
                  method: 'tools/call',
                  params: {
                    name: toolName,
                    arguments: toolArgs || {},
                  },
                }) + '\n'
              );
            } else if (msg.id === 2) {
              clearTimeout(timer);
              try {
                child.kill();
              } catch {}

              if (msg.error) {
                finish({
                  content: [],
                  isError: true,
                  outputText: `MCP Error (${msg.error.code}): ${msg.error.message}`,
                });
                return;
              }

              const result = msg.result || {};
              const contentList = Array.isArray(result.content) ? result.content : [];
              let combinedText = contentList
                .map((c: any) => c.text || JSON.stringify(c))
                .join('\n');

              if (!combinedText && result) {
                combinedText = JSON.stringify(result, null, 2);
              }

              finish({
                content: contentList,
                isError: result.isError || false,
                outputText: combinedText,
              });
              return;
            }
          } catch {}
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        finish({
          content: [],
          isError: true,
          outputText: `Failed to spawn MCP server ${srv.name}: ${err.message}`,
        });
      });

      // Send JSON-RPC initialize
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
      } catch (err: any) {
        clearTimeout(timer);
        finish({
          content: [],
          isError: true,
          outputText: `Failed to write initialize to MCP server: ${err?.message}`,
        });
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

  /**
   * Formats active MCP tools into OpenAI function schema so the LLM can call them directly.
   */
  public exportOpenAiTools(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, any> };
  }> {
    const out: Array<{
      type: 'function';
      function: { name: string; description: string; parameters: Record<string, any> };
    }> = [];

    // 1. Add direct tool entries for each active MCP server
    for (const srv of this.servers.values()) {
      if (!srv.enabled) continue;
      for (const t of srv.tools) {
        const canonicalName = t.name.startsWith('mcp_') ? t.name : `mcp_${srv.name}_${t.name}`;
        out.push({
          type: 'function',
          function: {
            name: canonicalName,
            description: `[MCP: ${srv.name}] ${t.description}`,
            parameters: t.inputSchema || { type: 'object', properties: {} },
          },
        });
      }
    }

    // 2. Add universal lazy call_mcp_tool meta-tool (matches Antigravity!)
    out.push({
      type: 'function',
      function: {
        name: 'call_mcp_tool',
        description:
          'Universal MCP invocation tool (Antigravity standard). Call any tool from an active MCP server.',
        parameters: {
          type: 'object',
          properties: {
            ServerName: {
              type: 'string',
              description: `Name of the MCP server. Available: ${Array.from(this.servers.keys()).join(', ')}`,
            },
            ToolName: {
              type: 'string',
              description: 'Name of the tool to call on that server.',
            },
            Arguments: {
              type: 'object',
              description: 'Arguments to pass to the MCP tool.',
            },
          },
          required: ['ServerName', 'ToolName', 'Arguments'],
        },
      },
    });

    return out;
  }
}
