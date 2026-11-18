import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import type { RouteContext } from './types.js';

function getGitHubAuthToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const res = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
    });
    if (res.stdout) {
      for (const line of res.stdout.split('\n')) {
        if (line.startsWith('password=')) return line.slice('password='.length).trim();
      }
    }
  } catch {}
  return '';
}

export function registerUpdaterRoutes(ctx: RouteContext): void {
  const { app, ports } = ctx;
  const repo = 'williamcboehmjr/LocalGravity';

  app.get('/api/updater/latest.json', async (req, reply) => {
    try {
      const token = getGitHubAuthToken();
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'LocalGravity-Brain-Updater/2.3',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const relRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
      if (!relRes.ok) {
        return reply.code(relRes.status).send({ error: `GitHub release fetch failed: ${relRes.status} ${relRes.statusText}` });
      }
      const release = (await relRes.json()) as any;
      const latestAsset = (release.assets || []).find((a: any) => a.name === 'latest.json');
      if (!latestAsset) {
        return reply.code(404).send({ error: 'latest.json asset not found in latest release' });
      }

      const manifestRes = await fetch(latestAsset.url, {
        headers: { ...headers, Accept: 'application/octet-stream' },
      });
      if (!manifestRes.ok) {
        return reply.code(manifestRes.status).send({
          error: `Failed to download latest.json asset: ${manifestRes.status} ${manifestRes.statusText}`,
        });
      }

      const manifest = (await manifestRes.json()) as any;
      const host = req.headers.host || `localhost:${ports.daemonPort}`;
      const proto = (req.headers['x-forwarded-proto'] as string) || 'http';

      if (manifest.platforms && typeof manifest.platforms === 'object') {
        for (const [, platData] of Object.entries(manifest.platforms as Record<string, any>)) {
          if (platData && platData.url) {
            const fileName = platData.url.split('/').pop();
            platData.url = `${proto}://${host}/api/updater/download/${fileName}`;
          }
        }
      }

      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
      return reply.send(manifest);
    } catch (err: any) {
      console.error('[Updater] Failed to serve latest.json proxy:', err);
      return reply.code(500).send({ error: err.message || 'Internal updater error' });
    }
  });

  app.get('/api/updater/download/:fileName', async (req, reply) => {
    const { fileName } = req.params as { fileName: string };
    try {
      const token = getGitHubAuthToken();
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'LocalGravity-Brain-Updater/2.3',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const relRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
      if (!relRes.ok) {
        return reply.code(relRes.status).send({ error: `GitHub release fetch failed: ${relRes.status} ${relRes.statusText}` });
      }
      const release = (await relRes.json()) as any;
      const targetAsset = (release.assets || []).find((a: any) => a.name === fileName);
      if (!targetAsset) {
        return reply.code(404).send({ error: `Asset ${fileName} not found in release` });
      }

      const dlRes = await fetch(targetAsset.url, {
        headers: { ...headers, Accept: 'application/octet-stream' },
        redirect: 'follow',
      });
      if (!dlRes.ok) {
        return reply.code(dlRes.status).send({ error: `Asset download failed: ${dlRes.status} ${dlRes.statusText}` });
      }

      reply.header('Content-Type', 'application/octet-stream');
      if (targetAsset.size) reply.header('Content-Length', String(targetAsset.size));
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`);

      if (dlRes.body) {
        // @ts-ignore - Node.js Readable from web ReadableStream
        return reply.send(Readable.fromWeb(dlRes.body as any));
      }
      return reply.send(Buffer.from(await dlRes.arrayBuffer()));
    } catch (err: any) {
      console.error(`[Updater] Download proxy failed for ${fileName}:`, err);
      return reply.code(500).send({ error: err.message || 'Updater download proxy failed' });
    }
  });
}
