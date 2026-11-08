/**
 * Pure text-normalization helpers used by the TabbyEngine streaming path and the
 * agent loop to guard against degenerate model output (repetition loops).
 *
 * These are intentionally side-effect-free so they can be unit-tested in isolation.
 */

export function hasConsecutiveRepetition(buffer: string): boolean {
  if (!buffer || buffer.length < 16) return false;
  const tail = buffer.slice(-300);
  const match = tail.match(/(.{4,80}?)(?:[\s\n\r]*\1){2,}$/i);
  return !!match;
}

export function deduplicateRepeatedSequences(text: string): string {
  if (!text || text.length < 20) return text;
  const lines = text.split(/\r?\n/);
  const dedupLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (dedupLines.length >= 1 && trimmed.length > 5 && trimmed === dedupLines[dedupLines.length - 1].trim()) {
      continue;
    }
    dedupLines.push(lines[i]);
  }
  let result = dedupLines.join('\n');
  result = result.replace(/([^.!?\n]{6,}[.!?])(?:\s*\1){2,}/gi, '$1');
  result = result.replace(/\b([a-zA-Z0-9_\-]{3,25}(?:\s+[a-zA-Z0-9_\-]{3,25}){0,3})\b(?:\s+\1\b){3,}/gi, '$1');
  return result.trim();
}
