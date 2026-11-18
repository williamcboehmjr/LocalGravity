import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { BuiltinToolHandler } from './types.js';

const handleSearchWeb: BuiltinToolHandler = async (args) => {
  const startMs = performance.now();
  const query = String(args.query || '').trim();
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 15);
  if (!query) {
    return {
      stdout: 'Please provide a search query.',
      stderr: '',
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(8000),
    });
    const html = await resp.text();
    const linkRegex = /<a\s+[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex = /<a\s+[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(html)) !== null && results.length < limit) {
      const rawUrl = m[1];
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      let directUrl = rawUrl;
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          directUrl = decodeURIComponent(uddgMatch[1]);
        } catch {}
      }
      results.push({ title, url: directUrl, snippet: '' });
    }
    let sIdx = 0;
    while ((m = snippetRegex.exec(html)) !== null && sIdx < results.length) {
      results[sIdx].snippet = m[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .trim();
      sIdx++;
    }
    return {
      stdout: JSON.stringify({ query, count: results.length, results }, null, 2),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  } catch (err: any) {
    return {
      stdout: '',
      stderr: `Web search failed: ${err?.message || String(err)}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
};

const handleDownloadFile: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const downloadUrl = String(args.url || '').trim();
  if (!downloadUrl) {
    return {
      stdout: '',
      stderr: 'Please provide a valid download URL.',
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  let destDir = exec.resolveSafePath(ctx.workspaceRoot, args.destination || 'downloads');
  let fname = args.filename ? String(args.filename).trim() : '';

  if (!fname) {
    try {
      const u = new URL(downloadUrl);
      fname = path.basename(u.pathname) || `download_${Date.now()}`;
    } catch {
      fname = `download_${Date.now()}`;
    }
  }

  let targetFile: string;
  if (fs.existsSync(destDir) && fs.statSync(destDir).isDirectory()) {
    targetFile = path.join(destDir, fname);
  } else if (path.extname(destDir)) {
    targetFile = destDir;
    destDir = path.dirname(destDir);
  } else {
    targetFile = path.join(destDir, fname);
  }

  fs.mkdirSync(destDir, { recursive: true });

  const resp = await fetch(downloadUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });

  if (!resp.ok || !resp.body) {
    return {
      stdout: '',
      stderr: `Download failed: ${resp.status} ${resp.statusText}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  const fileStream = fs.createWriteStream(targetFile);
  await pipeline(resp.body, fileStream);
  const stat = fs.statSync(targetFile);

  return {
    stdout: JSON.stringify(
      {
        downloaded: true,
        path: targetFile.replace(/\\/g, '/'),
        bytes: stat.size,
        mb: (stat.size / (1024 * 1024)).toFixed(2),
        url: downloadUrl,
      },
      null,
      2
    ),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};

const handleHttpRequest: BuiltinToolHandler = async (args) => {
  const startMs = performance.now();
  const reqUrl = String(args.url || '').trim();
  if (!reqUrl) {
    return {
      stdout: '',
      stderr: 'URL is required for http_request.',
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  if (reqUrl.includes(':5000') || reqUrl.includes(':5001')) {
    return {
      stdout: '',
      stderr: 'Forbidden port 5000/5001 rejected by security policy.',
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  const method = String(args.method || 'GET').toUpperCase();
  const headers = (args.headers || {}) as Record<string, string>;
  const timeout = Number(args.timeout_ms) || 10000;

  let bodyData: any = undefined;
  if (args.body !== undefined && method !== 'GET') {
    if (typeof args.body === 'object') {
      bodyData = JSON.stringify(args.body);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    } else {
      bodyData = String(args.body);
    }
  }

  const resp = await fetch(reqUrl, {
    method,
    headers,
    body: bodyData,
    signal: AbortSignal.timeout(timeout),
  });

  const contentType = resp.headers.get('content-type') || '';
  let responsePayload: any;
  if (contentType.includes('application/json')) {
    try {
      responsePayload = await resp.json();
    } catch {
      responsePayload = await resp.text();
    }
  } else {
    responsePayload = await resp.text();
  }

  return {
    stdout: JSON.stringify(
      {
        url: reqUrl,
        status: resp.status,
        statusText: resp.statusText,
        ok: resp.ok,
        headers: Object.fromEntries(resp.headers.entries()),
        data: responsePayload,
      },
      null,
      2
    ),
    stderr: '',
    exitCode: resp.ok ? 0 : 1,
    durationMs: Math.round(performance.now() - startMs),
  };
};

const handleBrowserInspect: BuiltinToolHandler = async (args) => {
  const startMs = performance.now();
  const url = String(args.url || 'http://localhost:3390');
  if (url.includes(':5000') || url.includes(':5001')) {
    return {
      stdout: '',
      stderr: 'Forbidden port 5000/5001 rejected by security policy.',
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  const resp = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(10000),
  });
  const html = await resp.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    stdout: JSON.stringify(
      {
        url,
        status: resp.status,
        title: titleMatch ? titleMatch[1].trim() : 'Untitled',
        contentLength: html.length,
        content: cleaned.slice(0, 4000),
      },
      null,
      2
    ),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};

export const WEB_TOOL_HANDLERS: Record<string, BuiltinToolHandler> = {
  search_web: handleSearchWeb,
  download_file: handleDownloadFile,
  http_request: handleHttpRequest,
  browser_inspect: handleBrowserInspect,
};
