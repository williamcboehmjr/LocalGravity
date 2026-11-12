// One-shot refactor: extract handlePromptTurn from index.ts into agent/promptTurn.ts
import fs from 'node:fs';
const SRC = new URL('../src/index.ts', import.meta.url);
let text = fs.readFileSync(SRC, 'utf8');

const headerMatch = text.match(/async function handlePromptTurn\(params: \{/);
if (!headerMatch) throw new Error('handlePromptTurn not found');
const startIdx = headerMatch.index;

// Brace match from the first '{' after "params: {" opening — we need to find the body's opening brace.
// The signature is: async function handlePromptTurn(params: { ... }) { BODY }
// Find end of params type object then end of param list, then body open brace.
let i = text.indexOf('{', startIdx + headerMatch[0].length - 1); // this is the params-type '{'
// match the params type object braces
function matchBrace(from) {
  let depth = 0;
  for (let j = from; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') { depth--; if (depth === 0) return j; }
  }
  throw new Error('unbalanced');
}
const paramsTypeEnd = matchBrace(i);
// after params type: ) { BODY }
const bodyOpen = text.indexOf('{', paramsTypeEnd + 1);
const bodyClose = matchBrace(bodyOpen);

const signature = text.slice(startIdx, bodyOpen); // "async function handlePromptTurn(params: {...})"
const bodyText = text.slice(bodyOpen + 1, bodyClose); // verbatim body (without outer braces)

// Detect which closure identifiers the body references
const candidates = {
  db: 'db', tabby: 'tabby', mcp: 'mcp', skills: 'skills', tools: 'tools', harness: 'harness',
  terminal: 'terminal', broadcastSync: 'broadcastSync', activeAbortControllers: 'activeAbortControllers',
};
const usedDeps = Object.keys(candidates).filter((k) => new RegExp('\\b' + k + '\\b').test(bodyText));

// static imports the body may need (now imported directly in promptTurn.ts, not passed as deps)
const statics = {
  pruneChatMessages: './utils/messagePruning.js', // will fix relative path below
  detectPrematureStop: '../agent/prematureStop.js',
};

console.log('START_IDX=' + startIdx);
console.log('BODY_START_LINE=' + (text.slice(0, bodyOpen).split('\n').length));
console.log('BODY_END_LINE=' + (text.slice(0, bodyClose).split('\n').length));
console.log('USED_DEPS=' + usedDeps.join(','));

// Save extracted pieces for inspection / next step
fs.writeFileSync('./scripts/_extracted_signature.txt', signature);
fs.writeFileSync('./scripts/_extracted_body.txt', bodyText);
fs.writeFileSync('./scripts/_used_deps.json', JSON.stringify({ usedDeps }, null, 2));
