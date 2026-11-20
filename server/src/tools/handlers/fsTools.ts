import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { extractJpegsFromPdf } from '../../files/attachmentManager.js';
import { applyFuzzyPatch } from '../../utils/patchDoctor.js';
import { LspDiagnosticsManager } from '../lspManager.js';
import { truncateSafeOutput, type BuiltinToolHandler } from './types.js';

const require = createRequire(import.meta.url);

const getLsp = (exec: { lsp?: LspDiagnosticsManager }) => exec.lsp || new LspDiagnosticsManager();

const handleReadFile: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const rawFilePath = args.path || args.Path;
  const targetPath = exec.resolveSafePath(ctx.workspaceRoot, rawFilePath);
  if (!fs.existsSync(targetPath)) {
    return {
      stdout: '',
      stderr: `File not found: ${targetPath}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  const raw = fs.readFileSync(targetPath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const sLine = (args.start_line ?? args.StartLine) ? Math.max(1, Number(args.start_line ?? args.StartLine)) : 1;
  const eLine = (args.end_line ?? args.EndLine) ? Math.min(lines.length, Number(args.end_line ?? args.EndLine)) : lines.length;
  const slice = lines.slice(sLine - 1, eLine).join('\n');
  return {
    stdout: truncateSafeOutput(slice, 24000),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};

const handleWriteFile: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const rawFilePath = args.path || args.Path;
  const targetPath = exec.resolveSafePath(ctx.workspaceRoot, rawFilePath);
  const previousContent = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
  const newContent = String(args.content ?? args.Content ?? '');

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, newContent, 'utf-8');

  const checkpoint = exec.db.createFileCheckpoint({
    thread_id: ctx.threadId,
    message_id: ctx.messageId,
    file_path: targetPath,
    previous_content_blob: previousContent,
    new_content_blob: newContent,
  });
  ctx.onFileCheckpointCreated?.(checkpoint);
  const diagNote = getLsp(exec).formatPostEditDiagnosticNote(targetPath);

  return {
    stdout: `Wrote ${newContent.length} bytes to ${targetPath} (checkpoint ${checkpoint.id} saved)${diagNote}`,
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
    checkpoint,
  };
};

const handleEditOrDiff: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const rawFilePath = args.path || args.Path;
  const targetPath = exec.resolveSafePath(ctx.workspaceRoot, rawFilePath);
  if (!fs.existsSync(targetPath)) {
    return {
      stdout: '',
      stderr: `Cannot apply diff/edit: file ${targetPath} does not exist`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  const previousContent = fs.readFileSync(targetPath, 'utf-8');
  const targetStr = String(args.target ?? args.Target ?? '');
  const replacementStr = String(args.replacement ?? args.Replacement ?? '');

  const patchResult = applyFuzzyPatch(previousContent, targetStr, replacementStr);
  if (!patchResult.ok) {
    return {
      stdout: '',
      stderr: `Target block not found in ${targetPath}. ${patchResult.diagnosticHint || ''}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  const newContent = patchResult.newContent;
  fs.writeFileSync(targetPath, newContent, 'utf-8');

  const checkpoint = exec.db.createFileCheckpoint({
    thread_id: ctx.threadId,
    message_id: ctx.messageId,
    file_path: targetPath,
    previous_content_blob: previousContent,
    new_content_blob: newContent,
  });
  ctx.onFileCheckpointCreated?.(checkpoint);
  const diagNote = getLsp(exec).formatPostEditDiagnosticNote(targetPath);

  return {
    stdout: `Applied edit/diff to ${targetPath} via ${patchResult.strategy} match (lines ${patchResult.matchedLineStart}-${patchResult.matchedLineEnd}, checkpoint ${checkpoint.id} saved)${diagNote}`,
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
    checkpoint,
  };
};

const handlePatchJson: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const targetPath = exec.resolveSafePath(ctx.workspaceRoot, args.path);
  if (!fs.existsSync(targetPath)) {
    return {
      stdout: '',
      stderr: `JSON file not found: ${targetPath}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  const raw = fs.readFileSync(targetPath, 'utf-8');
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch (e: any) {
    return {
      stdout: '',
      stderr: `Failed to parse JSON in ${targetPath}: ${e?.message}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  const action = String(args.action || 'read').toLowerCase();
  const keyPath = args.key_path ? String(args.key_path).trim() : '';

  const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const validateKeyPath = (kp: string): string[] | null => {
    const parts = kp.split('.');
    if (parts.some((p) => !p || FORBIDDEN_JSON_KEYS.has(p))) return null;
    return parts;
  };

  if (action === 'read') {
    if (!keyPath) {
      return {
        stdout: JSON.stringify(json, null, 2),
        stderr: '',
        exitCode: 0,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const parts = validateKeyPath(keyPath);
    if (!parts) {
      return {
        stdout: '',
        stderr: `Invalid or forbidden key_path: "${keyPath}"`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    let curr = json;
    for (const p of parts) {
      if (curr == null || typeof curr !== 'object') {
        curr = undefined;
        break;
      }
      curr = curr[p];
    }
    return {
      stdout: JSON.stringify({ key_path: keyPath, value: curr }, null, 2),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'set') {
    if (!keyPath) {
      return {
        stdout: '',
        stderr: 'key_path is required for action "set".',
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const parts = validateKeyPath(keyPath);
    if (!parts) {
      return {
        stdout: '',
        stderr: `Invalid or forbidden key_path: "${keyPath}"`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    let curr = json;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!curr[parts[i]] || typeof curr[parts[i]] !== 'object') {
        curr[parts[i]] = {};
      }
      curr = curr[parts[i]];
    }
    const priorContent = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
    curr[parts[parts.length - 1]] = args.value;
    const nextContent = JSON.stringify(json, null, 2) + '\n';
    if (ctx.threadId && priorContent !== null) {
      const cp = exec.db.createFileCheckpoint({
        thread_id: ctx.threadId,
        message_id: ctx.messageId || '',
        file_path: targetPath,
        previous_content_blob: priorContent,
        new_content_blob: nextContent,
      });
      ctx.onFileCheckpointCreated?.(cp);
    }
    fs.writeFileSync(targetPath, nextContent, 'utf-8');
    return {
      stdout: `Successfully updated "${keyPath}" in ${targetPath}`,
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'delete') {
    if (!keyPath) {
      return {
        stdout: '',
        stderr: 'key_path is required for action "delete".',
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const parts = validateKeyPath(keyPath);
    if (!parts) {
      return {
        stdout: '',
        stderr: `Invalid or forbidden key_path: "${keyPath}"`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    let curr = json;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!curr[parts[i]] || typeof curr[parts[i]] !== 'object') {
        return { stdout: 'Key path does not exist.', stderr: '', exitCode: 0, durationMs: 0 };
      }
      curr = curr[parts[i]];
    }
    const priorContent = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
    delete curr[parts[parts.length - 1]];
    const nextContent = JSON.stringify(json, null, 2) + '\n';
    if (ctx.threadId && priorContent !== null) {
      const cp = exec.db.createFileCheckpoint({
        thread_id: ctx.threadId,
        message_id: ctx.messageId || '',
        file_path: targetPath,
        previous_content_blob: priorContent,
        new_content_blob: nextContent,
      });
      ctx.onFileCheckpointCreated?.(cp);
    }
    fs.writeFileSync(targetPath, nextContent, 'utf-8');
    return {
      stdout: `Successfully deleted "${keyPath}" from ${targetPath}`,
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  return {
    stdout: '',
    stderr: `Unsupported patch_json action: ${action}`,
    exitCode: 1,
    durationMs: Math.round(performance.now() - startMs),
  };
};

const handleManageFiles: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const action = String(args.action || 'stat').toLowerCase();
  const srcPath = exec.resolveSafePath(ctx.workspaceRoot, args.source);

  if (action === 'stat') {
    if (!fs.existsSync(srcPath)) {
      return {
        stdout: JSON.stringify({ exists: false, path: srcPath }, null, 2),
        stderr: '',
        exitCode: 0,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const stat = fs.statSync(srcPath);
    return {
      stdout: JSON.stringify(
        {
          exists: true,
          path: srcPath.replace(/\\/g, '/'),
          size: stat.size,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          created: stat.birthtime,
          modified: stat.mtime,
        },
        null,
        2
      ),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'delete') {
    const rawSource = args.source !== undefined && args.source !== null ? String(args.source).trim() : '';
    if (!rawSource || rawSource === '.') {
      return {
        stdout: '',
        stderr: 'Refusing to delete: source path is required and cannot be empty or ".".',
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const resolvedSrc = path.resolve(srcPath).toLowerCase();
    const resolvedWs = path.resolve(ctx.workspaceRoot).toLowerCase();
    if (resolvedSrc === resolvedWs) {
      return {
        stdout: '',
        stderr: `Refusing to delete workspace root directory: ${srcPath}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    if (!fs.existsSync(srcPath)) {
      return {
        stdout: `File does not exist: ${srcPath}`,
        stderr: '',
        exitCode: 0,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const norm = path.normalize(srcPath).toLowerCase();
    if (norm === 'c:\\' || norm === 'c:/' || norm === 'e:\\' || norm === 'e:/' || norm === '/' || norm === os.homedir().toLowerCase()) {
      return {
        stdout: '',
        stderr: 'Refusing to delete critical root directory.',
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    fs.rmSync(srcPath, { recursive: true, force: true });
    return {
      stdout: `Deleted ${srcPath}`,
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  }

  if (action === 'copy' || action === 'move') {
    if (!fs.existsSync(srcPath)) {
      return {
        stdout: '',
        stderr: `Source does not exist: ${srcPath}`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    if (!args.destination) {
      return {
        stdout: '',
        stderr: `Destination is required for action "${action}".`,
        exitCode: 1,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
    const dstPath = exec.resolveSafePath(ctx.workspaceRoot, args.destination);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });

    if (action === 'copy') {
      fs.cpSync(srcPath, dstPath, { recursive: true });
      return {
        stdout: `Copied ${srcPath} -> ${dstPath}`,
        stderr: '',
        exitCode: 0,
        durationMs: Math.round(performance.now() - startMs),
      };
    } else {
      fs.renameSync(srcPath, dstPath);
      return {
        stdout: `Moved ${srcPath} -> ${dstPath}`,
        stderr: '',
        exitCode: 0,
        durationMs: Math.round(performance.now() - startMs),
      };
    }
  }

  return {
    stdout: '',
    stderr: `Unsupported manage_files action: ${action}`,
    exitCode: 1,
    durationMs: Math.round(performance.now() - startMs),
  };
};

const handleListDirectory: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const targetDir = exec.resolveSafePath(ctx.workspaceRoot, args.path || '.');
  if (!fs.existsSync(targetDir)) {
    return {
      stdout: '',
      stderr: `Directory not found: ${targetDir}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  const entries = fs.readdirSync(targetDir, { withFileTypes: true }).map((d) => ({
    name: d.name,
    type: d.isDirectory() ? 'directory' : 'file',
  }));
  const cappedEntries = entries.slice(0, 150);
  let jsonResult = JSON.stringify(cappedEntries, null, 2);
  if (entries.length > 150) {
    jsonResult += `\n... [Showing 150 of ${entries.length} items to preserve context]`;
  }
  return {
    stdout: jsonResult,
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};

const handleInspectFileMetadata: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const rawPath = String(args.path || '');
  const resolved = exec.resolveSafePath(ctx.workspaceRoot, rawPath);
  if (!fs.existsSync(resolved)) {
    return {
      stdout: '',
      stderr: `File not found: ${resolved}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  try {
    const meta = exec.attachmentManager
      ? exec.attachmentManager.extractFileMetadata(resolved)
      : { path: resolved, size: fs.statSync(resolved).size };
    return {
      stdout: JSON.stringify(meta, null, 2),
      stderr: '',
      exitCode: 0,
      durationMs: Math.round(performance.now() - startMs),
    };
  } catch (e: any) {
    return {
      stdout: '',
      stderr: `Failed to inspect metadata: ${e?.message || String(e)}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
};

const handleInspectDocument: BuiltinToolHandler = async (args, ctx, exec) => {
  const startMs = performance.now();
  const rawPath = String(args.path || '');
  const resolved = exec.resolveSafePath(ctx.workspaceRoot, rawPath);
  if (!fs.existsSync(resolved)) {
    return {
      stdout: '',
      stderr: `Document not found: ${resolved}`,
      exitCode: 1,
      durationMs: Math.round(performance.now() - startMs),
    };
  }
  const ext = path.extname(resolved).toLowerCase();
  const buffer = fs.readFileSync(resolved);
  const stat = fs.statSync(resolved);
  const result: Record<string, any> = {
    path: resolved.replace(/\\/g, '/'),
    filename: path.basename(resolved),
    sizeBytes: stat.size,
    format: ext.replace('.', ''),
  };

  if (ext === '.pdf') {
    if (args.extract_images !== false) {
      const jpegs = extractJpegsFromPdf(buffer);
      const dir = path.dirname(resolved);
      const base = path.parse(resolved).name;
      const savedImages: string[] = [];
      jpegs.slice(0, 10).forEach((jBuf, idx) => {
        const imgOut = path.join(dir, `${base}_extracted_img${idx + 1}.jpg`);
        fs.writeFileSync(imgOut, jBuf);
        savedImages.push(imgOut.replace(/\\/g, '/'));
      });
      result.extractedImagesCount = jpegs.length;
      result.extractedImages = savedImages;
      result.note =
        savedImages.length > 0
          ? `Extracted ${savedImages.length} embedded images (e.g. photos/scans). Saved to disk at paths above for visual analysis.`
          : 'No embedded raster images detected in this PDF.';
    }

    try {
      const pdfParseModule = require('pdf-parse');
      const parseFn = typeof pdfParseModule === 'function' ? pdfParseModule : pdfParseModule.default;
      if (parseFn) {
        const parsed = await parseFn(buffer);
        result.pageCount = parsed.numpages;
        result.info = parsed.info;
        result.textLength = parsed.text ? parsed.text.length : 0;
        result.textContent = parsed.text ? parsed.text.trim().slice(0, 30000) : '';
        result.documentType = !result.textContent
          ? 'scanned_image_pdf (No text layer found; text is stored inside the extracted images)'
          : 'searchable_text_pdf';
      }
    } catch (err: any) {
      result.textExtractionError = String(err?.message || err);
    }
  } else {
    const text = buffer.toString('utf-8');
    const lines = text.split('\n');
    result.lineCount = lines.length;
    result.textContent = lines.slice(0, 1000).join('\n');
  }

  return {
    stdout: JSON.stringify(result, null, 2),
    stderr: '',
    exitCode: 0,
    durationMs: Math.round(performance.now() - startMs),
  };
};

export const FS_TOOL_HANDLERS: Record<string, BuiltinToolHandler> = {
  read_file: handleReadFile,
  write_file: handleWriteFile,
  edit_file: handleEditOrDiff,
  apply_diff: handleEditOrDiff,
  patch_json: handlePatchJson,
  manage_files: handleManageFiles,
  list_directory: handleListDirectory,
  inspect_file_metadata: handleInspectFileMetadata,
  inspect_document: handleInspectDocument,
};
