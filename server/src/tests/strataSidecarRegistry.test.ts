import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GoogleAiEngine } from '../google/googleAiEngine.js';
import { ProviderRegistry, isForbiddenProviderUrl } from '../providers/providerRegistry.js';
import { SwarmTurnScheduler } from '../swarm/swarmScheduler.js';
import { LlamaMoESidecar, extractListeningPidsForPort } from '../tabby/llamaSidecar.js';
import { TabbyEngine } from '../tabby/tabbyEngine.js';
import { deduplicateRepeatedSequences, hasConsecutiveRepetition } from '../tabby/textNormalizers.js';

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

class FakeChildProcess extends EventEmitter {
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public exitCode: number | null = null;
  public killed = false;
  public pid: number;
  public killCalls: string[] = [];

  constructor(pid = 99991) {
    super();
    this.pid = pid;
  }

  public kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    this.killCalls.push(String(signal));
    this.killed = true;
    if (this.exitCode === null) {
      this.exitCode = 0;
      queueMicrotask(() => this.emit('exit', 0));
    }
    return true;
  }
}

async function runStrataSidecarRegistryTests() {
  console.log('Running Strata, LlamaSidecar & ProviderRegistry Unit Tests (F2.4, R5)...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-strata-reg-'));
  const originalFetch = globalThis.fetch;

  try {
    // T15 & T16: TabbyEngine auto-wakes dead/offloaded sidecar before checkConnection,
    // and executes ensureRunning/profile swap INSIDE SwarmTurnScheduler.acquireGpuTurn
    {
      const sidecar = new LlamaMoESidecar({ port: 8080 });
      let healthyState = false;
      let activeCountDuringEnsureRunning = -1;
      let ensureRunningCalls = 0;

      (sidecar as any).isHealthy = async () => healthyState;
      (sidecar as any).getActiveProfile = () => 'swift-1.5-iq2_xs';
      (sidecar as any).ensureRunning = async () => {
        ensureRunningCalls += 1;
        activeCountDuringEnsureRunning = SwarmTurnScheduler.getInstance().getStatus().activeCount;
        healthyState = true;
        return true;
      };

      const googleEngine = new GoogleAiEngine(tmpDir);
      googleEngine.updateConfig({ provider: 'strata' });

      const tabby = new TabbyEngine({
        repoRoot: tmpDir,
        tabbyPort: 8080,
        sidecar,
        googleEngine,
        maxRetries: 0,
      });

      // Set activeTier === 'high' and swapStatus === 'ready' to verify it STILL checks sidecar.isHealthy()
      (tabby as any).activeTier = 'high';
      (tabby as any).swapStatus = 'ready';

      globalThis.fetch = (async (url: any) => {
        if (String(url).endsWith('/health')) {
          return new Response('ok', { status: healthyState ? 200 : 503 });
        }
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"Woke and replied"}}]}\n\n',
          'data: [DONE]\n\n',
        ]);
      }) as typeof fetch;

      const res = await tabby.streamChatCompletion({
        tier: 'high',
        thinkingBudget: 'off',
        messages: [{ role: 'user', content: 'wake up' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
      });
      assert.equal(ensureRunningCalls, 1);
      assert.equal(activeCountDuringEnsureRunning, 1, 'ensureRunning must execute inside SwarmTurnScheduler GPU lock');
      assert.equal(SwarmTurnScheduler.getInstance().getStatus().activeCount, 0);
      assert.equal(res.content, 'Woke and replied');
    }

    // T17: !strataMode fix, hasConsecutiveRepetition, XML <tool_call> schema/indentation/buffering, role: 'tool' preservation
    {
      // textNormalizers unit checks
      assert.equal(hasConsecutiveRepetition('------------------------------'), false);
      assert.equal(hasConsecutiveRepetition('                              '), false);
      assert.equal(hasConsecutiveRepetition('| --- | --- | --- | --- | --- |'), false);
      assert.equal(
        hasConsecutiveRepetition('Checking file status now. Checking file status now. Checking file status now.'),
        true
      );

      const twoLineCode = '  if (x) {\n    return null;\n    return null;\n  }';
      assert.equal(deduplicateRepeatedSequences(twoLineCode), twoLineCode);
      const threeLineRepeat = '  repeated line here\n  repeated line here\n  repeated line here';
      assert.equal(deduplicateRepeatedSequences(threeLineRepeat), '  repeated line here\n  repeated line here');

      // Strata streaming checks
      const sidecar = new LlamaMoESidecar({ port: 8080 });
      (sidecar as any).isHealthy = async () => true;
      (sidecar as any).ensureRunning = async () => true;
      (sidecar as any).getActiveProfile = () => 'swift-1.5-iq2_xs';

      const googleEngine = new GoogleAiEngine(tmpDir);
      googleEngine.updateConfig({ provider: 'strata' });
      const tabby = new TabbyEngine({
        repoRoot: tmpDir,
        tabbyPort: 8080,
        sidecar,
        googleEngine,
        maxRetries: 0,
      });

      const toolsSchema = [
        {
          type: 'function',
          function: {
            name: 'write_file',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'edit_file',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                target: { type: 'string' },
              },
            },
          },
        },
      ];

      let capturedRequestBody: any = null;
      const streamedTokens: string[] = [];
      const executedTools: Array<{ name: string; args: Record<string, any> }> = [];

      // First test: !strataMode allows > maxThinkingTokens (fast cap is 120) and omits response_prefix;
      // chunk-split <tool_call> never leaks to onTokenDelta; write_file JSON string stays string; edit_file preserves leading spaces; role:'tool' preserved
      globalThis.fetch = (async (_url: any, init?: RequestInit) => {
        if (init?.body) capturedRequestBody = JSON.parse(String(init.body));
        const longThought = Array.from(
          { length: 25 },
          (_, i) => `Reasoning step ${i + 1}: checking component ${i * 3 + 7}. `
        ).join(''); // > 120 estimated tokens, non-repetitive
        return sseResponse([
          `data: {"choices":[{"delta":{"reasoning_content":"${longThought}"}}]}\n\n`,
          'data: {"choices":[{"delta":{"content":"Working on it. <to"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"ol_call><function=write_file><parameter=path>package.json</parameter><parameter=content>{\\"a\\":1}</parameter></function></tool_call>"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"<tool_call><function=edit_file><parameter=path>a.ts</parameter><parameter=target>\\n  if (x) {\\n    return 1;\\n  }\\n</parameter></function></tool_call>"}}]}\n\n',
          'data: [DONE]\n\n',
        ]);
      }) as typeof fetch;

      const toolMsgContent = '  line 1\n  line 2\n  line 2\n  line 2\n  </div>\n  </div>';
      const res = await tabby.streamChatCompletion({
        tier: 'high',
        thinkingBudget: 'fast',
        skipGpuLock: true,
        tools: toolsSchema,
        messages: [
          { role: 'user', content: 'Edit files' },
          { role: 'tool', content: toolMsgContent },
        ],
        onThoughtDelta: () => {},
        onTokenDelta: (d) => streamedTokens.push(d),
        onToolCallRequest: async (name, args) => {
          executedTools.push({ name, args });
        },
      });

      assert.equal(capturedRequestBody.response_prefix, undefined, 'strataMode must omit response_prefix');
      const sentToolMsg = capturedRequestBody.messages.find((m: any) => m.role === 'tool');
      assert.equal(sentToolMsg.content, toolMsgContent, 'role: tool content must never be altered by deduplicateRepeatedSequences');
      assert.ok(res.thinkingTokens > 120, 'Strata tier must not cap thinkingTokens at fast budget limit');
      assert.equal(streamedTokens.join(''), 'Working on it. ');
      assert.equal(streamedTokens.join('').includes('<tool_call>'), false);
      assert.equal(executedTools.length, 2);
      assert.equal(typeof executedTools[0].args.content, 'string');
      assert.equal(executedTools[0].args.content, '{"a":1}');
      assert.equal(executedTools[1].args.target, '  if (x) {\n    return 1;\n  }');

      // Repetition stop test during streaming
      let cancelledByRepetition = false;
      globalThis.fetch = (async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const phrase = 'Looping forever without progress now. ';
            controller.enqueue(
              encoder.encode(`data: {"choices":[{"delta":{"content":"${phrase.repeat(4)}"}}]}\n\n`)
            );
            controller.enqueue(
              encoder.encode(`data: {"choices":[{"delta":{"content":"Should never emit this"}}]}\n\n`)
            );
            controller.close();
          },
          cancel() {
            cancelledByRepetition = true;
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }) as typeof fetch;

      const repRes = await tabby.streamChatCompletion({
        tier: 'high',
        thinkingBudget: 'off',
        skipGpuLock: true,
        messages: [{ role: 'user', content: 'go' }],
        onThoughtDelta: () => {},
        onTokenDelta: () => {},
      });
      assert.equal(repRes.finishReason, 'repetition_stop');
      assert.equal(cancelledByRepetition, true);
      assert.equal(repRes.content.includes('Should never emit this'), false);
    }

    // T18: LlamaMoESidecar wake vs offloadFromGpu / stop race
    {
      let spawnCount = 0;
      let fakeProc: FakeChildProcess | null = null;
      const taskkillCmds: string[] = [];

      const sidecar = new LlamaMoESidecar({
        port: 8080,
        startupTimeoutMs: 500,
        pollIntervalMs: 15,
        offloadPollIntervalMs: 10,
        deps: {
          existsSync: () => true,
          getPathsConfig: () => ({ strataDir: tmpDir, strataInstallDir: tmpDir, comfyUrl: 'http://127.0.0.1:8188' }) as any,
          unloadAllOllamaModels: async () => ({ unloaded: [], durationMs: 0 }),
          execSync: ((cmd: string) => {
            taskkillCmds.push(cmd);
            if (cmd.startsWith('netstat')) return '';
            if (fakeProc && cmd.includes(String(fakeProc.pid))) {
              fakeProc.kill('SIGKILL');
            }
            return '';
          }) as any,
          spawn: (() => {
            spawnCount += 1;
            fakeProc = new FakeChildProcess(50100 + spawnCount);
            return fakeProc as unknown as ChildProcess;
          }) as any,
        },
      });

      globalThis.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch;

      const wakePromise = sidecar.ensureRunning('swift-1.5-iq2_xs');
      // Let spawn occur
      await new Promise((r) => setTimeout(r, 25));
      assert.equal(spawnCount, 1);

      // Call offloadFromGpu mid-wake
      await sidecar.offloadFromGpu('test_race');
      const wakeResult = await wakePromise;
      assert.equal(wakeResult, false);
      assert.equal(sidecar.getCachedState(), 'standby');
      assert.equal(sidecar.isOffloaded(), true);
      assert.equal(sidecar.isProcessAlive(), false);
      assert.equal(spawnCount, 1, 'Offload mid-wake must not allow re-spawn afterwards');
    }

    // T19: LlamaMoESidecar re-entrant profile swap (swift-1.5-iq2_xs -> qwen36-ud-q4_k_xl) does not deadlock
    {
      let activeHealthy = true;
      let spawnCalls = 0;
      const procs: FakeChildProcess[] = [];

      const sidecar = new LlamaMoESidecar({
        port: 8080,
        startupTimeoutMs: 250,
        pollIntervalMs: 10,
        offloadPollIntervalMs: 5,
        deps: {
          existsSync: () => true,
          getPathsConfig: () => ({ strataDir: tmpDir, strataInstallDir: tmpDir, comfyUrl: 'http://127.0.0.1:8188' }) as any,
          unloadAllOllamaModels: async () => ({ unloaded: [], durationMs: 0 }),
          execSync: ((cmd: string) => {
            if (cmd.startsWith('netstat')) return '';
            if (cmd.startsWith('taskkill')) {
              activeHealthy = false;
              for (const p of procs) {
                if (cmd.includes(String(p.pid))) p.kill('SIGKILL');
              }
            }
            return '';
          }) as any,
          spawn: (() => {
            spawnCalls += 1;
            const p = new FakeChildProcess(60100 + spawnCalls);
            procs.push(p);
            setTimeout(() => {
              activeHealthy = true;
            }, 15);
            return p as unknown as ChildProcess;
          }) as any,
        },
      });

      globalThis.fetch = (async (url: any) => {
        if (String(url).endsWith('/health')) {
          return new Response(activeHealthy ? 'ok' : 'down', { status: activeHealthy ? 200 : 503 });
        }
        return new Response('ok', { status: 200 });
      }) as typeof fetch;

      const ok = await sidecar.ensureRunning('qwen36-ud-q4_k_xl');
      assert.equal(ok, true);
      assert.equal(sidecar.getActiveProfile(), 'qwen36-ud-q4_k_xl');
      assert.equal(spawnCalls, 1);
    }

    // T20: LlamaMoESidecar spawn 'error' event (ENOENT) handled gracefully
    {
      const sidecar = new LlamaMoESidecar({
        port: 8080,
        startupTimeoutMs: 120,
        pollIntervalMs: 10,
        deps: {
          existsSync: () => true,
          getPathsConfig: () => ({ strataDir: tmpDir, strataInstallDir: tmpDir, comfyUrl: 'http://127.0.0.1:8188' }) as any,
          unloadAllOllamaModels: async () => ({ unloaded: [], durationMs: 0 }),
          execSync: (() => '') as any,
          spawn: (() => {
            const p = new FakeChildProcess(70001);
            setTimeout(() => p.emit('error', new Error('spawn ENOENT')), 5);
            return p as unknown as ChildProcess;
          }) as any,
        },
      });
      globalThis.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch;

      const ok = await sidecar.ensureRunning('swift-1.5-iq2_xs');
      assert.equal(ok, false);
      assert.equal(sidecar.isProcessAlive(), false);
      assert.equal(sidecar.getCachedState(), 'standby');
    }

    // T20b (P4c): LlamaMoESidecar synchronous deps.spawn throw must reset state to 'standby' and isWaking() === false
    {
      const sidecar = new LlamaMoESidecar({
        port: 8080,
        startupTimeoutMs: 120,
        pollIntervalMs: 10,
        deps: {
          existsSync: () => true,
          getPathsConfig: () => ({ strataDir: tmpDir, strataInstallDir: tmpDir, comfyUrl: 'http://127.0.0.1:8188' }) as any,
          unloadAllOllamaModels: async () => ({ unloaded: [], durationMs: 0 }),
          execSync: (() => '') as any,
          spawn: (() => {
            throw new Error('sync spawn failure');
          }) as any,
        },
      });
      globalThis.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch;

      const ok = await sidecar.ensureRunning('swift-1.5-iq2_xs');
      assert.equal(ok, false);
      assert.equal(sidecar.isProcessAlive(), false);
      assert.equal(sidecar.getCachedState(), 'standby');
      assert.equal(sidecar.isWaking(), false);
    }

    // T21: LlamaMoESidecar startup timeout kills orphan child process
    {
      let orphanProc: FakeChildProcess | null = null;
      let killedPid = false;
      const sidecar = new LlamaMoESidecar({
        port: 8080,
        startupTimeoutMs: 50,
        pollIntervalMs: 10,
        deps: {
          existsSync: () => true,
          getPathsConfig: () => ({ strataDir: tmpDir, strataInstallDir: tmpDir, comfyUrl: 'http://127.0.0.1:8188' }) as any,
          unloadAllOllamaModels: async () => ({ unloaded: [], durationMs: 0 }),
          execSync: ((cmd: string) => {
            if (cmd.startsWith('taskkill') && orphanProc && cmd.includes(String(orphanProc.pid))) {
              killedPid = true;
              orphanProc.kill('SIGKILL');
            }
            return '';
          }) as any,
          spawn: (() => {
            orphanProc = new FakeChildProcess(80001);
            return orphanProc as unknown as ChildProcess;
          }) as any,
        },
      });
      globalThis.fetch = (async () => new Response('loading', { status: 503 })) as typeof fetch;

      const ok = await sidecar.ensureRunning('swift-1.5-iq2_xs');
      assert.equal(ok, false);
      assert.equal(killedPid || Boolean(orphanProc && (orphanProc as FakeChildProcess).killed), true);
      assert.equal(sidecar.isProcessAlive(), false);
      assert.equal(sidecar.getCachedState(), 'standby');
    }

    // T22: extractListeningPidsForPort exact Windows netstat parsing
    {
      const sampleNetstat = [
        '  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       4321',
        '  TCP    [::]:8080              [::]:0                 LISTENING       4322',
        '  TCP    127.0.0.1:80801        0.0.0.0:0              LISTENING       9001',
        '  TCP    127.0.0.1:51234        127.0.0.1:8080         ESTABLISHED     9002',
        '  TCP    127.0.0.1:51235        127.0.0.1:8080         LISTENING       9003',
        '  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       0',
        '  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       55555',
      ].join('\n');

      const pids = extractListeningPidsForPort(sampleNetstat, 8080, 55555);
      assert.deepEqual(pids, ['4321', '4322']);
      assert.deepEqual(extractListeningPidsForPort(sampleNetstat, 5000, 55555), []);
      assert.deepEqual(extractListeningPidsForPort(sampleNetstat, 5001, 55555), []);
    }

    // T23: ProviderRegistry defaults, legacy :5000 migration, upsert/probe guards
    {
      const regDir = path.join(tmpDir, 'reg-fresh');
      const reg = new ProviderRegistry(regDir);
      const profiles = reg.listProfiles();
      const tabbyProfile = profiles.find((p) => p.id === 'tabbyapi');
      assert.ok(tabbyProfile);
      assert.equal(tabbyProfile.baseUrl, 'http://127.0.0.1:5050/v1');
      for (const p of profiles) {
        assert.equal(isForbiddenProviderUrl(p.baseUrl), false);
      }

      // Legacy persisted :5000 migration on load()
      const legacyDir = path.join(tmpDir, 'reg-legacy');
      fs.mkdirSync(path.join(legacyDir, '.runtime'), { recursive: true });
      fs.writeFileSync(
        path.join(legacyDir, '.runtime', 'providers.json'),
        JSON.stringify({
          activeProviderId: 'strata',
          profiles: [
            {
              id: 'tabbyapi',
              name: 'TabbyAPI',
              kind: 'tabbyapi',
              baseUrl: 'http://127.0.0.1:5000/v1',
              defaultModel: 'local-exl2',
              models: ['local-exl2'],
              isLocal: true,
              enabled: false,
            },
          ],
        }),
        'utf-8'
      );
      const legacyReg = new ProviderRegistry(legacyDir);
      const migratedTabby = legacyReg.listProfiles().find((p) => p.id === 'tabbyapi');
      assert.equal(migratedTabby?.baseUrl, 'http://127.0.0.1:5050/v1');

      // upsertProfile rejects :5000 and :5001
      assert.throws(() =>
        reg.upsertProfile({
          id: 'bad-5000',
          name: 'Bad',
          kind: 'openai_compatible',
          baseUrl: 'http://127.0.0.1:5000/v1',
          defaultModel: 'm',
          models: ['m'],
          isLocal: true,
          enabled: false,
        })
      );
      assert.throws(() =>
        reg.upsertProfile({
          id: 'bad-5001',
          name: 'Bad',
          kind: 'openai_compatible',
          baseUrl: 'http://127.0.0.1:5001/v1',
          defaultModel: 'm',
          models: ['m'],
          isLocal: true,
          enabled: false,
        })
      );

      // probeProfileHealth blocks :5000 without calling fetch
      let fetchCalled = false;
      globalThis.fetch = (async () => {
        fetchCalled = true;
        return new Response('ok', { status: 200 });
      }) as typeof fetch;
      (reg as any).state.profiles.push({
        id: 'injected-5000',
        name: 'Injected',
        kind: 'openai_compatible',
        baseUrl: 'http://127.0.0.1:5000/v1',
        defaultModel: 'm',
        models: ['m'],
        isLocal: true,
        enabled: false,
      });
      const probeRes = await reg.probeProfileHealth('injected-5000');
      assert.equal(probeRes.ok, false);
      assert.equal(fetchCalled, false);
    }

    // T24: Static R5 guard checks on M1 source files
    {
      const __filename = fileURLToPath(import.meta.url);
      const serverSrcDir = path.resolve(path.dirname(__filename), '..', '..', 'src');
      const m1Files = [
        path.join(serverSrcDir, 'core', 'inferenceBackend.ts'),
        path.join(serverSrcDir, 'google', 'googleAiEngine.ts'),
        path.join(serverSrcDir, 'tabby', 'tabbyEngine.ts'),
        path.join(serverSrcDir, 'tabby', 'llamaSidecar.ts'),
        path.join(serverSrcDir, 'tabby', 'textNormalizers.ts'),
        path.join(serverSrcDir, 'providers', 'providerRegistry.ts'),
      ];
      const forbiddenImport = 'shared/' + 'protocol';
      for (const f of m1Files) {
        const src = fs.readFileSync(f, 'utf-8');
        assert.equal(src.includes(forbiddenImport), false, `${f} must not import shared protocol`);
      }
      const regSrc = fs.readFileSync(path.join(serverSrcDir, 'providers', 'providerRegistry.ts'), 'utf-8');
      assert.equal(regSrc.includes('http://127.0.0.1:5000'), false);
      assert.equal(regSrc.includes('http://127.0.0.1:5001'), false);
    }

    console.log('✅ Strata, LlamaSidecar & ProviderRegistry Unit Tests PASSED (T15-T24)');
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runStrataSidecarRegistryTests().catch((err) => {
  console.error('❌ Strata, LlamaSidecar & ProviderRegistry Unit Tests FAILED:', err);
  process.exit(1);
});
