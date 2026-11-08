import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAntigravitySlashCommand } from '../slashCommands.js';

test('non-slash prompt returns command=null with defaults', () => {
  const r = parseAntigravitySlashCommand('hello world');
  assert.equal(r.command, null);
  assert.equal(r.cleanPrompt, 'hello world');
  assert.equal(r.modeDirective, '');
  assert.equal(r.maxToolSteps, 32);
  assert.equal(r.maxAutoContinues, 2);
  assert.equal(r.subagentRole, 'Autonomous Engineer');
});

test('unknown slash command falls through to defaults', () => {
  const r = parseAntigravitySlashCommand('/frobnicate body text');
  assert.equal(r.command, null);
  assert.equal(r.cleanPrompt, '/frobnicate body text');
  assert.equal(r.maxToolSteps, 32);
});

test('leading whitespace is trimmed before matching', () => {
  const r = parseAntigravitySlashCommand('   /plan design the api   ');
  assert.equal(r.command, '/plan');
  assert.equal(r.cleanPrompt, 'design the api');
});

test('/goal parses body and overrides maxToolSteps=50', () => {
  const r = parseAntigravitySlashCommand('/goal ship the feature');
  assert.equal(r.command, '/goal');
  assert.equal(r.cleanPrompt, 'ship the feature');
  assert.equal(r.maxToolSteps, 50);
  assert.match(r.modeDirective, /RELENTLESS AUTONOMOUS GOAL EXECUTION/);
});

test('/plan uses default prompt and maxToolSteps=25', () => {
  const r = parseAntigravitySlashCommand('/plan');
  assert.equal(r.command, '/plan');
  assert.match(r.cleanPrompt, /step-by-step architectural implementation plan/);
  assert.equal(r.maxToolSteps, 25);
});

test('/boost forces thinking budget deep and maxToolSteps=38', () => {
  const r = parseAntigravitySlashCommand('/boost verify concurrency');
  assert.equal(r.command, '/boost');
  assert.equal(r.forceThinkingBudget, 'deep');
  assert.equal(r.maxToolSteps, 38);
});

test('commands without forceThinkingBudget leave it undefined', () => {
  const r = parseAntigravitySlashCommand('/goal test');
  assert.equal(r.forceThinkingBudget, undefined);
});

test('/grill-me sets maxToolSteps=15 and Design Interviewer role', () => {
  const r = parseAntigravitySlashCommand('/grill-me');
  assert.equal(r.command, '/grill-me');
  assert.equal(r.maxToolSteps, 15);
  assert.equal(r.subagentRole, 'Design Interviewer');
});

test('/teamwork sets maxToolSteps=45 and Team Coordinator role', () => {
  const r = parseAntigravitySlashCommand('/teamwork build it');
  assert.equal(r.command, '/teamwork');
  assert.equal(r.maxToolSteps, 45);
  assert.equal(r.subagentRole, 'Team Coordinator');
});

test('/browser sets Browser Agent role', () => {
  const r = parseAntigravitySlashCommand('/browser https://example.com');
  assert.equal(r.command, '/browser');
  assert.equal(r.maxToolSteps, 25);
  assert.equal(r.subagentRole, 'Browser Agent');
});

test('/learn sets Harness² Learner role', () => {
  const r = parseAntigravitySlashCommand('/learn remember this rule');
  assert.equal(r.command, '/learn');
  assert.equal(r.maxToolSteps, 20);
  assert.equal(r.subagentRole, 'Harness² Learner');
});

test('/schedule sets Automation Scheduler role', () => {
  const r = parseAntigravitySlashCommand('/schedule daily summary');
  assert.equal(r.command, '/schedule');
  assert.equal(r.maxToolSteps, 20);
  assert.equal(r.subagentRole, 'Automation Scheduler');
});

test('command name is case-insensitive', () => {
  const r = parseAntigravitySlashCommand('/GOAL do it');
  assert.equal(r.command, '/goal');
});

test('multiline body is preserved in cleanPrompt', () => {
  const r = parseAntigravitySlashCommand('/plan line one\nline two');
  assert.equal(r.cleanPrompt, 'line one\nline two');
});

test('empty command token after slash does not match (defaults)', () => {
  const r = parseAntigravitySlashCommand('/ hello');
  assert.equal(r.command, null);
});
