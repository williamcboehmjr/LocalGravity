import { PrunableMessage, pruneChatMessages } from './messagePruning.js';

export interface AutoCompactionResult {
  messages: PrunableMessage[];
  didCompact: boolean;
  previousChars: number;
  compactedChars: number;
  previousTokens: number;
  compactedTokens: number;
  compactedTurnCount: number;
  summary: string;
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
  keepRecentCount = 6
): AutoCompactionResult {
  const previousChars = messages.reduce(
    (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length),
    0
  );
  const previousTokens = Math.max(1, Math.ceil(previousChars / 4));

  // If below threshold or too few messages to compact, return pruned messages directly
  if (previousChars <= thresholdChars || messages.length <= keepRecentCount + 2) {
    const pruned = pruneChatMessages(messages, thresholdChars);
    const afterChars = pruned.reduce(
      (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length),
      0
    );
    const didPrune = afterChars < previousChars;
    return {
      messages: pruned,
      didCompact: didPrune,
      previousChars,
      compactedChars: afterChars,
      previousTokens,
      compactedTokens: Math.max(1, Math.ceil(afterChars / 4)),
      compactedTurnCount: didPrune ? messages.length - keepRecentCount : 0,
      summary: didPrune
        ? `Pruned historical tool outputs (${previousTokens} → ${Math.ceil(afterChars / 4)} tok)`
        : '',
    };
  }

  const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
  const startIdx = systemMsg ? 1 : 0;
  const recentBoundary = Math.max(startIdx + 1, messages.length - keepRecentCount);

  const middleMessages = messages.slice(startIdx, recentBoundary);
  const recentMessages = messages.slice(recentBoundary);

  const userObjectives: string[] = [];
  const toolSummaries: string[] = [];
  const assistantMilestones: string[] = [];

  for (const msg of middleMessages) {
    const rawContent: any = msg.content;
    const text =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
        ? rawContent.map((p: any) => p.text || '').join(' ')
        : '';

    if (msg.role === 'user' && text.trim()) {
      const clean = text.replace(/\s+/g, ' ').trim().slice(0, 220);
      if (!clean.startsWith('[CONTEXT AUTO-COMPACTED')) {
        userObjectives.push(clean);
      }
    } else if (msg.role === 'assistant') {
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const fnName = tc?.function?.name || 'tool';
          let argPreview = '';
          try {
            const parsed = JSON.parse(tc?.function?.arguments || '{}');
            argPreview = parsed.path || parsed.command || parsed.query || parsed.url || '';
          } catch {}
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
    `[CONTEXT AUTO-COMPACTED • WORKING MEMORY DISTILLATION]`,
    `Compacted ${middleMessages.length} earlier messages to keep inference fast and focused.`,
  ];

  if (userObjectives.length > 0) {
    distilledLines.push(
      `• Earlier User Requests:\n  - ${userObjectives.slice(-5).join('\n  - ')}`
    );
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

  const finalMessages = pruneChatMessages(assembled, thresholdChars);
  const compactedChars = finalMessages.reduce(
    (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length),
    0
  );
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
  };
}
