import { readFileSync } from 'fs';

const lines = readFileSync('server/src/tools/builtinTools.ts', 'utf8').split('\n');

// Find all top-level `case '<name>':` inside executeTool switch.
let inSwitch = false;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  // Match a case line with a quoted tool name, indented ~8 spaces (switch body).
  const m = l.match(/^\s{6,12}case\s+'([a-z_]+)'\s*:/);
  if (m) {
    console.log(`${i + 1}: ${m[1]}`);
  }
}
