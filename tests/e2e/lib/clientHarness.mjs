import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  CLIENT_DIR,
  delay,
  FORBIDDEN_PORTS,
  killProcessTree,
  removeDirSafe,
  REPO_ROOT,
  reqClient,
  requireFromClient,
  requireFromServer,
  SERVER_DIR,
  SHARED_DIR,
  TESTS_E2E_DIR,
} from './harness.mjs';

const CLIENT_SRC_DIR = path.join(CLIENT_DIR, 'src');
const CLIENT_NODE_MODULES = path.join(CLIENT_DIR, 'node_modules');
const CLIENT_DIST_DIR = path.join(CLIENT_DIR, 'dist');

let moduleImportCounter = 0;

function runCommand(cmd, args, cwd, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const isWinNpm = process.platform === 'win32' && (cmd === 'npm' || cmd.endsWith('.cmd'));
    const spawnCmd = isWinNpm ? 'cmd.exe' : cmd;
    const spawnArgs = isWinNpm ? ['/d', '/s', '/c', cmd, ...args] : args;
    const child = spawn(spawnCmd, spawnArgs, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(async () => {
      timedOut = true;
      await killProcessTree(child, 1000);
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf-8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf-8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      if (timedOut) {
        resolve({
          exitCode: 1,
          stdout,
          stderr: `${stderr}\nCommand timed out after ${timeoutMs}ms: ${cmd} ${args.join(' ')}`,
          durationMs,
        });
      } else {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs,
        });
      }
    });
  });
}

export async function runClientTypecheck({ timeoutMs = 60000 } = {}) {
  const tscEntry = reqClient.resolve('typescript/bin/tsc');
  return runCommand(process.execPath, [tscEntry, '-b', '--noEmit'], CLIENT_DIR, timeoutMs);
}

export async function runClientBuild({ timeoutMs = 120000 } = {}) {
  return runCommand('npm', ['--prefix', CLIENT_DIR, 'run', 'build'], REPO_ROOT, timeoutMs);
}

export async function runCargoCheck({ timeoutMs = 180000 } = {}) {
  const manifestPath = path.join(CLIENT_DIR, 'src-tauri', 'Cargo.toml');
  return runCommand('cargo', ['check', '--manifest-path', manifestPath], REPO_ROOT, timeoutMs);
}

export function inspectDistAssets() {
  const indexHtmlPath = path.join(CLIENT_DIST_DIR, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(`client/dist/index.html not found at ${indexHtmlPath}. Run client build first.`);
  }
  const html = fs.readFileSync(indexHtmlPath, 'utf-8');
  const assetsDir = path.join(CLIENT_DIST_DIR, 'assets');
  const cssFiles = [];
  const jsFiles = [];

  if (fs.existsSync(assetsDir)) {
    const entries = fs.readdirSync(assetsDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(assetsDir, entry.name);
      if (entry.name.endsWith('.css')) {
        cssFiles.push({
          name: entry.name,
          path: fullPath,
          content: fs.readFileSync(fullPath, 'utf-8'),
        });
      } else if (entry.name.endsWith('.js')) {
        jsFiles.push({
          name: entry.name,
          path: fullPath,
          size: fs.statSync(fullPath).size,
        });
      }
    }
  }

  return {
    distDir: CLIENT_DIST_DIR,
    html,
    cssFiles,
    jsFiles,
    allCss: cssFiles.map((f) => f.content).join('\n'),
  };
}

export function readClientFile(relPath) {
  const direct = path.join(CLIENT_DIR, relPath);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return fs.readFileSync(direct, 'utf-8');
  }
  const fromSrc = path.join(CLIENT_SRC_DIR, relPath);
  if (fs.existsSync(fromSrc) && fs.statSync(fromSrc).isFile()) {
    return fs.readFileSync(fromSrc, 'utf-8');
  }
  throw new Error(`Client file not found: ${relPath} (checked ${direct} and ${fromSrc})`);
}

export function readRepoFile(relPath) {
  const full = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Repo file not found: ${full}`);
  }
  return fs.readFileSync(full, 'utf-8');
}

function collectFiles(rootDir, exts) {
  if (!fs.existsSync(rootDir)) return [];
  const results = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target') {
          continue;
        }
        stack.push(full);
      } else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  }
  return results.sort();
}

function stripCommentsPreservingLines(source) {
  return source.replace(
    /('(?:\\[\s\S]|[^'\\\r\n])*'|"(?:\\[\s\S]|[^"\\\r\n])*"|`(?:\\[\s\S]|[^`\\])*`)|(\/\*[\s\S]*?\*\/)|(\/\/[^\r\n]*)/g,
    (match, strLit, blockComment, lineComment) => {
      if (strLit) return strLit;
      if (blockComment) return blockComment.replace(/[^\n]/g, '');
      if (lineComment) return '';
      return match;
    }
  );
}

const PORT_A = String(5000);
const PORT_B = String(5001);
const FORBIDDEN_URL_RE = new RegExp(
  `:(?:(?:${PORT_A}|${PORT_B})\\b|\\$\\{\\s*(?:${PORT_A}|${PORT_B})\\s*\\})`
);
const FORBIDDEN_LISTEN_RE = new RegExp(`\\blisten\\s*\\(\\s*(?:${PORT_A}|${PORT_B})\\b`);
const FORBIDDEN_PORT_PROP_RE = new RegExp(
  `(?:^|[^a-zA-Z0-9$])(?:[a-zA-Z0-9_]*[pP]ort|PORT)\\s*[:=]\\s*(?:${PORT_A}|${PORT_B})\\b`
);

const EXPLICIT_PORT_GUARD_PATTERNS = [
  'FORBIDDEN_PORTS',
  'isPortForbidden',
  'isPortAvailable',
  'blockedPorts',
  `!== ${PORT_A}`,
  `!== ${PORT_B}`,
  `=== ${PORT_A}`,
  `=== ${PORT_B}`,
  `!= ${PORT_A}`,
  `!= ${PORT_B}`,
  `== ${PORT_A}`,
  `== ${PORT_B}`,
  `.includes(':${PORT_A}')`,
  `.includes(':${PORT_B}')`,
  `.includes(":${PORT_A}")`,
  `.includes(":${PORT_B}")`,
  `.includes('http://127.0.0.1:${PORT_A}')`,
  `.includes('http://127.0.0.1:${PORT_B}')`,
  `.includes("http://127.0.0.1:${PORT_A}")`,
  `.includes("http://127.0.0.1:${PORT_B}")`,
  `.includes('http://localhost:${PORT_A}')`,
  `.includes('http://localhost:${PORT_B}')`,
  `.includes("http://localhost:${PORT_A}")`,
  `.includes("http://localhost:${PORT_B}")`,
  'forbiddenPorts',
];

const SHARED_PROTOCOL_IMPORT_RE =
  /(?:import|from|require)\s*(?:\(\s*)?['"][^'"]*shared\/protocol/gm;

export function scanRepoConstraints({ repoRoot = REPO_ROOT } = {}) {
  const serverDir = path.join(repoRoot, 'server');
  const clientDir = path.join(repoRoot, 'client');
  const clientSrcDir = path.join(clientDir, 'src');
  const testsE2eDir = path.join(repoRoot, 'tests', 'e2e');

  const sharedProtocolViolations = [];
  const forbiddenPortViolations = [];
  const tsconfigIssues = [];

  const serverFiles = collectFiles(path.join(serverDir, 'src'), ['.ts', '.tsx', '.js', '.mjs']);
  for (const file of serverFiles) {
    const raw = fs.readFileSync(file, 'utf-8');
    const stripped = stripCommentsPreservingLines(raw);
    for (const match of stripped.matchAll(SHARED_PROTOCOL_IMPORT_RE)) {
      const lineNum = stripped.slice(0, match.index).split(/\r?\n/).length;
      sharedProtocolViolations.push({
        file: path.relative(repoRoot, file).replace(/\\/g, '/'),
        line: lineNum,
        text: match[0].replace(/\s+/g, ' ').trim(),
      });
    }
  }

  const scanDirs = [
    path.join(serverDir, 'src'),
    clientSrcDir,
    testsE2eDir,
  ];
  const scanExts = ['.ts', '.tsx', '.js', '.mjs'];
  for (const dir of scanDirs) {
    const files = collectFiles(dir, scanExts);
    for (const file of files) {
      const raw = fs.readFileSync(file, 'utf-8');
      const stripped = stripCommentsPreservingLines(raw);
      const lines = stripped.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const hasMatch =
          FORBIDDEN_URL_RE.test(line) ||
          FORBIDDEN_LISTEN_RE.test(line) ||
          FORBIDDEN_PORT_PROP_RE.test(line);
        if (!hasMatch) continue;
        if (EXPLICIT_PORT_GUARD_PATTERNS.some((g) => line.includes(g))) continue;

        forbiddenPortViolations.push({
          file: path.relative(repoRoot, file).replace(/\\/g, '/'),
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  }

  try {
    const clientTsConfig = JSON.parse(
      fs.readFileSync(path.join(clientDir, 'tsconfig.json'), 'utf-8')
    );
    const opts = clientTsConfig.compilerOptions || {};
    if (opts.strict !== true) tsconfigIssues.push('client/tsconfig.json: strict must be true');
    if (opts.noUnusedLocals !== true) {
      tsconfigIssues.push('client/tsconfig.json: noUnusedLocals must be true');
    }
    if (opts.noUnusedParameters !== true) {
      tsconfigIssues.push('client/tsconfig.json: noUnusedParameters must be true');
    }
  } catch (err) {
    tsconfigIssues.push(`Failed to read client/tsconfig.json: ${err.message}`);
  }

  try {
    const serverTsConfig = JSON.parse(
      fs.readFileSync(path.join(serverDir, 'tsconfig.json'), 'utf-8')
    );
    const opts = serverTsConfig.compilerOptions || {};
    if (opts.rootDir !== './src') {
      tsconfigIssues.push(`server/tsconfig.json: rootDir must be './src', got ${opts.rootDir}`);
    }
  } catch (err) {
    tsconfigIssues.push(`Failed to read server/tsconfig.json: ${err.message}`);
  }

  return {
    ok:
      sharedProtocolViolations.length === 0 &&
      forbiddenPortViolations.length === 0 &&
      tsconfigIssues.length === 0,
    sharedProtocolViolations,
    forbiddenPortViolations,
    tsconfigIssues,
  };
}

function createClientNodePlugin(stubModules = {}) {
  const clientExternals = new Set([
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom',
    'react-dom/client',
    'react-dom/server',
    'zustand',
    'zustand/vanilla',
    'zustand/middleware',
    'zustand/shallow',
  ]);

  return {
    name: 'lg-client-node-resolver',
    setup(build) {
      build.onResolve({ filter: /\.css$/ }, (args) => ({
        path: args.path,
        namespace: 'lg-empty-css',
      }));
      build.onLoad({ filter: /.*/, namespace: 'lg-empty-css' }, () => ({
        contents: 'export default {};',
        loader: 'js',
      }));

      build.onResolve({ filter: /^@tauri-apps\// }, (args) => ({
        path: args.path,
        namespace: 'lg-tauri-stub',
      }));
      build.onLoad({ filter: /.*/, namespace: 'lg-tauri-stub' }, () => ({
        contents:
          'export const invoke = async () => null; export const listen = async () => () => {}; export const emit = async () => {}; export default {};',
        loader: 'js',
      }));

      for (const [modName, modCode] of Object.entries(stubModules)) {
        const escaped = modName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
          path: modName,
          namespace: 'lg-custom-stub',
        }));
      }
      build.onLoad({ filter: /.*/, namespace: 'lg-custom-stub' }, (args) => ({
        contents: stubModules[args.path] || 'export default {};',
        loader: 'js',
      }));

      build.onResolve({ filter: /^(react|react-dom|zustand)(\/.*)?$/ }, (args) => {
        if (clientExternals.has(args.path)) {
          return {
            path: pathToFileURL(reqClient.resolve(args.path)).href,
            external: true,
          };
        }
        return null;
      });
    },
  };
}

export async function compileClientModule(relPathFromClientSrc, opts = {}) {
  const esbuild = requireFromServer('esbuild');
  const entryPath = path.isAbsolute(relPathFromClientSrc)
    ? relPathFromClientSrc
    : path.join(CLIENT_SRC_DIR, relPathFromClientSrc);

  if (!fs.existsSync(entryPath)) {
    throw new Error(`Client module not found: ${entryPath}`);
  }

  let ownedTempDir = false;
  let tempDir = opts.tempDir;
  if (!tempDir) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-compile-'));
    ownedTempDir = true;
  }
  fs.mkdirSync(tempDir, { recursive: true });

  const outFile = path.join(
    tempDir,
    `${path.basename(entryPath, path.extname(entryPath))}.${++moduleImportCounter}.mjs`
  );

  await esbuild.build({
    entryPoints: [entryPath],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    nodePaths: [CLIENT_NODE_MODULES],
    alias: {
      '@': CLIENT_SRC_DIR,
      '@shared': SHARED_DIR,
    },
    banner: {
      js: "import { createRequire as __lgCreateRequire } from 'node:module'; const require = __lgCreateRequire(import.meta.url);",
    },
    plugins: [createClientNodePlugin(opts.stubModules)],
    logLevel: 'silent',
  });

  const mod = await import(`${pathToFileURL(outFile).href}?v=${moduleImportCounter}`);
  if (ownedTempDir) {
    await removeDirSafe(tempDir);
  }
  return mod;
}

export async function loadFreshClientStores(ctx, { localStorageSeed = {}, locationPort = '' } = {}) {
  const storageMap = new Map(
    Object.entries(localStorageSeed).map(([k, v]) => [String(k), String(v)])
  );

  const prevWindow = globalThis.window;
  const prevLocalStorage = globalThis.localStorage;
  const hasWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const hasStorageDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  const fakeStorage = {
    getItem(k) {
      return storageMap.has(String(k)) ? storageMap.get(String(k)) : null;
    },
    setItem(k, v) {
      storageMap.set(String(k), String(v));
    },
    removeItem(k) {
      storageMap.delete(String(k));
    },
    clear() {
      storageMap.clear();
    },
    key(i) {
      return Array.from(storageMap.keys())[i] ?? null;
    },
    get length() {
      return storageMap.size;
    },
  };

  const fakeWindow = {
    location: {
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: String(locationPort),
      host: locationPort ? `127.0.0.1:${locationPort}` : '127.0.0.1',
      origin: locationPort ? `http://127.0.0.1:${locationPort}` : 'http://127.0.0.1',
    },
    localStorage: fakeStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };

  globalThis.window = fakeWindow;
  globalThis.localStorage = fakeStorage;

  if (ctx && typeof ctx.onCleanup === 'function') {
    ctx.onCleanup(() => {
      if (hasWindowDesc) globalThis.window = prevWindow;
      else delete globalThis.window;
      if (hasStorageDesc) globalThis.localStorage = prevLocalStorage;
      else delete globalThis.localStorage;
    });
  }

  const tempDir = ctx?.createTempDir ? ctx.createTempDir('lg-stores-') : undefined;
  const sessionMod = await compileClientModule('store/useSessionStore.ts', { tempDir });
  const artifactMod = await compileClientModule('store/useArtifactStore.ts', { tempDir });

  return {
    useSessionStore: sessionMod.useSessionStore,
    useArtifactStore: artifactMod.useArtifactStore,
    localStorage: fakeStorage,
  };
}

export async function renderComponentToHtml(
  ctx,
  relPathFromClientSrc,
  exportName = 'default',
  props = {},
  opts = {}
) {
  const tempDir = opts.tempDir || (ctx?.createTempDir ? ctx.createTempDir('lg-ssr-') : undefined);
  const mod = await compileClientModule(relPathFromClientSrc, {
    ...opts,
    tempDir,
  });

  const Component =
    exportName === 'default'
      ? mod.default || Object.values(mod).find((v) => typeof v === 'function')
      : mod[exportName];

  if (typeof Component !== 'function') {
    throw new Error(
      `Export "${exportName}" in ${relPathFromClientSrc} is not a React component function (available exports: ${Object.keys(mod).join(', ')})`
    );
  }

  const React = requireFromClient('react');
  const ReactDOMServer = requireFromClient('react-dom/server');
  return ReactDOMServer.renderToStaticMarkup(React.createElement(Component, props));
}

export function findChromiumExecutable() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const msPlaywrightDir = path.join(localAppData, 'ms-playwright');

  if (fs.existsSync(msPlaywrightDir)) {
    const entries = fs.readdirSync(msPlaywrightDir).sort().reverse();
    for (const dir of entries) {
      if (dir.startsWith('chromium_headless_shell-')) {
        const candidate = path.join(
          msPlaywrightDir,
          dir,
          'chrome-headless-shell-win64',
          'chrome-headless-shell.exe'
        );
        if (fs.existsSync(candidate)) return candidate;
        const posixCandidate = path.join(
          msPlaywrightDir,
          dir,
          'chrome-headless-shell-linux',
          'chrome-headless-shell'
        );
        if (fs.existsSync(posixCandidate)) return posixCandidate;
      }
      if (dir.startsWith('chromium-')) {
        const candidate = path.join(msPlaywrightDir, dir, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  const systemCandidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

  for (const candidate of systemCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    'No Chromium/Edge headless executable found. Checked CHROME_PATH, %LOCALAPPDATA%\\ms-playwright, and standard browser paths.'
  );
}

function createBrowserBundlePlugin({ stubTauri = true, stubModules = {} } = {}) {
  return {
    name: 'lg-browser-bundler',
    setup(build) {
      if (stubTauri) {
        build.onResolve({ filter: /^@tauri-apps\// }, (args) => ({
          path: args.path,
          namespace: 'lg-tauri-browser-stub',
        }));
        build.onLoad({ filter: /.*/, namespace: 'lg-tauri-browser-stub' }, () => ({
          contents:
            'export const invoke = async () => null; export const listen = async () => () => {}; export const emit = async () => {}; export default {};',
          loader: 'js',
        }));
      }

      for (const [modName] of Object.entries(stubModules)) {
        const escaped = modName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
          path: modName,
          namespace: 'lg-browser-custom-stub',
        }));
      }
      build.onLoad({ filter: /.*/, namespace: 'lg-browser-custom-stub' }, (args) => ({
        contents: stubModules[args.path] || 'export default {};',
        loader: 'js',
      }));
    },
  };
}

export async function bundleClientForBrowser(entryRelPathOrCode, opts = {}) {
  const esbuild = requireFromServer('esbuild');
  const { resolveDir = CLIENT_SRC_DIR, stubTauri = true, stubModules = {} } = opts;

  const maybeFile =
    !entryRelPathOrCode.includes('\n') &&
    (fs.existsSync(path.join(CLIENT_SRC_DIR, entryRelPathOrCode)) ||
      fs.existsSync(entryRelPathOrCode));

  const common = {
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    nodePaths: [CLIENT_NODE_MODULES],
    alias: {
      '@': CLIENT_SRC_DIR,
      '@shared': SHARED_DIR,
    },
    loader: { '.css': 'empty' },
    plugins: [createBrowserBundlePlugin({ stubTauri, stubModules })],
    logLevel: 'silent',
  };

  let result;
  if (maybeFile) {
    const entryPath = fs.existsSync(entryRelPathOrCode)
      ? entryRelPathOrCode
      : path.join(CLIENT_SRC_DIR, entryRelPathOrCode);
    result = await esbuild.build({
      ...common,
      entryPoints: [entryPath],
    });
  } else {
    result = await esbuild.build({
      ...common,
      stdin: {
        contents: entryRelPathOrCode,
        resolveDir,
        loader: 'tsx',
        sourcefile: 'browser-test-entry.tsx',
      },
    });
  }

  return result.outputFiles[0].text;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

export async function withBrowserPage(ctx, opts, fn) {
  if (typeof opts === 'function') {
    fn = opts;
    opts = {};
  }
  const {
    html,
    bundleCode,
    css,
    serveDist = false,
    viewport = { width: 1280, height: 800 },
    timeoutMs = 15000,
  } = opts || {};

  const chromiumExe = findChromiumExecutable();
  const WebSocket = requireFromServer('ws');
  const userDataDir = ctx?.createTempDir
    ? ctx.createTempDir('lg-cdp-')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'lg-cdp-'));
  const ownTempDir = !(ctx?.createTempDir);

  let defaultCss = css ?? '';
  if (!defaultCss && !serveDist) {
    const assetsDir = path.join(CLIENT_DIST_DIR, 'assets');
    if (fs.existsSync(assetsDir)) {
      defaultCss = fs
        .readdirSync(assetsDir)
        .filter((n) => n.endsWith('.css'))
        .map((n) => fs.readFileSync(path.join(assetsDir, n), 'utf-8'))
        .join('\n');
    }
  }

  const sockets = new Set();
  const httpServer = http.createServer((req, res) => {
    const urlPath = new URL(req.url || '/', 'http://127.0.0.1').pathname;

    if (serveDist) {
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const candidate = path.join(CLIENT_DIST_DIR, rel);
      const target =
        fs.existsSync(candidate) && fs.statSync(candidate).isFile()
          ? candidate
          : path.join(CLIENT_DIST_DIR, 'index.html');
      const ext = path.extname(target);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(target).pipe(res);
      return;
    }

    if (urlPath === '/bundle.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(bundleCode || '');
      return;
    }

    const pageHtml =
      html ||
      `<!DOCTYPE html>
<html class="dark">
<head>
  <meta charset="utf-8" />
  <style>${defaultCss}</style>
</head>
<body class="bg-[#131314] text-[#E8EAED]">
  <div id="root"></div>
  ${bundleCode ? '<script src="/bundle.js"></script>' : ''}
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pageHtml);
  });

  httpServer.on('connection', (sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const httpAddr = httpServer.address();
  const httpPort = typeof httpAddr === 'object' && httpAddr ? httpAddr.port : 0;
  if (!httpPort || FORBIDDEN_PORTS.has(httpPort)) {
    httpServer.close();
    throw new Error(`Browser page HTTP server bound invalid or forbidden port ${httpPort}`);
  }
  const pageUrl = `http://127.0.0.1:${httpPort}/`;

  let browserProc = null;
  let cdpWs = null;

  try {
    browserProc = spawn(
      chromiumExe,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        'about:blank',
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    const cdpPort = await new Promise((resolve, reject) => {
      let settled = false;
      let errOut = '';
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Timed out waiting for Chromium DevTools port. stderr:\n${errOut}`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      const onData = (chunk) => {
        errOut += chunk.toString('utf-8');
        const m = errOut.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
        if (m && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve(Number(m[1]));
        }
      };

      browserProc.stderr.on('data', onData);
      browserProc.stdout.on('data', onData);
      browserProc.once('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
      browserProc.once('exit', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Chromium exited early with code ${code}. stderr:\n${errOut}`));
        }
      });
    });

    if (FORBIDDEN_PORTS.has(cdpPort)) {
      throw new Error(`Chromium CDP bound forbidden port ${cdpPort}`);
    }

    const targetsRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const targets = await targetsRes.json();
    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    if (!pageTarget?.webSocketDebuggerUrl) {
      throw new Error(`No debuggable page target returned from CDP /json/list`);
    }

    cdpWs = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cdpWs.off('error', onError);
        resolve();
      };
      const onError = (err) => {
        cdpWs.off('open', onOpen);
        reject(err);
      };
      cdpWs.once('open', onOpen);
      cdpWs.once('error', onError);
    });

    let nextCmdId = 1;
    const pending = new Map();
    const cdpListeners = new Set();
    const errors = [];
    let cdpClosedErr = null;
    let rejectLoad = null;

    const failAllPending = (err) => {
      if (!cdpClosedErr) {
        cdpClosedErr = err;
      }
      for (const [, entry] of pending) {
        entry.reject(cdpClosedErr);
      }
      pending.clear();
      if (rejectLoad) {
        const rej = rejectLoad;
        rejectLoad = null;
        rej(cdpClosedErr);
      }
    };

    cdpWs.on('close', (code, reason) => {
      const reasonStr = reason ? reason.toString('utf-8') : '';
      failAllPending(
        new Error(
          `CDP WebSocket disconnected (code=${code}${reasonStr ? `, reason=${reasonStr}` : ''})`
        )
      );
    });

    cdpWs.on('error', (err) => {
      failAllPending(
        err instanceof Error
          ? new Error(`CDP WebSocket error: ${err.message}`)
          : new Error(`CDP WebSocket error: ${String(err)}`)
      );
    });

    cdpWs.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8'));
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(`CDP error (${msg.error.code}): ${msg.error.message}`));
        } else {
          resolve(msg.result);
        }
        return;
      }

      if (msg.method === 'Runtime.exceptionThrown') {
        const desc =
          msg.params?.exceptionDetails?.exception?.description ||
          msg.params?.exceptionDetails?.text ||
          'Uncaught page exception';
        errors.push({ kind: 'exception', message: desc });
      } else if (
        msg.method === 'Runtime.consoleAPICalled' &&
        msg.params?.type === 'error'
      ) {
        const text = (msg.params.args || [])
          .map((a) => a.value ?? a.description ?? '')
          .join(' ');
        errors.push({ kind: 'console.error', message: text });
      }

      for (const listener of [...cdpListeners]) {
        listener(msg);
      }
    });

    const sendCdp = (method, params = {}) => {
      if (cdpClosedErr) {
        return Promise.reject(cdpClosedErr);
      }
      if (cdpWs.readyState !== WebSocket.OPEN) {
        return Promise.reject(
          new Error(`CDP WebSocket is not open (readyState=${cdpWs.readyState}) for ${method}`)
        );
      }
      const id = nextCmdId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          cdpWs.send(JSON.stringify({ id, method, params }));
        } catch (err) {
          pending.delete(id);
          reject(err);
        }
      });
    };

    await sendCdp('Page.enable');
    await sendCdp('Runtime.enable');
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    let onLoadListener = null;
    const loadPromise = new Promise((resolve, reject) => {
      rejectLoad = reject;
      onLoadListener = (msg) => {
        if (msg.method === 'Page.loadEventFired') {
          cdpListeners.delete(onLoadListener);
          rejectLoad = null;
          resolve();
        }
      };
      cdpListeners.add(onLoadListener);
    });
    // Prevent unhandledRejection if sendCdp('Page.navigate') fails before Promise.race
    loadPromise.catch(() => {});

    await sendCdp('Page.navigate', { url: pageUrl });
    let loadTimer = null;
    try {
      await Promise.race([
        loadPromise,
        new Promise((_, reject) => {
          loadTimer = setTimeout(() => {
            if (onLoadListener) cdpListeners.delete(onLoadListener);
            rejectLoad = null;
            reject(new Error(`Timed out waiting for Page.loadEventFired on ${pageUrl}`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (loadTimer !== null) clearTimeout(loadTimer);
      if (onLoadListener) cdpListeners.delete(onLoadListener);
      rejectLoad = null;
    }

    const evaluate = async (fnOrExpr, ...args) => {
      const expression =
        typeof fnOrExpr === 'function'
          ? `(${fnOrExpr.toString()})(${args
              .map((a) => (a === undefined ? 'undefined' : JSON.stringify(a)))
              .join(', ')})`
          : String(fnOrExpr);

      const res = await sendCdp('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });

      if (res.exceptionDetails) {
        const desc =
          res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text ||
          'Evaluation threw exception';
        throw new Error(`Browser evaluate failed: ${desc}`);
      }
      return res.result?.value;
    };

    const page = {
      url: pageUrl,
      evaluate,
      sendCdp,
      async click(selector) {
        const rect = await evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
        }, selector);
        if (!rect) {
          throw new Error(`page.click: element not found for selector "${selector}"`);
        }
        if (rect.w > 0 && rect.h > 0) {
          await sendCdp('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: rect.x,
            y: rect.y,
          });
          await sendCdp('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: rect.x,
            y: rect.y,
            button: 'left',
            clickCount: 1,
          });
          await sendCdp('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: rect.x,
            y: rect.y,
            button: 'left',
            clickCount: 1,
          });
        } else {
          await evaluate((sel) => {
            const el = document.querySelector(sel);
            el?.click();
          }, selector);
        }
      },
      async type(selector, value) {
        const ok = await evaluate(
          (sel, val) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            el.focus();
            const proto =
              el instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          },
          selector,
          value
        );
        if (!ok) {
          throw new Error(`page.type: element not found for selector "${selector}"`);
        }
      },
      async waitFor(predicateExprOrFn, waitTimeoutMs = 5000) {
        const deadline = Date.now() + waitTimeoutMs;
        let lastErr = null;
        while (Date.now() < deadline) {
          if (cdpClosedErr) throw cdpClosedErr;
          try {
            const val = await evaluate(predicateExprOrFn);
            if (val) return val;
            lastErr = null;
          } catch (err) {
            if (cdpClosedErr) throw cdpClosedErr;
            lastErr = err;
          }
          await delay(40);
        }
        throw new Error(
          `page.waitFor timed out after ${waitTimeoutMs}ms${lastErr ? `: ${lastErr.message}` : ''}`
        );
      },
      getErrors() {
        return [...errors];
      },
    };

    return await fn(page);
  } finally {
    if (cdpWs) {
      try {
        cdpWs.close();
      } catch {}
    }
    if (browserProc) {
      await killProcessTree(browserProc, 1000);
    }
    for (const sock of sockets) {
      try {
        sock.destroy();
      } catch {}
    }
    await new Promise((resolve) => httpServer.close(() => resolve()));
    if (ownTempDir) {
      await removeDirSafe(userDataDir);
    }
  }
}
