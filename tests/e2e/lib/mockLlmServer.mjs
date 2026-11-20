import assert from 'node:assert/strict';
import http from 'node:http';
import { FORBIDDEN_PORTS, waitFor } from './harness.mjs';

const DEFAULT_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let ended = false;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
    };
    const onData = (chunk) => chunks.push(chunk);
    const onEnd = () => {
      ended = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf-8'));
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      if (!ended) {
        cleanup();
        reject(new Error('Request body stream closed before end'));
      }
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

function waitWithCloseCheck(res, ms) {
  if (res.destroyed || res.writableEnded) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      res.off('close', onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    res.once('close', onClose);
    timer = setTimeout(() => finish(false), ms);
  });
}

function splitStringAtIndices(str, splitIndices) {
  if (!Array.isArray(splitIndices) || splitIndices.length === 0) {
    return [str];
  }
  const sorted = [...new Set(splitIndices.filter((n) => Number.isInteger(n) && n > 0 && n < str.length))].sort(
    (a, b) => a - b
  );
  if (sorted.length === 0) return [str];
  const parts = [];
  let prev = 0;
  for (const idx of sorted) {
    parts.push(str.slice(prev, idx));
    prev = idx;
  }
  if (prev < str.length) {
    parts.push(str.slice(prev));
  }
  return parts;
}

function buildXmlToolCallText(xmlToolCalls) {
  return xmlToolCalls
    .map((tc) => {
      const params = Object.entries(tc.args || {})
        .map(([k, v]) => `<parameter=${k}>${typeof v === 'string' ? v : JSON.stringify(v)}</parameter>`)
        .join('');
      return `<tool_call><function=${tc.name}>${params}</function></tool_call>`;
    })
    .join('\n');
}

function buildJsonToolCallText(jsonToolCalls) {
  return jsonToolCalls
    .map((tc) => `<tool_call>${JSON.stringify({ name: tc.name, arguments: tc.args || {} })}</tool_call>`)
    .join('\n');
}

function mapGeminiFinishReason(finishReason) {
  switch (finishReason) {
    case 'length':
      return 'MAX_TOKENS';
    case 'content_filter':
      return 'SAFETY';
    case 'stop':
    case 'tool_calls':
    default:
      return 'STOP';
  }
}

function buildOpenAiSseChunks(step, reqCtx) {
  if (Array.isArray(step.sseRawChunks)) {
    return [...step.sseRawChunks];
  }

  const model = step.model || reqCtx.body?.model || 'mock-model';
  const id = step.id || `chatcmpl-mock-${reqCtx.index}`;
  const created = Math.floor(Date.now() / 1000);
  const chunks = [];

  const pushDelta = (delta, finish_reason = null, usage = undefined) => {
    const payload = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason }],
    };
    if (usage !== undefined) payload.usage = usage;
    chunks.push(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const reasoningChunks = Array.isArray(step.reasoningChunks)
    ? step.reasoningChunks
    : typeof step.thinking === 'string' && step.thinking.length > 0
      ? [step.thinking]
      : [];

  for (const rc of reasoningChunks) {
    pushDelta({ reasoning_content: rc });
  }

  let contentChunks = Array.isArray(step.contentChunks)
    ? [...step.contentChunks]
    : typeof step.content === 'string' && step.content.length > 0
      ? [step.content]
      : [];

  if (Array.isArray(step.xmlToolCalls) && step.xmlToolCalls.length > 0) {
    contentChunks.push(buildXmlToolCallText(step.xmlToolCalls));
  }
  if (Array.isArray(step.jsonToolCalls) && step.jsonToolCalls.length > 0) {
    contentChunks.push(buildJsonToolCallText(step.jsonToolCalls));
  }

  for (const cc of contentChunks) {
    pushDelta({ content: cc });
  }

  const toolCalls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
  toolCalls.forEach((tc, idx) => {
    const tcIndex = tc.index ?? idx;
    const tcId = tc.id || `call_mock_${reqCtx.index}_${idx}`;
    const argsStr =
      typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {});
    const argParts = splitStringAtIndices(argsStr, tc.splitArgsAt);

    const firstToolCallDelta = {
      index: tcIndex,
      id: tcId,
      type: 'function',
      function: { name: tc.name, arguments: argParts[0] ?? '' },
    };
    if (tc.thoughtSignature !== undefined) {
      firstToolCallDelta.extra_content = {
        google: { thought_signature: tc.thoughtSignature },
      };
    }
    pushDelta({ tool_calls: [firstToolCallDelta] });

    for (let p = 1; p < argParts.length; p++) {
      pushDelta({
        tool_calls: [
          {
            index: tcIndex,
            function: { arguments: argParts[p] },
          },
        ],
      });
    }
  });

  if (
    reasoningChunks.length === 0 &&
    contentChunks.length === 0 &&
    toolCalls.length === 0 &&
    step.content !== ''
  ) {
    pushDelta({ content: 'Mock LLM response' });
  }

  const finishReason =
    step.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop');

  const usageObj = step.usage
    ? {
        prompt_tokens: step.usage.prompt_tokens ?? 10,
        completion_tokens: step.usage.completion_tokens ?? 5,
        total_tokens:
          step.usage.total_tokens ??
          (step.usage.prompt_tokens ?? 10) + (step.usage.completion_tokens ?? 5),
        ...(step.usage.completion_tokens_details
          ? { completion_tokens_details: step.usage.completion_tokens_details }
          : {}),
      }
    : undefined;

  const shouldEmitUsageChunk =
    step.emitUsageChunk ?? Boolean(usageObj || reqCtx.body?.stream_options?.include_usage);

  pushDelta({}, finishReason, !shouldEmitUsageChunk ? usageObj : undefined);

  if (shouldEmitUsageChunk) {
    const finalUsage = usageObj || {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    };
    chunks.push(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [],
        usage: finalUsage,
      })}\n\n`
    );
  }

  if (!step.omitDone) {
    chunks.push('data: [DONE]\n\n');
  }

  return chunks;
}

function buildOpenAiJsonResponse(step, reqCtx) {
  const model = step.model || reqCtx.body?.model || 'mock-model';
  const id = step.id || `chatcmpl-mock-${reqCtx.index}`;
  let content = typeof step.content === 'string' ? step.content : '';
  if (Array.isArray(step.contentChunks)) {
    content = step.contentChunks.join('');
  }
  if (Array.isArray(step.xmlToolCalls) && step.xmlToolCalls.length > 0) {
    content += (content ? '\n' : '') + buildXmlToolCallText(step.xmlToolCalls);
  }
  if (Array.isArray(step.jsonToolCalls) && step.jsonToolCalls.length > 0) {
    content += (content ? '\n' : '') + buildJsonToolCallText(step.jsonToolCalls);
  }
  if (!content && !step.thinking && !(step.toolCalls && step.toolCalls.length > 0)) {
    content = 'Mock LLM response';
  }

  const toolCalls = Array.isArray(step.toolCalls)
    ? step.toolCalls.map((tc, idx) => ({
        id: tc.id || `call_mock_${reqCtx.index}_${idx}`,
        type: 'function',
        function: {
          name: tc.name,
          arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
        },
        ...(tc.thoughtSignature !== undefined
          ? { extra_content: { google: { thought_signature: tc.thoughtSignature } } }
          : {}),
      }))
    : undefined;

  const message = {
    role: 'assistant',
    content: content || null,
  };
  if (step.thinking) message.reasoning_content = step.thinking;
  if (toolCalls && toolCalls.length > 0) message.tool_calls = toolCalls;

  const finishReason =
    step.finishReason ?? (toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop');

  const usage = step.usage
    ? {
        prompt_tokens: step.usage.prompt_tokens ?? 10,
        completion_tokens: step.usage.completion_tokens ?? 5,
        total_tokens:
          step.usage.total_tokens ??
          (step.usage.prompt_tokens ?? 10) + (step.usage.completion_tokens ?? 5),
        ...(step.usage.completion_tokens_details
          ? { completion_tokens_details: step.usage.completion_tokens_details }
          : {}),
      }
    : { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage,
  };
}

function buildGeminiParts(step) {
  if (Array.isArray(step.geminiParts)) {
    return step.geminiParts;
  }
  const parts = [];
  const reasoning = Array.isArray(step.reasoningChunks)
    ? step.reasoningChunks.join('')
    : step.thinking || '';
  if (reasoning) {
    parts.push({ thought: true, text: reasoning });
  }
  const text = Array.isArray(step.contentChunks)
    ? step.contentChunks.join('')
    : step.content ?? '';
  if (text) {
    parts.push({ text });
  }
  if (Array.isArray(step.toolCalls)) {
    for (const tc of step.toolCalls) {
      let parsedArgs = tc.arguments;
      if (typeof parsedArgs === 'string') {
        try {
          parsedArgs = JSON.parse(parsedArgs);
        } catch {
          parsedArgs = { _raw: parsedArgs };
        }
      }
      const part = {
        functionCall: {
          name: tc.name,
          args: parsedArgs ?? {},
        },
      };
      if (tc.thoughtSignature !== undefined) {
        part.thoughtSignature = tc.thoughtSignature;
      }
      parts.push(part);
    }
  }
  if (parts.length === 0) {
    parts.push({ text: 'Mock Gemini response' });
  }
  return parts;
}

function buildGeminiUsageMetadata(step) {
  const promptTokens = step.usage?.prompt_tokens ?? 10;
  const completionTokens = step.usage?.completion_tokens ?? 5;
  const thinkingTokens = step.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  return {
    promptTokenCount: promptTokens,
    candidatesTokenCount: completionTokens,
    thoughtsTokenCount: thinkingTokens,
    totalTokenCount: step.usage?.total_tokens ?? promptTokens + completionTokens + thinkingTokens,
  };
}

function buildGeminiSseChunks(step) {
  if (Array.isArray(step.sseRawChunks)) {
    return [...step.sseRawChunks];
  }

  const chunks = [];
  const usageMetadata = buildGeminiUsageMetadata(step);
  const finishReason = mapGeminiFinishReason(step.finishReason);

  const reasoningChunks = Array.isArray(step.reasoningChunks)
    ? step.reasoningChunks
    : typeof step.thinking === 'string' && step.thinking.length > 0
      ? [step.thinking]
      : [];
  for (const rc of reasoningChunks) {
    chunks.push(
      `data: ${JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ thought: true, text: rc }] } }],
      })}\n\n`
    );
  }

  const contentChunks = Array.isArray(step.contentChunks)
    ? step.contentChunks
    : typeof step.content === 'string' && step.content.length > 0
      ? [step.content]
      : [];
  for (const cc of contentChunks) {
    chunks.push(
      `data: ${JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text: cc }] } }],
      })}\n\n`
    );
  }

  if (Array.isArray(step.toolCalls) && step.toolCalls.length > 0) {
    const fcParts = step.toolCalls.map((tc) => {
      let args = tc.arguments;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = { _raw: args };
        }
      }
      const p = { functionCall: { name: tc.name, args: args ?? {} } };
      if (tc.thoughtSignature !== undefined) p.thoughtSignature = tc.thoughtSignature;
      return p;
    });
    chunks.push(
      `data: ${JSON.stringify({
        candidates: [{ content: { role: 'model', parts: fcParts }, finishReason }],
        usageMetadata,
      })}\n\n`
    );
  } else if (Array.isArray(step.geminiParts)) {
    chunks.push(
      `data: ${JSON.stringify({
        candidates: [{ content: { role: 'model', parts: step.geminiParts }, finishReason }],
        usageMetadata,
      })}\n\n`
    );
  } else {
    if (chunks.length === 0) {
      chunks.push(
        `data: ${JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: 'Mock Gemini response' }] } }],
        })}\n\n`
      );
    }
    chunks.push(
      `data: ${JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [] }, finishReason }],
        usageMetadata,
      })}\n\n`
    );
  }

  return chunks;
}

async function sendChunkedSse(req, res, chunks, step) {
  let closed = false;
  let hasStalled = false;
  const onClose = () => {
    closed = true;
  };
  res.once('close', onClose);

  try {
    res.writeHead(step.status || 200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(step.headers || {}),
    });
    res.flushHeaders?.();

    if (typeof step.abortAfterChunks === 'number' && step.abortAfterChunks <= 0) {
      if (await waitWithCloseCheck(res, 15)) return;
      if (!closed && !res.destroyed) {
        res.socket?.destroy();
      }
      return;
    }

    for (let i = 0; i < chunks.length; i++) {
      if (closed || res.destroyed) return;

      if (typeof step.abortAfterChunks === 'number' && i >= step.abortAfterChunks) {
        res.socket?.destroy();
        return;
      }

      if (
        typeof step.stallAfterChunks === 'number' &&
        i >= step.stallAfterChunks &&
        !hasStalled
      ) {
        hasStalled = true;
        const abortedDuringStall = await waitWithCloseCheck(res, step.stallMs ?? 10000);
        if (abortedDuringStall || closed || res.destroyed) return;
        if (step.abortAfterStall) {
          res.socket?.destroy();
          return;
        }
      }

      await new Promise((resolve) => {
        res.write(chunks[i], () => resolve());
      });
      if (typeof step.chunkDelayMs === 'number' && step.chunkDelayMs > 0) {
        if (await waitWithCloseCheck(res, step.chunkDelayMs)) return;
      } else if (
        (typeof step.abortAfterChunks === 'number' && i + 1 >= step.abortAfterChunks) ||
        (typeof step.stallAfterChunks === 'number' && !hasStalled && i + 1 >= step.stallAfterChunks)
      ) {
        if (await waitWithCloseCheck(res, 15)) return;
      }
    }

    if (closed || res.destroyed) return;

    if (typeof step.abortAfterChunks === 'number' && chunks.length >= step.abortAfterChunks) {
      res.socket?.destroy();
      return;
    }

    if (
      typeof step.stallAfterChunks === 'number' &&
      chunks.length >= step.stallAfterChunks &&
      !hasStalled
    ) {
      hasStalled = true;
      const abortedDuringStall = await waitWithCloseCheck(res, step.stallMs ?? 10000);
      if (abortedDuringStall || closed || res.destroyed) return;
      if (step.abortAfterStall) {
        res.socket?.destroy();
        return;
      }
    }

    if (!closed && !res.destroyed) {
      res.end();
    }
  } finally {
    res.off('close', onClose);
  }
}

export async function createMockLlmServer(options = {}) {
  const stepQueue = [];
  const requests = [];
  let customHandler = typeof options.handler === 'function' ? options.handler : null;
  let loadedModel = options.loadedModel || 'mock-model';
  let healthStatus = options.healthStatus ?? 200;
  let defaultStep = options.defaultResponse || null;
  const sockets = new Set();

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const rawBody = await readRequestBody(req);
      let body = null;
      if (rawBody.trim().length > 0) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = rawBody;
        }
      }

      const reqCtx = {
        index: requests.length,
        method: req.method || 'GET',
        path: parsedUrl.pathname,
        query: Object.fromEntries(parsedUrl.searchParams.entries()),
        headers: { ...req.headers },
        body,
        rawBody,
        receivedAt: Date.now(),
      };
      requests.push(reqCtx);

      const isControlRoute =
        reqCtx.path === '/health' ||
        reqCtx.path === '/v1/models' ||
        reqCtx.path === '/v1/model' ||
        reqCtx.path === '/v1/model/unload' ||
        reqCtx.path === '/v1/model/load';

      let step = null;
      if (customHandler) {
        step = await customHandler(reqCtx, stepQueue);
      } else if (!isControlRoute && stepQueue.length > 0) {
        step = stepQueue.shift();
      } else if (isControlRoute && stepQueue.length > 0 && stepQueue[0]?.matchControl) {
        step = stepQueue.shift();
      }

      if (!step && defaultStep && !isControlRoute) {
        step = typeof defaultStep === 'function' ? await defaultStep(reqCtx) : defaultStep;
      }

      if (step && typeof step === 'function') {
        step = await step(reqCtx);
      }

      if (step?.dropConnection) {
        req.socket?.destroy();
        return;
      }

      if (typeof step?.hangMs === 'number' && step.hangMs > 0) {
        const abortedDuringHang = await waitWithCloseCheck(res, step.hangMs);
        if (abortedDuringHang || res.destroyed || res.writableEnded) return;
      }

    if (typeof step?.status === 'number' && step.status >= 400) {
      const errBody =
        step.body ?? {
          error: {
            message: `Mock HTTP ${step.status}`,
            type: 'mock_error',
            code: step.status,
          },
        };
      const payload = typeof errBody === 'string' ? errBody : JSON.stringify(errBody);
      res.writeHead(step.status, {
        'Content-Type': typeof errBody === 'string' ? 'text/plain' : 'application/json',
        ...(step.headers || {}),
      });
      res.end(payload);
      return;
    }

    // Health & Tabby Control routes
    if (reqCtx.method === 'GET' && reqCtx.path === '/health') {
      res.writeHead(healthStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(step?.body ?? { status: healthStatus === 200 ? 'ok' : 'error' }));
      return;
    }

    if (reqCtx.method === 'GET' && reqCtx.path === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          step?.body ?? {
            object: 'list',
            data: [{ id: loadedModel, object: 'model', owned_by: 'localgravity-mock' }],
          }
        )
      );
      return;
    }

    if (reqCtx.method === 'GET' && reqCtx.path === '/v1/model') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(step?.body ?? { id: loadedModel }));
      return;
    }

    if (reqCtx.method === 'POST' && reqCtx.path === '/v1/model/unload') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(step?.body ?? { ok: true }));
      return;
    }

    if (reqCtx.method === 'POST' && reqCtx.path === '/v1/model/load') {
      if (body && typeof body === 'object' && body.model_name) {
        loadedModel = String(body.model_name);
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      res.end('data: {"module":1,"modules":1,"status":"finished"}\n\n');
      return;
    }

    // Google Decisions API
    if (reqCtx.method === 'POST' && reqCtx.path === '/v1beta/decisions') {
      const decisionBody =
        step?.body ??
        (step?.decision
          ? {
              answers: {
                needs_planning: { noul: step.decision.needsPlanningScore ?? 0.85 },
                planner_model: {
                  choice: step.decision.choice ?? 'argon',
                  confidence: step.decision.confidence ?? 0.9,
                },
              },
            }
          : {
              answers: {
                needs_planning: { noul: 0.85 },
                planner_model: { choice: 'argon', confidence: 0.9 },
              },
            });
      res.writeHead(step?.status || 200, { 'Content-Type': 'application/json', ...(step?.headers || {}) });
      res.end(JSON.stringify(decisionBody));
      return;
    }

    // Google Interactions API
    if (reqCtx.method === 'POST' && reqCtx.path === '/v1beta/interactions') {
      const interactionsBody = step?.body ?? {
        output_image: {
          data: DEFAULT_1X1_PNG_BASE64,
          mime_type: 'image/png',
        },
      };
      res.writeHead(step?.status || 200, { 'Content-Type': 'application/json', ...(step?.headers || {}) });
      res.end(JSON.stringify(interactionsBody));
      return;
    }

    // Native Gemini REST / SSE: /v1beta/models/:model:generateContent or :streamGenerateContent
    const geminiModelMatch = reqCtx.path.match(/^\/v1beta\/models\/([^/:]+):(generateContent|streamGenerateContent)$/);
    if (reqCtx.method === 'POST' && geminiModelMatch) {
      const action = geminiModelMatch[2];
      const effectiveStep = step || {};
      const isSse = action === 'streamGenerateContent' && (reqCtx.query.alt === 'sse' || effectiveStep.forceSse);

      if (isSse) {
        const chunks = buildGeminiSseChunks(effectiveStep);
        await sendChunkedSse(req, res, chunks, effectiveStep);
        return;
      }

      const payload =
        effectiveStep.body ?? {
          candidates: [
            {
              content: {
                role: 'model',
                parts: buildGeminiParts(effectiveStep),
              },
              finishReason: mapGeminiFinishReason(effectiveStep.finishReason),
            },
          ],
          usageMetadata: buildGeminiUsageMetadata(effectiveStep),
        };
      res.writeHead(effectiveStep.status || 200, {
        'Content-Type': 'application/json',
        ...(effectiveStep.headers || {}),
      });
      res.end(JSON.stringify(payload));
      return;
    }

    // OpenAI / Tabby / Strata / Google OpenAI-Compat Chat Completions
    if (
      reqCtx.method === 'POST' &&
      (reqCtx.path === '/v1/chat/completions' ||
        reqCtx.path === '/v1beta/openai/chat/completions' ||
        reqCtx.path === '/openai/chat/completions')
    ) {
      const effectiveStep = step || {};
      if (effectiveStep.body && !Array.isArray(effectiveStep.sseRawChunks)) {
        res.writeHead(effectiveStep.status || 200, {
          'Content-Type': 'application/json',
          ...(effectiveStep.headers || {}),
        });
        res.end(
          typeof effectiveStep.body === 'string'
            ? effectiveStep.body
            : JSON.stringify(effectiveStep.body)
        );
        return;
      }

      const wantsStream =
        Array.isArray(effectiveStep.sseRawChunks) ||
        effectiveStep.forceSse === true ||
        (body && typeof body === 'object' ? body.stream !== false : true);

      if (!wantsStream) {
        const jsonResp = buildOpenAiJsonResponse(effectiveStep, reqCtx);
        res.writeHead(effectiveStep.status || 200, {
          'Content-Type': 'application/json',
          ...(effectiveStep.headers || {}),
        });
        res.end(JSON.stringify(jsonResp));
        return;
      }

      const chunks = buildOpenAiSseChunks(effectiveStep, reqCtx);
      await sendChunkedSse(req, res, chunks, effectiveStep);
      return;
    }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Mock route not found: ${reqCtx.method} ${reqCtx.path}` } }));
    } catch (err) {
      if (!res.headersSent && !res.destroyed && !res.writableEnded && !res.socket?.destroyed) {
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: err?.message || String(err) } }));
        } catch {}
      } else if (!res.destroyed) {
        try {
          res.destroy();
        } catch {}
      }
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  assert.ok(port > 0, 'Mock LLM server must bind a valid port');
  assert.ok(!FORBIDDEN_PORTS.has(port), `Mock LLM server bound forbidden port ${port}`);

  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    port,
    url: baseUrl,
    baseUrl,
    openaiBaseUrl: `${baseUrl}/v1`,
    geminiBaseUrl: `${baseUrl}/v1beta`,
    requests,
    enqueue(...steps) {
      stepQueue.push(...steps);
    },
    setHandler(fn) {
      customHandler = fn;
    },
    setHealthStatus(status) {
      healthStatus = status;
    },
    setDefaultResponse(step) {
      defaultStep = step;
    },
    clearRequests() {
      requests.length = 0;
    },
    reset() {
      stepQueue.length = 0;
      requests.length = 0;
      customHandler = null;
      defaultStep = null;
      loadedModel = options.loadedModel || 'mock-model';
      healthStatus = options.healthStatus ?? 200;
    },
    async waitForRequestCount(n, timeoutMs = 5000) {
      await waitFor(() => requests.length >= n, {
        timeoutMs,
        intervalMs: 25,
        label: `mockLlmServer to receive ${n} requests`,
      });
      return requests.slice(0, n);
    },
    async close() {
      for (const sock of sockets) {
        try {
          sock.destroy();
        } catch {}
      }
      sockets.clear();
      await new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
