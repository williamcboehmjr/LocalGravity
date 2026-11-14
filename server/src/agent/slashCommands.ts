import type { ThinkingBudget } from '../db/database.js';

export interface SlashCommandParseResult {
  command: string | null;
  cleanPrompt: string;
  modeDirective: string;
  maxToolSteps: number;
  maxAutoContinues: number;
  forceThinkingBudget?: ThinkingBudget;
  subagentRole: string;
}

const KNOWN_SLASH_COMMANDS =
  'goal|plan|boost|grill-me|teamwork|restart|browser|learn|schedule|vision|swarm';

export function parseAntigravitySlashCommand(rawPrompt: string): SlashCommandParseResult {
  const trimmed = rawPrompt.trim();
  const cmdRegex = new RegExp(`(^|\\s)\\/(${KNOWN_SLASH_COMMANDS})(?=\\s|$)`, 'i');
  const match = trimmed.match(cmdRegex);
  if (!match) {
    return {
      command: null,
      cleanPrompt: rawPrompt,
      modeDirective: '',
      maxToolSteps: 32,
      maxAutoContinues: 5,
      subagentRole: 'Autonomous Engineer',
    };
  }

  const cmd = match[2].toLowerCase();
  const body = trimmed
    .replace(cmdRegex, (_full, leadingWs: string) => (leadingWs ? ' ' : ''))
    .replace(/\s{2,}/g, ' ')
    .trim();

  switch (cmd) {
    case 'goal':
      return {
        command: '/goal',
        cleanPrompt: body || 'Complete the active workspace objective thoroughly from end to end.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /goal (RELENTLESS AUTONOMOUS GOAL EXECUTION) ===\n' +
          'You are operating in /goal mode. Do NOT stop until the goal is 100% achieved, implemented, and verified.\n' +
          '1. Decompose the goal into concrete phases.\n' +
          '2. Execute all required file inspections, edits, and terminal verifications.\n' +
          '3. Never stop after merely reading files—follow through all the way to the finished deliverable.',
        maxToolSteps: 50,
        maxAutoContinues: 5,
        subagentRole: 'Goal Executor',
      };
    case 'plan':
      return {
        command: '/plan',
        cleanPrompt: body || 'Create a comprehensive step-by-step architectural implementation plan for this workspace.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /plan (ARCHITECTURAL IMPLEMENTATION PLANNER) ===\n' +
          'Inspect the relevant files in the workspace first, then produce a structured, production-grade Markdown Implementation Plan containing:\n' +
          '1. Objective & Architectural Overview\n' +
          '2. Proposed File Changes (with exact file paths & responsibilities)\n' +
          '3. Step-by-Step Execution Checklist\n' +
          '4. Verification & Testing Strategy',
        maxToolSteps: 25,
        maxAutoContinues: 2,
        subagentRole: 'System Architect',
      };
    case 'boost':
      return {
        command: '/boost',
        cleanPrompt: body || 'Perform a deep, multi-perspective architectural analysis and verification.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /boost (DEEP MULTI-PERSPECTIVE REASONING & VERIFICATION) ===\n' +
          'Engage maximum analytical rigor: evaluate correctness, edge cases, concurrency/state bugs, and maintainability.\n' +
          'Cross-check assumptions against the real source files before delivering a comprehensive, verified solution.',
        maxToolSteps: 38,
        maxAutoContinues: 2,
        forceThinkingBudget: 'deep',
        subagentRole: 'Principal Verifier',
      };
    case 'grill-me':
      return {
        command: '/grill-me',
        cleanPrompt: body || 'Interview me to align on design decisions and requirements for our next feature or refactor.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /grill-me (INTERACTIVE DESIGN INTERVIEW) ===\n' +
          'Briefly inspect the workspace context if helpful, then ask the user 3 to 5 high-leverage architectural/design questions.\n' +
          'For each question, provide clear options with a "(Recommended)" default and explain the trade-off concisely.',
        maxToolSteps: 15,
        maxAutoContinues: 2,
        subagentRole: 'Design Interviewer',
      };
    case 'teamwork':
      return {
        command: '/teamwork',
        cleanPrompt: body || 'Coordinate a multi-agent team to analyze, architect, and improve this project.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /teamwork (AUTONOMOUS MULTI-AGENT TEAMWORK) ===\n' +
          'Execute this task by coordinating four specialized subagent phases sequentially:\n' +
          '- [Subagent 1: Codebase Researcher] — Map relevant files and dependencies.\n' +
          '- [Subagent 2: Lead Architect] — Formulate the modular design.\n' +
          '- [Subagent 3: Implementation Specialist] — Write or refactor the code.\n' +
          '- [Subagent 4: QA Verifier] — Validate build & runtime integrity.\n' +
          'Present the final output clearly organized by team findings and actions.',
        maxToolSteps: 45,
        maxAutoContinues: 2,
        subagentRole: 'Team Coordinator',
      };
    case 'restart':
      return {
        command: '/restart',
        cleanPrompt: body || 'Restart LocalGravity Central Brain and reload runtime state.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /restart (SUPERVISED SELF-RESTART) ===\n' +
          'The user requested a self-restart. Acknowledge that you are signaling the Windows Taskbar Supervisor to recycle the server and reconnect.',
        maxToolSteps: 5,
        maxAutoContinues: 0,
        subagentRole: 'System Supervisor',
      };
    case 'browser':
      return {
        command: '/browser',
        cleanPrompt: body || 'Use headless Playwright browser automation to inspect or research the target.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /browser (PLAYWRIGHT WEB AUTOMATION AGENT) ===\n' +
          'Immediately use the `browse_url` tool (Playwright headless browser) to navigate to the URL or search target, extract the live DOM text, and synthesize the findings.',
        maxToolSteps: 25,
        maxAutoContinues: 2,
        subagentRole: 'Browser Agent',
      };
    case 'learn':
      return {
        command: '/learn',
        cleanPrompt: body || 'Persist the key lessons and architectural rules from our session into Harness² memory.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /learn (PERSIST TO HARNESS² MEMORY) ===\n' +
          'Read `.localgravity/harness/memory.md` (or `skills.md`), distill the user\'s instruction or lesson into a clear, permanent engineering rule, write the updated file back to disk using `write_file`, and confirm what was learned.',
        maxToolSteps: 20,
        maxAutoContinues: 2,
        subagentRole: 'Harness² Learner',
      };
    case 'schedule':
      return {
        command: '/schedule',
        cleanPrompt: body || 'Design and configure a scheduled background automation task.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /schedule (BACKGROUND AUTOMATION DESIGNER) ===\n' +
          'Design a scheduled automation workflow for the user\'s request, specifying the cron schedule, execution command, and persistence in `.localgravity/harness/scripts.md`.',
        maxToolSteps: 20,
        maxAutoContinues: 2,
        subagentRole: 'Automation Scheduler',
      };
    case 'vision':
      return {
        command: '/vision',
        cleanPrompt: body || 'Verify Strata Qwen 3.8 Flash-Next multimodal vision pipeline and inspect the current desktop screen.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /vision (STRATA MULTIMODAL VISION & SCREEN INSPECTOR) ===\n' +
          'Call `inspect_models` with `{"action": "test_vision"}` or `capture_screen` to inspect the live visual state using Qwen 3.8 Flash-Next Vision on Strata port 8080, and report the exact visual findings.',
        maxToolSteps: 15,
        maxAutoContinues: 1,
        subagentRole: 'Vision Specialist',
      };
    case 'swarm':
      return {
        command: '/swarm',
        cleanPrompt: body || 'Coordinate a multi-agent swarm on the shared message board to decompose and execute this task.',
        modeDirective:
          '=== SLASH COMMAND ACTIVE: /swarm (SINGLE-GPU MULTI-AGENT SWARM COORDINATOR) ===\n' +
          'You are the Swarm Coordinator. Use `swarm`, `post_message`, `read_board`, and `swarm_wait` to spawn specialized workers (e.g., researcher, author, verifier).\n' +
          '1. Set a swarm title with `swarm({ action: "title", title: "..." })`.\n' +
          '2. Spawn independent workers with `swarm({ action: "add", name, brief, workspace: "share"|"inherit" })`.\n' +
          '3. Coordinate handoffs with @name mentions via `post_message`, read results with `read_board`, and kill finished workers before synthesizing the final response.',
        maxToolSteps: 45,
        maxAutoContinues: 2,
        subagentRole: 'Swarm Coordinator',
      };
    default:
      return {
        command: null,
        cleanPrompt: rawPrompt,
        modeDirective: '',
        maxToolSteps: 32,
        maxAutoContinues: 5,
        subagentRole: 'Autonomous Engineer',
      };
  }
}
