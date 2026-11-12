import http from 'node:http';

const reqData = JSON.stringify({
  model: 'qwen3.8-flash-next-iq3_xxs',
  messages: [
    {
      role: 'user',
      content: 'Solve this logic puzzle step by step: You have 3 boxes labeled Apples, Oranges, and Mixed. All 3 are labeled incorrectly. You pick one fruit from one box. Which box do you pick from to determine the contents of all 3 boxes?'
    }
  ],
  max_tokens: 400,
  temperature: 0.6
});

const start = Date.now();
const req = http.request(
  {
    hostname: '127.0.0.1',
    port: 8080,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(reqData)
    }
  },
  (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      const elapsedSec = (Date.now() - start) / 1000;
      console.log('HTTP Status:', res.statusCode);
      try {
        const json = JSON.parse(body);
        const choice = json.choices && json.choices[0];
        console.log('=== STRATA RESULT ===');
        console.log('Elapsed:', elapsedSec.toFixed(2), 's');
        if (json.usage) {
          console.log('Completion tokens:', json.usage.completion_tokens);
          console.log('Tokens/sec:', (json.usage.completion_tokens / elapsedSec).toFixed(1));
        }
        if (choice && choice.message) {
          if (choice.message.reasoning_content) {
            console.log('--- REASONING CONTENT ---');
            console.log(choice.message.reasoning_content.slice(0, 500) + '...');
          }
          console.log('--- FINAL CONTENT ---');
          console.log(choice.message.content);
        }
      } catch (err) {
        console.error('Parse error:', err, 'Body:', body);
      }
    });
  }
);

req.on('error', (err) => {
  console.error('Request error:', err);
});

req.write(reqData);
req.end();
