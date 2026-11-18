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

  return history
    .filter((m) => m.id !== assistantMsgId)
    .slice(-limit)
    .map((m, idx, arr) => {
      const rawContent =
        idx === arr.length - 1 && m.role === 'user' && slashCommand ? slashCleanPrompt : m.content;
      let attachments: any[] = [];
      if (m.attachments) {
        try {
          attachments = typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments;
        } catch {}
      }
      if (idx === arr.length - 1 && (!attachments || attachments.length === 0) && savedAttachments.length > 0) {
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
          return { role: m.role, content: contentParts };
        }
        return { role: m.role, content: fullUserText };
      }

      return { role: m.role, content: rawContent };
    });
}
