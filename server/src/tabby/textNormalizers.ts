/**
 * Pure text-normalization helpers used by the TabbyEngine streaming path and the
 * agent loop to guard against degenerate model output (repetition loops).
 *
 * These are intentionally side-effect-free so they can be unit-tested in isolation.
 */

export function hasConsecutiveRepetition(buffer: string): boolean {
  if (!buffer || buffer.length < 24) return false;
  const tail = buffer.slice(-400);
  const match = tail.match(/([^\s].{3,80}?)(?:[\s\n\r]*\1){2,}$/i);
  if (!match) return false;
  // Require at least 2 alphanumeric chars so markdown rules (---, ===), table dividers, or whitespace never trigger
  return /[a-zA-Z0-9].*[a-zA-Z0-9]/.test(match[1]);
}

export function deduplicateRepeatedSequences(text: any): any {
  if (typeof text !== 'string') {
    if (Array.isArray(text)) {
      return text.map((part) => {
        if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
          return { ...part, text: deduplicateRepeatedSequences(part.text) };
        }
        return part;
      });
    }
    return text;
  }
  if (!text || text.length < 20) return text;
  const lines = text.split(/\r?\n/);
  const dedupLines: string[] = [];
  let prevTrimmed = '';
  let consecutiveCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 5 && trimmed === prevTrimmed) {
      consecutiveCount++;
    } else {
      prevTrimmed = trimmed;
      consecutiveCount = 1;
    }

    // Only collapse when 3 or more consecutive identical lines occur (preserving legitimate 2-line repeats)
    if (consecutiveCount >= 3 && trimmed.length > 5) {
      continue;
    }
    dedupLines.push(lines[i]);
  }
  let result = dedupLines.join('\n');
  result = result.replace(/([^.!?\n]{6,}[.!?])(?:\s*\1){2,}/gi, '$1');
  result = result.replace(/\b([a-zA-Z0-9_\-]{3,25}(?:\s+[a-zA-Z0-9_\-]{3,25}){0,3})\b(?:\s+\1\b){3,}/gi, '$1');
  return result;
}
