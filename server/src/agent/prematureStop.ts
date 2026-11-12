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

  // 2. Output is a transitional preamble ending with colon ":" (e.g. "Let me use write_file... verbatim:")
  if (trimmed.endsWith(':') && trimmed.length < 500 && !trimmed.includes('```')) {
    return {
      shouldContinue: true,
      continuationPrompt:
        '[ACTION REQUIRED]: Please proceed directly with the tool execution or output the planned content now.',
    };
  }

  // 3. Output ends with or contains an unexecuted promise/declaration of intent
  // Extract trailing non-empty line and trailing sentence so status summaries
  // like "Batch 2 complete and green (EXIT=0). Let me verify the asExec() bridge..."
  // correctly trigger autonomous continuation instead of stalling.
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : trimmed;
  const sentences = lastLine.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
  const trailingSentence = sentences.length > 0 ? sentences[sentences.length - 1] : lastLine;

  const actionIntentRegex =
    /(?:^|\b)(let me|now let me|i'll|i will|let's|i am going to|i need to|starting|executing|working on)\s+(use|read|check|inspect|dump|run|test|split|refactor|create|write|edit|update|look|examine|verify|confirm|call|invoke|query|probe|execute|dispatch|try|validate|install|setup|proceed|continue|pull|fetch|search|analyze|map|list|explore|open|review|implement|fix|build|grab|locate|trace|diagnose|finish|complete|wire|hook|commit|push|publish|release|ship|apply|patch|compile|stage|resolve|extract|unzip|parse|copy|move|delete|remove|mkdir|generate|design|plan|summarize|scan|count|save|load)\b/i;

  if (actionIntentRegex.test(trailingSentence) || (trimmed.length < 400 && actionIntentRegex.test(trimmed))) {
    const matchedSnippet = trailingSentence.slice(0, 100);
    return {
      shouldContinue: true,
      continuationPrompt:
        `[ACTION REQUIRED]: You stated you would take an action ("${matchedSnippet}"), but stopped without executing a tool. Please execute the tool call for the planned action now (e.g. read_file, list_directory, search_codebase, write_file, run_terminal). Do NOT stop with a promise.`,
    };
  }

  // 3b. UNGROUNDED "I CANNOT / AS AN AI / NO REAL-TIME ACCESS" GUARD:
  const helplessClaimRegex =
    /(i do not have access to real-time|i cannot browse the web|i don't have access to the internet|as an ai language model|as of my last update|i am not able to search|i don't have real-time information|i am unable to access the internet|i cannot search the web|i don't have access to current|i cannot view websites)/i;
  if (helplessClaimRegex.test(trimmed)) {
    return {
      shouldContinue: true,
      continuationPrompt:
        '[ACTION REQUIRED]: You DO have full, unrestricted live web search access via the "search_web" tool! Immediately invoke search_web(query=...) to look up the exact information instead of claiming inability.',
    };
  }

  // 3c. UNNECESSARY PERMISSION / CONFIRMATION HEDGING GUARD:
  // If the user's prompt already requested execution (or confirmed "yes"/"continue"),
  // do not allow the model to stop and ask "Want me to implement...?" / "Should I proceed?".
  const userRequestedExecution =
    Boolean(userPrompt) &&
    (/\b(fix|implement|build|create|write|edit|update|finish|complete|publish|release|push|audit|refactor|add|remove|wire|hook|solve|execute|do|continue|proceed|go ahead)\b/i.test(
      userPrompt!
    ) ||
      /^(yes|yep|yeah|sure|ok|okay|do it|go ahead|proceed|continue)\b/i.test(userPrompt!.trim()));

  const permissionHedgingRegex =
    /(?:would you like me to|do you want me to|want me to|should i|shall i|would you like to proceed|let me know if you(?:'d| would) like me to|if you want, i can|say the word|ready to (?:implement|proceed|apply|build|fix)[^.?!]*\?)/i;

  if (userRequestedExecution && (permissionHedgingRegex.test(trailingSentence) || permissionHedgingRegex.test(lastLine))) {
    return {
      shouldContinue: true,
      continuationPrompt:
        '[ACTION REQUIRED]: The user already instructed you to complete this task. Do NOT stop to ask for permission or confirmation ("Want me to...?", "Should I...?"). Execute the implementation and verification tools now.',
    };
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
