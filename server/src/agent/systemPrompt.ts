import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { getPathsConfig } from '../core/pathsConfig.js';
import { buildCompactRepoMap } from '../tools/repoMap.js';
import { LspDiagnosticsManager } from '../tools/lspManager.js';
import { buildLeanSystemDirective } from '../tools/toolScoper.js';

export interface BuildSystemDirectiveParams {
  projectName: string;
  projectRoot: string;
  gitBranch: string;
  customInstructions?: string;
  remoteHostNote: string;
  slashCommand: string | null;
  modeDirective: string;
  compiledHarness: string;
  skillsSection: string;
  mcpInstructions: string;
  brainProvider: 'strata' | 'google_ai_studio';
  resolvedModelDisplayName: string;
  isComfyStudio: boolean;
  comfyDefaultWorkflow?: string;
  comfyCompanionBrain?: string;
  comfyOllamaModel?: string;
  promptStr: string;
}

export function buildComfyStudioSystemDirective(params: {
  workflow: string;
  companionBrain: string;
  ollamaModel?: string;
  workflowsDir: string;
  modeDirective?: string;
}): string {
  const wf = params.workflow || 'Moss Image.json';
  const brainLabel =
    params.companionBrain === 'ollama_vision' && params.ollamaModel
      ? `ollama_vision (${params.ollamaModel})`
      : params.companionBrain;
  const lines = [
    `You are LocalGravity ComfyUI Studio — an ultra-fast, single-tool image & vision assistant.`,
    `Active ComfyUI Workflow: "${wf}" | Companion Brain: ${brainLabel} | Workflows Dir: "${params.workflowsDir.replace(/\\/g, '/')}"`,
    ``,
    `RULES FOR INSTANT TURNS:`,
    `1. Whenever the user asks to create, generate, draw, render, edit, or test an image/video, IMMEDIATELY call the \`comfyui\` tool on step 1.`,
    ...(params.companionBrain === 'ollama_vision'
      ? [
          `2. Expand the user's request directly into a rich, vivid visual prompt (2-4 detailed sentences covering subject, lighting, camera/lens, atmosphere, composition) inside \`comfyui({ action: "${wf === 'gemini_image' ? 'gemini_image' : 'generate'}"${wf === 'gemini_image' ? '' : `, workflow: "${wf}"`}, prompt: "<expanded prompt>", enhance_prompt: false })\` on step 1 for maximum single-pass speed (unless the user explicitly names another workflow like "z-image", "krea", "h3", "moss", "qwen", or "gemini_video").`,
          `3. You have native multimodal vision: inspect any image attached by the user when crafting prompts or picking edits, and pass inspect_output: true to \`comfyui\` if the user explicitly asks you to visually inspect, critique, or iteratively refine the generated image.`,
          `4. Do NOT invent fake file paths or "[MCP Image saved...]" strings in text. Only report exact outputs returned by the \`comfyui\` tool, including its markdown image link \`[MCP Image saved to: ...](/api/mcp-outputs/...)\`.`,
        ]
      : [
          `2. If "${wf}" === "gemini_image", call comfyui({ action: "gemini_image", prompt: "..." }). Otherwise call comfyui({ action: "generate", workflow: "${wf}", prompt: "..." }) (unless the user explicitly names a different workflow like "z-image", "krea", "h3", "moss", "qwen", or "gemini_video").`,
          `3. Do NOT invent fake file paths or "[MCP Image saved...]" strings in text. Only report exact outputs returned by the \`comfyui\` tool, including its markdown image link \`[MCP Image saved to: ...](/api/mcp-outputs/...)\`.`,
        ]),
  ];
  if (params.modeDirective) {
    lines.push('', params.modeDirective);
  }
  return lines.join('\n');
}

export function buildTurnSystemDirective(p: BuildSystemDirectiveParams): string {
  const paths = getPathsConfig();
  const userHome = os.homedir().replace(/\\/g, '/');
  const downloadsDir = path.join(os.homedir(), 'Downloads').replace(/\\/g, '/');
  const desktopDir = path.join(os.homedir(), 'Desktop').replace(/\\/g, '/');
  const documentsDir = path.join(os.homedir(), 'Documents').replace(/\\/g, '/');

  if (p.isComfyStudio || p.slashCommand === '/comfy') {
    let base = buildComfyStudioSystemDirective({
      workflow: p.comfyDefaultWorkflow || 'Moss Image.json',
      companionBrain: p.comfyCompanionBrain || 'auto',
      ollamaModel: p.comfyOllamaModel,
      workflowsDir: paths.comfyWorkflowsDir,
      modeDirective: p.modeDirective,
    });
    if (p.customInstructions) {
      base += `\nCustom Instructions: ${p.customInstructions}`;
    }
    return base;
  }

  const modelsDirNorm = (paths.modelsDirs[0] || '').replace(/\\/g, '/');
  const strataDirNorm = paths.strataDir.replace(/\\/g, '/');
  const comfyWfNorm = paths.comfyWorkflowsDir.replace(/\\/g, '/');

  const engineDirectiveLine =
    p.brainProvider === 'google_ai_studio'
      ? `- Active Brain Inference Provider: Google AI Studio API (${p.resolvedModelDisplayName}) — orchestrated by LocalGravity Central Brain without local Strata GPU.`
      : `- Strata Engine: Active on ${paths.strataUrl} serving "Swift 1.5 Flash-Next" (IQ2_XS + Vision) with 65,536 context, spec=6, and multimodal vision projector.\n` +
        `- Strata Root: "${strataDirNorm}"\n` +
        (modelsDirNorm ? `- Local Models Directory: "${modelsDirNorm}"` : '');

  let systemDirective = '';
  if (p.slashCommand === '/lean') {
    systemDirective =
      buildLeanSystemDirective({
        projectName: p.projectName,
        projectRoot: p.projectRoot,
        gitBranch: p.gitBranch,
        userHome,
        engineLine: engineDirectiveLine + p.remoteHostNote,
        skillsSection: p.skillsSection,
        compiledHarness: p.compiledHarness,
      }) +
      (p.modeDirective ? `\n\n${p.modeDirective}` : '') +
      (p.customInstructions ? `\nCustom Instructions: ${p.customInstructions}` : '');
  } else {
    systemDirective =
      `You are LocalGravity, an autonomous AI engineering assistant running directly on the user's workstation.\n` +
      `Active Workspace: ${p.projectName} (${p.projectRoot}) [branch: ${p.gitBranch}]\n` +
      p.remoteHostNote +
      `Workstation Paths:\n` +
      `- User Folders: Home="${userHome}", Downloads="${downloadsDir}", Desktop="${desktopDir}", Documents="${documentsDir}"\n` +
      `${engineDirectiveLine}\n\n` +
      `=== UNRESTRICTED SYSTEM ACCESS & AUTONOMOUS TOOL SUITE ===\n` +
      `=== WEB SEARCH MANDATE ===\n` +
      `1. SEARCH THE WEB FIRST when uncertain about external docs, libraries, error codes, or real-time facts via \`search_web\`.\n` +
      `2. SCANNED PDFs & IMAGES: Call \`inspect_document\` to extract embedded raster images from PDFs for visual inspection.\n` +
      `3. FULL WORKSTATION ACCESS & ACTIVE VISION: You have unrestricted local access and active multimodal vision on ${paths.strataUrl}. Call \`inspect_models(action="test_vision")\` or \`capture_screen\` when testing vision.\n` +
      `4. SELF-RESTART & LOGS: Call \`restart_brain\` to restart Central Brain or \`read_system_logs\` to inspect strata/tray logs.\n` +
      `5. RICH TOOL BELT (Scoped per Turn):\n` +
      `   - Models & Engine: inspect_models, manage_strata, restart_brain, read_system_logs, inspect_system\n` +
      `   - Code & Navigation: code_outline, read_file, write_file, apply_diff, edit_file, run_code_batch, search_codebase, find_files\n` +
      `   - Web & Models: search_web, search_models, download_file, browser_inspect\n` +
      `   - Configuration & System: patch_json, manage_files, http_request, run_terminal\n` +
      `   - Vision & ComfyUI: capture_screen, inspect_window, comfyui (generate, list_workflows, inspect_workflow, status, start_server, free_vram, gemini_image, gemini_video)\n` +
      `=== COMFYUI, MOSS & GOOGLE API MEDIA GENERATION PROTOCOL ===\n` +
      `- When generating images/videos via ComfyUI, ALWAYS call the native \`comfyui\` tool (not raw MCP duplicates). Aliases: "moss" ("Moss Image.json"), "z-image" ("z-image.json"), "krea" ("Famegrid Krea 2 Spice V2 - Simplified.json"), "h3" ("H3 Image Easy Workflow.json"), "qwen" ("Qwen 2.1 Image Edit.json"), and "MiniMax H3.json" for video.\n` +
      `- In Google API mode or ComfyUI Studio mode, prompt enhancers run without waking Strata; you can also call \`comfyui({ action: "gemini_image", prompt: "..." })\` or \`comfyui({ action: "gemini_video", prompt: "..." })\`.\n` +
      `- User workflows directory: "${comfyWfNorm}". Do NOT download duplicate checkpoints.\n` +
      `=== EXECUTION RULES ===\n` +
      `1. Empirical verification first (inspect_models, find_files, manage_files, read_file) before claiming anything is missing or broken.\n` +
      `2. Execute end-to-end without stopping midway to ask permission when the user already requested implementation, builds, or fixes.\n` +
      `3. Never call \`manage_strata(action="restart")\` while writing/testing code unless explicitly requested.\n` +
      `4. Scheduled timers: use \`schedule\`; background tasks: \`manage_task\`; subagents: \`invoke_subagent\`; artifacts: \`write_artifact\`.\n` +
      `5. Build verification: run \`npm --prefix client run build\` or \`npm --prefix server run build\` after edits; use \`publish_release\` when asked to release.\n\n` +
      (p.skillsSection ? `${p.skillsSection}\n\n` : '') +
      (p.mcpInstructions ? `${p.mcpInstructions}\n\n` : '') +
      (p.modeDirective ? `${p.modeDirective}\n\n` : '') +
      `=== HARNESS² 8-COMPONENT CONTEXT ===\n${p.compiledHarness}\n` +
      (p.customInstructions ? `Custom Instructions: ${p.customInstructions}\n` : '');
  }

  let expanded = systemDirective;
  if (/(?:^|\s)@repo-map(?=\s|$)/i.test(p.promptStr)) {
    expanded += `\n\n=== COMPACT WORKSPACE REPO MAP (@repo-map) ===\n${buildCompactRepoMap(p.projectRoot)}\n`;
  }
  if (/(?:^|\s)@git-diff(?=\s|$)/i.test(p.promptStr)) {
    try {
      const stat = execSync('git diff --stat', { cwd: p.projectRoot, timeout: 4000, encoding: 'utf-8', windowsHide: true });
      const patch = execSync('git diff', { cwd: p.projectRoot, timeout: 4000, encoding: 'utf-8', windowsHide: true }).slice(0, 6000);
      expanded += `\n\n=== LIVE GIT DIFF (@git-diff) ===\n${stat}\n${patch || '(No unstaged changes)'}\n`;
    } catch (diffErr: any) {
      expanded += `\n\n=== LIVE GIT DIFF (@git-diff) ===\n(git diff unavailable: ${diffErr?.message || diffErr})\n`;
    }
  }
  if (/(?:^|\s)@problems(?=\s|$)/i.test(p.promptStr)) {
    const wsProblems = new LspDiagnosticsManager().getWorkspaceDiagnostics(p.projectRoot);
    const probText =
      wsProblems.length === 0 ? 'No syntax/parse problems detected in workspace.' : JSON.stringify(wsProblems, null, 2);
    expanded += `\n\n=== WORKSPACE DIAGNOSTICS (@problems) ===\n${probText}\n`;
  }

  return expanded;
}
