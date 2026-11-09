import { readFileSync, writeFileSync } from 'fs';

const file = 'server/src/tools/builtinTools.ts';
let lines = readFileSync(file, 'utf8').split('\n');

// Find a case block start line index for a given tool name.
function findCaseStart(name) {
  const re = new RegExp(`^\\s*case\\s+'${name}'\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

// Given a case start index, find the matching closing brace of its block body.
function findBlockEnd(startIdx) {
  // The block opens with `{` on/after the case line. Track depth from that brace.
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    const l = lines[i];
    for (const ch of l) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; if (started && depth === 0) return i; }
    }
  }
  return -1;
}

// Remove blocks for these tools. Collect ranges, then delete from highest start to lowest
// so indices stay valid.
const targets = ['read_system_logs', 'list_skills', 'read_skill', 'call_mcp_tool'];
const ranges = [];
for (const t of targets) {
  const s = findCaseStart(t);
  if (s === -1) { console.log(`NOT FOUND: ${t}`); continue; }
  const e = findBlockEnd(s);
  ranges.push([s, e]);
}

// Sort descending by start.
ranges.sort((a, b) => b[0] - a[0]);

for (const [s, e] of ranges) {
  // Include trailing blank line after the block if present.
  let end = e;
  while (end + 1 < lines.length && lines[end + 1].trim() === '') { end++; }
  lines.splice(s, end - s + 1);
}

writeFileSync(file, lines.join('\n'));
console.log('Removed ranges:', JSON.stringify(ranges));
console.log('New line count:', lines.length);
