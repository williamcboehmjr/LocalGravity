export type PatchMatchStrategy =
  | 'exact'
  | 'crlf_normalized'
  | 'trailing_whitespace'
  | 'fuzzy_indentation'
  | 'none';

export interface PatchDoctorResult {
  ok: boolean;
  newContent: string;
  strategy: PatchMatchStrategy;
  matchedLineStart?: number;
  matchedLineEnd?: number;
  diagnosticHint?: string;
}

/**
 * Fuzzy "Patch Doctor" for resilient code edits (`apply_diff`).
 * Handles:
 * 1. Exact matches
 * 2. CRLF (\r\n) vs LF (\n) line-ending differences (preserving file's native EOL)
 * 3. Trailing whitespace differences per line
 * 4. Leading indentation differences (fuzzy trimmed line-by-line matching)
 */
export function applyFuzzyPatch(
  source: string,
  target: string,
  replacement: string
): PatchDoctorResult {
  if (!target) {
    return {
      ok: false,
      newContent: source,
      strategy: 'none',
      diagnosticHint: 'Target string cannot be empty.',
    };
  }

  // Pass 1: Exact substring match
  const exactIdx = source.indexOf(target);
  if (exactIdx !== -1) {
    const before = source.slice(0, exactIdx);
    const after = source.slice(exactIdx + target.length);
    const lineStart = before.split(/\r?\n/).length;
    const lineEnd = lineStart + target.split(/\r?\n/).length - 1;
    return {
      ok: true,
      newContent: before + replacement + after,
      strategy: 'exact',
      matchedLineStart: lineStart,
      matchedLineEnd: lineEnd,
    };
  }

  const usesCrlf = source.includes('\r\n');
  const eol = usesCrlf ? '\r\n' : '\n';
  const normSource = source.replace(/\r\n/g, '\n');
  const normTarget = target.replace(/\r\n/g, '\n');
  const normReplacement = replacement.replace(/\r\n/g, '\n');

  // Pass 2: CRLF / LF normalized match
  const crlfIdx = normSource.indexOf(normTarget);
  if (crlfIdx !== -1) {
    const before = normSource.slice(0, crlfIdx);
    const after = normSource.slice(crlfIdx + normTarget.length);
    const lineStart = before.split('\n').length;
    const lineEnd = lineStart + normTarget.split('\n').length - 1;
    const combined = before + normReplacement + after;
    return {
      ok: true,
      newContent: usesCrlf ? combined.replace(/\n/g, '\r\n') : combined,
      strategy: 'crlf_normalized',
      matchedLineStart: lineStart,
      matchedLineEnd: lineEnd,
    };
  }

  const srcLines = normSource.split('\n');
  const tgtLines = normTarget.split('\n');

  // Strip trailing empty line from target if model included a trailing newline
  if (tgtLines.length > 1 && tgtLines[tgtLines.length - 1] === '') {
    tgtLines.pop();
  }

  const m = tgtLines.length;
  const n = srcLines.length;

  if (m > 0 && m <= n) {
    // Pass 3: Trailing-whitespace insensitive match
    for (let i = 0; i <= n - m; i++) {
      let match = true;
      for (let j = 0; j < m; j++) {
        if (srcLines[i + j].trimEnd() !== tgtLines[j].trimEnd()) {
          match = false;
          break;
        }
      }
      if (match) {
        const replLines = normReplacement.replace(/\n$/, '').split('\n');
        const updatedLines = [
          ...srcLines.slice(0, i),
          ...replLines,
          ...srcLines.slice(i + m),
        ];
        return {
          ok: true,
          newContent: updatedLines.join(eol),
          strategy: 'trailing_whitespace',
          matchedLineStart: i + 1,
          matchedLineEnd: i + m,
        };
      }
    }

    // Pass 4: Fuzzy indentation (trimmed line match)
    for (let i = 0; i <= n - m; i++) {
      let match = true;
      for (let j = 0; j < m; j++) {
        if (srcLines[i + j].trim() !== tgtLines[j].trim()) {
          match = false;
          break;
        }
      }
      if (match) {
        const replLines = normReplacement.replace(/\n$/, '').split('\n');
        const updatedLines = [
          ...srcLines.slice(0, i),
          ...replLines,
          ...srcLines.slice(i + m),
        ];
        return {
          ok: true,
          newContent: updatedLines.join(eol),
          strategy: 'fuzzy_indentation',
          matchedLineStart: i + 1,
          matchedLineEnd: i + m,
        };
      }
    }
  }

  // Diagnostic hint: find the first non-empty target line in source to show surrounding context
  const firstMeaningfulLine = tgtLines.find((l) => l.trim().length > 3)?.trim();
  let diagnosticHint = 'Target block not found in file.';
  if (firstMeaningfulLine) {
    const nearIdx = srcLines.findIndex((l) => l.includes(firstMeaningfulLine));
    if (nearIdx !== -1) {
      const snippetStart = Math.max(0, nearIdx - 2);
      const snippetEnd = Math.min(srcLines.length, nearIdx + Math.min(m + 2, 10));
      const snippet = srcLines
        .slice(snippetStart, snippetEnd)
        .map((line, idx) => `${snippetStart + idx + 1}: ${line}`)
        .join('\n');
      diagnosticHint = `Target block did not match exactly, but found a similar line near line ${nearIdx + 1}:\n${snippet}`;
    }
  }

  return {
    ok: false,
    newContent: source,
    strategy: 'none',
    diagnosticHint,
  };
}
