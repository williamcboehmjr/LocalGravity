import React, { useState, useRef, useEffect } from 'react';
import {
  Image as ImageIcon,
  X,
  Zap,
  Square,
  Plus,
  ChevronDown,
  FileCode2,
  Folder,
  Plug,
  ShieldAlert,
  ArrowUp,
  Check,
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

const TIER_LABELS: Record<ModelTier, { name: string; sub: string }> = {
  low: { name: 'Qwen 3.5 4B Low', sub: 'Fast • Low VRAM' },
  medium: { name: 'Qwen 3.5 9B Medium', sub: 'Balanced Workhorse' },
  high: { name: 'Qwen 3.8 27B High', sub: 'Deep Multimodal' },
};

const BUDGET_LABELS: Record<ThinkingBudget, string> = {
  off: 'Think: Off',
  fast: 'Fast',
  deep: 'Deep',
};

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
    executionPolicy,
    setExecutionPolicy,
    isGenerating,
  } = useSessionStore();

  const { workspaceFiles } = useArtifactStore();
  const { mcpServers } = useTelemetryStore();

  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showBudgetMenu, setShowBudgetMenu] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastCompositionEndAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (textareaRef.current && !CSS.supports('field-sizing', 'content')) {
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
      }
      return;
    }

    onSend(input.trim(), images.length > 0 ? images : undefined, selectedTier, thinkingBudget);
    setInput('');
    setImages([]);
    setShowMentionPopover(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.nativeEvent.isComposing) return;
      if (
        lastCompositionEndAtRef.current !== null &&
        Math.abs(e.nativeEvent.timeStamp - lastCompositionEndAtRef.current) < 50
      ) {
        return;
      }
      handleSubmit();
    } else if (e.key === 'Escape') {
      setShowMentionPopover(false);
      setShowModelMenu(false);
      setShowBudgetMenu(false);
    }
  };

  const handleSelectTier = (tier: ModelTier) => {
    setSelectedTier(tier);
    onTierChange?.(tier);
    setShowModelMenu(false);
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

  const hasContent = Boolean(input.trim() || images.length > 0);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      className={`relative px-3.5 pt-3 pb-2.5 bg-[#1E1E20] border rounded-2xl shadow-lg space-y-2 shrink-0 transition-colors ${
        isDraggingOver
          ? 'border-[#60A5FA] bg-[#60A5FA]/5'
          : 'border-[#2C2C30] focus-within:border-[#3E3E44]'
      }`}
    >
      {/* @file / @folder / @mcp Autocomplete Popover */}
      {showMentionPopover && mentionCandidates.length > 0 && (
        <div className="absolute bottom-full left-3 mb-2 w-72 max-h-52 overflow-y-auto bg-[#1E1E20] border border-[#2E2E32] rounded-xl shadow-2xl p-1.5 z-40 space-y-0.5 select-none">
          <div className="text-[10px] font-medium uppercase tracking-wider text-[#6E6E73] px-2 py-1">
            Context Mentions
          </div>
          {mentionCandidates.slice(0, 8).map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => insertMention(item.label)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono text-[#E3E3E3] hover:bg-[#28282C] text-left transition-colors"
            >
              {item.type === 'mcp' ? (
                <Plug className="w-3.5 h-3.5 text-[#C084FC] shrink-0" />
              ) : item.type === 'folder' ? (
                <Folder className="w-3.5 h-3.5 text-[#FBBF24] shrink-0" />
              ) : (
                <FileCode2 className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
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
        <div className="flex items-center gap-2 overflow-x-auto pb-1 select-none">
          {images.map((img, idx) => (
            <div
              key={idx}
              className="relative group shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-[#2E2E32]"
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
        onCompositionEnd={(e) => {
          lastCompositionEndAtRef.current = e.nativeEvent.timeStamp;
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Ask anything, @ to mention, / for actions"
        className="auto-fit-textarea bg-transparent resize-none outline-none text-[13px] text-[#E3E3E3] placeholder:text-[#6E6E73] font-sans leading-relaxed"
      />

      {/* Bottom Toolbar inside Composer (Antigravity 2.0 layout) */}
      <div className="flex items-center justify-between pt-1 gap-2 select-none">
        {/* Left side: + button, Model Dropdown, Thinking Budget Dropdown */}
        <div className="flex items-center gap-1.5 min-w-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageUpload}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => {
              setInput((prev) => (prev.endsWith('@') ? prev : `${prev}@`));
              setMentionFilter('');
              setShowMentionPopover(true);
              textareaRef.current?.focus();
            }}
            className="p-1 rounded-md text-[#8E8E93] hover:text-[#E3E3E3] hover:bg-[#28282C] transition-colors"
            title="Add context (@file / @mcp)"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Model Tier Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowModelMenu(!showModelMenu);
                setShowBudgetMenu(false);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[#9A9A9E] hover:text-[#E3E3E3] hover:bg-[#28282C] transition-colors"
            >
              <span>{TIER_LABELS[selectedTier].name}</span>
              <ChevronDown className="w-3 h-3 text-[#6E6E73]" />
            </button>

            {showModelMenu && (
              <div className="absolute bottom-full left-0 mb-1.5 w-52 bg-[#1E1E20] border border-[#2E2E32] rounded-xl shadow-2xl p-1 z-50 space-y-0.5">
                {(['low', 'medium', 'high'] as ModelTier[]).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => handleSelectTier(tier)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                      selectedTier === tier
                        ? 'bg-[#28282C] text-[#E3E3E3]'
                        : 'text-[#9A9A9E] hover:bg-[#242428] hover:text-[#E3E3E3]'
                    }`}
                  >
                    <div>
                      <div className="font-medium">{TIER_LABELS[tier].name}</div>
                      <div className="text-[10px] text-[#6E6E73]">{TIER_LABELS[tier].sub}</div>
                    </div>
                    {selectedTier === tier && <Check className="w-3.5 h-3.5 text-[#E3E3E3]" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Thinking Effort Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowBudgetMenu(!showBudgetMenu);
                setShowModelMenu(false);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[#6E6E73] hover:text-[#E3E3E3] hover:bg-[#28282C] transition-colors"
              title="Thinking Effort"
            >
              <span>{BUDGET_LABELS[thinkingBudget]}</span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {showBudgetMenu && (
              <div className="absolute bottom-full left-0 mb-1.5 w-36 bg-[#1E1E20] border border-[#2E2E32] rounded-xl shadow-2xl p-1 z-50 space-y-0.5">
                {(['off', 'fast', 'deep'] as ThinkingBudget[]).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => {
                      setThinkingBudget(b);
                      setShowBudgetMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                      thinkingBudget === b
                        ? 'bg-[#28282C] text-[#E3E3E3]'
                        : 'text-[#9A9A9E] hover:bg-[#242428] hover:text-[#E3E3E3]'
                    }`}
                  >
                    <span className="capitalize">{b === 'off' ? 'Off' : `${b} Thinking`}</span>
                    {thinkingBudget === b && <Check className="w-3.5 h-3.5 text-[#E3E3E3]" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right side: Turbo / Policy Toggle, Image Upload, Send / Stop Button */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() =>
              setExecutionPolicy(
                executionPolicy === 'always_proceed' ? 'request_review' : 'always_proceed'
              )
            }
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
              executionPolicy === 'always_proceed'
                ? 'text-[#9A9A9E] hover:text-[#E3E3E3] hover:bg-[#28282C]'
                : 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/20'
            }`}
            title={
              executionPolicy === 'always_proceed'
                ? 'Turbo Mode: Auto-execute commands without review'
                : 'Review Mode: Ask before executing commands'
            }
          >
            {executionPolicy === 'always_proceed' ? (
              <>
                <Zap className="w-3 h-3" />
                <span>Turbo</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3 h-3" />
                <span>Review</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-md text-[#8E8E93] hover:text-[#E3E3E3] hover:bg-[#28282C] transition-colors"
            title="Attach Image or Screenshot"
          >
            <ImageIcon className="w-3.5 h-3.5" />
          </button>

          {isGenerating && !hasContent ? (
            <button
              type="button"
              onClick={onStop}
              className="w-7 h-7 rounded-lg bg-[#DC2626] hover:bg-[#EF4444] text-white flex items-center justify-center transition-colors shadow-sm"
              title="Stop Generation"
            >
              <Square className="w-3 h-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!hasContent}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                hasContent
                  ? 'bg-[#E3E3E3] hover:bg-white text-[#131314] cursor-pointer shadow-sm'
                  : 'bg-[#28282C] text-[#55555A] cursor-not-allowed'
              }`}
              title={isGenerating ? 'Queue Follow-Up Prompt' : 'Send Prompt (Enter)'}
            >
              <ArrowUp className="w-4 h-4 stroke-[2.25]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
