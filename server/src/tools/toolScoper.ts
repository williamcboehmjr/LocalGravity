export const PI_CORE_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'apply_diff',
  'run_terminal',
  'run_code_batch',
  'find_files',
  'search_codebase',
  'code_outline',
  'list_directory',
  'list_skills',
  'read_skill',
] as const;

export const DEFAULT_CORE_TOOL_NAMES = [
  ...PI_CORE_TOOL_NAMES,
  'lsp_diagnostics',
  'list_directory',
  'ask_question',
  'search_web',
  'patch_json',
  'manage_files',
  'http_request',
  'write_artifact',
  'invoke_subagent',
  'manage_task',
  'schedule',
] as const;

const COMFY_MEDIA_TOOLS = new Set(['comfyui', 'download_file', 'search_models']);
const VISION_DOC_BROWSER_TOOLS = new Set([
  'capture_screen',
  'inspect_window',
  'inspect_document',
  'inspect_file_metadata',
  'browser_inspect',
]);
const ENGINE_SYSTEM_RELEASE_TOOLS = new Set([
  'inspect_models',
  'manage_strata',
  'inspect_system',
  'read_system_logs',
  'restart_brain',
  'publish_release',
  'reload_harness',
]);

  export interface SelectScopedToolsOptions {
  prompt: string;
  slashCommand?: string | null;
  forceLean?: boolean;
  forceComfyStudio?: boolean;
  includeSwarmBoardTools?: boolean;
  builtinTools: any[];
  skillTools: any[];
  mcpTools: any[];
  swarmTools?: any[];
  previouslyUsedTools?: Iterable<string>;
}

function getToolName(schema: any): string {
  return String(schema?.function?.name || schema?.name || '').trim();
}

function dedupeSchemasByName(tools: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const t of tools) {
    const name = getToolName(t);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(t);
  }
  return out;
}

export function selectScopedTools(opts: SelectScopedToolsOptions): any[] {
  const prompt = String(opts.prompt || '');
  const promptLower = prompt.toLowerCase();
  const slashCommand = opts.slashCommand || null;
  const previouslyUsed = new Set<string>(opts.previouslyUsedTools || []);

  const allBuiltinAndSkill = [...opts.builtinTools, ...opts.skillTools];

  // Ultra-lean single-tool mode for ComfyUI Studio turns
  if (opts.forceComfyStudio || slashCommand === '/comfy') {
    const comfyOnly = opts.builtinTools.filter((t) => getToolName(t) === 'comfyui');
    if (comfyOnly.length > 0) {
      return comfyOnly;
    }
  }

  if (opts.forceLean || slashCommand === '/lean') {
    const allowed = new Set<string>(PI_CORE_TOOL_NAMES);
    for (const name of previouslyUsed) {
      allowed.add(name);
    }
    if (
      opts.includeSwarmBoardTools ||
      (opts.swarmTools && opts.swarmTools.length > 0) ||
      slashCommand === '/swarm' ||
      /\bswarm\b|\/swarm\b/i.test(prompt)
    ) {
      allowed.add('swarm');
    }
    if (slashCommand === '/grill-me' || /\/grill-me\b/i.test(prompt)) {
      allowed.add('ask_question');
    }
    for (const t of allBuiltinAndSkill) {
      const name = getToolName(t);
      if (name && promptLower.includes(name.toLowerCase())) {
        allowed.add(name);
      }
    }
    const filtered = allBuiltinAndSkill.filter((t) => allowed.has(getToolName(t)));
    return dedupeSchemasByName([
      ...filtered,
      ...opts.skillTools,
      ...(opts.swarmTools || []),
    ]);
  }

  const allowed = new Set<string>(DEFAULT_CORE_TOOL_NAMES);
  for (const name of previouslyUsed) {
    allowed.add(name);
  }

  if (
    opts.includeSwarmBoardTools ||
    (opts.swarmTools && opts.swarmTools.length > 0) ||
    slashCommand === '/swarm' ||
    /\bswarm\b|\/swarm\b/i.test(prompt)
  ) {
    allowed.add('swarm');
  }
  if (slashCommand === '/grill-me' || /\/grill-me\b/i.test(prompt)) {
    allowed.add('ask_question');
  }

  const wantComfyMedia =
    slashCommand === '/vision' ||
    /\b(comfy|comfyui|moss|h3|krea|image|video|picture|photo|draw|render|workflow|flux|sdxl|lora|checkpoint|gguf|huggingface|hf|gemini_image|gemini_video)\b/i.test(
      prompt
    );
  if (wantComfyMedia) {
    for (const n of COMFY_MEDIA_TOOLS) allowed.add(n);
  }

  const wantVisionDocBrowser =
    slashCommand === '/vision' ||
    slashCommand === '/browser' ||
    /\b(screen|screenshot|window|vision|see|look|pdf|document|menu|scan|receipt|browser|browse|webpage|site|url|http)\b/i.test(
      prompt
    );
  if (wantVisionDocBrowser) {
    for (const n of VISION_DOC_BROWSER_TOOLS) allowed.add(n);
  }

  const wantEngineSystemRelease =
    slashCommand === '/restart' ||
    slashCommand === '/reload' ||
    slashCommand === '/vision' ||
    slashCommand === '/goal' ||
    slashCommand === '/boost' ||
    /\b(strata|model|models|vram|gpu|nvidia|system|log|logs|port|process|restart|reload|release|publish|update|version|msi|git|tag|health|vision)\b/i.test(
      prompt
    );
  if (wantEngineSystemRelease) {
    for (const n of ENGINE_SYSTEM_RELEASE_TOOLS) allowed.add(n);
  }

  // Always unlock any tool explicitly named in the prompt
  for (const t of allBuiltinAndSkill) {
    const name = getToolName(t);
    if (name && promptLower.includes(name.toLowerCase())) {
      allowed.add(name);
    }
  }

  const scopedBuiltin = allBuiltinAndSkill.filter((t) => allowed.has(getToolName(t)));
  const hasNativeComfy = scopedBuiltin.some((t) => getToolName(t) === 'comfyui');
  const explicitComfyMcpMention = /\bcomfy[-_]mcp\b|@comfy/i.test(prompt);
  const filteredMcp = hasNativeComfy && !explicitComfyMcpMention
    ? opts.mcpTools.filter((t) => {
        const n = getToolName(t).toLowerCase();
        return !(n.includes('comfy') && /(run_workflow|generate_image|run_template)$/.test(n));
      })
    : opts.mcpTools;

  return dedupeSchemasByName([
    ...scopedBuiltin,
    ...opts.skillTools,
    ...(opts.swarmTools || []),
    ...filteredMcp,
  ]);
}

export interface BuildLeanSystemDirectiveParams {
  projectName: string;
  projectRoot: string;
  gitBranch: string;
  userHome: string;
  engineLine: string;
  skillsSection: string;
  compiledHarness: string;
}

export function buildLeanSystemDirective(params: BuildLeanSystemDirectiveParams): string {
  const harnessSnippet = (params.compiledHarness || '').trim().slice(0, 1200);
  const skillsSnippet = (params.skillsSection || '').trim().slice(0, 800);

  return [
    `You are LocalGravity, an autonomous AI engineering agent on the user's workstation.`,
    `Workspace: ${params.projectName} (${params.projectRoot}) [branch: ${params.gitBranch}]`,
    `Home: ${params.userHome}`,
    params.engineLine.trim(),
    ``,
    `Core tools:`,
    `- read_file, write_file, edit_file, apply_diff: Inspect and edit files (checkpoints saved automatically).`,
    `- run_terminal: Execute shell commands in workspace.`,
    `- run_code_batch: Batch multi-file reads, searches, edits, and checks in a single Node ESM script via global \`lg\` helpers (\`lg.readFile\`, \`lg.writeFile\`, \`lg.editFile\`, \`lg.listFiles\`, \`lg.search\`, \`lg.sh\`). Prefer this over many small sequential calls.`,
    `- find_files, search_codebase, code_outline: Fast code navigation.`,
    `- list_skills, read_skill: Load specialized skill rules on demand.`,
    ``,
    `Rules:`,
    `1. Inspect files before editing; prefer targeted edits over full rewrites.`,
    `2. Execute tasks end-to-end and verify builds/tests before reporting completion.`,
    `3. Never probe ports 5000 or 5001.`,
    skillsSnippet ? `\n${skillsSnippet}` : '',
    harnessSnippet ? `\n=== HARNESS SUMMARY ===\n${harnessSnippet}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
