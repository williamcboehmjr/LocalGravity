import fs from 'node:fs';
import path from 'node:path';
import type { RouteContext } from './types.js';

export function registerWorkspaceRoutes(ctx: RouteContext): void {
  const { app, repoRoot, db, tools, broadcastSync } = ctx;

  app.get('/api/workspace/files', async (req) => {
    const { root_path } = (req.query || {}) as { root_path?: string };
    const baseDir = root_path && root_path !== '.' ? root_path : repoRoot;
    const files: Array<{ path: string; name: string; type: 'file' | 'directory' }> = [];

    const walk = (dir: string, depth = 0) => {
      if (depth > 3 || files.length >= 250) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === '.venv' ||
          entry.name === 'dist' ||
          entry.name === 'target' ||
          entry.name === '.runtime'
        ) {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          files.push({ path: relPath, name: entry.name, type: 'directory' });
          walk(fullPath, depth + 1);
        } else {
          files.push({ path: relPath, name: entry.name, type: 'file' });
        }
      }
    };

    walk(baseDir);
    return { rootPath: baseDir.replace(/\\/g, '/'), files };
  });

  app.get('/api/workspace/file', async (req, reply) => {
    const { path: filePath, root_path } = (req.query || {}) as { path?: string; root_path?: string };
    if (!filePath) return reply.code(400).send({ error: 'Missing path parameter' });
    const baseDir = root_path && root_path !== '.' ? root_path : repoRoot;
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      return reply.code(404).send({ error: `File not found: ${resolved}` });
    }
    return { path: resolved.replace(/\\/g, '/'), content: fs.readFileSync(resolved, 'utf-8') };
  });

  app.post('/api/workspace/file', async (req) => {
    const body = (req.body || {}) as {
      path: string;
      content: string;
      root_path?: string;
      thread_id?: string;
      message_id?: string;
    };
    const baseDir = body.root_path && body.root_path !== '.' ? body.root_path : repoRoot;
    const resolved = path.isAbsolute(body.path) ? body.path : path.resolve(baseDir, body.path);
    const prev = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf-8') : null;
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, body.content, 'utf-8');

    let checkpoint = null;
    if (body.thread_id && body.message_id) {
      checkpoint = db.createFileCheckpoint({
        thread_id: body.thread_id,
        message_id: body.message_id,
        file_path: resolved,
        previous_content_blob: prev,
        new_content_blob: body.content,
      });
    }

    broadcastSync({ type: 'FILE_UPDATED', payload: { path: resolved.replace(/\\/g, '/'), checkpoint } });
    return { saved: true, path: resolved.replace(/\\/g, '/'), checkpoint };
  });

  app.post('/api/vision/capture', async () => {
    const snap = tools.captureWindowsScreen();
    broadcastSync({ type: 'VISION_CAPTURE', payload: snap });
    return snap;
  });
}
