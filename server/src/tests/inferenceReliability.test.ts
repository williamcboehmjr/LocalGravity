import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InferenceError } from '../core/inferenceBackend.js';
import { GoogleAiEngine } from '../google/googleAiEngine.js';
import { TabbyEngine } from '../tabby/tabbyEngine.js';
import { LlamaMoESidecar } from '../tabby/llamaSidecar.js';

function sseResponse(chunks: string[], status = 200, onCancel?: () => void): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function makeFakeHealthySidecar(): LlamaMoESidecar {
  const sidecar = new LlamaMoESidecar({ port: 8080 });
  (sidecar as any).isHealthy = async () => true;
  (sidecar as any).ensureRunning = async () => true;
  (sidecar as any).getActiveProfile = () => 'swift-1.5-iq2_xs';
  return sidecar;
}

async function runInferenceReliabilityTests() {
  console.log('Running Inference Reliability Unit Tests (F2.1, F2.2, F2.3, F2.5)...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-inf-rel-'));
  const originalFetch = globalThis.fetch;

  try {
    // T1: GoogleAiEngine 429 Retry-After: 0 -> 200 SSE
    {
      const engine = new GoogleAiEngine(tmpDir, {
        maxRetries: 2,
        baseBackoffMs: 5,
        requestTimeoutMs: 500,
        streamStallTimeoutMs: 500,
      });
      engine.updateConfig({
        provider: 'google_ai_studio',
        googleApiKey: 'test-key',
        selectedGoogleModel: 'gemini-4-hydrogen',
      });

      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) {
          return new Response('Rate limited', {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"Recovered!"}}]}\n\n',
          'data: [DONE]\n\n',
        ]);
      }) as typeof fetch;

      const res = await engine.streamChatCompletion({
        tier: 'medium',
        thinkingBudget: 'off',
        messages: [{ role: 'user', content: 'hi' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
      });
      assert.equal(calls, 2);
      assert.equal(res.content, 'Recovered!');
    }

    // T2: GoogleAiEngine HTTP 503 exhausts retries -> throws InferenceError (SERVER_ERROR, retryable: true, status: 503)
    {
      const engine = new GoogleAiEngine(tmpDir, {
        maxRetries: 1,
        baseBackoffMs: 5,
        requestTimeoutMs: 500,
        streamStallTimeoutMs: 500,
      });
      engine.updateConfig({
        provider: 'google_ai_studio',
        googleApiKey: 'test-key',
        selectedGoogleModel: 'gemini-4-hydrogen',
      });

      const tokenDeltas: string[] = [];
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return new Response('Service unavailable', { status: 503 });
      }) as typeof fetch;

      await assert.rejects(
        () =>
          engine.streamChatCompletion({
            tier: 'medium',
            thinkingBudget: 'off',
            messages: [{ role: 'user', content: 'hi' }],
            onThoughtDelta: () => {},
            onTokenDelta: (d) => tokenDeltas.push(d),
          }),
        (err: any) =>
          err instanceof InferenceError &&
          err.code === 'SERVER_ERROR' &&
          err.status === 503 &&
          err.retryable === true &&
          !err.message.toLowerCase().includes('abort')
      );
      assert.ok(calls >= 2);
      assert.equal(tokenDeltas.some((t) => t.includes('⚠️')), false);
    }

    // T3: GoogleAiEngine HTTP 401 fails in 1 attempt with AUTH_MISSING (non-retryable)
    {
      const engine = new GoogleAiEngine(tmpDir, {
        maxRetries: 3,
        baseBackoffMs: 5,
      });
      engine.updateConfig({
        provider: 'google_ai_studio',
        googleApiKey: 'bad-key',
        selectedGoogleModel: 'gemini-4-hydrogen',
      });

      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return new Response('Unauthorized', { status: 401 });
      }) as typeof fetch;

      await assert.rejects(
        () =>
          engine.streamChatCompletion({
            tier: 'medium',
            thinkingBudget: 'off',
            messages: [{ role: 'user', content: 'hi' }],
            onThoughtDelta: () => {},
            onTokenDelta: () => {},
          }),
        (err: any) =>
          err instanceof InferenceError && err.code === 'AUTH_MISSING' && err.retryable === false
      );
      assert.equal(calls, 1);
    }

    // T4: GoogleAiEngine mid-stream stall -> STREAM_STALL without 'abort' substring; request timeout -> TIMEOUT without 'abort'
    {
      const engine = new GoogleAiEngine(tmpDir, {
        maxRetries: 0,
        baseBackoffMs: 5,
        requestTimeoutMs: 40,
        streamStallTimeoutMs: 40,
      });
      engine.updateConfig({
        provider: 'google_ai_studio',
        googleApiKey: 'test-key',
        selectedGoogleModel: 'gemini-4-hydrogen',
      });

      const tokens: string[] = [];
      let cancelled = false;
      globalThis.fetch = (async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'));
            // Intentionally never enqueue another chunk or close
          },
          cancel() {
            cancelled = true;
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }) as typeof fetch;

      await assert.rejects(
        () =>
          engine.streamChatCompletion({
            tier: 'medium',
            thinkingBudget: 'off',
            messages: [{ role: 'user', content: 'hi' }],
            onThoughtDelta: () => {},
            onTokenDelta: (d) => tokens.push(d),
          }),
        (err: any) =>
          err instanceof InferenceError &&
          err.code === 'STREAM_STALL' &&
          !err.message.toLowerCase().includes('abort')
      );
      assert.equal(tokens.join(''), 'Partial');
      assert.equal(cancelled, true);

      // Request timeout test
      globalThis.fetch = (async (_url: any, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }) as typeof fetch;

      await assert.rejects(
        () =>
          engine.streamChatCompletion({
            tier: 'medium',
            thinkingBudget: 'off',
            messages: [{ role: 'user', content: 'hi' }],
            onThoughtDelta: () => {},
            onTokenDelta: () => {},
          }),
        (err: any) =>
          err instanceof InferenceError &&
          err.code === 'TIMEOUT' &&
          err.retryable === true &&
          !err.message.toLowerCase().includes('abort')
      );
    }

    // T5 & T6: TabbyEngine transient network error retry + recovery, and AbortSignal -> ABORTED
    {
      const sidecar = makeFakeHealthySidecar();
      const googleEngine = new GoogleAiEngine(tmpDir);
      googleEngine.updateConfig({ provider: 'strata' });

      const tabby = new TabbyEngine({
        repoRoot: tmpDir,
        tabbyPort: 8080,
        sidecar,
        googleEngine,
        maxRetries: 2,
        baseBackoffMs: 5,
        requestTimeoutMs: 500,
        streamStallTimeoutMs: 500,
      });

      let attemptCount = 0;
      globalThis.fetch = (async (url: any) => {
        if (String(url).endsWith('/health')) {
          return new Response('ok', { status: 200 });
        }
        attemptCount += 1;
        if (attemptCount === 1) {
          throw new Error('ECONNRESET');
        }
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"Strata OK"}}]}\n\n',
          'data: [DONE]\n\n',
        ]);
      }) as typeof fetch;

      const res = await tabby.streamChatCompletion({
        tier: 'high',
        thinkingBudget: 'off',
        skipGpuLock: true,
        messages: [{ role: 'user', content: 'hello' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
      });
      assert.equal(attemptCount, 2);
      assert.equal(res.content, 'Strata OK');

      // T6: AbortSignal aborts cleanly without retrying, calls reader.cancel(), throws ABORTED with 'abort' in message
      const ac = new AbortController();
      let readerCancelled = false;
      let fetchCalls = 0;
      globalThis.fetch = (async (url: any) => {
        if (String(url).endsWith('/health')) return new Response('ok', { status: 200 });
        fetchCalls += 1;
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
            setTimeout(() => ac.abort(), 15);
          },
          cancel() {
            readerCancelled = true;
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }) as typeof fetch;

      await assert.rejects(
        () =>
          tabby.streamChatCompletion({
            tier: 'high',
            thinkingBudget: 'off',
            skipGpuLock: true,
            abortSignal: ac.signal,
            messages: [{ role: 'user', content: 'hello' }],
            onThoughtDelta: () => {},
            onTokenDelta: () => {},
          }),
        (err: any) =>
          err instanceof InferenceError &&
          err.code === 'ABORTED' &&
          err.retryable === false &&
          err.message.toLowerCase().includes('abort')
      );
      assert.equal(fetchCalls, 1);
      assert.equal(readerCancelled, true);
    }

    // T7: Missing Google API key -> AUTH_MISSING; Unreachable Strata -> ENGINE_UNAVAILABLE; Strata 500 -> SERVER_ERROR; zero "⚠️" prose
    {
      const engineNoKey = new GoogleAiEngine(tmpDir);
      engineNoKey.updateConfig({ provider: 'google_ai_studio', googleApiKey: '' });
      const origGemini = process.env.GEMINI_API_KEY;
      const origGoogle = process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      const leakedTokens: string[] = [];
      try {
        await assert.rejects(
          () =>
            engineNoKey.streamChatCompletion({
              tier: 'high',
              thinkingBudget: 'off',
              messages: [{ role: 'user', content: 'hi' }],
              onThoughtDelta: () => {},
              onTokenDelta: (t) => leakedTokens.push(t),
            }),
          (err: any) => err instanceof InferenceError && err.code === 'AUTH_MISSING'
        );
      } finally {
        if (origGemini !== undefined) process.env.GEMINI_API_KEY = origGemini;
        if (origGoogle !== undefined) process.env.GOOGLE_API_KEY = origGoogle;
      }
      assert.equal(leakedTokens.length, 0);

      // Unreachable Strata
      const deadSidecar = new LlamaMoESidecar({ port: 8080 });
      (deadSidecar as any).isHealthy = async () => false;
      (deadSidecar as any).ensureRunning = async () => false;
      const googleCfg = new GoogleAiEngine(tmpDir);
      googleCfg.updateConfig({ provider: 'strata' });
      const tabbyUnreachable = new TabbyEngine({
        repoRoot: tmpDir,
        tabbyPort: 8080,
        sidecar: deadSidecar,
        googleEngine: googleCfg,
        maxRetries: 0,
        baseBackoffMs: 5,
      });
      await assert.rejects(
        () =>
          tabbyUnreachable.streamChatCompletion({
            tier: 'high',
            thinkingBudget: 'off',
            skipGpuLock: true,
            messages: [{ role: 'user', content: 'hi' }],
            onThoughtDelta: () => {},
            onTokenDelta: (t) => leakedTokens.push(t),
          }),
        (err: any) => err instanceof InferenceError && err.code === 'ENGINE_UNAVAILABLE'
      );
      assert.equal(leakedTokens.length, 0);

      // Strata HTTP 500
      const tabby500 = new TabbyEngine({
        repoRoot: tmpDir,
        tabbyPort: 8080,
        sidecar: makeFakeHealthySidecar(),
        googleEngine: googleCfg,
        maxRetries: 0,
        baseBackoffMs: 5,
      });
      globalThis.fetch = (async () => new Response('Internal error', { status: 500 })) as typeof fetch;
      await assert.rejects(
        () =>
          tabby500.streamChatCompletion({
            tier: 'high',
            thinkingBudget: 'off',
            skipGpuLock: true,
            messages: [{ role: 'user', content: 'hi' }],
            onThoughtDelta: () => {},
            onTokenDelta: (t) => leakedTokens.push(t),
          }),
        (err: any) => err instanceof InferenceError && err.code === 'SERVER_ERROR' && err.status === 500
      );
      assert.equal(leakedTokens.length, 0);
    }

    // T8 & T9: Trailing SSE buffer without trailing newline + usage/finishReason + stream_options.include_usage
    {
      const engine = new GoogleAiEngine(tmpDir, { maxRetries: 0, baseBackoffMs: 5 });
      engine.updateConfig({
        provider: 'google_ai_studio',
        googleApiKey: 'test-key',
        selectedGoogleModel: 'gemini-4-hydrogen',
      });

      let capturedBody: any = null;
      globalThis.fetch = (async (_url: any, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body || '{}'));
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"Chunk 1"}}]}\n\n',
          // Trailing line without \n and choices: [] usage chunk
          'data: {"choices":[{"delta":{"content":" Tail"},"finish_reason":"length"}]}\ndata: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":45,"total_tokens":180,"completion_tokens_details":{"reasoning_tokens":15}}}',
        ]);
      }) as typeof fetch;

      const res = await engine.streamChatCompletion({
        tier: 'medium',
        thinkingBudget: 'fast',
        messages: [{ role: 'user', content: 'hi' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
      });
      assert.deepEqual(capturedBody.stream_options, { include_usage: true });
      assert.equal(res.content, 'Chunk 1 Tail');
      assert.equal(res.finishReason, 'length');
      assert.deepEqual(res.usage, {
        promptTokens: 120,
        completionTokens: 45,
        totalTokens: 180,
        thinkingTokens: 15,
      });
      assert.equal(res.outputTokens, 45);
      assert.equal(res.thinkingTokens, 15);

      // Same check on TabbyEngine + content_filter finishReason
      const googleCfg = new GoogleAiEngine(tmpDir);
      googleCfg.updateConfig({ provider: 'strata' });
      const tabby = new TabbyEngine({
        repoRoot: tmpDir,
        tabbyPort: 8080,
        sidecar: makeFakeHealthySidecar(),
        googleEngine: googleCfg,
        maxRetries: 0,
      });
      let tabbyBody: any = null;
      globalThis.fetch = (async (_url: any, init?: RequestInit) => {
        if (init?.body) tabbyBody = JSON.parse(String(init.body));
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"Blocked"},"finish_reason":"content_filter"}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":10,"total_tokens":60}}',
        ]);
      }) as typeof fetch;

      const tRes = await tabby.streamChatCompletion({
        tier: 'high',
        thinkingBudget: 'off',
        skipGpuLock: true,
        messages: [{ role: 'user', content: 'hi' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
      });
      assert.deepEqual(tabbyBody.stream_options, { include_usage: true });
      assert.equal(tRes.finishReason, 'content_filter');
      assert.deepEqual(tRes.usage, { promptTokens: 50, completionTokens: 10, totalTokens: 60 });
    }

    // T10 & T11: Malformed tool-call JSON repair & error feedback in GoogleAiEngine & TabbyEngine
    {
      const engine = new GoogleAiEngine(tmpDir, { maxRetries: 0 });
      engine.updateConfig({
        provider: 'google_ai_studio',
        googleApiKey: 'test-key',
        selectedGoogleModel: 'gemini-4-hydrogen',
      });
      const executed: any[] = [];
      const parseErrs: any[] = [];
      globalThis.fetch = (async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c_repair","function":{"name":"read_file","arguments":"```json\\n{\\"path\\":\\"ok.ts\\",}\\n```"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c_bad","function":{"name":"manage_files","arguments":"{bad"}}]}}]}\n\n',
          'data: [DONE]\n\n',
        ])) as typeof fetch;

      const gRes = await engine.streamChatCompletion({
        tier: 'medium',
        thinkingBudget: 'off',
        messages: [{ role: 'user', content: 'tools' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
        onToolCallRequest: async (toolName, args) => {
          executed.push({ toolName, args });
        },
        onToolCallParseError: (info) => {
          parseErrs.push(info);
        },
      });
      assert.deepEqual(executed, [{ toolName: 'read_file', args: { path: 'ok.ts' } }]);
      assert.equal(parseErrs.length, 1);
      assert.equal(parseErrs[0].toolName, 'manage_files');
      assert.equal(gRes.malformedToolCalls?.length, 1);

      // T11: TabbyEngine OpenAI tool_calls + XML/JSON <tool_call> + truncated <tool_call>
      const googleCfg = new GoogleAiEngine(tmpDir);
      googleCfg.updateConfig({ provider: 'strata' });
      const tabby = new TabbyEngine({
        repoRoot: tmpDir,
        tabbyPort: 8080,
        sidecar: makeFakeHealthySidecar(),
        googleEngine: googleCfg,
        maxRetries: 0,
      });
      const tExec: any[] = [];
      const tErrs: any[] = [];
      globalThis.fetch = (async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.ts\\",}"}},{"index":1,"id":"tc2","function":{"name":"write_file","arguments":"{\\"unclosed"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"<tool_call>{bad_json}</tool_call><tool_call><function=list_directory><parameter=path>src"}}]}\n\n',
          'data: [DONE]\n\n',
        ])) as typeof fetch;

      const tRes = await tabby.streamChatCompletion({
        tier: 'high',
        thinkingBudget: 'off',
        skipGpuLock: true,
        messages: [{ role: 'user', content: 'tools' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
        onToolCallRequest: async (toolName, args) => {
          tExec.push({ toolName, args });
        },
        onToolCallParseError: (info) => {
          tErrs.push(info);
        },
      });
      assert.deepEqual(tExec, [{ toolName: 'read_file', args: { path: 'a.ts' } }]);
      assert.equal(tErrs.length, 3);
      assert.equal(tRes.malformedToolCalls?.length, 3);
      assert.equal(tRes.content.includes('<tool_call>'), false);
    }

    // T12, T13, T14: Orchestrator thinkingBudget 'off', thought_signature key-order/tc.id/sanitized-name/extra_content merge, chunk-split <thought>/<think>
    {
      const engine = new GoogleAiEngine(tmpDir, { maxRetries: 0 });
      engine.updateConfig({
        provider: 'google_ai_studio',
        googleApiKey: 'test-key',
        selectedGoogleModel: 'orchestrator-argon-hydrogen',
      });

      const thoughtsOff: string[] = [];
      globalThis.fetch = (async (url: any) => {
        if (String(url).includes('/decisions')) {
          return new Response('offline', { status: 503 });
        }
        return sseResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"secret thinking","content":"<thought>ignored</thought>Visible"}}]}\n\n',
          'data: [DONE]\n\n',
        ]);
      }) as typeof fetch;

      const offRes = await engine.streamChatCompletion({
        tier: 'high',
        thinkingBudget: 'off',
        messages: [{ role: 'user', content: 'Design and build feature X' }],
        onThoughtDelta: (d) => thoughtsOff.push(d),
        onTokenDelta: () => {},
      });
      assert.equal(offRes.thinkingTokens, 0);
      assert.equal(offRes.thinkingContent, '');
      assert.equal(thoughtsOff.length, 0);

      // T13: thought_signature key-order canonicalization, tc.id distinction, extra_content merge, sanitized tool name
      engine.updateConfig({ selectedGoogleModel: 'gemini-4-hydrogen' });
      const longToolName = 'mcp__very_long_server_prefix_that_exceeds_sixty_four_characters_total_length_name';
      globalThis.fetch = (async () =>
        sseResponse([
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"sig_id_1","function":{"name":"","arguments":"{\\"b\\":2,\\"a\\":1}"},"extra_content":{"google":{"thought_signature":"sig_1"},"other":"keep1"}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ])) as typeof fetch;

      // Test sanitized tool name + key-order canonicalization via sanitizeToolsForGoogle + recordThoughtSignature
      const sanitizedTools = [
        {
          type: 'function',
          function: {
            name: longToolName,
            description: 'long tool',
            parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
          },
        },
      ];
      const { tools: gTools, nameMap } = (engine as any).sanitizeToolsForGoogle(sanitizedTools);
      const safeName = gTools[0].function.name;
      assert.equal(nameMap.get(safeName), longToolName);

      globalThis.fetch = (async () =>
        sseResponse([
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"id_first","function":{"name":"${safeName}","arguments":"{\\"b\\":2,\\"a\\":1}"},"extra_content":{"google":{"thought_signature":"sig_first"},"meta":"m1"}},{"index":1,"id":"id_second","function":{"name":"${safeName}","arguments":"{\\"b\\":2,\\"a\\":1}"},"extra_content":{"google":{"thought_signature":"sig_second"}}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ])) as typeof fetch;

      await engine.streamChatCompletion({
        tier: 'medium',
        thinkingBudget: 'fast',
        tools: sanitizedTools,
        messages: [{ role: 'user', content: 'run long tool' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
        onToolCallRequest: async () => {},
      });

      const mapped = (engine as any).toOpenAiMessages([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'id_second',
              type: 'function',
              function: { name: longToolName, arguments: '{"a":1,"b":2}' },
              extra_content: { existingKey: true, google: { extraField: 42 } },
            },
            {
              id: 'db_reassigned_uuid',
              type: 'function',
              function: { name: longToolName, arguments: '{"a":1,"b":2}' },
            },
          ],
        },
      ]);
      assert.equal(mapped[0].tool_calls[0].extra_content.google.thought_signature, 'sig_second');
      assert.equal(mapped[0].tool_calls[0].extra_content.google.extraField, 42);
      assert.equal(mapped[0].tool_calls[0].extra_content.existingKey, true);
      assert.ok(mapped[0].tool_calls[1].extra_content.google.thought_signature);

      // T14: Chunk-split <thought>...</thought> and <think>...</think> carry-buffer
      globalThis.fetch = (async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"Intro <thou"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"ght>plan 1</th"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"ought> mid <thi"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"nk>plan 2</thi"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"nk>Outro"}}]}\n\n',
          'data: [DONE]\n\n',
        ])) as typeof fetch;

      const splitThoughts: string[] = [];
      const splitTokens: string[] = [];
      const splitRes = await engine.streamChatCompletion({
        tier: 'medium',
        thinkingBudget: 'fast',
        messages: [{ role: 'user', content: 'split tags' }],
        onThoughtDelta: (d) => splitThoughts.push(d),
        onTokenDelta: (d) => splitTokens.push(d),
      });
      assert.equal(splitThoughts.join(''), 'plan 1plan 2');
      assert.equal(splitTokens.join(''), 'Intro  mid Outro');
      assert.equal(splitRes.thinkingContent, 'plan 1plan 2');
      assert.equal(splitRes.content, 'Intro  mid Outro');
    }

    // T25 (P5.3): GoogleAiEngine thinkingBudget === 'off' must still strip <thought>/<think> tags without leaking
    {
      const engine = new GoogleAiEngine(tmpDir, { maxRetries: 0 });
      engine.updateConfig({
        provider: 'google_ai_studio',
        googleApiKey: 'test-key',
        selectedGoogleModel: 'gemini-4-hydrogen',
      });

      const deltas: string[] = [];
      const thoughts: string[] = [];
      globalThis.fetch = (async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"<thou"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"ght>secret</thou"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"ght><think>hidden</think>Visible"}}]}\n\n',
          'data: [DONE]\n\n',
        ])) as typeof fetch;

      const res = await engine.streamChatCompletion({
        tier: 'medium',
        thinkingBudget: 'off',
        messages: [{ role: 'user', content: 'hi' }],
        onThoughtDelta: (d) => thoughts.push(d),
        onTokenDelta: (d) => deltas.push(d),
      });
      assert.equal(res.content, 'Visible');
      assert.equal(res.thinkingContent, '');
      assert.equal(res.thinkingTokens, 0);
      assert.equal(thoughts.length, 0);
      assert.equal(deltas.join(''), 'Visible');
      assert.equal(deltas.some((d) => d.includes('<thought>') || d.includes('<think>')), false);
    }

    // T26 (P2.4): GoogleAiEngine HTTP 400 safety error mentioning "model" throws CONTENT_FILTER on first attempt without candidate fallback
    {
      const engine = new GoogleAiEngine(tmpDir, { maxRetries: 2, baseBackoffMs: 5 });
      engine.updateConfig({
        provider: 'google_ai_studio',
        googleApiKey: 'test-key',
        selectedGoogleModel: 'gemini-4-hydrogen',
      });

      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ error: { message: 'Model output blocked by safety content_filter' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;

      await assert.rejects(
        () =>
          engine.streamChatCompletion({
            tier: 'medium',
            thinkingBudget: 'off',
            messages: [{ role: 'user', content: 'hi' }],
            onThoughtDelta: () => {},
            onTokenDelta: () => {},
          }),
        (err: any) =>
          err instanceof InferenceError &&
          err.code === 'CONTENT_FILTER' &&
          err.status === 400 &&
          err.retryable === false
      );
      assert.equal(calls, 1, 'Safety 400 mentioning "model" must not fall back across candidates');
    }

    // T27 (P2g): TabbyEngine <think> inside <tool_call> XML parameters must be preserved verbatim (even across chunk splits)
    {
      const googleCfg = new GoogleAiEngine(tmpDir);
      googleCfg.updateConfig({ provider: 'strata' });
      const tabby = new TabbyEngine({
        repoRoot: tmpDir,
        tabbyPort: 8080,
        sidecar: makeFakeHealthySidecar(),
        googleEngine: googleCfg,
        maxRetries: 0,
      });

      const executed: Array<{ name: string; args: Record<string, any> }> = [];
      const thoughts: string[] = [];
      globalThis.fetch = (async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"<to"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"ol_call><function=write_file><parameter=path>t.ts</parameter><parameter=content>const s = \\"<thi"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"nk>example</thi"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"nk>\\";</parameter></function></tool_call>"}}]}\n\n',
          'data: [DONE]\n\n',
        ])) as typeof fetch;

      const res = await tabby.streamChatCompletion({
        tier: 'high',
        thinkingBudget: 'fast',
        skipGpuLock: true,
        tools: [
          {
            type: 'function',
            function: {
              name: 'write_file',
              parameters: {
                type: 'object',
                properties: { path: { type: 'string' }, content: { type: 'string' } },
              },
            },
          },
        ],
        messages: [{ role: 'user', content: 'write test' }],
        onThoughtDelta: (d) => thoughts.push(d),
        onTokenDelta: () => {},
        onToolCallRequest: async (name, args) => {
          executed.push({ name, args });
        },
      });

      assert.equal(executed.length, 1);
      assert.equal(executed[0].name, 'write_file');
      assert.equal(executed[0].args.content, 'const s = "<think>example</think>";');
      assert.equal(res.thinkingContent, '');
      assert.equal(thoughts.length, 0);
    }

    // T28 (P1c): TabbyEngine concurrent swapStatus clobber protection across onToolCallRequest and skipGpuLock stream
    {
      let offloadCount = 0;
      const sidecar = makeFakeHealthySidecar();
      (sidecar as any).offloadFromGpu = async () => {
        offloadCount += 1;
      };

      const googleCfg = new GoogleAiEngine(tmpDir);
      googleCfg.updateConfig({ provider: 'strata' });
      const tabby = new TabbyEngine({
        repoRoot: tmpDir,
        tabbyPort: 8080,
        sidecar,
        googleEngine: googleCfg,
        maxRetries: 0,
      });

      let markCallAToolEntered!: () => void;
      const callAToolEntered = new Promise<void>((resolve) => {
        markCallAToolEntered = resolve;
      });
      let releaseCallATool!: () => void;
      const waitCallATool = new Promise<void>((resolve) => {
        releaseCallATool = resolve;
      });

      let markCallBStreamEntered!: () => void;
      const callBStreamEntered = new Promise<void>((resolve) => {
        markCallBStreamEntered = resolve;
      });
      let releaseCallBStream!: () => void;

      let fetchNum = 0;
      globalThis.fetch = (async (url: any) => {
        if (String(url).endsWith('/health')) return new Response('ok', { status: 200 });
        fetchNum += 1;
        if (fetchNum === 1) {
          return sseResponse([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}\n\n',
            'data: [DONE]\n\n',
          ]);
        }
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"B1"}}]}\n\n'));
            markCallBStreamEntered();
            releaseCallBStream = () => {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            };
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }) as typeof fetch;

      const callAPromise = tabby.streamChatCompletion({
        tier: 'high',
        thinkingBudget: 'off',
        messages: [{ role: 'user', content: 'call A' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
        onToolCallRequest: async () => {
          markCallAToolEntered();
          await waitCallATool;
        },
      });

      await callAToolEntered;
      const callBPromise = tabby.streamChatCompletion({
        tier: 'high',
        thinkingBudget: 'off',
        skipGpuLock: true,
        messages: [{ role: 'user', content: 'call B' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
      });

      await callBStreamEntered;
      assert.equal(tabby.getTelemetry().swapStatus, 'generating');

      // Release Call A while Call B is still mid-stream
      releaseCallATool();
      await callAPromise;

      // Call A's finally must NOT clobber swapStatus or allow idle offload while Call B is active
      assert.equal(tabby.getTelemetry().swapStatus, 'generating');
      await tabby.unloadModelDueToIdle();
      assert.equal(offloadCount, 0, 'unloadModelDueToIdle must not offload while Call B is still generating');

      // Now finish Call B and verify swapStatus returns to ready and offload succeeds
      releaseCallBStream();
      const bRes = await callBPromise;
      assert.equal(bRes.content, 'B1');
      assert.equal(tabby.getTelemetry().swapStatus, 'ready');
      await Promise.resolve();
      await tabby.unloadModelDueToIdle();
      assert.equal(offloadCount, 1);
    }

    console.log('✅ Inference Reliability Unit Tests PASSED (T1-T14, T25-T28)');
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runInferenceReliabilityTests().catch((err) => {
  console.error('❌ Inference Reliability Unit Tests FAILED:', err);
  process.exit(1);
});
