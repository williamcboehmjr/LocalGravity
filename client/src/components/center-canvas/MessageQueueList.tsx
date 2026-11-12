import React, { useState } from 'react';
import { Zap, Pencil, Trash2, Check, ArrowUpRight, Layers } from 'lucide-react';
import { useSessionStore, QueuedMessage } from '../../store/useSessionStore';

interface MessageQueueListProps {
  onInterruptAndSend: (item: QueuedMessage) => void;
  onEditInInput?: (text: string, images?: string[]) => void;
}

export const MessageQueueList: React.FC<MessageQueueListProps> = ({
  onInterruptAndSend,
  onEditInInput,
}) => {
  const { messageQueue, removeQueuedMessage, updateQueuedMessage, clearQueue } = useSessionStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  if (messageQueue.length === 0) return null;

  const startEdit = (item: QueuedMessage) => {
    setEditingId(item.id);
    setEditText(item.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const saveEdit = (id: string) => {
    if (editText.trim()) {
      updateQueuedMessage(id, editText.trim());
    }
    setEditingId(null);
    setEditText('');
  };

  const handleLoadIntoInput = (item: QueuedMessage) => {
    if (onEditInInput) {
      onEditInInput(item.text, item.images);
      removeQueuedMessage(item.id);
    }
  };

  return (
    <div className="bg-canvas/90 border border-cyan-500/30 rounded-xl p-2.5 sm:p-3 mb-2 shadow-lg backdrop-blur-md space-y-2">
      {/* Queue Header */}
      <div className="flex items-center justify-between text-xs text-text-secondary pb-1 border-b border-border-subtle/50">
        <div className="flex items-center gap-1.5 font-medium text-cyan-400">
          <Layers className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span className="font-semibold tracking-wide">
            Queued Messages ({messageQueue.length})
          </span>
          <span className="text-[11px] text-text-muted hidden sm:inline">
            • Will send automatically when current turn finishes
          </span>
        </div>
        <button
          onClick={clearQueue}
          className="text-[11px] text-text-muted hover:text-rose-400 transition-colors font-mono cursor-pointer"
          title="Clear all queued messages"
        >
          Clear Queue
        </button>
      </div>

      {/* Queue Items */}
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {messageQueue.map((item, index) => {
          const isEditing = editingId === item.id;

          return (
            <div
              key={item.id}
              className="bg-surface/80 hover:bg-surface border border-border-subtle/70 rounded-lg p-2 sm:p-2.5 transition-colors space-y-1.5"
            >
              {/* Item Header & Tags */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">
                    #{index + 1}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-surface-muted text-text-secondary uppercase">
                    ⚡ {item.tier}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>

                {/* Primary Actions (Send Now / Edit / Delete) */}
                {!isEditing && (
                  <div className="flex items-center gap-1">
                    {/* Send Now / Interrupt Button */}
                    <button
                      onClick={() => onInterruptAndSend(item)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-amber-950/90 text-amber-300 hover:bg-amber-900 border border-amber-600/70 shadow-xs transition-colors cursor-pointer"
                      title="Interrupt current response and send this message immediately"
                    >
                      <Zap className="w-3 h-3 fill-current text-amber-400" />
                      <span className="text-[11px]">Send Now</span>
                    </button>

                    {/* Edit Button */}
                    <button
                      onClick={() => startEdit(item)}
                      className="p-1 rounded-md text-text-secondary hover:text-white hover:bg-surface-highlight transition-colors cursor-pointer"
                      title="Edit this queued message"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    {/* Delete Button */}
                    <button
                      onClick={() => removeQueuedMessage(item.id)}
                      className="p-1 rounded-md text-text-muted hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                      title="Delete from queue"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Inline Edit Form */}
              {isEditing ? (
                <div className="space-y-2 pt-1">
                  <textarea
                    rows={2}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="w-full bg-canvas text-white text-xs sm:text-sm p-2 rounded-lg border border-cyan-500/50 outline-none resize-none focus:border-cyan-400 font-sans"
                    autoFocus
                  />
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => handleLoadIntoInput(item)}
                      className="flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 transition-colors cursor-pointer"
                      title="Pull text into main prompt bar"
                    >
                      <ArrowUpRight className="w-3 h-3" />
                      <span>Edit in Prompt Bar</span>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={cancelEdit}
                        className="px-2 py-1 rounded text-xs text-text-muted hover:text-white transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(item.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent-blue hover:bg-blue-600 text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
                      >
                        <Check className="w-3 h-3" />
                        <span>Save</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Display Message Text & Images */
                <div className="space-y-1">
                  {item.images && item.images.length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                      {item.images.map((img, imgIdx) => (
                        <img
                          key={imgIdx}
                          src={img}
                          alt="queued attachment"
                          className="w-10 h-10 object-cover rounded-md border border-border-subtle"
                        />
                      ))}
                    </div>
                  )}
                  <p className="text-xs sm:text-sm text-zinc-200 whitespace-pre-wrap font-sans leading-relaxed line-clamp-3">
                    {item.text}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
