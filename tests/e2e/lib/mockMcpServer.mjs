import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const SERVER_SCRIPT_TEMPLATE = `import fs from 'node:fs';
import readline from 'node:readline';

const controlPath = process.env.MOCK_MCP_CONTROL;
const logPath = process.env.MOCK_MCP_LOG;
const initialConfig = process.env.MOCK_MCP_CONFIG ? JSON.parse(process.env.MOCK_MCP_CONFIG) : {};

function appendLog(entry) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, JSON.stringify({ ts: Date.now(), pid: process.pid, ...entry }) + '\\n', 'utf-8');
  } catch {}
}

function readState() {
  let state = { ...initialConfig };
  if (controlPath && fs.existsSync(controlPath)) {
    try {
      const disk = JSON.parse(fs.readFileSync(controlPath, 'utf-8'));
      state = { ...state, ...disk };
    } catch {}
  }
  return state;
}

function sendJson(obj) {
  const line = JSON.stringify(obj);
  appendLog({ event: 'stdout_rpc', msg: obj });
  process.stdout.write(line + '\\n');
}

function writeStderrBytes(bytes) {
  if (!bytes || bytes <= 0) return;
  const chunk = 'E'.repeat(Math.min(bytes, 65536));
  let remaining = bytes;
  while (remaining > 0) {
    const slice = remaining >= chunk.length ? chunk : 'E'.repeat(remaining);
    process.stderr.write(slice + '\\n');
    remaining -= slice.length;
  }
  appendLog({ event: 'stderr_burst', bytes });
}

const bootState = readState();
appendLog({ event: 'spawn', serverName: bootState.serverName || 'mock-mcp' });

if (typeof bootState.stderrBurstOnStartBytes === 'number' && bootState.stderrBurstOnStartBytes > 0) {
  writeStderrBytes(bootState.stderrBurstOnStartBytes);
}

let lastListChangedSeq = Number(bootState.listChangedSeq || 0);
const pollTimer = setInterval(() => {
  const st = readState();
  const nextSeq = Number(st.listChangedSeq || 0);
  if (nextSeq > lastListChangedSeq) {
    lastListChangedSeq = nextSeq;
    sendJson({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} });
  }
}, 50);
if (typeof pollTimer.unref === 'function') pollTimer.unref();

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (rawLine) => {
  const trimmed = rawLine.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    appendLog({ event: 'stdin_parse_error', raw: trimmed, error: String(err) });
    return;
  }

  appendLog({ event: 'stdin_rpc', msg });
  const state = readState();
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};

  if (method === 'initialize') {
    if (state.hangOnInit) {
      appendLog({ event: 'hang_on_init', id });
      return;
    }
    if (typeof state.initDelayMs === 'number' && state.initDelayMs > 0) {
      await new Promise((r) => setTimeout(r, state.initDelayMs));
    }
    if (state.initError) {
      sendJson({
        jsonrpc: '2.0',
        id,
        error: {
          code: state.initError.code ?? -32000,
          message: state.initError.message ?? 'Mock MCP initialization failed',
        },
      });
      return;
    }
    const result = {
      protocolVersion: state.protocolVersion || '2024-11-05',
      capabilities: {
        tools: { listChanged: true },
      },
      serverInfo: {
        name: state.serverName || 'mock-mcp',
        version: '1.0.0',
      },
    };
    if (typeof state.instructions === 'string') {
      result.instructions = state.instructions;
    }
    sendJson({ jsonrpc: '2.0', id, result });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'ping') {
    if (id !== undefined) sendJson({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    if (typeof state.toolsListDelayMs === 'number' && state.toolsListDelayMs > 0) {
      await new Promise((r) => setTimeout(r, state.toolsListDelayMs));
    }
    const tools = Array.isArray(state.tools) && state.tools.length > 0
      ? state.tools
      : [
          {
            name: 'echo',
            description: 'Echo back arguments for verification',
            inputSchema: {
              type: 'object',
              properties: { message: { type: 'string' } },
            },
          },
        ];
    sendJson({ jsonrpc: '2.0', id, result: { tools } });
    return;
  }

  if (method === 'tools/call') {
    const toolName = String(params.name || '');
    const args = params.arguments || {};
    const rules = state.toolRules || {};
    const rule = rules[toolName] || {};

    const stderrBytes = typeof rule.stderrBytes === 'number'
      ? rule.stderrBytes
      : Number(state.stderrPerCallBytes || 0);
    if (stderrBytes > 0) {
      writeStderrBytes(stderrBytes);
    }

    if (typeof rule.crashAfterMs === 'number') {
      setTimeout(() => {
        appendLog({ event: 'crash_exit', toolName, exitCode: rule.exitCode ?? 1 });
        process.exit(rule.exitCode ?? 1);
      }, rule.crashAfterMs);
    }

    if (typeof rule.exitCode === 'number' && typeof rule.crashAfterMs !== 'number') {
      appendLog({ event: 'exit_on_call', toolName, exitCode: rule.exitCode });
      process.exit(rule.exitCode);
    }

    if (rule.hang) {
      appendLog({ event: 'hang_on_call', id, toolName });
      return;
    }

    if (typeof rule.delayMs === 'number' && rule.delayMs > 0) {
      await new Promise((r) => setTimeout(r, rule.delayMs));
    }

    if (rule.rpcError) {
      sendJson({
        jsonrpc: '2.0',
        id,
        error: {
          code: rule.rpcError.code ?? -32603,
          message: rule.rpcError.message ?? 'Mock tool RPC error',
        },
      });
      return;
    }

    if (Array.isArray(rule.updateTools)) {
      const nextState = { ...state, tools: rule.updateTools, listChangedSeq: Number(state.listChangedSeq || 0) + 1 };
      if (controlPath) {
        fs.writeFileSync(controlPath, JSON.stringify(nextState, null, 2), 'utf-8');
      }
      lastListChangedSeq = nextState.listChangedSeq;
      sendJson({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} });
    } else if (rule.emitListChanged) {
      sendJson({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} });
    }

    let content = Array.isArray(rule.content) ? rule.content : null;
    if (!content) {
      content = [];
      if (rule.returnImageBase64) {
        content.push({
          type: 'image',
          data: typeof rule.returnImageBase64 === 'string'
            ? rule.returnImageBase64
            : '${DEFAULT_1X1_PNG_BASE64}',
          mimeType: rule.imageMimeType || 'image/png',
        });
      }
      if (rule.responseText !== undefined || !rule.returnImageBase64) {
        const text =
          rule.responseText !== undefined
            ? String(rule.responseText)
            : JSON.stringify({ tool: toolName, args, pid: process.pid });
        content.push({ type: 'text', text });
      }
    }

    sendJson({
      jsonrpc: '2.0',
      id,
      result: {
        content,
        isError: Boolean(rule.isError),
      },
    });
    return;
  }

  if (id !== undefined) {
    sendJson({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found: ' + method },
    });
  }
});

process.on('SIGTERM', () => {
  appendLog({ event: 'sigterm' });
  process.exit(0);
});

process.on('exit', (code) => {
  appendLog({ event: 'exit', code });
});
`;

export function createMockMcpServerFixture(tempDir, options = {}) {
  fs.mkdirSync(tempDir, { recursive: true });
  const serverName = options.serverName || `mock_mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const scriptPath = path.join(tempDir, `${serverName}.mjs`);
  const logPath = path.join(tempDir, `${serverName}.log.jsonl`);
  const controlPath = path.join(tempDir, `${serverName}.control.json`);

  const initialState = {
    serverName,
    protocolVersion: options.protocolVersion || '2024-11-05',
    instructions: options.instructions,
    initDelayMs: options.initDelayMs ?? 0,
    initError: options.initError ?? null,
    hangOnInit: Boolean(options.hangOnInit),
    toolsListDelayMs: options.toolsListDelayMs ?? 0,
    stderrBurstOnStartBytes: options.stderrBurstOnStartBytes ?? 0,
    stderrPerCallBytes: options.stderrPerCallBytes ?? 0,
    listChangedSeq: 0,
    tools: options.tools || [
      {
        name: 'echo',
        description: 'Echo arguments for mock MCP testing',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    ],
    toolRules: options.toolRules || {},
  };

  fs.writeFileSync(scriptPath, SERVER_SCRIPT_TEMPLATE, 'utf-8');
  fs.writeFileSync(controlPath, JSON.stringify(initialState, null, 2), 'utf-8');
  fs.writeFileSync(logPath, '', 'utf-8');

  const mcpConfigEntry = {
    command: process.execPath,
    args: [scriptPath],
    env: {
      MOCK_MCP_CONTROL: controlPath,
      MOCK_MCP_LOG: logPath,
      MOCK_MCP_CONFIG: JSON.stringify(initialState),
    },
    transport: 'stdio',
    enabled: options.enabled !== false,
  };

  function readRpcLog() {
    if (!fs.existsSync(logPath)) return [];
    const lines = fs
      .readFileSync(logPath, 'utf-8')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const parsed = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {}
    }
    return parsed;
  }

  function updateState(patch) {
    let current = initialState;
    if (fs.existsSync(controlPath)) {
      try {
        current = JSON.parse(fs.readFileSync(controlPath, 'utf-8'));
      } catch {}
    }
    const next = { ...current, ...patch };
    if (patch.emitListChanged) {
      next.listChangedSeq = Number(current.listChangedSeq || 0) + 1;
      delete next.emitListChanged;
    }
    fs.writeFileSync(controlPath, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  }

  function writeMcpConfig(targetPath, extraServers = {}) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const config = {
      mcpServers: {
        [serverName]: mcpConfigEntry,
        ...extraServers,
      },
    };
    fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');
    return targetPath;
  }

  async function close() {
    const entries = readRpcLog();
    const spawnedPids = new Set(entries.map((e) => e.pid).filter((p) => Number.isInteger(p) && p > 0));
    const exitedPids = new Set(
      entries.filter((e) => e.event === 'exit').map((e) => e.pid)
    );
    for (const pid of spawnedPids) {
      if (exitedPids.has(pid)) continue;
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
  }

  return {
    serverName,
    scriptPath,
    logPath,
    controlPath,
    mcpConfigEntry,
    writeMcpConfig,
    readRpcLog,
    updateState,
    close,
  };
}
