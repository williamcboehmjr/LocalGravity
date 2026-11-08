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
  Target,
  Map,
  Sparkles,
  MessageSquareMore,
  Users,
  Globe,
  BookOpen,
  Minimize2,
  Clock,
  Trash2,
  Slash,
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
  onClearContext?: () => void;
}

const TIER_LABELS: Record<ModelTier, { name: string; sub: string }> = {
  low: { name: 'Qwen 3.5 4B Low', sub: 'Fast • Low VRAM' },
  medium: { name: 'Qwen 3.8 27B Medium', sub: 'Fast Workhorse (60+ tok/s)' },
  high: { name: 'Qwen 3.8 Flash-Next High', sub: 'MoE 176B/6B active (High Horsepower)' },
};

const BUDGET_LABELS: Record<ThinkingBudget, string> = {
  off: 'Think: Off',
  fast: 'Fast',
  deep: 'Deep',
};

export interface SlashCommandItem {
  command: string;
  title: string;
  description: string;
  badge: string;
  icon: React.ReactNode;
}

export const ANTIGRAVITY_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    command: '/goal',
    title: 'Autonomous Goal Mode',
    description: 'Run a thorough, multi-step task with self-catching continuation until 100% achieved',
    badge: '50 steps',
    icon: <Target className="w-3.5 h-3.5 text-emerald-400 shrink-0" />,
  },
  {
    command: '/plan',
    title: 'Step-by-Step Architectural Plan',
    description: 'Design a structured implementation plan & sync to the Plan Workbench before coding',
    badge: 'Planner',
    icon: <Map className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />,
  },
  {
    command: '/boost',
    title: 'Deep Multi-Perspective & Verification',
    description: 'Engage goal-directed Deep Thinking, multi-angle analysis, and rigorous verification',
    badge: 'Deep Verify',
    icon: <Sparkles className="w-3.5 h-3.5 text-[#C084FC] shrink-0" />,
  },
  {
    command: '/grill-me',
    title: 'Interactive Design Interview',
    description: 'Align on requirements & resolve design trade-offs through focused questions first',
    badge: 'Interview',
    icon: <MessageSquareMore className="w-3.5 h-3.5 text-amber-400 shrink-0" />,
  },
  {
    command: '/teamwork',
    title: 'Autonomous Multi-Subagent Team',
    description: 'Coordinate Researcher, Architect, Builder, and QA Verifier subagents in sequence',
    badge: '4 Agents',
    icon: <Users className="w-3.5 h-3.5 text-cyan-400 shrink-0" />,
  },
  {
    command: '/browser',
    title: 'Headless Playwright Web Agent',
    description: 'Browse the web, inspect live pages, or scrape documentation with Playwright',
    badge: 'Web',
    icon: <Globe className="w-3.5 h-3.5 text-sky-400 shrink-0" />,
  },
  {
    command: '/learn',
    title: 'Persist Rule to Harness² Memory',
    description: 'Save a lesson, correction, or engineering pattern into .localgravity/harness/memory.md',
    badge: 'Memory',
    icon: <BookOpen className="w-3.5 h-3.5 text-pink-400 shrink-0" />,
  },
  {
    command: '/compact',
    title: 'Compact Context Window',
    description: 'Distill and compact conversation history to free up the model context window',
    badge: 'Context',
    icon: <Minimize2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />,
  },
  {
    command: '/schedule',
    title: 'Schedule Recurring Automation',
    description: 'Design a recurring cron automation or scheduled background task',
    badge: 'Cron',
    icon: <Clock className="w-3.5 h-3.5 text-orange-400 shrink-0" />,
  },
  {
    command: '/clear',
    title: 'Clear Conversation Thread',
    description: 'Immediately wipe messages in the current conversation thread',
    badge: 'Reset',
    icon: <Trash2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />,
  },
];

export const PromptBar: React.FC<PromptBarProps> = ({
  onSend,
  onTierChange,
  onStop,
  onQueue,
  onInterruptAndSend,
  onClearContext,
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
  const [showSlashPopover, setShowSlashPopover] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
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

  const filteredSlashCommands = ANTIGRAVITY_SLASH_COMMANDS.filter(
    (c) =>
      c.command.toLowerCase().includes(slashFilter) ||
      c.title.toLowerCase().includes(slashFilter)
  );

  const handleInputChange = (val: string) => {
    setInput(val);

    // Check for leading `/` slash command trigger (e.g. "/" or "/go")
    const slashMatch = val.match(/^\/([a-zA-Z0-9_-]*)$/);
    if (slashMatch) {
      setSlashFilter(slashMatch[1].toLowerCase());
      setSlashSelectedIndex(0);
      setShowSlashPopover(true);
      setShowMentionPopover(false);
      return;
    } else {
      setShowSlashPopover(false);
    }

    const atMatch = val.match(/@([a-zA-Z0-9_./-]*)$/);
    if (atMatch) {
      setMentionFilter(atMatch[1].toLowerCase());
      setShowMentionPopover(true);
    } else {
      setShowMentionPopover(false);
    }
  };

  const selectSlashCommand = (cmd: SlashCommandItem) => {
    if (cmd.command === '/clear') {
      setInput('');
      setShowSlashPopover(false);
      onClearContext?.();
      return;
    }
    if (cmd.command === '/compact') {
      setInput('');
      setShowSlashPopover(false);
      onSend('/compact', undefined, selectedTier, thinkingBudget);
      return;
    }
    if (cmd.command === '/boost') {
      setThinkingBudget('deep');
    }
    setInput(`${cmd.command} `);
    setShowSlashPopover(false);
    textareaRef.current?.focus();
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
    const trimmed = input.trim();
    if (!trimmed && images.length === 0) return;

    if (trimmed.toLowerCase() === '/clear') {
      setInput('');
      setImages([]);
      setShowSlashPopover(false);
      onClearContext?.();
      return;
    }

    if (isGenerating) {
      if (onQueue) {
        onQueue(trimmed, images.length > 0 ? images : undefined);
        setInput('');
        setImages([]);
      }
      return;
    }

    const effectiveBudget: ThinkingBudget = trimmed.toLowerCase().startsWith('/boost')
      ? 'deep'
      : thinkingBudget;

    onSend(trimmed, images.length > 0 ? images : undefined, selectedTier, effectiveBudget);
    setInput('');
    setImages([]);
    setShowMentionPopover(false);
    setShowSlashPopover(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashPopover && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashSelectedIndex((prev) => (prev + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashSelectedIndex(
          (prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
        );
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const chosen = filteredSlashCommands[slashSelectedIndex] || filteredSlashCommands[0];
        if (chosen) {
          selectSlashCommand(chosen);
        }
        return;
      }
    }

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
      setShowSlashPopover(false);
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

  const activeSlashCmd = ANTIGRAVITY_SLASH_COMMANDS.find(
    (c) =>
      input.toLowerCase().startsWith(c.command + ' ') ||
      input.trim().toLowerCase() === c.command
  );

  const hasContent = Boolean(input.trim() || images.length > 0);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      className={`relative px-3.5 pt-3 pb-2.5 bg-[#1E1F22] border rounded-2xl shadow-lg space-y-2 shrink-0 transition-colors ${
        isDraggingOver
          ? 'border-[#8AB4F8] bg-[#8AB4F8]/5'
          : 'border-[#34363A] focus-within:border-[#4E5157]'
      }`}
    >
      {/* Antigravity `/` Slash Commands Popover */}
      {showSlashPopover && filteredSlashCommands.length > 0 && (
        <div className="absolute bottom-full left-3 mb-2 w-80 sm:w-96 max-h-72 overflow-y-auto bg-[#1B1B1E] border border-[#2E2E34] rounded-xl shadow-2xl p-1.5 z-50 space-y-0.5 select-none">
          <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-[#6E6E73] px-2.5 py-1">
            <span>Antigravity Slash Commands</span>
            <span className="font-mono text-[9px] text-[#55555A]">↑↓ Navigate • Tab/Enter</span>
          </div>
          {filteredSlashCommands.map((item, idx) => {
            const isSelected = idx === slashSelectedIndex;
            return (
              <button
                key={item.command}
                type="button"
                onClick={() => selectSlashCommand(item)}
                onMouseEnter={() => setSlashSelectedIndex(idx)}
                className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                  isSelected ? 'bg-[#28282E] text-[#E3E3E3]' : 'text-[#A0A0A6] hover:bg-[#232328]'
                }`}
              >
                <div className="mt-0.5">{item.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[13px] font-semibold text-[#E3E3E3]">
                        {item.command}
                      </span>
                      <span className="text-[13px] text-[#9A9A9E]">{item.title}</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded bg-[#141417] border border-[#2C2C32] text-[10px] font-mono text-[#8E8E93] shrink-0">
                      {item.badge}
                    </span>
                  </div>
                  <div className="text-[12px] text-[#6E6E73] leading-snug mt-0.5 truncate">
                    {item.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

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

      {/* Active Slash Command Indicator Pill */}
      {activeSlashCmd && (
        <div className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-[#151518] border border-[#2A2A30] text-xs select-none">
          <div className="flex items-center gap-1.5 min-w-0">
            {activeSlashCmd.icon}
            <span className="font-mono font-semibold text-[#E3E3E3]">
              {activeSlashCmd.command}
            </span>
            <span className="text-[#6E6E73]">•</span>
            <span className="text-[11px] text-[#9A9A9E] truncate">{activeSlashCmd.title}</span>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 shrink-0 ml-2">
            {activeSlashCmd.badge}
          </span>
        </div>
      )}

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
        className="auto-fit-textarea bg-transparent resize-none outline-none text-[15.5px] sm:text-[16.5px] text-[#E8EAED] placeholder:text-[#80868B] font-sans leading-relaxed"
      />

      {/* Bottom Toolbar inside Composer (Antigravity 2.0 layout) */}
      <div className="flex items-center justify-between pt-1 gap-2 select-none">
        {/* Left side: + button, / Slash button, Model Dropdown, Thinking Budget Dropdown */}
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
              setShowSlashPopover(false);
              textareaRef.current?.focus();
            }}
            className="p-1.5 rounded-md text-[#9AA0A6] hover:text-[#E8EAED] hover:bg-[#282A2E] transition-colors"
            title="Add context (@file / @mcp)"
          >
            <Plus className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              setInput('/');
              setSlashFilter('');
              setSlashSelectedIndex(0);
              setShowSlashPopover(!showSlashPopover);
              setShowMentionPopover(false);
              textareaRef.current?.focus();
            }}
            className="hidden sm:inline-flex p-1.5 rounded-md text-[#9AA0A6] hover:text-[#E8EAED] hover:bg-[#282A2E] transition-colors"
            title="Slash Commands (/goal, /plan, /boost, /teamwork...)"
          >
            <Slash className="w-3.5 h-3.5" />
          </button>

          {/* Model Tier Pill (Antigravity Style) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowModelMenu(!showModelMenu);
                setShowBudgetMenu(false);
              }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-[#E8EAED] bg-[#222327] border border-[#34363B] hover:bg-[#2A2B30] hover:border-[#42444A] transition-all"
            >
              <span className="truncate max-w-[150px] sm:max-w-[180px]">{TIER_LABELS[selectedTier].name}</span>
              <ChevronDown className="w-3 h-3 text-[#9AA0A6]" />
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
          <div className="relative hidden sm:block">
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
            className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
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
            className="hidden sm:inline-flex p-1.5 rounded-md text-[#8E8E93] hover:text-[#E3E3E3] hover:bg-[#28282C] transition-colors"
            title="Attach Image or Screenshot"
          >
            <ImageIcon className="w-3.5 h-3.5" />
          </button>

          {isGenerating && !hasContent ? (
            <button
              type="button"
              onClick={onStop}
              className="w-8 h-8 rounded-full bg-[#DC2626] hover:bg-[#EF4444] text-white flex items-center justify-center transition-colors shadow-sm"
              title="Stop Generation"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!hasContent}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                hasContent
                  ? 'bg-white hover:bg-[#F1F3F4] text-[#101114] cursor-pointer shadow-md'
                  : 'bg-[#282A2E] text-[#5F6368] cursor-not-allowed border border-[#3C4044]'
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
