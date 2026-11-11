import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tests = [
  'adaptiveCot.test.js',
  'autoCompactor.test.js',
  'patchDoctor.test.js',
  'taskManager.test.js',
  'subagentManager.test.js',
  'artifactManager.test.js',
  'turnPipeline.test.js',
  'swarmManager.test.js',
];

console.log('==============================================================');
console.log('🧪 Running LocalGravity 2.2.0 Antigravity 6-Pillar Test Suite');
console.log('==============================================================');

for (const t of tests) {
  const fullPath = path.join(__dirname, t);
  console.log(`\n▶ Running ${t}...`);
  execSync(`node "${fullPath}"`, { stdio: 'inherit' });
}

console.log('\n==============================================================');
console.log('✅ ALL 6 PILLAR UNIT TEST SUITES PASSED (100% GREEN)');
console.log('==============================================================');
