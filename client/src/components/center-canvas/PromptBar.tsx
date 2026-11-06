import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Image as ImageIcon,
  X,
  Zap,
  Sparkles,
  Square,
  CornerDownLeft,
  AtSign,
  FileCode2,
  Folder,
  Plug,
} from 'lucide-react';
import { useSessionStore, QueuedMessage } from '../../store/useSessionStore';
import { useArtifactStore } from '../../store/useArtifactStore';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { ModelTier, ThinkingBudget } from '../../types/protocol';
import { MessageQueueList } from './MessageQueueList';

interface PromptBarProps {
  onSend: (
    text: string,
    images?: string[],
    tierOverride?: ModelTier,
    thinkingBudgetOverride?: ThinkingBudget
  ) => void;
  onTierChange?: (tier: ModelTier) => void;
  onStop?: () => void;
  onQueue?: (text: string, images?: string[]) => void;
  onInterruptAndSend?: (item: QueuedMessage) => void;
}

export const PromptBar: React.FC<PromptBarProps> = ({
  onSend,
  onTierChange,
  onStop,
  onQueue,
  onInterruptAndSend,
}) => {
  const {
    selectedTier,
    setSelectedTier,
    thinkingBudget,
    setThinkingBudget,
    isGenerating,
    setIsGenerating,
    modelStatus,
  } = useSessionStore();

  const { workspaceFiles } = useArtifactStore();
  const { tokensPerSec, lastSwapDurationMs, mcpServers } = useTelemetryStore();

  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  const handleInputChange = (val: string) => {
    setInput(val);
    const atMatch = val.match(/@([a-zA-Z0-9_./-]*)$/);
    if (atMatch) {
      setMentionFilter(atMatch[1].toLowerCase());
      setShowMentionPopover(true);
    } else {
      setShowMentionPopover(false);
    }
  };

  const insertMention = (token: string) => {
    const replaced = input.replace(/@([a-zA-Z0-9_./-]*)$/, `@${token} `);
    setInput(replaced);
    setShowMentionPopover(false);
    textareaRef.current?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            if (base64) setImages((prev) => [...prev, base64]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            if (base64) setImages((prev) => [...prev, base64]);
          };
          reader.readAsDataURL(file);
        }
      });
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          if (base64) setImages((prev) => [...prev, base64]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleEditInInput = (text: string, imgs?: string[]) => {
    setInput(text);
    if (imgs && imgs.length > 0) setImages(imgs);
    textareaRef.current?.focus();
  };

  const handleSubmit = () => {
    if (!input.trim() && images.length === 0) return;

    if (isGenerating) {
      if (onQueue) {
        onQueue(input.trim(), images.length > 0 ? images : undefined);
        setInput('');
        setImages([]);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      }
      return;
    }

    onSend(input.trim(), images.length > 0 ? images : undefined, selectedTier, thinkingBudget);
    setInput('');
    setImages([]);
    setShowMentionPopover(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setShowMentionPopover(false);
    }
  };

  const handleSelectTier = (tier: ModelTier) => {
    setSelectedTier(tier);
    onTierChange?.(tier);
  };

  const mentionCandidates = [
    ...mcpServers.map((s) => ({ type: 'mcp' as const, label: `mcp:${s.name}` })),
    ...(workspaceFiles.length > 0
      ? workspaceFiles.slice(0, 25).map((f) => ({
          type: f.type === 'directory' ? ('folder' as const) : ('file' as const),
          label: f.path,
        }))
      : [
          { type: 'file' as const, label: 'README.md' },
          { type: 'file' as const, label: 'launch.py' },
          { type: 'file' as const, label: 'mcp_config.json' },
          { type: 'folder' as const, label: 'server/src' },
          { type: 'folder' as const, label: 'client/src' },
        ]),
  ].filter((c) => c.label.toLowerCase().includes(mentionFilter));

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      className={`relative p-3.5 bg-[#1C2029] border rounded-2xl shadow-2xl space-y-2.5 shrink-0 transition-colors ${
        isDraggingOver
          ? 'border-[#8AB4F8] bg-[#8AB4F8]/5'
          : 'border-[#262B36] focus-within:border-[#8AB4F8]'
      }`}
    >
      {/* @file / @folder / @mcp Autocomplete Popover */}
      {showMentionPopover && mentionCandidates.length > 0 && (
        <div className="absolute bottom-full left-3 mb-2 w-72 max-h-52 overflow-y-auto bg-[#1C2029] border border-[#262B36] rounded-xl shadow-2xl p-1.5 z-40 space-y-0.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#5F6368] px-2 py-1">
            Context Mentions (@file / @folder / @mcp)
          </div>
          {mentionCandidates.slice(0, 8).map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => insertMention(item.label)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono text-[#E8EAED] hover:bg-[#8AB4F8]/15 hover:text-[#8AB4F8] text-left transition-colors"
            >
              {item.type === 'mcp' ? (
                <Plug className="w-3.5 h-3.5 text-[#C58AF9] shrink-0" />
              ) : item.type === 'folder' ? (
                <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <FileCode2 className="w-3.5 h-3.5 text-[#8AB4F8] shrink-0" />
              )}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Queued Messages List */}
      <MessageQueueList
        onInterruptAndSend={(item) => onInterruptAndSend?.(item)}
        onEditInInput={handleEditInInput}
      />

      {/* Attached Screenshots Tray */}
      {images.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {images.map((img, idx) => (
            <div
              key={idx}
              className="relative group shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-[#262B36]"
            >
              <img src={img} alt="attachment" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => setImages(images.filter((_, i) => i !== idx))}
                className="absolute top-1 right-1 p-0.5 rounded-full bg-black/80 hover:bg-rose-600 text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Multi-line Prompt Input */}
      <textarea
        ref={textareaRef}
        rows={1}
        value={input}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Ask LocalGravity, paste a screenshot, or type @file / @mcp..."
        className="w-full bg-transparent resize-none outline-none text-sm sm:text-base text-[#E8EAED] placeholder:text-[#5F6368] font-sans leading-relaxed max-h-40 px-1"
      />

      {/* Bottom Cockpit Bar: 3x3 Matrix Pills (Model Tier × Thinking Budget) + Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-[#262B36] gap-2 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2 overflow-x-auto min-w-0">
          {/* Model Tier Selector Pill: [ Low 4B ] | [ Med 9B ] | [ High 27B ] */}
          <div className="flex items-center bg-[#0B0D11] p-1 rounded-xl border border-[#262B36] shrink-0">
            <button
              type="button"
              onClick={() => handleSelectTier('low')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                selectedTier === 'low'
                  ? 'bg-[#1A73E8]/25 text-[#8AB4F8] font-semibold border border-[#8AB4F8]/60'
                  : 'text-[#9AA0A6] hover:text-[#E8EAED]'
              }`}
              title="Qwen 3.5 4B (EXL3 ~4.5 bpw) • ViT pinned in VRAM"
            >
              <Zap className="w-3 h-3" />
              <span>Low 4B</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectTier('medium')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                selectedTier === 'medium'
                  ? 'bg-[#1A73E8]/25 text-[#8AB4F8] font-semibold border border-[#8AB4F8]/60'
                  : 'text-[#9AA0A6] hover:text-[#E8EAED]'
              }`}
              title="Qwen 3.5 9B (EXL3 ~4.0 bpw) • Primary coding workhorse"
            >
              <Zap className="w-3 h-3" />
              <span>Med 9B</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectTier('high')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                selectedTier === 'high'
                  ? 'bg-[#C58AF9]/25 text-[#C58AF9] font-semibold border border-[#C58AF9]/60'
                  : 'text-[#9AA0A6] hover:text-[#E8EAED]'
              }`}
              title="Qwen 3.8 27B VL (EXL3 ~3.5 bpw) • Deep architectural reasoning"
            >
              <Zap className="w-3 h-3" />
              <span>High 27B</span>
            </button>
          </div>

          {/* Thinking Budget Selector Pill: [ Off ] | [ Fast ] | [ Deep ] */}
          <div className="flex items-center bg-[#0B0D11] p-1 rounded-xl border border-[#262B36] shrink-0">
            <span className="flex items-center gap-1 px-2 text-[11px] text-[#9AA0A6] font-medium">
              <Sparkles className="w-3 h-3 text-[#C58AF9]" />
              <span className="hidden md:inline">Think:</span>
            </span>
            {(['off', 'fast', 'deep'] as ThinkingBudget[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setThinkingBudget(b)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono capitalize transition-all cursor-pointer ${
                  thinkingBudget === b
                    ? 'bg-gradient-to-r from-[#1A73E8]/30 to-[#C58AF9]/30 text-[#E8EAED] font-semibold border border-[#8AB4F8]/60'
                    : 'text-[#9AA0A6] hover:text-[#E8EAED]'
                }`}
                title={
                  b === 'off'
                    ? 'Off: 0ms overhead (<think></think> prefill)'
                    : b === 'fast'
                    ? 'Fast: ~250-token rapid verification check'
                    : 'Deep: Unconstrained chain-of-thought deliberation'
                }
              >
                {b}
              </button>
            ))}
          </div>

          {/* Live Swap & Speed Telemetry Pill */}
          <span className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0B0D11] border border-[#262B36] text-[11px] font-mono text-[#9AA0A6] shrink-0">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                modelStatus === 'swapping' ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'
              }`}
            />
            <span>{tokensPerSec.toFixed(1)} tok/s</span>
            <span className="text-[#5F6368]">•</span>
            <span>{lastSwapDurationMs}ms swap</span>
          </span>
        </div>

        {/* Right Actions: @Mention, Attach Image, Stop/Queue/Send */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setInput((prev) => (prev.endsWith('@') ? prev : `${prev}@`));
              setMentionFilter('');
              setShowMentionPopover(true);
              textareaRef.current?.focus();
            }}
            className="p-2 rounded-xl hover:bg-[#262B36] text-[#9AA0A6] hover:text-[#E8EAED] transition-colors"
            title="Insert @file / @folder / @mcp context mention"
          >
            <AtSign className="w-4 h-4" />
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            multiple
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-xl hover:bg-[#262B36] text-[#9AA0A6] hover:text-[#E8EAED] transition-colors"
            title="Attach screenshot or image"
          >
            <ImageIcon className="w-4 h-4" />
          </button>

          {isGenerating ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => (onStop ? onStop() : setIsGenerating(false))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F28B82]/20 text-[#F28B82] border border-[#F28B82]/50 hover:bg-[#F28B82]/30 transition-colors font-semibold text-xs cursor-pointer"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>

              {(input.trim() || images.length > 0) && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1A73E8] hover:bg-[#4285F4] text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  <CornerDownLeft className="w-3.5 h-3.5" />
                  <span>Queue</span>
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!input.trim() && images.length === 0}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl font-semibold text-xs transition-all ${
                input.trim() || images.length > 0
                  ? 'bg-gradient-to-r from-[#1A73E8] to-[#4285F4] text-white hover:brightness-110 shadow-md cursor-pointer'
                  : 'bg-[#262B36] text-[#5F6368] cursor-not-allowed'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
