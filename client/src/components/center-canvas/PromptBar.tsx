import React, { useState, useRef, useEffect } from 'react';
import { Send, Image as ImageIcon, X, Zap, Brain, Square, CornerDownLeft } from 'lucide-react';
import { useSessionStore, QueuedMessage } from '../../store/useSessionStore';
import { ModelTier, ThinkingBudget } from '../../types/protocol';
import { MessageQueueList } from './MessageQueueList';

interface PromptBarProps {
  onSend: (text: string, images?: string[]) => void;
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
  } = useSessionStore();

  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [input]);

  // Handle clipboard screenshot pasting
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
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
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

    onSend(input.trim(), images.length > 0 ? images : undefined);
    setInput('');
    setImages([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSelectTier = (tier: ModelTier) => {
    setSelectedTier(tier);
    if (onTierChange) onTierChange(tier);
  };

  const cycleThinkingBudget = () => {
    const order: ThinkingBudget[] = ['off', 'fast', 'deep'];
    const nextIdx = (order.indexOf(thinkingBudget) + 1) % order.length;
    setThinkingBudget(order[nextIdx]);
  };

  return (
    <div className="p-3.5 sm:p-4 bg-surface border border-border-subtle rounded-2xl shadow-2xl space-y-3 shrink-0">
      {/* Queued Messages List */}
      <MessageQueueList
        onInterruptAndSend={(item) => onInterruptAndSend?.(item)}
        onEditInInput={handleEditInInput}
      />

      {/* Attached Images Tray */}
      {images.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {images.map((img, idx) => (
            <div key={idx} className="relative group shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-border-strong shadow-sm">
              <img src={img} alt="attachment" className="w-full h-full object-cover" />
              <button
                onClick={() => setImages(images.filter((_, i) => i !== idx))}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/75 hover:bg-rose-900/90 text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Textarea - text-base (16px) on mobile prevents auto-zoom, clear high-contrast white text */}
      <textarea
        ref={textareaRef}
        rows={1}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Ask LocalGravity or give an instruction..."
        className="w-full bg-transparent resize-none outline-none text-base text-white placeholder:text-zinc-400 font-sans leading-relaxed max-h-36 sm:max-h-48 px-1"
      />

      {/* Control Bar: Dual Antigravity Controls + Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-border-subtle gap-2 flex-nowrap">
        {/* Left Side: Tier Selector & Thinking Selector */}
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto shrink min-w-0">
          {/* Antigravity Model Tier Toggle */}
          <div className="flex items-center bg-canvas p-1 rounded-xl border border-border-subtle shrink-0">
            <button
              onClick={() => handleSelectTier('low')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-mono transition-colors ${
                selectedTier === 'low'
                  ? 'bg-blue-950/90 text-blue-400 font-bold border border-blue-700/80 shadow-xs'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Low</span>
            </button>
            <button
              onClick={() => handleSelectTier('medium')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-mono transition-colors ${
                selectedTier === 'medium'
                  ? 'bg-amber-950/90 text-amber-400 font-bold border border-amber-700/80 shadow-xs'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Med</span>
            </button>
            <button
              onClick={() => handleSelectTier('high')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-mono transition-colors ${
                selectedTier === 'high'
                  ? 'bg-purple-950/90 text-purple-400 font-bold border border-purple-700/80 shadow-xs'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>High</span>
            </button>
          </div>

          {/* Thinking Budget Toggle */}
          <div className="flex items-center bg-canvas p-1 rounded-xl border border-border-subtle shrink-0">
            {/* Desktop 3-pill */}
            <div className="hidden sm:flex items-center">
              <span className="flex items-center gap-1.5 px-2 text-xs text-text-muted font-medium">
                <Brain className="w-4 h-4 text-cyan-400" />
                <span>Think:</span>
              </span>
              <button
                onClick={() => setThinkingBudget('off')}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors ${
                  thinkingBudget === 'off' ? 'bg-surface-highlight text-white font-bold' : 'text-text-secondary hover:text-white'
                }`}
              >
                Off
              </button>
              <button
                onClick={() => setThinkingBudget('fast')}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors ${
                  thinkingBudget === 'fast' ? 'bg-cyan-950/90 text-cyan-400 font-bold border border-cyan-700/80' : 'text-text-secondary hover:text-white'
                }`}
              >
                Fast
              </button>
              <button
                onClick={() => setThinkingBudget('deep')}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors ${
                  thinkingBudget === 'deep' ? 'bg-purple-950/90 text-purple-400 font-bold border border-purple-700/80' : 'text-text-secondary hover:text-white'
                }`}
              >
                Deep
              </button>
            </div>

            {/* Mobile Touch Cycling Pill */}
            <button
              onClick={cycleThinkingBudget}
              className="flex sm:hidden items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-mono text-cyan-300 bg-cyan-950/80 border border-cyan-700/80 font-semibold"
              title="Tap to change thinking budget"
            >
              <Brain className="w-3.5 h-3.5 text-cyan-400" />
              <span className="capitalize">{thinkingBudget}</span>
            </button>
          </div>
        </div>

        {/* Right Side: Attach & Send */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            multiple
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 sm:p-2.5 rounded-xl hover:bg-surface-muted text-text-secondary hover:text-white transition-colors"
            title="Attach screenshot or image"
          >
            <ImageIcon className="w-5 h-5" />
          </button>

          {isGenerating ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  if (onStop) {
                    onStop();
                  } else {
                    setIsGenerating(false);
                  }
                }}
                className="flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl bg-rose-950/90 text-rose-200 border border-rose-700/80 hover:bg-rose-900 transition-colors font-semibold text-xs sm:text-sm shadow-sm cursor-pointer"
                title="Stop generation"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>

              {(input.trim() || images.length > 0) && (
                <button
                  onClick={handleSubmit}
                  className="flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs sm:text-sm transition-colors shadow-sm active:scale-95 cursor-pointer"
                  title="Queue message to run after current turn"
                >
                  <CornerDownLeft className="w-3.5 h-3.5" />
                  <span>Queue</span>
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim() && images.length === 0}
              className={`flex items-center gap-1.5 px-4 sm:px-4.5 py-2 rounded-xl font-semibold text-xs sm:text-sm transition-colors shadow-sm ${
                input.trim() || images.length > 0
                  ? 'bg-accent-blue text-white hover:bg-blue-600 active:scale-95 shadow-accent-blue/20 cursor-pointer'
                  : 'bg-surface-muted text-text-muted cursor-not-allowed opacity-60'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Send</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
