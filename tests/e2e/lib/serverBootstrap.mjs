import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FORBIDDEN_PORTS, REPO_ROOT } from './harness.mjs';

const __filename = fileURLToPath(import.meta.url);

function installFetchMockShim(mockLlmUrl) {
  const normalizedMock = mockLlmUrl.replace(/\/+$/, '');
  const mockOrigin = new URL(normalizedMock).origin;
  const originalFetch = globalThis.fetch.bind(globalThis);
  const allowLocalServices = process.env.LG_TEST_ALLOW_LOCAL_SERVICES === '1';

  const classifyUrl = (rawUrl) => {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { action: 'pass', url: rawUrl };
    }

    const isLocalHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';

    if (isLocalHost && parsed.port === '8080') {
      return {
        action: 'rewrite',
        url: `${mockOrigin}${parsed.pathname}${parsed.search}`,
      };
    }

    if (parsed.hostname === 'generativelanguage.googleapis.com') {
      return {
        action: 'rewrite',
        url: `${mockOrigin}${parsed.pathname}${parsed.search}`,
      };
    }

    if (!allowLocalServices && isLocalHost && (parsed.port === '8188' || parsed.port === '11434')) {
      return {
        action: 'block',
        url: rawUrl,
      };
    }

    return { action: 'pass', url: rawUrl };
  };

  globalThis.fetch = async (input, init) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input?.url;

    if (typeof rawUrl === 'string') {
      const decision = classifyUrl(rawUrl);
      if (decision.action === 'block') {
        throw new TypeError(`Blocked local service fetch in isolated E2E test: ${rawUrl}`);
      }
      if (decision.action === 'rewrite') {
        if (typeof input === 'string' || input instanceof URL) {
          return originalFetch(decision.url, init);
        }
        const cloned = new Request(decision.url, input);
        return originalFetch(cloned, init);
      }
    }

    return originalFetch(input, init);
  };
}

export async function runBootstrapServer() {
  const repoRoot = process.env.LG_TEST_REPO_ROOT || REPO_ROOT;
  const dbPath = process.env.LG_TEST_DB_PATH;
  const mockLlmUrl = process.env.LG_TEST_MOCK_LLM_URL;

  if (mockLlmUrl) {
    installFetchMockShim(mockLlmUrl);
  }

  const distIndexUrl = pathToFileURL(path.join(repoRoot, 'server', 'dist', 'index.js')).href;
  const { createDaemonServer } = await import(distIndexUrl);

  const ctx = await createDaemonServer({
    dbPath,
    isolated: true,
  });

  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = ctx.app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  if (!port || FORBIDDEN_PORTS.has(port)) {
    throw new Error(`Bootstrap server bound invalid or forbidden port: ${port}`);
  }

  ctx.ports.daemonPort = port;
  ctx.ports.localUrl = `http://localhost:${port}`;
  ctx.ports.wsSyncUrl = `ws://127.0.0.1:${port}/ws/sync`;

  let shuttingDown = false;
  const gracefulExit = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await ctx.app.close();
    } catch {}
    try {
      ctx.terminal.dispose();
    } catch {}
    try {
      ctx.db.close();
    } catch {}
    process.exit(0);
  };

  process.on('SIGTERM', () => void gracefulExit());
  process.on('SIGINT', () => void gracefulExit());
  process.on('message', (msg) => {
    if (msg === 'shutdown') void gracefulExit();
  });

  process.stdout.write(`READY_JSON:${JSON.stringify({ port, dbPath })}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename)
) {
  runBootstrapServer().catch((err) => {
    console.error('Bootstrap server fatal error:', err);
    process.exit(1);
  });
}
