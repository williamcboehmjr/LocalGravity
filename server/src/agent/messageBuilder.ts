import fs from 'node:fs';
import path from 'node:path';
import type { MessageRecord, ToolExecutionRecord } from '../db/database.js';
import type { SavedAttachment } from '../files/attachmentManager.js';

export type ChatHistoryItem = {
  role: string;
  content: any;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

export function buildChatHistoryMessages(params: {
  history: Array<MessageRecord & { tool_executions: ToolExecutionRecord[] }>;
  assistantMsgId: string;
  savedAttachments: SavedAttachment[];
  slashCommand: string | null;
  slashCleanPrompt: string;
  limit?: number;
}): ChatHistoryItem[] {
  const { history, assistantMsgId, savedAttachments, slashCommand, slashCleanPrompt, limit = 14 } = params;

  const filtered = history.filter((m) => m.id !== assistantMsgId);
  let latestCompacted: (MessageRecord & { tool_executions: ToolExecutionRecord[] }) | undefined;
  for (let i = filtered.length - 1; i >= 0; i--) {
    if (
      typeof filtered[i].content === 'string' &&
      filtered[i].content.includes('[CONTEXT AUTO-COMPACTED')
    ) {
      latestCompacted = filtered[i];
      break;
    }
  }

  let sliced = filtered.slice(-limit);
  if (latestCompacted && !sliced.some((m) => m.id === latestCompacted!.id)) {
    sliced = [latestCompacted, ...sliced];
  }

  const out: ChatHistoryItem[] = [];

  for (let idx = 0; idx < sliced.length; idx++) {
    const m = sliced[idx];
    const isLast = idx === sliced.length - 1;
    let rawContent =
      isLast && m.role === 'user' && slashCommand ? slashCleanPrompt : m.content;

    if (m.role === 'assistant') {
      const hasTools = Array.isArray(m.tool_executions) && m.tool_executions.length > 0;
      const trimmedContent = (rawContent || '').trim();
      if (!trimmedContent && !hasTools) {
        // Skip empty aborted assistant turns that have neither content nor tool executions
        continue;
      }
      if (hasTools) {
        const toolSummaries = m.tool_executions.map((t) => {
          const outSnippet = (t.stdout_stream || t.stderr_stream || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 180);
          return `${t.tool_name}(${t.status}${t.exit_code !== null && t.exit_code !== undefined ? `, exit=${t.exit_code}` : ''})${outSnippet ? `: ${outSnippet}` : ''}`;
        });
        const toolBlock = `[Prior Tool Executions]: ${toolSummaries.join(' | ')}`;
        rawContent = trimmedContent ? `${rawContent}\n\n${toolBlock}` : toolBlock;
      }
    }

    let attachments: any[] = [];
    if (m.attachments) {
      try {
        attachments = typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments;
      } catch {}
    }
    if (isLast && (!attachments || attachments.length === 0) && savedAttachments.length > 0) {
      attachments = savedAttachments;
    }

    if (m.role === 'user' && Array.isArray(attachments) && attachments.length > 0) {
      let fileGrounding = '\n\n=== ATTACHED WORKSTATION FILES & METADATA ===\n';
      attachments.forEach((att: any, fIdx: number) => {
        const fNum = fIdx + 1;
        const fName = att.name || `file_${fNum}`;
        const fPath = (att.savedPath || '').replace(/\\/g, '/');
        const fSize = att.sizeHuman || (att.size ? `${att.size} bytes` : 'unknown size');
        const fType = att.type || 'unknown type';
        const fSha = att.sha256 ? ` (SHA-256: ${att.sha256})` : '';
        const meta = att.metadata || {};

        fileGrounding += `[File ${fNum}] ${fName}\n`;
        if (fPath) fileGrounding += `- Workstation Local Path: "${fPath}"\n`;
        fileGrounding += `- Size: ${fSize}${fSha}\n`;
        fileGrounding += `- MIME Type: ${fType}\n`;
        if (meta.width && meta.height) {
          fileGrounding += `- Dimensions: ${meta.width} x ${meta.height} px\n`;
        }
        if (meta.exif && Object.keys(meta.exif).length > 0) {
          fileGrounding += `- EXIF Camera/Capture Metadata: ${JSON.stringify(meta.exif)}\n`;
        }
        if (meta.lineCount !== undefined) {
          fileGrounding += `- Text Lines: ${meta.lineCount}, Characters: ${meta.characterCount}\n`;
        }
        if (meta.previewSnippet) {
          fileGrounding +=
            `- Text Preview Snippet:\n[PREVIEW START]\n` +
            String(meta.previewSnippet || '').slice(0, 400) +
            `\n[PREVIEW END]\n`;
        }
        fileGrounding += `(Saved on workstation disk. You can read, inspect with inspect_file_metadata, or execute tools on this file directly.)\n\n`;
      });

      const fullUserText = (rawContent || 'Please analyze the attached files.').trim() + fileGrounding;

      const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: 'text', text: fullUserText },
      ];

      for (const att of attachments) {
        if (att.metadata?.extractedImages && Array.isArray(att.metadata.extractedImages)) {
          for (const emb of att.metadata.extractedImages) {
            const embUrl =
              emb.url ||
              (emb.savedPath && fs.existsSync(emb.savedPath)
                ? `data:image/jpeg;base64,${fs.readFileSync(emb.savedPath).toString('base64')}`
                : undefined);
            if (embUrl) {
              contentParts.push({
                type: 'image_url',
                image_url: { url: embUrl },
              });
            }
          }
        }

        const isImg =
          att.isImage ||
          (typeof att === 'string' && att.startsWith('data:image/')) ||
          (typeof att?.type === 'string' && att.type.startsWith('image/'));

        if (isImg) {
          let imgUrl = typeof att === 'string' ? att : att.base64DataUrl || att.dataUrl;
          if (!imgUrl && att.savedPath && fs.existsSync(att.savedPath)) {
            try {
              const buf = fs.readFileSync(att.savedPath);
              const ext = (path.extname(att.savedPath) || '.jpg').toLowerCase();
              const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
              imgUrl = `data:${mime};base64,${buf.toString('base64')}`;
            } catch {}
          }
          if (
            typeof imgUrl === 'string' &&
            (imgUrl.startsWith('data:image/') || imgUrl.startsWith('http://') || imgUrl.startsWith('https://'))
          ) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: imgUrl },
            });
          }
        }
      }

      if (contentParts.length > 1) {
        out.push({ role: m.role, content: contentParts });
      } else {
        out.push({ role: m.role, content: fullUserText });
      }
      continue;
    }

    out.push({ role: m.role, content: rawContent });
  }

  return out;
}
