export interface PrunableMessage {
  role: string;
  content: string;
  [k: string]: any;
}

export function pruneChatMessages(
  messages: Array<PrunableMessage>,
  maxTotalChars = 65000
): PrunableMessage[] {
  const pruned = messages.map((m) => ({ ...m }));

  // Strict Jinja / ChatML normalization:
  // Ensure that ONLY index 0 can be role === 'system'. If any other message has role: 'system', merge it into pruned[0]
  if (pruned.length > 0 && pruned[0].role !== 'system') {
    for (let i = 1; i < pruned.length; i++) {
      if (pruned[i].role === 'system') {
        pruned[i].role = 'user';
      }
    }
  } else if (pruned.length > 0) {
    for (let i = 1; i < pruned.length; i++) {
      if (pruned[i].role === 'system') {
        pruned[0].content += '\n\n' + pruned[i].content;
        pruned.splice(i, 1);
        i--;
      }
    }
  }

  // Protect the most recent step's tool outputs (last 4 messages) so the model ALWAYS sees the full output of tools it just called!
  const recentProtectedBoundary = Math.max(1, pruned.length - 4);

  let total = pruned.reduce((acc, m) => acc + (m.content?.length || 0), 0);
  if (total <= maxTotalChars) return pruned;

  // Stage 1: Compact older historical tool outputs (from 2+ steps ago)
  for (let i = 1; i < recentProtectedBoundary && total > maxTotalChars; i++) {
    if (pruned[i].role === 'tool' && pruned[i].content && pruned[i].content.length > 1800) {
      const reduction = pruned[i].content.length - 1400;
      pruned[i].content =
        pruned[i].content.slice(0, 1000) +
        '\n... [Historical step output compacted after analysis] ...\n' +
        pruned[i].content.slice(-400);
      total -= reduction;
    }
  }

  if (total <= maxTotalChars) return pruned;

  // Stage 2: More aggressive compaction on older historical tool outputs (3+ steps ago)
  for (let i = 1; i < recentProtectedBoundary && total > maxTotalChars; i++) {
    if (pruned[i].role === 'tool' && pruned[i].content && pruned[i].content.length > 600) {
      const reduction = pruned[i].content.length - 500;
      pruned[i].content =
        pruned[i].content.slice(0, 350) +
        '\n... [Completed historical step compacted] ...\n' +
        pruned[i].content.slice(-150);
      total -= reduction;
    }
  }

  if (total <= maxTotalChars) return pruned;

  // Stage 3: Only if even the protected recent tool outputs alone exceed budget (e.g., 4 parallel 24k reads), cap individual protected tool outputs at 18,000 chars
  for (let i = recentProtectedBoundary; i < pruned.length && total > maxTotalChars; i++) {
    if (pruned[i].role === 'tool' && pruned[i].content && pruned[i].content.length > 18000) {
      const reduction = pruned[i].content.length - 16000;
      pruned[i].content =
        pruned[i].content.slice(0, 11500) +
        '\n... [Middle lines omitted for context budget] ...\n' +
        pruned[i].content.slice(-4500);
      total -= reduction;
    }
  }

  if (total <= maxTotalChars) return pruned;

  // Stage 4: Drop oldest historical turns from index 1 while preserving valid assistant/tool pairs
  while (pruned.length > 4 && total > maxTotalChars) {
    const item = pruned[1];
    if (item.role === 'user' || (item.role === 'assistant' && !item.tool_calls)) {
      const dropped = pruned.splice(1, 1)[0];
      total -= (dropped.content?.length || 0);
    } else if (item.role === 'assistant' && item.tool_calls) {
      const dropped = pruned.splice(1, 1)[0];
      total -= (dropped.content?.length || 0);
      while (pruned.length > 1 && (pruned[1] as any).role === 'tool') {
        const droppedTool = pruned.splice(1, 1)[0];
        total -= (droppedTool.content?.length || 0);
      }
    } else {
      const dropped = pruned.splice(1, 1)[0];
      total -= (dropped.content?.length || 0);
    }
  }

  return pruned;
}
