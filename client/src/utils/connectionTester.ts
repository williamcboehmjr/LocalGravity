export interface ConnectionTestResult {
  ok: boolean;
  latency?: number;
  httpStatus?: number;
  wsConnected: boolean;
  httpConnected: boolean;
  message: string;
}

export function cleanHostAndPort(rawHost: string, rawPort: string = '3390'): { host: string; port: string } {
  let host = (rawHost || '').trim().replace(/^(https?:\/\/|wss?:\/\/)/i, '').replace(/\/.*$/, '');
  let port = (rawPort || '').trim();

  if (host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    port = parts[1] || port;
  }

  // Normalize localhost to 127.0.0.1 to prevent Windows WebView2 IPv6 [::1] connection drops
  if (host.toLowerCase() === 'localhost' || !host) {
    host = '127.0.0.1';
  }

  return {
    host,
    port: port || '3390',
  };
}

export async function testBrainConnection(
  rawHost: string,
  rawPort: string = '3390',
  timeoutMs: number = 3500
): Promise<ConnectionTestResult> {
  const { host, port } = cleanHostAndPort(rawHost, rawPort);

  const wsUrl = `ws://${host}:${port}/ws/sync`;
  const httpUrl = `http://${host}:${port}/api/threads`;

  const startTime = performance.now();

  // Test 1: WebSocket probe
  const testWs = new Promise<{ ok: boolean; latency: number; error?: string }>((resolve) => {
    try {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        resolve({ ok: false, latency: 0, error: 'WebSocket connection timed out' });
      }, timeoutMs);

      ws.onopen = () => {
        clearTimeout(timer);
        const latency = Math.round(performance.now() - startTime);
        try {
          ws.close();
        } catch {}
        resolve({ ok: true, latency });
      };

      ws.onerror = () => {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        resolve({ ok: false, latency: 0, error: 'WebSocket connection refused' });
      };
    } catch (err: any) {
      resolve({ ok: false, latency: 0, error: err?.message || 'WebSocket creation error' });
    }
  });

  // Test 2: HTTP probe
  const testHttp = fetch(httpUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then((res) => ({ ok: true, status: res.status }))
    .catch((err) => ({ ok: false, error: err?.message || 'HTTP fetch failed' }));

  const [wsRes, httpRes] = await Promise.all([testWs, testHttp]);

  const anyOk = wsRes.ok || httpRes.ok;
  const latency = wsRes.ok ? wsRes.latency : Math.round(performance.now() - startTime);

  if (anyOk) {
    return {
      ok: true,
      latency,
      wsConnected: wsRes.ok,
      httpConnected: httpRes.ok,
      message: `Connected successfully! (Latency: ${latency}ms) • Brain responded on ${host}:${port}`,
    };
  }

  return {
    ok: false,
    wsConnected: false,
    httpConnected: false,
    message: `Unable to connect to PC Brain at ${host}:${port}. Verify LocalGravity is running on your PC and port ${port} is allowed in Windows Firewall.`,
  };
}
