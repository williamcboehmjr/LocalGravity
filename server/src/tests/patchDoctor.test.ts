import assert from 'node:assert/strict';
import { applyFuzzyPatch } from '../utils/patchDoctor.js';

function runPatchDoctorTests() {
  console.log('Running Piece 3 Unit Tests: Fuzzy Patch Doctor...');

  // 1. Exact match
  const src1 = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
  const res1 = applyFuzzyPatch(src1, 'const b = 2;', 'const b = 20;');
  assert.equal(res1.ok, true);
  assert.equal(res1.strategy, 'exact');
  assert.ok(res1.newContent.includes('const b = 20;'));

  // 2. CRLF vs LF normalized match (source uses \r\n, target uses \n)
  const src2 = 'function greet() {\r\n  return "hello";\r\n}\r\n';
  const res2 = applyFuzzyPatch(src2, 'function greet() {\n  return "hello";\n}', 'function greet() {\n  return "hi";\n}');
  assert.equal(res2.ok, true);
  assert.equal(res2.strategy, 'crlf_normalized');
  assert.ok(res2.newContent.includes('\r\n'), 'Must preserve CRLF line endings');
  assert.ok(res2.newContent.includes('return "hi";'));

  // 3. Trailing whitespace mismatch
  const src3 = 'const x = 10;   \nconst y = 20;\t\n';
  const res3 = applyFuzzyPatch(src3, 'const x = 10;\nconst y = 20;', 'const x = 100;\nconst y = 200;');
  assert.equal(res3.ok, true);
  assert.equal(res3.strategy, 'trailing_whitespace');
  assert.ok(res3.newContent.includes('const x = 100;'));

  // 4. Fuzzy indentation mismatch (source has 14 spaces, model sent 4 spaces)
  const src4 = 'export function App() {\n              <span className="title">Brain offline</span>\n              <span className="sub">Retry</span>\n}\n';
  const res4 = applyFuzzyPatch(
    src4,
    '    <span className="title">Brain offline</span>\n    <span className="sub">Retry</span>',
    '              <ReconnectBadge />\n              <span className="title">Brain offline</span>'
  );
  assert.equal(res4.ok, true);
  assert.equal(res4.strategy, 'fuzzy_indentation');
  assert.ok(res4.newContent.includes('<ReconnectBadge />'));

  // 5. Diagnostic hint when target does not match
  const src5 = 'line 1\nconst specialValue = 42;\nconst otherLine = 99;\n';
  const res5 = applyFuzzyPatch(src5, 'const specialValue = 42;\nconst wrongLine = 123;', 'replacement');
  assert.equal(res5.ok, false);
  assert.ok(res5.diagnosticHint?.includes('near line 2'), 'Must provide line number diagnostic hint');

  console.log('✅ Piece 3 Unit Tests PASSED (12/12 assertions)');
}

runPatchDoctorTests();
