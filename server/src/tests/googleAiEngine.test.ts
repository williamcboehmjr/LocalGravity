import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { GoogleAiEngine, normalizeGoogleModelId } from '../google/googleAiEngine.js';

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

    // 3. Two orchestrator IDs normalization & Argon/Carbon routing decisions
    assert.equal(normalizeGoogleModelId('orchestrator'), 'orchestrator-argon-hydrogen');
    assert.equal(
      normalizeGoogleModelId('orchestrator-argon-hydrogen'),
      'orchestrator-argon-hydrogen'
    );
    assert.equal(
      normalizeGoogleModelId('orchestrator-carbon-hydrogen'),
      'orchestrator-carbon-hydrogen'
    );

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

    const trivialDecision = await engine.evaluateOrchestratorDecision('hello', undefined, 'carbon');
    assert.equal(trivialDecision.plannerChoice, 'hydrogen');
    assert.equal(trivialDecision.needsPlanning, false);

    console.log('✅ GoogleAiEngine Unit Tests PASSED (17/17 assertions)');
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runGoogleAiEngineTests().catch((err) => {
  console.error('❌ GoogleAiEngine Unit Tests FAILED:', err);
  process.exit(1);
});
