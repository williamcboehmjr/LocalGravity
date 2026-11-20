export interface PrematureStopResult {
  shouldContinue: boolean;
  continuationPrompt: string;
  isPremature: boolean;
  reason?: string;
  retryInstruction?: string;
}

export interface PrematureStopOptions {
  slashCommand?: string | null;
  finishReason?: string;
  userPrompt?: string;
  executedToolNames?: string[];
  maxAutoContinues?: number;
}

export const READ_ONLY_INSPECTION_TOOLS = new Set([
  'read_file',
  'list_directory',
  'search_codebase',
  'find_files',
  'code_outline',
  'inspect_file_metadata',
  'inspect_document',
  'list_skills',
  'read_skill',
  'inspect_models',
  'inspect_system',
  'read_system_logs',
  'search_web',
  'search_models',
  'browser_inspect',
  'capture_screen',
  'inspect_window',
  'lsp_diagnostics',
  'read_board',
  'ask_question',
]);

function makePremature(shouldContinue: boolean, prompt = '', reason?: string): PrematureStopResult {
  return {
    shouldContinue,
    continuationPrompt: prompt,
    isPremature: shouldContinue,
    reason,
    retryInstruction: prompt || undefined,
  };
}

export function detectPrematureStop(
  stepContent: string,
  hasExecutedTools: boolean,
  autoContinueCount: number,
  maxAutoContinuesOrOptions?: number | PrematureStopOptions,
  userPrompt?: string,
  executedToolNames?: string[],
  options?: PrematureStopOptions
): PrematureStopResult {
  let maxAutoContinues = 5;
  let resolvedOptions: PrematureStopOptions | undefined = options;

  if (typeof maxAutoContinuesOrOptions === 'number') {
    maxAutoContinues = maxAutoContinuesOrOptions;
  } else if (maxAutoContinuesOrOptions && typeof maxAutoContinuesOrOptions === 'object') {
    resolvedOptions = maxAutoContinuesOrOptions;
    if (typeof maxAutoContinuesOrOptions.maxAutoContinues === 'number') {
      maxAutoContinues = maxAutoContinuesOrOptions.maxAutoContinues;
    }
    if (userPrompt === undefined && maxAutoContinuesOrOptions.userPrompt !== undefined) {
      userPrompt = maxAutoContinuesOrOptions.userPrompt;
    }
    if (executedToolNames === undefined && maxAutoContinuesOrOptions.executedToolNames !== undefined) {
      executedToolNames = maxAutoContinuesOrOptions.executedToolNames;
    }
  }

  const finishReason = resolvedOptions?.finishReason;
  const slashCommand = resolvedOptions?.slashCommand ?? null;

  if (finishReason === 'content_filter') {
    return makePremature(false);
  }

  // Never allow more than maxAutoContinues
  if (autoContinueCount >= maxAutoContinues) {
    return makePremature(false);
  }

  if (finishReason === 'length') {
    return makePremature(
      true,
      'Your previous response was truncated due to the token limit (finish_reason=length). Continue directly from where you left off without repeating earlier text.',
      'output_truncated_length'
    );
  }

  const trimmed = (stepContent || '').trim();

  // 1. Model finished <think> but emitted 0 characters of output and 0 tool calls
  if (trimmed.length === 0) {
    return makePremature(
      true,
      '[ACTION REQUIRED]: You finished thinking without executing a tool or delivering an answer. Please either invoke the tool you need or write out your complete solution now.',
      'empty_output'
    );
  }

  // 1b. Raw unparsed tool markup leaked into prose without an executed tool call
  const hasLeakedXmlToolCall =
    /<tool_call\b/i.test(trimmed) ||
    /<\/tool_call>/i.test(trimmed) ||
    /<function=[a-zA-Z0-9_-]+>/i.test(trimmed);
  const hasLeakedJsonToolCall =
    /"name"\s*:\s*"(?:comfyui|read_file|write_file|edit_file|apply_diff|run_terminal|run_code_batch|search_web|find_files|search_codebase)"/i.test(
      trimmed
    ) && /"arguments"\s*:/i.test(trimmed);

  if (hasLeakedXmlToolCall || hasLeakedJsonToolCall) {
    return makePremature(
      true,
      '[ACTION REQUIRED]: Your raw tool markup was NOT executed because no structured tool call was emitted. Invoke the real structured tool call now without printing <tool_call> or JSON markup as prose.',
      'leaked_tool_markup'
    );
  }

  // 2. Output is a transitional preamble ending with colon ":" (e.g. "Let me use write_file... verbatim:")
  if (trimmed.endsWith(':') && trimmed.length < 500 && !trimmed.includes('```')) {
    return makePremature(
      true,
      '[ACTION REQUIRED]: Please proceed directly with the tool execution or output the planned content now.',
      'colon_preamble'
    );
  }

  // 3. Output ends with or contains an unexecuted promise/declaration of intent
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : trimmed;
  const sentences = lastLine
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const trailingSentence = sentences.length > 0 ? sentences[sentences.length - 1] : lastLine;
  const prevSentence = sentences.length >= 2 ? sentences[sentences.length - 2] : '';

  const actionIntentRegex =
    /(?:^|\b)(let me|now let me|now i will|next,?\s+i(?:'ll| will)|i'll|i will|let's|first,?\s+let's|i am going to|i'm going to|i need to|starting|executing|working on|proceeding to|moving on to|continuing with)\s+(?:now\s+)?(use|read|check|inspect|dump|run|test|split|refactor|create|write|edit|update|look|examine|verify|confirm|call|invoke|query|probe|execute|dispatch|try|validate|install|setup|proceed|continue|pull|fetch|search|analyze|map|list|explore|open|review|implement|fix|build|grab|locate|trace|diagnose|finish|complete|wire|hook|commit|push|publish|release|ship|apply|patch|compile|stage|resolve|extract|unzip|parse|copy|move|delete|remove|mkdir|generate|design|plan|summarize|scan|count|save|load)\b/i;

  const intentHit =
    actionIntentRegex.test(trailingSentence) ||
    actionIntentRegex.test(lastLine) ||
    (trailingSentence.length < 90 && prevSentence.length > 0 && actionIntentRegex.test(prevSentence)) ||
    (trimmed.length < 400 && actionIntentRegex.test(trimmed));

  if (intentHit) {
    const matchedSnippet = (actionIntentRegex.test(trailingSentence) ? trailingSentence : prevSentence || trailingSentence).slice(0, 100);
    return makePremature(
      true,
      `[ACTION REQUIRED]: You stated you would take an action ("${matchedSnippet}"), but stopped without executing a tool. Please execute the tool call for the planned action now (e.g. read_file, list_directory, search_codebase, write_file, run_terminal, comfyui). Do NOT stop with a promise.`,
      'action_intent_promise'
    );
  }

  // 3b. UNGROUNDED "I CANNOT / AS AN AI / NO REAL-TIME ACCESS" GUARD (with word boundary, not trailing space)
  const helplessClaimRegex =
    /(i do not have access to real-time|i cannot browse the web|i don't have access to the internet|as an ai language model|as of my last update|i am not able to search|i don't have real-time information|i am unable to access the internet|i cannot search the web|i don't have access to current|i cannot view websites)\b/i;
  if (helplessClaimRegex.test(trimmed)) {
    return makePremature(
      true,
      '[ACTION REQUIRED]: You DO have full, unrestricted live web search access via the "search_web" tool! Immediately invoke search_web(query=...) to look up the exact information instead of claiming inability.',
      'helpless_claim'
    );
  }

  const isPlanOrGrillMode =
    slashCommand === '/plan' ||
    slashCommand === '/grill-me' ||
    Boolean(userPrompt && /(?:^|\s)\/(?:plan|grill-me)(?=\s|$)/i.test(userPrompt));

  const isPureQuestionPrompt = Boolean(
    userPrompt && /^\s*(?:how|why|what|explain|can you explain)\b/i.test(userPrompt)
  );

  const isExemptFromMutationAndHedging = isPlanOrGrillMode || isPureQuestionPrompt;

  // 3c. UNNECESSARY PERMISSION / CONFIRMATION HEDGING GUARD
  if (!isExemptFromMutationAndHedging) {
    const userRequestedExecution =
      Boolean(userPrompt) &&
      (/\b(fix|implement|build|create|write|edit|update|finish|complete|publish|release|push|audit|refactor|add|remove|wire|hook|solve|execute|do|continue|proceed|go ahead|generate|draw|render)\b/i.test(
        userPrompt!
      ) ||
        /^(yes|yep|yeah|sure|ok|okay|do it|go ahead|proceed|continue)\b/i.test(userPrompt!.trim()));

    const permissionHedgingRegex =
      /(?:would you like me to|do you want me to|want me to|should i|shall i|would you like to proceed|let me know if you(?:'d| would) like me to|if you want, i can|say the word|ready to (?:implement|proceed|apply|build|fix|generate)[^.?!]*\?)/i;

    if (userRequestedExecution && (permissionHedgingRegex.test(trailingSentence) || permissionHedgingRegex.test(lastLine))) {
      return makePremature(
        true,
        '[ACTION REQUIRED]: The user already instructed you to complete this task. Do NOT stop to ask for permission or confirmation ("Want me to...?", "Should I...?"). Execute the implementation and verification tools now.',
        'permission_hedging'
      );
    }
  }

  // 4. THEATRICAL SIMULATION / NO-MUTATION HALLUCINATION GUARD
  // Run if no tools have executed yet OR if only read-only inspection tools ran and the model fabricates edits/builds in text.
  const hasMutated = executedToolNames
    ? executedToolNames.some((n) => !READ_ONLY_INSPECTION_TOOLS.has(n))
    : hasExecutedTools;

  if (!hasMutated && !isExemptFromMutationAndHedging) {
    const roleplaySimulationRegex =
      /(reading through|now reading|now writing|npm run build|cargo check|clean compile|fixing compile errors|transcribing into|diffs at exact anchors|refactor #\d+ complete|zero call-site changes|applying edit \d|edit \d —|successfully updated [a-z0-9_./-]+\.(?:ts|tsx|rs))/i;

    const userWantsAction =
      userPrompt &&
      /\b(do|refactor|refractor|fix|edit|implement|create|write|run|test|build|split|make|update)\b/i.test(userPrompt);

    if (
      roleplaySimulationRegex.test(trimmed) ||
      (userWantsAction && trimmed.includes('```') && (trimmed.includes('server/src') || trimmed.includes('client/src')))
    ) {
      return makePremature(
        true,
        '[CRITICAL PROTOCOL VIOLATION — NO FILE MUTATIONS EXECUTED]: You wrote prose claiming edits or builds, but no mutation/execution tool ran on disk (write_file, edit_file, apply_diff, run_code_batch, or run_terminal). Fabricating execution in text is strictly forbidden. Invoke the real structured editing and build tools now.',
        'no_mutation_violation'
      );
    }
  }

  // 4b. UNEXECUTED COMFYUI / IMAGE GENERATION PROMISE GUARD
  if (userPrompt && Array.isArray(executedToolNames) && !executedToolNames.includes('comfyui')) {
    const promptWantsGeneration =
      /\/comfy\b/i.test(userPrompt) ||
      /\b(generate|create|make|draw|render)\b[\s\S]{0,40}\b(image|picture|photo|artwork|illustration|portrait|video|moss|h3|krea|z-image|comfy|comfyui)\b/i.test(
        userPrompt
      );
    const proseFakedOrPromisedImage =
      /\[MCP Image saved/i.test(trimmed) ||
      /\b(i have generated the image|i'll generate|generating (?:the )?image|queueing (?:the )?comfyui workflow)\b/i.test(
        trimmed
      );
    if (promptWantsGeneration && proseFakedOrPromisedImage) {
      return makePremature(
        true,
        '[ACTION REQUIRED]: You did not invoke the `comfyui` tool yet. Call `comfyui` now with `action="generate"` (or `"gemini_image"`) to generate the real image.',
        'unexecuted_comfyui_promise'
      );
    }
  }

  return makePremature(false);
}
