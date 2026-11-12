// Build agent/promptTurn.ts from extracted pieces + patch index.ts to use it.
import fs from 'node:fs';

const SRC = new URL('../src/index.ts', import.meta.url);
let text = fs.readFileSync(SRC, 'utf8');
const bodyText = fs.readFileSync('./scripts/_extracted_body.txt', 'utf8');

// Recompute boundaries (must match extract script logic) so we can excise the block.
const headerMatch = text.match(/async function handlePromptTurn\(params: \{/);
if (!headerMatch) throw new Error('handlePromptTurn not found in index.ts');
const startIdx = headerMatch.index;

function matchBrace(from) {
  let depth = 0;
  for (let j = from; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') { depth--; if (depth === 0) return j; }
  }
  throw new Error('unbalanced');
}

const sigOpenType = text.indexOf('{', startIdx + headerMatch[0].length - 1);
const paramsTypeEnd = matchBrace(sigOpenType);
const bodyOpen = text.indexOf('{', paramsTypeEnd + 1);
const bodyClose = matchBrace(bodyOpen);

// Excise the entire function block (startIdx .. bodyClose inclusive) from index.ts.
let patchedIndex = text.slice(0, startIdx) + text.slice(bodyClose + 1);

// Insert factory-constructed handler right where the old function lived.
const insertion =
`  const handlePromptTurn = createPromptTurnHandler({
    db, tabby, mcp, skills, tools, harness, terminal,
    broadcastSync, activeAbortControllers, repoRoot: REPO_ROOT,
  });

`;
patchedIndex = patchedIndex.slice(0, startIdx) + insertion + patchedIndex.slice(startIdx);

// Add the import to index.ts (after slashCommands import line).
patchedIndex = patchedIndex.replace(
  "import { parseAntigravitySlashCommand } from './agent/slashCommands.js';",
  "import { parseAntigravitySlashCommand } from './agent/slashCommands.js';\nimport { createPromptTurnHandler } from './agent/promptTurn.js';"
);

fs.writeFileSync(SRC, patchedIndex);

// Build promptTurn.ts (verbatim body, REPO_ROOT -> repoRoot).
const movedBody = bodyText.replace(/\bREPO_ROOT\b/g, 'repoRoot');

const header = `import type { LocalGravityDB, ModelTier, ThinkingBudget } from '../db/database.js';
import type { TabbyEngine } from '../tabby/tabbyEngine.js';
import { deduplicateRepeatedSequences } from '../tabby/tabbyEngine.js';
import type { McpClientManager } from '../mcp/mcpManager.js';
import type { SkillManager } from '../skills/skillManager.js';
import type { SharedTerminalManager } from '../terminal/terminalManager.js';
import type { BuiltinToolExecutor } from '../tools/builtinTools.js';
import type { Harness2Manager } from '../harness/harnessManager.js';
import { queryHostHardwareTelemetry } from '../utils/telemetry.js';
import { pruneChatMessages } from '../utils/messagePruning.js';
import { detectPrematureStop } from './prematureStop.js';
import { parseAntigravitySlashCommand } from './slashCommands.js';

export interface PromptTurnDeps {
  db: LocalGravityDB;
  tabby: TabbyEngine;
  mcp: McpClientManager;
  skills: SkillManager;
  tools: BuiltinToolExecutor;
  harness: Harness2Manager;
  terminal: SharedTerminalManager;
  broadcastSync: (event: Record<string, any>) => void;
  activeAbortControllers: Map<string, AbortController>;
  repoRoot: string;
}

export function createPromptTurnHandler(deps: PromptTurnDeps) {
  const { db, tabby, mcp, skills, tools, harness, terminal, broadcastSync, activeAbortControllers, repoRoot } = deps;

  return async function handlePromptTurn(params: {
    threadId: string;
    prompt: string;
    tier: ModelTier;
    thinkingBudget: ThinkingBudget;
    attachments?: any[];
  }) {`;

const footer = `
  };
}
`;

fs.writeFileSync(new URL('../src/agent/promptTurn.ts', import.meta.url), header + movedBody + footer);

console.log('OK: wrote agent/promptTurn.ts and patched index.ts');
console.log('index.ts new length lines:', patchedIndex.split('\n').length);
