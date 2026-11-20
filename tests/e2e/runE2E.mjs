import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createTestContext,
  delay,
  FORBIDDEN_PORTS,
  getFreePort,
  REPO_ROOT,
  requireFromClient,
  requireFromServer,
  TESTS_E2E_DIR,
  withTimeout,
} from './lib/harness.mjs';
import { createMockLlmServer } from './lib/mockLlmServer.mjs';
import { createMockMcpServerFixture } from './lib/mockMcpServer.mjs';
import {
  findChromiumExecutable,
  scanRepoConstraints,
  withBrowserPage,
} from './lib/clientHarness.mjs';

const VALID_TIERS = [1, 2, 3, 4];

function parseCliArgs(argv) {
  const opts = {
    tiers: null,
    filter: '',
    json: false,
    list: false,
    selfCheck: false,
    timeoutMs: 30000,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--self-check') {
      opts.selfCheck = true;
    } else if (arg === '--tier' || arg.startsWith('--tier=')) {
      const rawVal = arg.startsWith('--tier=') ? arg.slice('--tier='.length) : argv[++i];
      if (!rawVal) {
        throw new Error('Missing value for --tier');
      }
      const parsed = rawVal
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s));
      for (const t of parsed) {
        if (!Number.isInteger(t) || !VALID_TIERS.includes(t)) {
          throw new Error(`Invalid tier "${t}". Expected 1, 2, 3, or 4.`);
        }
      }
      opts.tiers = Array.from(new Set([...(opts.tiers || []), ...parsed])).sort((a, b) => a - b);
    } else if (arg === '--filter' || arg.startsWith('--filter=')) {
      const rawVal = arg.startsWith('--filter=') ? arg.slice('--filter='.length) : argv[++i];
      if (rawVal === undefined) {
        throw new Error('Missing value for --filter');
      }
      opts.filter = String(rawVal);
    } else if (arg === '--timeout' || arg.startsWith('--timeout=')) {
      const rawVal = arg.startsWith('--timeout=') ? arg.slice('--timeout='.length) : argv[++i];
      const n = Number(rawVal);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --timeout value: ${rawVal}`);
      }
      opts.timeoutMs = Math.floor(n);
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  if (!opts.tiers || opts.tiers.length === 0) {
    opts.tiers = [...VALID_TIERS];
  }
  return opts;
}

function printHelp(logFn) {
  logFn(`LocalGravity E2E Test Runner

Usage:
  node tests/e2e/runE2E.mjs [options]

Options:
  --tier=1|2|3|4     Run specific tier(s), comma-separated or repeated (default: 1,2,3,4)
  --filter=<substr>  Case-insensitive filter on suite/test id, name, or feature
  --list             List discovered suites and tests without executing
  --json             Emit machine-readable JSON summary to stdout (human logs to stderr)
  --timeout=<ms>     Default per-test timeout in ms (default: 30000)
  --self-check       Verify runner & harness infrastructure (ports, temp dirs, deps, CDP)
  --help, -h         Show this help message`);
}

function discoverTierFiles(tiers) {
  const discovered = [];
  for (const tier of tiers) {
    const tierDir = path.join(TESTS_E2E_DIR, `tier${tier}`);
    if (!fs.existsSync(tierDir)) continue;
    const entries = fs
      .readdirSync(tierDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.test.mjs'))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      discovered.push({
        tier,
        fileName: entry.name,
        filePath: path.join(tierDir, entry.name),
        relPath: path.relative(REPO_ROOT, path.join(tierDir, entry.name)).replace(/\\/g, '/'),
      });
    }
  }
  return discovered;
}

function validateSuite(rawSuite, meta) {
  if (!rawSuite || typeof rawSuite !== 'object') {
    throw new Error(`Suite ${meta.relPath} must export default (or named 'suite') object`);
  }
  if (typeof rawSuite.name !== 'string' || rawSuite.name.trim().length === 0) {
    throw new Error(`Suite ${meta.relPath} is missing a non-empty string 'name'`);
  }
  const suiteTier = rawSuite.tier ?? meta.tier;
  if (!VALID_TIERS.includes(Number(suiteTier))) {
    throw new Error(`Suite ${meta.relPath} has invalid tier: ${rawSuite.tier}`);
  }
  if (!Array.isArray(rawSuite.tests)) {
    throw new Error(`Suite ${meta.relPath} must export a 'tests' array`);
  }
  for (let i = 0; i < rawSuite.tests.length; i++) {
    const t = rawSuite.tests[i];
    if (!t || typeof t !== 'object') {
      throw new Error(`Suite ${meta.relPath} test[${i}] is not an object`);
    }
    if (typeof t.id !== 'string' || !t.id.trim()) {
      throw new Error(`Suite ${meta.relPath} test[${i}] is missing string 'id'`);
    }
    if (typeof t.name !== 'string' || !t.name.trim()) {
      throw new Error(`Suite ${meta.relPath} test[${i}] (${t.id}) is missing string 'name'`);
    }
    if (typeof t.run !== 'function') {
      throw new Error(`Suite ${meta.relPath} test[${i}] (${t.id}) is missing 'run' function`);
    }
  }
  return {
    name: rawSuite.name,
    tier: Number(suiteTier),
    features: Array.isArray(rawSuite.features) ? rawSuite.features : [],
    relPath: meta.relPath,
    tests: rawSuite.tests,
  };
}

function matchesFilter(suite, test, filterLower) {
  if (!filterLower) return true;
  const haystacks = [
    suite.name,
    suite.relPath,
    ...(suite.features || []),
    test.id,
    test.name,
    test.feature || '',
  ];
  return haystacks.some((h) => String(h).toLowerCase().includes(filterLower));
}

async function runSelfCheck(log) {
  const checks = [];
  const startedAll = Date.now();

  const recordCheck = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      const durationMs = Date.now() - t0;
      checks.push({ name, status: 'passed', durationMs, detail: detail || 'ok' });
      log(`  [PASS] ${name} (${durationMs}ms)${detail ? ` — ${detail}` : ''}`);
    } catch (err) {
      const durationMs = Date.now() - t0;
      const message = err?.message || String(err);
      checks.push({ name, status: 'failed', durationMs, error: message });
      log(`  [FAIL] ${name} (${durationMs}ms) — ${message}`);
    }
  };

  log('Running LocalGravity E2E harness self-checks...');

  await recordCheck('getFreePort() avoids forbidden ports 5000/5001', async () => {
    const port = await getFreePort();
    assert.ok(Number.isInteger(port) && port > 0, `Expected positive port, got ${port}`);
    assert.ok(!FORBIDDEN_PORTS.has(port), `Allocated forbidden port ${port}`);
    return `port=${port}`;
  });

  await recordCheck('createTestContext() temp dir & LIFO cleanup', async () => {
    const order = [];
    const ctx = createTestContext({ testId: 'self-check' });
    const dir = ctx.createTempDir('lg-selfcheck-');
    assert.ok(fs.existsSync(dir), 'Temp dir should exist before cleanup');
    fs.writeFileSync(path.join(dir, 'probe.txt'), 'ok', 'utf-8');
    ctx.onCleanup(() => order.push('first'));
    ctx.onCleanup(() => order.push('second'));
    await ctx.cleanup();
    assert.ok(!fs.existsSync(dir), `Temp dir was not removed: ${dir}`);
    assert.deepEqual(order, ['second', 'first']);
    return 'cleaned tempDir + LIFO hooks';
  });

  await recordCheck('withTimeout() resolves fast ops & aborts expired ops', async () => {
    const fast = await withTimeout(async () => {
      await delay(10);
      return 'done';
    }, 1000, 'fast-op');
    assert.equal(fast, 'done');

    let signalAborted = false;
    await assert.rejects(
      () =>
        withTimeout(
          (signal) =>
            new Promise((_, reject) => {
              signal.addEventListener('abort', () => {
                signalAborted = true;
              });
              // Intentionally hang until aborted
              setTimeout(() => reject(new Error('should not reach')), 5000).unref();
            }),
          50,
          'expired-op'
        ),
      /Timeout after 50ms: expired-op/
    );
    assert.equal(signalAborted, true, 'AbortSignal should be triggered on timeout');
    return 'timeout + AbortSignal verified';
  });

  await recordCheck('Cross-workspace module resolution (ws, better-sqlite3, esbuild, react, zustand)', async () => {
    const WebSocket = requireFromServer('ws');
    const Database = requireFromServer('better-sqlite3');
    const esbuild = requireFromServer('esbuild');
    const React = requireFromClient('react');
    const ReactDOMServer = requireFromClient('react-dom/server');
    const zustand = requireFromClient('zustand');

    assert.equal(typeof WebSocket, 'function');
    assert.equal(typeof Database, 'function');
    assert.equal(typeof esbuild.build, 'function');
    assert.equal(typeof React.createElement, 'function');
    assert.equal(typeof ReactDOMServer.renderToStaticMarkup, 'function');
    assert.equal(typeof zustand.create, 'function');
    return `esbuild=${esbuild.version}, react=${React.version}`;
  });

  await recordCheck('mockLlmServer + mockMcpServer lifecycle', async () => {
    const ctx = createTestContext({ testId: 'self-check-mocks' });
    try {
      const llm = await createMockLlmServer();
      ctx.onCleanup(() => llm.close());
      assert.ok(llm.port > 0 && !FORBIDDEN_PORTS.has(llm.port));
      const healthRes = await fetch(`${llm.baseUrl}/health`);
      assert.equal(healthRes.status, 200);

      const mcpDir = ctx.createTempDir('lg-selfcheck-mcp-');
      const mcp = createMockMcpServerFixture(mcpDir, { serverName: 'selfcheck_mcp' });
      ctx.onCleanup(() => mcp.close());
      const cfgPath = mcp.writeMcpConfig(path.join(mcpDir, 'mcp_config.json'));
      assert.ok(fs.existsSync(cfgPath));
      assert.equal(mcp.mcpConfigEntry.command, process.execPath);
      return `mockLlm port=${llm.port}`;
    } finally {
      await ctx.cleanup();
    }
  });

  await recordCheck('scanRepoConstraints() static scanner', async () => {
    const report = scanRepoConstraints();
    assert.ok(Array.isArray(report.sharedProtocolViolations));
    assert.ok(Array.isArray(report.forbiddenPortViolations));
    assert.ok(Array.isArray(report.tsconfigIssues));
    return `sharedProtocol=${report.sharedProtocolViolations.length}, ports=${report.forbiddenPortViolations.length}, tsconfig=${report.tsconfigIssues.length}`;
  });

  await recordCheck('Headless Chromium CDP round-trip (findChromiumExecutable + withBrowserPage)', async () => {
    const exe = findChromiumExecutable();
    assert.ok(fs.existsSync(exe), `Chromium executable missing at ${exe}`);
    const ctx = createTestContext({ testId: 'self-check-cdp' });
    try {
      const val = await withBrowserPage(ctx, { html: '<div id="probe">ready</div>' }, async (page) => {
        const res = await page.evaluate(() => ({
          sum: 1 + 1,
          text: document.querySelector('#probe')?.textContent,
        }));
        assert.deepEqual(page.getErrors(), []);
        return res;
      });
      assert.deepEqual(val, { sum: 2, text: 'ready' });
      return path.basename(exe);
    } finally {
      await ctx.cleanup();
    }
  });

  const passed = checks.filter((c) => c.status === 'passed').length;
  const failed = checks.filter((c) => c.status === 'failed').length;
  const durationMs = Date.now() - startedAll;

  log(`Self-check summary: ${passed}/${checks.length} passed, ${failed} failed (${durationMs}ms).`);

  return {
    ok: failed === 0 && checks.length > 0,
    summary: { total: checks.length, passed, failed, durationMs },
    checks,
  };
}

async function main() {
  let opts;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const log = opts.json ? (...args) => console.error(...args) : (...args) => console.log(...args);

  if (opts.help) {
    printHelp(log);
    process.exit(0);
  }

  if (opts.selfCheck) {
    const report = await runSelfCheck(log);
    if (opts.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    }
    process.exit(report.ok ? 0 : 1);
  }

  const discoveredFiles = discoverTierFiles(opts.tiers);
  const filterLower = opts.filter.trim().toLowerCase();

  const loadedSuites = [];
  const loadErrors = [];

  for (const meta of discoveredFiles) {
    try {
      const mod = await import(pathToFileURL(meta.filePath).href);
      const suite = validateSuite(mod.default ?? mod.suite, meta);
      loadedSuites.push(suite);
    } catch (err) {
      loadErrors.push({
        tier: meta.tier,
        relPath: meta.relPath,
        error: err?.stack || err?.message || String(err),
      });
    }
  }

  const matchedPlan = [];
  for (const suite of loadedSuites) {
    const matchedTests = suite.tests.filter((t) => matchesFilter(suite, t, filterLower));
    if (matchedTests.length > 0) {
      matchedPlan.push({ suite, tests: matchedTests });
    }
  }

  const totalMatched = matchedPlan.reduce((sum, item) => sum + item.tests.length, 0);

  if (opts.list) {
    if (totalMatched === 0 && loadErrors.length === 0) {
      log(
        `No E2E tests matched (tiers=[${opts.tiers.join(',')}], filter=${JSON.stringify(opts.filter)}).`
      );
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({ ok: false, total: 0, tiers: opts.tiers, suites: [], loadErrors }, null, 2) + '\n'
        );
      }
      process.exit(1);
    }

    for (const errItem of loadErrors) {
      log(`[LOAD ERROR] Tier ${errItem.tier} (${errItem.relPath}): ${errItem.error}`);
    }

    for (const { suite, tests } of matchedPlan) {
      log(`Tier ${suite.tier} | ${suite.name} (${suite.relPath}) — ${tests.length} test(s)`);
      for (const t of tests) {
        log(`  - ${t.id} [${t.feature || '-'}] ${t.name}`);
      }
    }
    log(`Total matched: ${totalMatched} test(s) across ${matchedPlan.length} suite(s).`);

    if (opts.json) {
      process.stdout.write(
        JSON.stringify(
          {
            ok: loadErrors.length === 0 && totalMatched > 0,
            total: totalMatched,
            tiers: opts.tiers,
            suites: matchedPlan.map(({ suite, tests }) => ({
              name: suite.name,
              tier: suite.tier,
              relPath: suite.relPath,
              features: suite.features,
              tests: tests.map((t) => ({
                id: t.id,
                feature: t.feature || null,
                name: t.name,
              })),
            })),
            loadErrors,
          },
          null,
          2
        ) + '\n'
      );
    }
    process.exit(loadErrors.length === 0 && totalMatched > 0 ? 0 : 1);
  }

  const runStartedAt = Date.now();
  const results = [];
  const byTier = {};
  for (const t of opts.tiers) {
    byTier[t] = { total: 0, passed: 0, failed: 0, durationMs: 0 };
  }

  for (const errItem of loadErrors) {
    const tierStats = byTier[errItem.tier] || (byTier[errItem.tier] = { total: 0, passed: 0, failed: 0, durationMs: 0 });
    tierStats.total += 1;
    tierStats.failed += 1;
    log(`[FAIL] [Tier ${errItem.tier}] Suite load failed: ${errItem.relPath}\n${errItem.error}`);
    results.push({
      id: `LOAD:${errItem.relPath}`,
      name: `Load suite ${errItem.relPath}`,
      suite: errItem.relPath,
      tier: errItem.tier,
      feature: null,
      status: 'failed',
      durationMs: 0,
      error: errItem.error,
    });
  }

  for (const { suite, tests } of matchedPlan) {
    log(`\n=== Tier ${suite.tier}: ${suite.name} (${suite.relPath}) ===`);
    const tierStats = byTier[suite.tier] || (byTier[suite.tier] = { total: 0, passed: 0, failed: 0, durationMs: 0 });

    for (const test of tests) {
      const testTimeout = test.timeoutMs ?? opts.timeoutMs;
      const ctx = createTestContext({ repoRoot: REPO_ROOT, testId: test.id });
      const t0 = Date.now();
      let status = 'passed';
      let errorText = null;

      try {
        await withTimeout(
          (signal) => test.run({ ...ctx, signal }),
          testTimeout,
          `${test.id} (${test.name})`
        );
      } catch (err) {
        status = 'failed';
        errorText = err?.stack || err?.message || String(err);
      } finally {
        try {
          await ctx.cleanup();
        } catch (cleanupErr) {
          const cleanupMsg = cleanupErr?.stack || cleanupErr?.message || String(cleanupErr);
          if (status === 'passed') {
            status = 'failed';
            errorText = `Cleanup failed: ${cleanupMsg}`;
          } else {
            errorText += `\nCleanup also failed: ${cleanupMsg}`;
          }
        }
      }

      const durationMs = Date.now() - t0;
      tierStats.total += 1;
      tierStats.durationMs += durationMs;
      if (status === 'passed') {
        tierStats.passed += 1;
        log(`  [PASS] ${test.id} [${test.feature || '-'}] ${test.name} (${durationMs}ms)`);
      } else {
        tierStats.failed += 1;
        log(`  [FAIL] ${test.id} [${test.feature || '-'}] ${test.name} (${durationMs}ms)\n${errorText}`);
      }

      results.push({
        id: test.id,
        name: test.name,
        suite: suite.name,
        relPath: suite.relPath,
        tier: suite.tier,
        feature: test.feature || null,
        status,
        durationMs,
        ...(errorText ? { error: errorText } : {}),
      });
    }
  }

  const totalDurationMs = Date.now() - runStartedAt;
  const totalExecuted = results.length;
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const ok = totalExecuted > 0 && failed === 0;

  log('\n=== E2E Run Summary ===');
  for (const tier of Object.keys(byTier).sort((a, b) => Number(a) - Number(b))) {
    const s = byTier[tier];
    log(`  Tier ${tier}: ${s.passed}/${s.total} passed, ${s.failed} failed (${s.durationMs}ms)`);
  }
  log(`  Total:  ${passed}/${totalExecuted} passed, ${failed} failed (${totalDurationMs}ms)`);

  if (totalExecuted === 0) {
    log('  Result: FAIL (0 tests executed)');
  } else if (ok) {
    log('  Result: PASS');
  } else {
    log('  Result: FAIL');
  }

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok,
          summary: {
            total: totalExecuted,
            passed,
            failed,
            durationMs: totalDurationMs,
            byTier,
          },
          results,
        },
        null,
        2
      ) + '\n'
    );
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
