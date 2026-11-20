import {
  PrunableMessage,
  extractMessageText,
  measureMessageLength,
  measureMessageTextLength,
  pruneChatMessages,
} from './messagePruning.js';

export interface AutoCompactionOptions {
  forceCompact?: boolean;
  pruneBudgetChars?: number;
}

export interface AutoCompactionResult {
  messages: PrunableMessage[];
  didCompact: boolean;
  previousChars: number;
  compactedChars: number;
  previousTokens: number;
  compactedTokens: number;
  compactedTurnCount: number;
  summary: string;
  distilledMemory: string;
}

function isSyntheticUserPrompt(text: string): boolean {
  const clean = text.trim();
  return (
    clean.startsWith('[ACTION REQUIRED') ||
    clean.startsWith('[System Auto-Continue') ||
    clean.startsWith('[Visual Capture') ||
    clean.startsWith('[CONTEXT AUTO-COMPACTED')
  );
}

/**
 * Automatically compacts a conversation's message array when it crosses `thresholdChars`.
 * Preserves:
 * 1. The system prompt (index 0)
 * 2. A distilled working-memory summary of all intermediate turns (objectives, tools run, files modified)
 * 3. The most recent `keepRecentCount` messages verbatim so active tool loops have full fidelity.
 */
export function autoCompactMessages(
  messages: PrunableMessage[],
  thresholdChars = 36000,
  keepRecentCount = 6,
  options?: AutoCompactionOptions
): AutoCompactionResult {
  const previousChars = messages.reduce((sum, m) => sum + measureMessageLength(m), 0);
  const previousTokens = Math.max(1, Math.ceil(previousChars / 4));
  const shouldForce = Boolean(options?.forceCompact) || thresholdChars <= 200;
  const effectivePruneBudget =
    options?.pruneBudgetChars ?? (shouldForce ? Math.max(thresholdChars, 32000) : thresholdChars);

  const fallbackPrune = () => {
    const pruned = pruneChatMessages(messages, effectivePruneBudget);
    const afterChars = pruned.reduce((sum, m) => sum + measureMessageLength(m), 0);
    const didPrune = afterChars < previousChars;
    const summaryText = didPrune
      ? `Pruned historical tool outputs (${previousTokens} → ${Math.ceil(afterChars / 4)} tok)`
      : '';
    return {
      messages: pruned,
      didCompact: didPrune,
      previousChars,
      compactedChars: afterChars,
      previousTokens,
      compactedTokens: Math.max(1, Math.ceil(afterChars / 4)),
      compactedTurnCount: didPrune ? Math.max(0, messages.length - keepRecentCount) : 0,
      summary: summaryText,
      distilledMemory: summaryText,
    };
  };

  // If below threshold (and not forced) or too few messages to compact, return pruned messages directly
  if ((!shouldForce && previousChars <= thresholdChars) || messages.length <= keepRecentCount + 2) {
    return fallbackPrune();
  }

  const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
  const startIdx = systemMsg ? 1 : 0;
  let recentBoundary = Math.max(startIdx + 1, messages.length - keepRecentCount);

  // Never split an assistant(tool_calls) message from its role:'tool' replies at recentBoundary.
  while (recentBoundary > startIdx && messages[recentBoundary]?.role === 'tool') {
    recentBoundary--;
  }
  if (recentBoundary <= startIdx || messages[recentBoundary]?.role === 'tool') {
    return fallbackPrune();
  }

  const middleMessages = messages.slice(startIdx, recentBoundary);
  const recentMessages = messages.slice(recentBoundary);

  const userObjectives: string[] = [];
  const toolSummaries: string[] = [];
  const assistantMilestones: string[] = [];
  const filesModified = new Set<string>();
  const filesInspected = new Set<string>();

  const FILE_MODIFY_TOOLS = new Set(['write_file', 'edit_file', 'apply_diff', 'patch_json', 'run_code_batch']);
  const FILE_READ_TOOLS = new Set(['read_file', 'code_outline']);

  for (const msg of middleMessages) {
    const text = extractMessageText(msg.content);

    if (msg.role === 'user' && text.trim()) {
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean.startsWith('[CONTEXT AUTO-COMPACTED')) {
        // Carry forward prior user requests when re-compacting so objectives are never wiped
        const reqMatches = text.match(/^\s{2}-\s+(.+)$/gm);
        if (reqMatches) {
          for (const line of reqMatches) {
            const req = line.replace(/^\s{2}-\s+/, '').trim().slice(0, 260);
            if (req && !isSyntheticUserPrompt(req)) userObjectives.push(req);
          }
        }
        const modMatch = text.match(/^•\s*Files Modified:\s*(.+)$/m);
        if (modMatch?.[1]) {
          for (const p of modMatch[1].split(',').map((s) => s.trim()).filter(Boolean)) {
            filesModified.add(p);
          }
        }
        const readMatch = text.match(/^•\s*Files Inspected:\s*(.+)$/m);
        if (readMatch?.[1]) {
          for (const p of readMatch[1].split(',').map((s) => s.trim()).filter(Boolean)) {
            filesInspected.add(p);
          }
        }
      } else if (!isSyntheticUserPrompt(clean)) {
        userObjectives.push(clean.slice(0, 260));
      }
    } else if (msg.role === 'assistant') {
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const fnName = tc?.function?.name || 'tool';
          let argPreview = '';
          let targetPath = '';
          try {
            const parsed = JSON.parse(tc?.function?.arguments || '{}');
            targetPath = String(parsed.path || parsed.file_path || parsed.target || '').trim();
            argPreview = targetPath || parsed.command || parsed.query || parsed.url || '';
          } catch {}
          if (targetPath) {
            if (FILE_MODIFY_TOOLS.has(fnName)) filesModified.add(targetPath);
            else if (FILE_READ_TOOLS.has(fnName)) filesInspected.add(targetPath);
          }
          toolSummaries.push(argPreview ? `${fnName}(${String(argPreview).slice(0, 60)})` : fnName);
        }
      }
      if (text.trim()) {
        assistantMilestones.push(text.replace(/\s+/g, ' ').trim().slice(0, 180));
      }
    } else if (msg.role === 'tool' && text.trim()) {
      const firstLine = text.trim().split('\n')[0].slice(0, 120);
      if (firstLine && toolSummaries.length < 25) {
        toolSummaries.push(`result: ${firstLine}`);
      }
    }
  }

  const distilledLines: string[] = [
    `[CONTEXT AUTO-COMPACTED — DISTILLED WORKING MEMORY]`,
    `Compacted ${middleMessages.length} earlier messages to keep inference fast and focused.`,
  ];

  if (userObjectives.length > 0) {
    distilledLines.push(
      `• Earlier User Requests:\n  - ${userObjectives.slice(-5).join('\n  - ')}`
    );
    const activeReq = userObjectives[userObjectives.length - 1];
    const hasRecentRealUser = recentMessages.some(
      (m) => m.role === 'user' && !isSyntheticUserPrompt(extractMessageText(m.content))
    );
    if (!hasRecentRealUser && activeReq) {
      distilledLines.push(`[ACTIVE USER REQUEST]: ${activeReq}`);
    }
  }
  if (filesModified.size > 0) {
    distilledLines.push(`• Files Modified: ${Array.from(filesModified).slice(-16).join(', ')}`);
  }
  if (filesInspected.size > 0) {
    distilledLines.push(`• Files Inspected: ${Array.from(filesInspected).slice(-16).join(', ')}`);
  }
  if (toolSummaries.length > 0) {
    const uniqueTools = Array.from(new Set(toolSummaries)).slice(-12);
    distilledLines.push(`• Completed Tool Actions: ${uniqueTools.join(', ')}`);
  }
  if (assistantMilestones.length > 0) {
    distilledLines.push(
      `• Key Progress Notes:\n  - ${assistantMilestones.slice(-4).join('\n  - ')}`
    );
  }

  const summaryBlock = distilledLines.join('\n');

  const assembled: PrunableMessage[] = [];
  if (systemMsg) {
    assembled.push({ ...systemMsg });
  }
  assembled.push({
    role: 'user',
    content: summaryBlock,
  });
  for (const rm of recentMessages) {
    assembled.push({ ...rm });
  }

  const finalMessages = pruneChatMessages(assembled, effectivePruneBudget);
  const compactedChars = finalMessages.reduce((sum, m) => sum + measureMessageLength(m), 0);
  const compactedTokens = Math.max(1, Math.ceil(compactedChars / 4));

  return {
    messages: finalMessages,
    didCompact: true,
    previousChars,
    compactedChars,
    previousTokens,
    compactedTokens,
    compactedTurnCount: middleMessages.length,
    summary: `Auto-compacted ${middleMessages.length} turns (${previousTokens} → ${compactedTokens} tok)`,
    distilledMemory: summaryBlock,
  };
}
export { measureMessageTextLength, measureMessageLength };
