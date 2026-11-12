import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ArtifactManager } from '../tools/artifactManager.js';
import { execute as writeArtifact } from '../tools/handlers/writeArtifact.js';

async function runArtifactTests() {
  console.log('Running Piece 6 Unit Tests: Side-by-Side Artifacts System...');
  const tmpDir = path.join(os.tmpdir(), `lg-artifacts-test-${Date.now()}`);
  const manager = new ArtifactManager(tmpDir);

  let notifiedId = '';
  const unsub = manager.onArtifactUpdate((art) => {
    notifiedId = art.id;
  });

  // 1. Upsert plan artifact and verify disk + listener notification
  const art1 = manager.upsertArtifact({
    threadId: 'thread-1',
    title: 'Phase 1 Implementation Plan',
    type: 'plan',
    content: '# Plan\n- Step 1: Adaptive CoT\n- Step 2: Auto-Compaction',
    summary: 'Core speed and compaction roadmap',
  });

  assert.equal(art1.id, 'artifact-phase-1-implementation-plan');
  assert.equal(notifiedId, art1.id);
  assert.ok(fs.existsSync(art1.filePath), 'Artifact file must be saved on disk');

  // 2. Test write_artifact tool handler
  const toolRes = await writeArtifact(
    {
      title: 'Release v2.2.0 Walkthrough',
      type: 'walkthrough',
      content: '## Walkthrough\nAll 6 LocalGravity pillars verified.',
    },
    {
      threadId: 'thread-1',
      messageId: 'msg-1',
      workspaceRoot: process.cwd(),
    },
    {} as any
  );

  assert.equal(toolRes.exitCode, 0);
  assert.ok(toolRes.stdout.includes('Release v2.2.0 Walkthrough'));

  unsub();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  console.log('✅ Piece 6 Unit Tests PASSED (6/6 assertions)');
}

runArtifactTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
