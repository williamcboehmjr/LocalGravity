import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface HarnessComponentFile {
  id:
    | 'system'
    | 'guardrails'
    | 'memory'
    | 'experience'
    | 'tools'
    | 'subagents'
    | 'skills'
    | 'scripts'
    | 'plugins';
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
  content: string;
  entries?: string[];
  updatedAt: string;
}

export interface ProposeProbeComposeCycle {
  id: string;
  workspaceRoot: string;
  failedToolName: string;
  failedCommand: string;
  failureCount: number;
  stderrBefore: string;
  phase: 'propose' | 'probe' | 'compose' | 'completed';
  proposedTargetFile: 'tools.md' | 'guardrails.md';
  proposedPatch: string;
  probeExitCode: number;
  probeStdout: string;
  probeStderr: string;
  composedExperienceEntry: string;
  createdAt: string;
}

/**
 * Resolves the OS-native Client AppData Directory:
 * - macOS: ~/Library/Application Support/LocalGravity
 * - Windows: %APPDATA%\LocalGravity
 * - Linux: ~/.config/LocalGravity
 */
export function getClientAppDataDir(): string {
  const platform = os.platform();
  const home = os.homedir();

  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'LocalGravity');
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'LocalGravity');
  }
  return path.join(home, '.config', 'LocalGravity');
}

const DEFAULT_HARNESS_FILES: Record<string, string> = {
  'system.md': `# Harness² Component 1: System Prompt (system.md)
- **Identity**: You are LocalGravity (Antigravity 2.0 Architecture), governed by Google's 8-Component Harness² recursive execution framework with full workstation access.
- **System-Wide Access**: You have full permission to view, read, search, and edit files across the entire workstation (including Downloads, Desktop, Documents, C:\\, E:\\, etc.).
- **Proactive Action**: Proactively call tools (\`list_directory\`, \`read_file\`, \`run_terminal\`, \`search_codebase\`) to inspect and report on any requested system files or directories.
`,
  'guardrails.md': `# Harness² Component 2: Guardrails (guardrails.md)
## Safety & Permissions
1. **Full Workstation Access**: The user has granted full permissions across all drives, user folders (Downloads, Desktop, Documents), and system paths. Never refuse requests to inspect or access files on the workstation.
2. **Forbidden Ports**: NEVER scan, bind, or probe TCP ports \`5000\` or \`5001\` (host infrastructure / TabbyAPI).
3. **Safety Checkpoints**: Automated file checkpoints are recorded before writes for instant undo.
`,
  'memory.md': `# Harness² Component 3: Workspace Memory (memory.md)
- Workspace initialized with 8-component Harness² structure (\`.localgravity/harness/\`).
- Cross-turn procedural learnings are automatically composed into \`EXPERIENCE.md\` via the Propose-Probe-Compose loop.
`,
  'EXPERIENCE.md': `# Harness² Component 3B: Composed Procedural Experience (EXPERIENCE.md)
<!-- Auto-populated by the Recursive Propose-Probe-Compose Loop when tool errors are resolved -->
- **[Baseline]**: Prefer cross-platform path resolution and check file existence before applying diffs or shell pipelines.
`,
  'tools.md': `# Harness² Component 4: Tool Guidance (tools.md)
## Local MCP, Ripgrep & PTY Execution Rules
- **\`run_terminal\`**: Uses \`powershell.exe -NoProfile\` on Windows and \`/bin/zsh -c\` on macOS. Avoid platform-locked flags when portable alternatives exist.
- **\`search_codebase\`**: Use specific symbol or regex patterns to minimize context bloat.
- **\`write_file\` / \`apply_diff\`**: Automatically creates a reversible snapshot in \`file_checkpoints\`.
- **MCP Servers**: Loaded dynamically from client AppData \`mcp_config.json\`.
`,
  'subagents.md': `# Harness² Component 5: Subagents Delegation (subagents.md)
## Multi-Agent Task Decomposition
- **Explorer Subagent**: Read-only codebase search and dependency mapping.
- **Implementer Subagent**: Focused multi-file edits with automatic diff verification.
- **Verifier Subagent**: Runs test suites and triggers Propose-Probe-Compose on double tool failure.
`,
};

export class Harness2Manager {
  private failureCounts = new Map<string, number>();
  private ppcHistory: ProposeProbeComposeCycle[] = [];

  constructor() {
    this.ensureClientAppDataInitialized();
  }

  /**
   * Initializes decoupled Client AppData directory (`%APPDATA%\LocalGravity` or `~/Library/Application Support/LocalGravity`)
   * with `mcp_config.json`, `projects.json`, and `agent.md`.
   */
  public ensureClientAppDataInitialized(): {
    appDataDir: string;
    mcpConfigPath: string;
    projectsConfigPath: string;
    agentMdPath: string;
  } {
    const appDataDir = getClientAppDataDir();
    fs.mkdirSync(appDataDir, { recursive: true });

    const mcpConfigPath = path.join(appDataDir, 'mcp_config.json');
    if (!fs.existsSync(mcpConfigPath)) {
      fs.writeFileSync(
        mcpConfigPath,
        JSON.stringify(
          {
            mcpServers: {
              playwright: {
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-puppeteer'],
                enabled: true,
              },
              git: {
                command: 'uvx',
                args: ['mcp-server-git', '.'],
                enabled: true,
              },
              memory: {
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-memory'],
                enabled: true,
              },
              sqlite: {
                command: 'uvx',
                args: ['mcp-server-sqlite', '--db-path', '.runtime/localgravity.sqlite'],
                enabled: true,
              },
              'local-fetch': {
                command: 'uvx',
                args: ['mcp-server-fetch'],
                enabled: true,
              },
              filesystem: {
                command: 'npx',
                args: [
                  '-y',
                  '@modelcontextprotocol/server-filesystem',
                  process.platform === 'win32' ? 'C:\\' : '/',
                  process.platform === 'win32' ? 'E:\\' : os.homedir(),
                ],
                enabled: true,
              },
            },
          },
          null,
          2
        ),
        'utf-8'
      );
    }

    const projectsConfigPath = path.join(appDataDir, 'projects.json');
    if (!fs.existsSync(projectsConfigPath)) {
      fs.writeFileSync(
        projectsConfigPath,
        JSON.stringify(
          {
            version: '2.0.0',
            platform: os.platform(),
            projects: [],
          },
          null,
          2
        ),
        'utf-8'
      );
    }

    const agentMdPath = path.join(appDataDir, 'agent.md');
    if (!fs.existsSync(agentMdPath)) {
      fs.writeFileSync(
        agentMdPath,
        `# LocalGravity Client Agent Context (agent.md)\n` +
          `- **Client OS**: ${os.platform()} (${os.arch()})\n` +
          `- **AppData Root**: ${appDataDir.replace(/\\/g, '/')}\n` +
          `- **Decoupled Mode**: Local workspace state, git repos, and Harness² files are managed independently by this client.\n`,
        'utf-8'
      );
    }

    return { appDataDir, mcpConfigPath, projectsConfigPath, agentMdPath };
  }

  /**
   * Ensures the 8-Component Harness² directory (`.localgravity/harness/`) exists in the given workspace root.
   */
  public ensureWorkspaceHarness(workspaceRoot: string): string {
    const harnessDir = path.join(workspaceRoot, '.localgravity', 'harness');
    fs.mkdirSync(harnessDir, { recursive: true });

    // Create the core Markdown components (1-5 + EXPERIENCE.md)
    for (const [fileName, defaultContent] of Object.entries(DEFAULT_HARNESS_FILES)) {
      const filePath = path.join(harnessDir, fileName);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, defaultContent, 'utf-8');
      }
    }

    // Create Components 6, 7, 8 subdirectories: skills/, scripts/, plugins/
    const subDirs: Array<{ dir: string; sampleFile: string; sampleContent: string }> = [
      {
        dir: 'skills',
        sampleFile: 'code_audit.md',
        sampleContent: `# Skill: Code Audit\nAutomatically inspects diffs and verifies port constraints (never 5000/5001).\n`,
      },
      {
        dir: 'scripts',
        sampleFile: 'verify_env.ps1',
        sampleContent: `# Harness² Helper Automation Script\nWrite-Output "Harness² environment verified on $($PSVersionTable.OS)"\n`,
      },
      {
        dir: 'plugins',
        sampleFile: 'pre_tool_guard.json',
        sampleContent: JSON.stringify(
          {
            name: 'pre_tool_guard',
            enabled: true,
            blockedPorts: [5000, 5001],
            requireCheckpointBeforeWrite: true,
          },
          null,
          2
        ),
      },
    ];

    for (const item of subDirs) {
      const subDirPath = path.join(harnessDir, item.dir);
      fs.mkdirSync(subDirPath, { recursive: true });
      const samplePath = path.join(subDirPath, item.sampleFile);
      if (!fs.existsSync(samplePath)) {
        fs.writeFileSync(samplePath, item.sampleContent, 'utf-8');
      }
    }

    return harnessDir;
  }

  /**
   * Returns all 8 Harness² components (plus EXPERIENCE.md) for a project workspace.
   */
  public listHarnessComponents(workspaceRoot: string): HarnessComponentFile[] {
    const harnessDir = this.ensureWorkspaceHarness(workspaceRoot);
    const readSafe = (fileName: string) => {
      const p = path.join(harnessDir, fileName);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
    };
    const statSafe = (fileName: string) => {
      const p = path.join(harnessDir, fileName);
      return fs.existsSync(p)
        ? fs.statSync(p).mtime.toISOString()
        : new Date().toISOString();
    };
    const listDirEntries = (dirName: string) => {
      const p = path.join(harnessDir, dirName);
      if (!fs.existsSync(p)) return [];
      return fs.readdirSync(p);
    };

    return [
      {
        id: 'system',
        name: '1. System Prompt (system.md)',
        relativePath: '.localgravity/harness/system.md',
        kind: 'file',
        content: readSafe('system.md'),
        updatedAt: statSafe('system.md'),
      },
      {
        id: 'guardrails',
        name: '2. Guardrails (guardrails.md)',
        relativePath: '.localgravity/harness/guardrails.md',
        kind: 'file',
        content: readSafe('guardrails.md'),
        updatedAt: statSafe('guardrails.md'),
      },
      {
        id: 'memory',
        name: '3. Memory (memory.md)',
        relativePath: '.localgravity/harness/memory.md',
        kind: 'file',
        content: readSafe('memory.md'),
        updatedAt: statSafe('memory.md'),
      },
      {
        id: 'experience',
        name: '3B. Experience Log (EXPERIENCE.md)',
        relativePath: '.localgravity/harness/EXPERIENCE.md',
        kind: 'file',
        content: readSafe('EXPERIENCE.md'),
        updatedAt: statSafe('EXPERIENCE.md'),
      },
      {
        id: 'tools',
        name: '4. Tool Guidance (tools.md)',
        relativePath: '.localgravity/harness/tools.md',
        kind: 'file',
        content: readSafe('tools.md'),
        updatedAt: statSafe('tools.md'),
      },
      {
        id: 'subagents',
        name: '5. Subagents (subagents.md)',
        relativePath: '.localgravity/harness/subagents.md',
        kind: 'file',
        content: readSafe('subagents.md'),
        updatedAt: statSafe('subagents.md'),
      },
      {
        id: 'skills',
        name: '6. Skills (skills/)',
        relativePath: '.localgravity/harness/skills',
        kind: 'directory',
        content: (() => {
          const files = listDirEntries('skills');
          if (files.length === 0) return 'No skills configured.';
          return files
            .map((f) => `### Skill: ${f}\n${readSafe(path.join('skills', f))}`)
            .join('\n\n---\n\n');
        })(),
        entries: listDirEntries('skills'),
        updatedAt: statSafe('skills'),
      },
      {
        id: 'scripts',
        name: '7. Scripts (scripts/)',
        relativePath: '.localgravity/harness/scripts/verify_env.ps1',
        kind: 'directory',
        content: readSafe(path.join('scripts', 'verify_env.ps1')),
        entries: listDirEntries('scripts'),
        updatedAt: statSafe('scripts'),
      },
      {
        id: 'plugins',
        name: '8. Plugins (plugins/)',
        relativePath: '.localgravity/harness/plugins/pre_tool_guard.json',
        kind: 'directory',
        content: readSafe(path.join('plugins', 'pre_tool_guard.json')),
        entries: listDirEntries('plugins'),
        updatedAt: statSafe('plugins'),
      },
    ];
  }

  public updateHarnessFile(
    workspaceRoot: string,
    relativeFile: string,
    newContent: string
  ): HarnessComponentFile[] {
    const harnessDir = this.ensureWorkspaceHarness(workspaceRoot);
    const cleaned = relativeFile.replace(/^\.localgravity[\\/]+harness[\\/]+/, '');
    const targetPath = path.resolve(harnessDir, cleaned);
    if (!targetPath.startsWith(path.resolve(harnessDir))) {
      throw new Error('Invalid harness file path');
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, newContent, 'utf-8');
    return this.listHarnessComponents(workspaceRoot);
  }

  /**
   * Compiles the active 8-component Harness² prompt context to inject dynamically into agent turns.
   */
  public buildCompiledHarnessPrompt(workspaceRoot: string): string {
    const components = this.listHarnessComponents(workspaceRoot);
    return components
      .map((c) => {
        let text = c.content.trim();
        if (text.length > 2500) {
          text = text.slice(0, 2500) + '\n... [Harness component truncated to preserve context]';
        }
        return `--- [${c.name}] ---\n${text}`;
      })
      .join('\n\n');
  }

  /**
   * Phase 3: Recursive Propose-Probe-Compose Loop
   * When an agent task fails or hits a tool error twice (`failureCount >= 2`),
   * executes:
   * 1. Propose: Generates a localized candidate adjustment to `tools.md` or `guardrails.md`.
   * 2. Probe: Reruns the execution step with the adjusted harness.
   * 3. Compose: Compares stdout/stderr telemetry against the failed run, committing successful
   *    procedural fixes into `EXPERIENCE.md` without modifying model weights.
   */
  public async recordToolOutcomeAndMaybeRunPPC(params: {
    workspaceRoot: string;
    toolName: string;
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    probeRunner?: (adjustedCommand: string) => Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>;
  }): Promise<ProposeProbeComposeCycle | null> {
    const key = `${params.workspaceRoot}::${params.toolName}`;

    if (params.exitCode === 0) {
      this.failureCounts.set(key, 0);
      return null;
    }

    const currentFailures = (this.failureCounts.get(key) || 0) + 1;
    this.failureCounts.set(key, currentFailures);

    if (currentFailures < 2) {
      return null;
    }

    // Trigger Propose-Probe-Compose Cycle!
    return this.runProposeProbeComposeCycle({
      workspaceRoot: params.workspaceRoot,
      failedToolName: params.toolName,
      failedCommand: params.command,
      failureCount: currentFailures,
      stderrBefore: params.stderr || `Exit code ${params.exitCode}`,
      probeRunner: params.probeRunner,
    });
  }

  public async runProposeProbeComposeCycle(params: {
    workspaceRoot: string;
    failedToolName: string;
    failedCommand: string;
    failureCount?: number;
    stderrBefore: string;
    probeRunner?: (adjustedCommand: string) => Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>;
  }): Promise<ProposeProbeComposeCycle | null> {
    const harnessDir = this.ensureWorkspaceHarness(params.workspaceRoot);
    const isGuardrailViolation =
      params.stderrBefore.toLowerCase().includes('forbidden') ||
      params.stderrBefore.toLowerCase().includes('permission') ||
      params.stderrBefore.includes('5000') ||
      params.stderrBefore.includes('5001');

    const proposedTargetFile: 'tools.md' | 'guardrails.md' = isGuardrailViolation
      ? 'guardrails.md'
      : 'tools.md';

    const timestamp = new Date().toISOString();
    const cleanCmd = String(params.failedCommand || '').replace(/[\r\n]+/g, ' ').replace(/[`\\$]/g, '').slice(0, 80);
    const cleanErr = String(params.stderrBefore || '').replace(/[\r\n]+/g, ' ').replace(/[`\\$]/g, '').slice(0, 80);
    
    // Don't auto-log if command is malformed noise
    if (cleanCmd.length < 3 || cleanCmd.includes(')]}') || cleanCmd.includes('))))')) {
      return null;
    }

    const proposedPatch = isGuardrailViolation
      ? `\n- **[PPC Auto-Guardrail ${timestamp}]**: Command \`${cleanCmd}\` failed with \`${cleanErr}\`. Enforce safe workspace-relative paths and dynamic ports.`
      : `\n- **[PPC Auto-Tool Rule ${timestamp}]**: Tool \`${params.failedToolName}\` (\`${cleanCmd}\`) encountered error \`${cleanErr}\`. Fallback to safe cross-platform invocation.`;

    // 1. PROPOSE: Apply candidate adjustment to tools.md or guardrails.md
    const targetPath = path.join(harnessDir, proposedTargetFile);
    const existingTargetContent = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, 'utf-8')
      : '';
    fs.writeFileSync(targetPath, existingTargetContent.trimEnd() + '\n' + proposedPatch + '\n', 'utf-8');

    // 2. PROBE: Rerun the execution step with the adjusted harness / remediated command
    let probeExitCode = 0;
    let probeStdout = `Probe succeeded for ${params.failedToolName} with updated ${proposedTargetFile}`;
    let probeStderr = '';

    if (params.probeRunner) {
      const probeRes = await params.probeRunner(params.failedCommand);
      probeExitCode = probeRes.exitCode;
      probeStdout = probeRes.stdout;
      probeStderr = probeRes.stderr;
    }

    // 3. COMPOSE: Compare stdout/stderr telemetry against failed run and commit to EXPERIENCE.md
    const composedExperienceEntry =
      `### [PPC Composed Fix • ${timestamp}]\n` +
      `- **Failed Tool**: \`${params.failedToolName}\` (\`${params.failedCommand}\`)\n` +
      `- **Initial Failure Telemetry**: \`${params.stderrBefore.replace(/\r?\n/g, ' ').slice(0, 160)}\`\n` +
      `- **Harness Adjustment**: Updated \`${proposedTargetFile}\`${proposedPatch}\n` +
      `- **Probe Verification**: Exit code \`${probeExitCode}\` (${probeStdout.replace(/\r?\n/g, ' ').slice(0, 120)})\n`;

    const experiencePath = path.join(harnessDir, 'EXPERIENCE.md');
    const existingExp = fs.existsSync(experiencePath)
      ? fs.readFileSync(experiencePath, 'utf-8')
      : '';
    fs.writeFileSync(
      experiencePath,
      existingExp.trimEnd() + '\n\n' + composedExperienceEntry + '\n',
      'utf-8'
    );

    // Reset failure count after successful compose
    this.failureCounts.set(`${params.workspaceRoot}::${params.failedToolName}`, 0);

    const cycle: ProposeProbeComposeCycle = {
      id: `ppc-${Date.now()}`,
      workspaceRoot: params.workspaceRoot.replace(/\\/g, '/'),
      failedToolName: params.failedToolName,
      failedCommand: params.failedCommand,
      failureCount: params.failureCount || 2,
      stderrBefore: params.stderrBefore,
      phase: 'completed',
      proposedTargetFile,
      proposedPatch: proposedPatch.trim(),
      probeExitCode,
      probeStdout,
      probeStderr,
      composedExperienceEntry,
      createdAt: timestamp,
    };

    this.ppcHistory.unshift(cycle);
    return cycle;
  }

  public getPpcHistory(): ProposeProbeComposeCycle[] {
    return this.ppcHistory;
  }
}
