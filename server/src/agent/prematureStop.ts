export interface PrematureStopResult {
  shouldContinue: boolean;
  continuationPrompt: string;
}

export function detectPrematureStop(
  stepContent: string,
  hasExecutedTools: boolean,
  autoContinueCount: number,
  maxAutoContinues: number,
  userPrompt?: string
): PrematureStopResult {
  // Never allow more than maxAutoContinues (default 2)
  if (autoContinueCount >= maxAutoContinues) {
    return { shouldContinue: false, continuationPrompt: '' };
  }

  const trimmed = (stepContent || '').trim();

  // 1. Model finished <think> but emitted 0 characters of output and 0 tool calls
  if (trimmed.length === 0) {
    return {
      shouldContinue: true,
      continuationPrompt:
        '[ACTION REQUIRED]: You finished thinking without executing a tool or delivering an answer. Please either invoke the tool you need or write out your complete solution now.',
    };
  }

  // 2. Output is a very short transitional line (< 140 chars) ending with colon ":"
  if (trimmed.endsWith(':') && trimmed.length < 140) {
    return {
      shouldContinue: true,
      continuationPrompt:
        '[ACTION REQUIRED]: Please proceed directly with the tool execution or output the planned content now.',
    };
  }

  // 3. Output is a short promise or declaration of intent (< 180 chars)
  if (trimmed.length < 180 && !trimmed.includes('\n\n')) {
    const actionIntentRegex =
      /^\s*(let me|now let me|i'll|i will|let's|i am going to|i need to|starting|executing|working on)\s+(read|check|inspect|dump|run|test|split|refactor|create|write|edit|update|look|examine|verify|pull|fetch|search|analyze|map|list|explore|open|review|implement|fix|build)\b/i;
    if (actionIntentRegex.test(trimmed)) {
      return {
        shouldContinue: true,
        continuationPrompt:
          '[ACTION REQUIRED]: Please execute the tool call for the action you planned now (e.g. read_file, list_directory, search_codebase, write_file, run_terminal). Do NOT stop with a promise.',
      };
    }
  }

  // 4. THEATRICAL SIMULATION / ZERO-TOOL HALLUCINATION GUARD:
  // If NO tools have been executed in this turn, check if the model is narrating/roleplaying tool actions in text!
  if (!hasExecutedTools) {
    const roleplaySimulationRegex =
      /(reading through|now reading|now writing|npm run build|cargo check|clean compile|tsc\b|fixing compile errors|transcribing into|diffs at exact anchors|refactor #\d+ complete|zero call-site changes|applying edit \d|edit \d —)/i;

    // Check if the user asked for an action
    const userWantsAction =
      userPrompt &&
      /\b(do|refactor|refractor|fix|edit|implement|create|write|run|test|build|split|make|update)\b/i.test(userPrompt);

    if (
      roleplaySimulationRegex.test(trimmed) ||
      (userWantsAction && trimmed.includes('```') && (trimmed.includes('server/src') || trimmed.includes('client/src')))
    ) {
      return {
        shouldContinue: true,
        continuationPrompt:
          '[CRITICAL PROTOCOL VIOLATION — ZERO TOOLS EXECUTED]: You wrote prose claiming to read, edit, or build files, but you have NOT executed ANY real tools on this workstation (0 calls to read_file, write_file, apply_diff, or run_terminal). Fabricating execution in text is strictly forbidden. You MUST emit real structured tool calls now to inspect and modify the files on disk.',
      };
    }
  }

  return { shouldContinue: false, continuationPrompt: '' };
}
