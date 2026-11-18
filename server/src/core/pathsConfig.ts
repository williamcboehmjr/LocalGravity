import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface PathsConfig {
  repoRoot: string;
  runtimeDir: string;
  mcpOutputsDir: string;
  comfyRoot: string;
  comfyAppDir: string;
  comfyWorkflowsDir: string;
  comfyPythonExe: string;
  comfyUrl: string;
  strataInstallDir: string;
  strataDir: string;
  strataUrl: string;
  companionPort: number;
  companionUrl: string;
  modelsDirs: string[];
  litertLmExe: string | null;
  llamaServerExe: string | null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

let cachedConfig: PathsConfig | null = null;
let cachedRepoRoot: string | null = null;

function findExecutableOnPath(binName: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${binName}` : `command -v ${binName}`;
    const out = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    if (out && fs.existsSync(out)) return out;
  } catch {}
  return null;
}

function readRuntimePathsOverrides(repoRoot: string): Record<string, any> {
  try {
    const p = path.join(repoRoot, '.runtime', 'paths.json');
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) || {};
    }
  } catch {}
  return {};
}

export function resetPathsConfigCache(): void {
  cachedConfig = null;
  cachedRepoRoot = null;
}

export function getPathsConfig(repoRootOverride?: string): PathsConfig {
  const repoRoot = path.resolve(repoRootOverride || DEFAULT_REPO_ROOT);
  if (cachedConfig && cachedRepoRoot === repoRoot && !process.env.LOCALGRAVITY_DISABLE_PATHS_CACHE) {
    return cachedConfig;
  }

  const overrides = readRuntimePathsOverrides(repoRoot);
  const homeDir = os.homedir();
  const localAppData =
    process.env.LOCALAPPDATA ||
    (process.platform === 'win32'
      ? path.join(homeDir, 'AppData', 'Local')
      : path.join(homeDir, '.local', 'share'));

  // ComfyUI root resolution
  const winDefaultComfy = path.join(homeDir, 'Documents', 'GitHub', 'ComfyUI', 'ComfyUI-Easy-Install');
  const genericComfy = path.join(homeDir, 'ComfyUI');
  const comfyRoot = String(
    process.env.LOCALGRAVITY_COMFY_ROOT ||
      overrides.comfyRoot ||
      (fs.existsSync(winDefaultComfy) ? winDefaultComfy : genericComfy)
  );
  const comfyAppDir = String(
    overrides.comfyAppDir ||
      (fs.existsSync(path.join(comfyRoot, 'ComfyUI')) ? path.join(comfyRoot, 'ComfyUI') : comfyRoot)
  );
  const comfyWorkflowsDir = String(
    process.env.LOCALGRAVITY_COMFY_WORKFLOWS_DIR ||
      overrides.comfyWorkflowsDir ||
      path.join(comfyAppDir, 'user', 'default', 'workflows')
  );
  const embeddedPy =
    process.platform === 'win32'
      ? path.join(comfyRoot, 'python_embeded', 'python.exe')
      : path.join(comfyRoot, 'venv', 'bin', 'python');
  const comfyPythonExe = String(
    process.env.LOCALGRAVITY_COMFY_PYTHON || overrides.comfyPythonExe || (fs.existsSync(embeddedPy) ? embeddedPy : 'python')
  );
  const comfyUrl = String(process.env.COMFY_URL || overrides.comfyUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');

  // Strata directories & URL
  const strataDir = String(process.env.LOCALGRAVITY_STRATA_DIR || overrides.strataDir || path.join(localAppData, 'Strata'));
  const strataInstallDir = String(overrides.strataInstallDir || path.join(strataDir, 'install'));
  const strataUrl = String(process.env.LOCALGRAVITY_STRATA_URL || overrides.strataUrl || 'http://127.0.0.1:8080').replace(/\/+$/, '');

  // Companion CPU server port & URL (strictly avoids 5000 / 5001)
  const rawCompanionPort = Number(process.env.LOCALGRAVITY_COMPANION_PORT || overrides.companionPort || 8081);
  const companionPort = rawCompanionPort === 5000 || rawCompanionPort === 5001 ? 8081 : rawCompanionPort;
  const companionUrl = `http://127.0.0.1:${companionPort}`;

  // Model search directories (ordered, deduped)
  const candidateModelDirs = [
    process.env.LOCALGRAVITY_MODELS_DIR,
    process.env.TABBY_MODELS_DIR,
    ...(Array.isArray(overrides.modelsDirs) ? overrides.modelsDirs : []),
    path.join(strataDir, 'models'),
    ...(process.platform === 'win32' ? ['E:\\Github\\Models', 'E:\\Models'] : []),
    path.join(repoRoot, 'models'),
    path.join(homeDir, 'Documents', 'GitHub', 'tabbyAPI', 'models'),
    ...(process.platform === 'win32' ? ['E:\\Github\\tabbyAPI\\models'] : []),
    path.join(homeDir, 'models'),
  ].filter((d): d is string => Boolean(d && String(d).trim()));

  const modelsDirs = Array.from(new Set(candidateModelDirs.map((d) => path.normalize(d))));

  // External fast companion runtimes (LiteRT-LM & llama-server)
  const embeddedLitert = path.join(comfyRoot, 'python_embeded', 'Scripts', process.platform === 'win32' ? 'litert-lm.exe' : 'litert-lm');
  const litertLmExe =
    process.env.LOCALGRAVITY_LITERT_EXE ||
    overrides.litertLmExe ||
    (fs.existsSync(embeddedLitert) ? embeddedLitert : findExecutableOnPath('litert-lm'));

  const wingetLlamaServer = path.join(
    localAppData,
    'Microsoft',
    'WinGet',
    'Packages',
    'ggml.llamacpp_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'llama-server.exe'
  );
  const llamaServerExe =
    process.env.LOCALGRAVITY_LLAMA_SERVER_EXE ||
    overrides.llamaServerExe ||
    (fs.existsSync(wingetLlamaServer) ? wingetLlamaServer : findExecutableOnPath(process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'));

  const runtimeDir = path.join(repoRoot, '.runtime');
  const mcpOutputsDir = path.join(runtimeDir, 'mcp-outputs');

  const cfg: PathsConfig = {
    repoRoot,
    runtimeDir,
    mcpOutputsDir,
    comfyRoot,
    comfyAppDir,
    comfyWorkflowsDir,
    comfyPythonExe,
    comfyUrl,
    strataInstallDir,
    strataDir,
    strataUrl,
    companionPort,
    companionUrl,
    modelsDirs,
    litertLmExe,
    llamaServerExe,
  };

  cachedConfig = cfg;
  cachedRepoRoot = repoRoot;
  return cfg;
}
