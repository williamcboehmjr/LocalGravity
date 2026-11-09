import type { BuiltinToolHandler } from './types.js';
import { ArtifactManager, ArtifactKind } from '../artifactManager.js';

export const name = 'write_artifact';

export const execute: BuiltinToolHandler = async (args, ctx) => {
  const startMs = Date.now();
  const manager = ArtifactManager.getInstance();
  const title = String(args.title || 'Implementation Plan').trim();
  const content = String(args.content || '').trim();
  const rawType = String(args.type || 'plan').toLowerCase();
  const validTypes: ArtifactKind[] = ['plan', 'walkthrough', 'report', 'code', 'diff'];
  const type: ArtifactKind = validTypes.includes(rawType as ArtifactKind)
    ? (rawType as ArtifactKind)
    : 'report';
  const summary = args.summary ? String(args.summary) : undefined;

  if (!content) {
    return {
      stdout: '',
      stderr: 'write_artifact requires non-empty "content".',
      exitCode: 1,
      durationMs: Date.now() - startMs,
    };
  }

  const artifact = manager.upsertArtifact({
    threadId: ctx.threadId,
    title,
    type,
    content,
    summary,
  });

  return {
    stdout: JSON.stringify(
      {
        message: `Artifact "${artifact.title}" (${artifact.type}) saved and synced to the Side-by-Side Artifacts Drawer.`,
        artifact: {
          id: artifact.id,
          title: artifact.title,
          type: artifact.type,
          filePath: artifact.filePath,
          summary: artifact.summary,
        },
      },
      null,
      2
    ),
    stderr: '',
    exitCode: 0,
    durationMs: Date.now() - startMs,
  };
};
