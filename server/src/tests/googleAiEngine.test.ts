import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  GoogleAiEngine,
  GOOGLE_MODEL_SPECS,
  isGoogleOrchestratorModel,
  normalizeGoogleModelId,
} from '../google/googleAiEngine.js';

async function runGoogleAiEngineTests() {
  console.log('Running GoogleAiEngine Tool-Call & ThoughtSignature Unit Tests...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-google-ai-test-'));
  const engine = new GoogleAiEngine(tmpDir);
  engine.updateConfig({
    provider: 'google_ai_studio',
    googleApiKey: 'test-key-123',
    selectedGoogleModel: 'gemini-4-hydrogen',
  });

  // 1. Multi-tool-call SSE streaming with partial chunks, id deduplication, and thought_signature recording
  const sseChunks = [
    'data: {"choices":[{"delta":{"content":"<think>Checking files</think>Done."}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read_file","arguments":"{\\"path\\":\\"a"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"arguments":".ts\\"}"},"extra_content":{"google":{"thought_signature":"sig_alpha_123"}}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"list_directory","arguments":"{\\"path\\":\\".\\"}"}}]}}]}\n\n',
    'data: [DONE]\n\n',
  ];

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const tokens: string[] = [];
    const thoughts: string[] = [];
    const prepared: string[] = [];
    const executed: Array<{ name: string; args: Record<string, any> }> = [];

    const result = await engine.streamChatCompletion({
      tier: 'medium',
      thinkingBudget: 'fast',
      messages: [{ role: 'user', content: 'Inspect a.ts and list .' }],
      onTokenDelta: (t) => tokens.push(t),
      onThoughtDelta: (t) => thoughts.push(t),
      onToolCallPreparing: (name) => {
        if (name) prepared.push(name);
      },
      onToolCallRequest: async (name, args) => {
        executed.push({ name, args });
      },
    });

    assert.equal(thoughts.join(''), 'Checking files');
    assert.equal(tokens.join(''), 'Done.');
    assert.deepEqual(prepared, ['read_file', 'list_directory']);
    assert.equal(executed.length, 2);
    assert.deepEqual(executed[0], { name: 'read_file', args: { path: 'a.ts' } });
    assert.deepEqual(executed[1], { name: 'list_directory', args: { path: '.' } });
    assert.equal(result.content, 'Done.');

    // 2. toOpenAiMessages: mid-turn system role coercion + cached thought_signature & fallback injection
    const toOpenAiMessages = (engine as any).toOpenAiMessages.bind(engine);
    const mapped = toOpenAiMessages([
      { role: 'system', content: 'Root sys' },
      { role: 'system', content: 'Injected sys' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_a',
            type: 'function',
            function: { name: 'read_file', arguments: '{ "path": "a.ts" }' },
          },
        ],
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_uncached',
            type: 'function',
            function: { name: 'unknown_tool', arguments: '{}' },
          },
        ],
      },
    ]);

    assert.equal(mapped[0].role, 'system');
    assert.equal(mapped[1].role, 'user');
    assert.equal(mapped[2].tool_calls[0].extra_content?.google?.thought_signature, 'sig_alpha_123');
    assert.equal(
      mapped[3].tool_calls[0].extra_content?.google?.thought_signature,
      'context_engineering_is_the_way_to_go'
    );

    // 3. Orchestrator & Neon model ID normalization + Decisions routing decisions
    assert.equal(normalizeGoogleModelId('orchestrator'), 'orchestrator-argon-hydrogen');
    assert.equal(
      normalizeGoogleModelId('orchestrator-argon-hydrogen'),
      'orchestrator-argon-hydrogen'
    );
    assert.equal(
      normalizeGoogleModelId('orchestrator-carbon-hydrogen'),
      'orchestrator-carbon-hydrogen'
    );
    assert.equal(normalizeGoogleModelId('gemini-4-neon'), 'gemini-4-neon');
    assert.equal(normalizeGoogleModelId('neon'), 'gemini-4-neon');
    assert.equal(
      normalizeGoogleModelId('orchestrator-neon-hydrogen'),
      'orchestrator-neon-hydrogen'
    );
    assert.equal(normalizeGoogleModelId('orchestrator-neon'), 'orchestrator-neon-hydrogen');
    assert.equal(
      normalizeGoogleModelId('orchestrator-carbon-neon'),
      'orchestrator-carbon-neon'
    );
    assert.equal(
      normalizeGoogleModelId('orchestrator carbon neon'),
      'orchestrator-carbon-neon'
    );

    assert.equal(isGoogleOrchestratorModel('orchestrator-neon-hydrogen'), true);
    assert.equal(isGoogleOrchestratorModel('orchestrator-carbon-neon'), true);
    assert.equal(isGoogleOrchestratorModel('gemini-4-neon'), false);
    assert.equal(GOOGLE_MODEL_SPECS['gemini-4-neon'].apiModel, 'gemini-4-neon');

    globalThis.fetch = (async () =>
      new Response('Decisions API offline in unit test', { status: 503 })) as typeof fetch;

    const argonDecision = await engine.evaluateOrchestratorDecision(
      'Build a full multi-module TypeScript parser',
      undefined,
      'argon'
    );
    assert.equal(argonDecision.plannerChoice, 'argon');
    assert.equal(argonDecision.needsPlanning, true);

    const carbonDecision = await engine.evaluateOrchestratorDecision(
      'Build a full multi-module TypeScript parser',
      undefined,
      'carbon'
    );
    assert.equal(carbonDecision.plannerChoice, 'carbon');
    assert.equal(carbonDecision.needsPlanning, true);

    const neonDecision = await engine.evaluateOrchestratorDecision(
      'Build a full multi-module TypeScript parser',
      undefined,
      'neon'
    );
    assert.equal(neonDecision.plannerChoice, 'neon');
    assert.equal(neonDecision.needsPlanning, true);

    const carbonNeonDecision = await engine.evaluateOrchestratorDecision(
      'Build a full multi-module TypeScript parser',
      undefined,
      'carbon',
      'neon'
    );
    assert.equal(carbonNeonDecision.plannerChoice, 'carbon');
    assert.equal(carbonNeonDecision.needsPlanning, true);

    const trivialDecision = await engine.evaluateOrchestratorDecision('hello', undefined, 'carbon');
    assert.equal(trivialDecision.plannerChoice, 'hydrogen');
    assert.equal(trivialDecision.needsPlanning, false);

    const trivialNeonExecDecision = await engine.evaluateOrchestratorDecision(
      'hello',
      undefined,
      'carbon',
      'neon'
    );
    assert.equal(trivialNeonExecDecision.plannerChoice, 'neon');
    assert.equal(trivialNeonExecDecision.needsPlanning, false);

    // 4. budgetToReasoningEffort supports xhigh on Gemini 4 Neon & Hydrogen, clamping Argon to high
    const budgetToReasoningEffort = (engine as any).budgetToReasoningEffort.bind(engine);
    assert.equal(budgetToReasoningEffort('xhigh', 'gemini-4-neon'), 'xhigh');
    assert.equal(budgetToReasoningEffort('xhigh', 'gemini-4-hydrogen'), 'xhigh');
    assert.equal(budgetToReasoningEffort('xhigh', 'gemini-4-argon'), 'high');

    // 5. End-to-end mocked streamChatCompletion for orchestrator-neon-hydrogen & orchestrator-carbon-neon
    const capturedBodies: Array<Record<string, any>> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const targetUrl = String(url);
      if (targetUrl.includes('/decisions')) {
        return new Response('Decisions API offline in unit test', { status: 503 });
      }
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
      capturedBodies.push(parsedBody);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: {"choices":[{"delta":{"content":"Response from ${parsedBody.model}"}}]}\n\n`
            )
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const dummyTools = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ];

    engine.updateConfig({ selectedGoogleModel: 'orchestrator-neon-hydrogen' });
    const neonOrchRes = await engine.streamChatCompletion({
      tier: 'high',
      thinkingBudget: 'xhigh',
      messages: [{ role: 'user', content: 'Design and implement a new rate limiter module' }],
      tools: dummyTools,
      onTokenDelta: () => {},
      onThoughtDelta: () => {},
    });
    assert.equal(capturedBodies.length, 2);
    assert.equal(capturedBodies[0].model, 'gemini-4-neon');
    assert.equal(capturedBodies[0].tools, undefined);
    assert.equal(capturedBodies[0].reasoning_effort, 'xhigh');
    assert.equal(capturedBodies[1].model, 'gemini-4-hydrogen');
    assert.ok(Array.isArray(capturedBodies[1].tools) && capturedBodies[1].tools.length === 1);
    assert.equal(neonOrchRes.content, 'Response from gemini-4-hydrogen');

    capturedBodies.length = 0;
    engine.updateConfig({ selectedGoogleModel: 'orchestrator-carbon-neon' });
    const carbonNeonRes = await engine.streamChatCompletion({
      tier: 'high',
      thinkingBudget: 'xhigh',
      messages: [{ role: 'user', content: 'Refactor the distributed cache consistency protocol' }],
      tools: dummyTools,
      onTokenDelta: () => {},
      onThoughtDelta: () => {},
    });
    assert.equal(capturedBodies.length, 2);
    assert.equal(capturedBodies[0].model, 'gemini-4-carbon');
    assert.equal(capturedBodies[0].reasoning_effort, 'high');
    assert.equal(capturedBodies[0].tools, undefined);
    assert.equal(capturedBodies[1].model, 'gemini-4-neon');
    // Phase 2 executor budget is decoupled from planner xhigh budget (throttled to 'low' when no tool error)
    assert.equal(capturedBodies[1].reasoning_effort, 'low');
    assert.ok(Array.isArray(capturedBodies[1].tools) && capturedBodies[1].tools.length === 1);
    assert.equal(carbonNeonRes.content, 'Response from gemini-4-neon');

    // 6. Phase 2 non-double-counted thinkingTokens, chunk-split <thought> tags, and malformed tool call guard
    const orchThinkingChunks: string[] = [];
    let callIdx = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const targetUrl = String(url);
      if (targetUrl.includes('/decisions')) {
        return new Response('Decisions API offline in unit test', { status: 503 });
      }
      callIdx += 1;
      const encoder = new TextEncoder();
      const chunks =
        callIdx === 1
          ? [
              'data: {"choices":[{"delta":{"content":"<thou"}}]}\n\n',
              'data: {"choices":[{"delta":{"content":"ght>Plan step 1</th"}}]}\n\n',
              'data: {"choices":[{"delta":{"content":"ought>Plan body"}}]}\n\n',
              'data: [DONE]\n\n',
            ]
          : [
              'data: {"choices":[{"delta":{"content":"<think>Exec note</think>Final answer."}}]}\n\n',
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_bad","function":{"name":"read_file","arguments":"{broken_json"}}]}}]}\n\n',
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
              'data: [DONE]\n\n',
            ];
      const stream = new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const badToolExecCalls: any[] = [];
    const parseErrors: any[] = [];
    const orchPhase2Res = await engine.streamChatCompletion({
      tier: 'high',
      thinkingBudget: 'high',
      messages: [{ role: 'user', content: 'Inspect and run complex plan' }],
      tools: dummyTools,
      onTokenDelta: () => {},
      onThoughtDelta: (d) => orchThinkingChunks.push(d),
      onToolCallRequest: async (name, args) => {
        badToolExecCalls.push({ name, args });
      },
      onToolCallParseError: (info) => {
        parseErrors.push(info);
      },
    });
    assert.equal(badToolExecCalls.length, 0, 'Malformed tool call JSON must not invoke onToolCallRequest({})');
    assert.equal(parseErrors.length, 1);
    assert.equal(orchPhase2Res.malformedToolCalls?.length, 1);
    assert.equal(orchPhase2Res.content, 'Final answer.');
    // Verify thinkingTokens equals sum of individual emitted thought deltas (not double-counted)
    const expectedSum = orchThinkingChunks.reduce(
      (sum, c) => sum + Math.max(1, Math.ceil(c.length / 4)),
      0
    );
    assert.equal(orchPhase2Res.thinkingTokens, expectedSum);
    const execOccurrences = orchPhase2Res.thinkingContent.split('Exec note').length - 1;
    assert.equal(execOccurrences, 1, 'Executor thinkingContent must not be duplicated');

    console.log('✅ GoogleAiEngine Unit Tests PASSED (all assertions including Gemini 4 Neon)');
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runGoogleAiEngineTests().catch((err) => {
  console.error('❌ GoogleAiEngine Unit Tests FAILED:', err);
  process.exit(1);
});
