import http from 'http';

const PROMPT = `Solve this senior systems engineering coding problem step-by-step:

Problem: Implement a high-performance Lock-Free Multi-Producer Multi-Consumer (MPMC) Bounded Queue in C++20 using atomic operations and explicit std::memory_order semantics.

Requirements:
1. Design & Memory Model:
   - Explain how sequence numbers per slot prevent ABA and race conditions.
   - Explain cache-line padding (alignas) to eliminate false sharing.
   - Specify exact memory orderings (relaxed, acquire, release) and prove why they prevent data races.
2. Complete C++20 Implementation:
   - Template <typename T, size_t Capacity> (Capacity enforced power of 2 via concepts or static_assert).
   - Implement try_enqueue(const T& data) and try_dequeue(T& data).
3. Multi-Threaded Verification:
   - Provide a complete, self-contained main() function with 4 producer threads and 4 consumer threads pushing and popping 500,000 items, verifying zero drops and exact sum consistency.`;

async function pollReady() {
  process.stdout.write('[TestHarness] Waiting for Strata on http://127.0.0.1:8080 to become ready...');
  while (true) {
    try {
      const res = await fetch('http://127.0.0.1:8080/health').catch(() => null);
      if (res && res.status === 200) {
        console.log('\n[TestHarness] Strata 8080 is ONLINE and healthy!');
        return;
      }
    } catch {}
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function runHardCodingTest() {
  await pollReady();

  console.log('\n======================================================');
  console.log('  Qwen 3.8 Flash-Next High Tier — Hard Coding Test');
  console.log('======================================================\n');
  console.log('[Prompt Submitted]:\n' + PROMPT + '\n');
  console.log('------------------------------------------------------\n');

  const startTime = performance.now();
  let firstTokenTime = null;
  let thinkingTokens = 0;
  let contentTokens = 0;
  let inThinking = false;

  const payload = JSON.stringify({
    model: 'qwen3.8-flash-next-iq3_s',
    messages: [
      {
        role: 'system',
        content: 'You are an elite algorithms and systems engineer. Solve complex algorithmic and concurrency problems with rigorous step-by-step mathematical reasoning and production-grade, bug-free code.'
      },
      {
        role: 'user',
        content: PROMPT
      }
    ],
    stream: true,
    max_tokens: 8192,
    temperature: 0.6
  });

  const response = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: payload
  });

  if (!response.ok) {
    console.error(`[Error] HTTP ${response.status}: ${await response.text()}`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;

          if (!firstTokenTime) {
            firstTokenTime = performance.now();
            console.log(`[Time To First Token]: ${((firstTokenTime - startTime) / 1000).toFixed(2)}s\n`);
          }

          if (delta.reasoning_content) {
            if (!inThinking) {
              inThinking = true;
              process.stdout.write('\n🧠 [Thinking Phase]:\n');
            }
            process.stdout.write(delta.reasoning_content);
            thinkingTokens++;
          }

          if (delta.content) {
            if (inThinking) {
              inThinking = false;
              process.stdout.write('\n\n💡 [Solution Output]:\n');
            }
            process.stdout.write(delta.content);
            contentTokens++;
          }
        } catch {}
      }
    }
  }

  const endTime = performance.now();
  const totalElapsedSec = (endTime - startTime) / 1000;
  const genElapsedSec = firstTokenTime ? (endTime - firstTokenTime) / 1000 : totalElapsedSec;
  const totalTokens = thinkingTokens + contentTokens;
  const tokPerSec = (totalTokens / genElapsedSec).toFixed(1);

  console.log('\n\n======================================================');
  console.log('  Performance Metrics Summary');
  console.log('======================================================');
  console.log(`  Total Tokens Generated : ${totalTokens} (${thinkingTokens} thinking, ${contentTokens} answer)`);
  console.log(`  Time to First Token    : ${firstTokenTime ? ((firstTokenTime - startTime) / 1000).toFixed(2) : 'N/A'}s`);
  console.log(`  Generation Time        : ${genElapsedSec.toFixed(2)}s`);
  console.log(`  Generation Speed       : ${tokPerSec} tokens/second`);
  console.log('======================================================\n');
}

runHardCodingTest().catch(console.error);
