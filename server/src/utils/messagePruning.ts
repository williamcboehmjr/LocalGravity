export interface PrunableMessage {
  role: string;
  content: any;
  [k: string]: any;
}

const BASE64_DATA_URL_REGEX = /data:[^;\s]+;base64,[A-Za-z0-9+/=]+/g;

/**
 * Measures text-only character length of a message's content, stripping inline base64
 * payloads and ignoring non-text multimodal parts (e.g., image_url).
 */
export function measureMessageTextLength(content: any): number {
  if (typeof content === 'string') {
    return content.replace(BASE64_DATA_URL_REGEX, '').length;
  }
  if (Array.isArray(content)) {
    let len = 0;
    for (const part of content) {
      if (part && part.type === 'text' && typeof part.text === 'string') {
        len += part.text.replace(BASE64_DATA_URL_REGEX, '').length;
      }
    }
    return len;
  }
  if (content == null) return 0;
  return String(content).replace(BASE64_DATA_URL_REGEX, '').length;
}

export function extractMessageText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join(' ');
  }
  return content == null ? '' : String(content);
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
        pruned[0].content = extractMessageText(pruned[0].content) + '\n\n' + extractMessageText(pruned[i].content);
        pruned.splice(i, 1);
        i--;
      }
    }
  }

  // Protect the most recent step's tool outputs (last 4 messages) so the model ALWAYS sees the full output of tools it just called!
  const recentProtectedBoundary = Math.max(1, pruned.length - 4);

  let total = pruned.reduce((acc, m) => acc + measureMessageTextLength(m.content), 0);
  if (total <= maxTotalChars) return pruned;

  // Stage 1: Compact older historical tool outputs (from 2+ steps ago)
  for (let i = 1; i < recentProtectedBoundary && total > maxTotalChars; i++) {
    if (pruned[i].role === 'tool' && typeof pruned[i].content === 'string' && pruned[i].content.length > 1800) {
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
    if (pruned[i].role === 'tool' && typeof pruned[i].content === 'string' && pruned[i].content.length > 600) {
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
    if (pruned[i].role === 'tool' && typeof pruned[i].content === 'string' && pruned[i].content.length > 18000) {
      const reduction = pruned[i].content.length - 16000;
      pruned[i].content =
        pruned[i].content.slice(0, 11500) +
        '\n... [Middle lines omitted for context budget] ...\n' +
        pruned[i].content.slice(-4500);
      total -= reduction;
    }
  }

  if (total <= maxTotalChars) return pruned;

  // Stage 4: Drop oldest historical turns from index 1 while preserving valid assistant/tool pairs.
  // CRITICAL: NEVER drop the last user query (or the only remaining user query), as OpenAI-compatible
  // backends (like Strata / Qwen) strictly require at least one 'user' query in messages and throw HTTP 400 otherwise!
  const dropGroupAt = (idx: number) => {
    const target = pruned[idx];
    if (!target) return;
    const dropped = pruned.splice(idx, 1)[0];
    total -= measureMessageTextLength(dropped.content);
    if (target.role === 'assistant' && Array.isArray(target.tool_calls) && target.tool_calls.length > 0) {
      while (idx < pruned.length && pruned[idx].role === 'tool') {
        const droppedTool = pruned.splice(idx, 1)[0];
        total -= measureMessageTextLength(droppedTool.content);
      }
    }
  };

  while (pruned.length > 3 && total > maxTotalChars) {
    const item = pruned[1];
    const userCount = pruned.filter((m) => m.role === 'user').length;
    if (item.role === 'user' && userCount <= 1) {
      // Do NOT drop the sole remaining user message!
      // Instead, look for older completed assistant+tool groups ahead to drop as an atomic unit.
      let droppedSomething = false;
      for (let j = 2; j < pruned.length - 2; j++) {
        if (pruned[j].role === 'assistant') {
          dropGroupAt(j);
          droppedSomething = true;
          break;
        }
      }
      if (!droppedSomething) break;
      continue;
    }

    dropGroupAt(1);
  }

  // Final Invariant Guard: Ensure at least one 'user' message exists in the returned array.
  // If historical pruning ever left only system/assistant/tool messages, inject a valid user turn!
  if (!pruned.some((m) => m.role === 'user')) {
    pruned.splice(1, 0, {
      role: 'user',
      content: 'Please proceed with the current task and report your findings.',
    });
  }

  return pruned;
}
