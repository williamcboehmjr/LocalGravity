import React from 'react';
import { FileText, X } from 'lucide-react';
import type { FileAttachmentItem } from '../../store/useSessionStore';

interface AttachmentStripProps {
  attachments: FileAttachmentItem[];
  onRemoveAttachment: (index: number, base64DataUrl?: string) => void;
  formatFileSize: (bytes: number) => string;
}

export const AttachmentStrip: React.FC<AttachmentStripProps> = ({
  attachments,
  onRemoveAttachment,
  formatFileSize,
}) => {
  if (attachments.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1.5 select-none scrollbar-thin">
      {attachments.map((att, idx) => (
        <div
          key={idx}
          className="relative group shrink-0 rounded-lg overflow-hidden border border-[#2E2E32] bg-[#1E1F23] flex items-center shadow-sm"
        >
          {att.isImage ? (
            <div className="w-14 h-14 relative">
              <img src={att.base64DataUrl} alt={att.name} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemoveAttachment(idx, att.base64DataUrl)}
                className="absolute top-1 right-1 p-0.5 rounded-full bg-black/80 hover:bg-rose-600 text-white transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 pr-7 max-w-[220px]">
              <FileText className="w-4 h-4 text-sky-400 shrink-0" />
              <div className="min-w-0 text-left">
                <div className="text-[12px] font-medium text-[#E8EAED] truncate" title={att.name}>
                  {att.name}
                </div>
                <div className="text-[10px] text-[#9AA0A6]">
                  {att.sizeHuman || formatFileSize(att.size)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemoveAttachment(idx)}
                className="absolute top-2 right-1.5 p-0.5 rounded-full bg-transparent hover:bg-[#3C4044] text-[#9AA0A6] hover:text-white transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
