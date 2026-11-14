import React, { useState, useRef, useEffect } from 'react';
import {
  Image as ImageIcon,
  X,
  FileText,
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
  Eye,
  RefreshCw,
  Wrench,
  ShieldCheck,
  Network,
} from 'lucide-react';
import {
  useSessionStore,
  QueuedMessage,
  FileAttachmentItem,
  GOOGLE_MODEL_OPTIONS,
  getGoogleModelOption,
  isGoogleOrchestratorModel,
  GoogleModelId,
} from '../../store/useSessionStore';
import { useArtifactStore } from '../../store/useArtifactStore';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { ModelTier, ThinkingBudget, GoogleThinkingLevel } from '../../types/protocol';
import { MessageQueueList } from './MessageQueueList';

interface PromptBarProps {
  onSend: (
    text: string,
    images?: string[],
    tierOverride?: ModelTier,
    thinkingBudgetOverride?: ThinkingBudget,
    attachments?: FileAttachmentItem[]
  ) => void;
  onTierChange?: (tier: ModelTier) => void;
  onStop?: () => void;
  onQueue?: (text: string, images?: string[], attachments?: FileAttachmentItem[]) => void;
  onInterruptAndSend?: (item: QueuedMessage) => void;
  onClearContext?: () => void;
}

const TIER_LABELS: Record<ModelTier, { name: string; sub: string }> = {
  low: { name: 'Swift 1.5 Flash-Next', sub: 'Strata IQ2_XS + Vision • Active Model' },
  medium: { name: 'Swift 1.5 Flash-Next', sub: 'Strata IQ2_XS + Vision • Active Model' },
  high: { name: 'Swift 1.5 Flash-Next', sub: 'Strata IQ2_XS + Vision • Active Model' },
};

const BUDGET_LABELS: Record<ThinkingBudget, string> = {
  off: 'Think: Off',
  fast: 'Fast',
  deep: 'Deep',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
};

const GOOGLE_THINKING_LEVELS: Record<string, GoogleThinkingLevel[]> = {
  'gemini-4-hydrogen': ['low', 'medium', 'high', 'xhigh'],
  'gemini-4-argon': ['low', 'medium', 'high'],
  'gemini-4-carbon': ['low', 'medium', 'high'],
  'gemini-3.8-flash': ['low', 'medium', 'high'],
};

const GOOGLE_LEVEL_LABELS: Record<GoogleThinkingLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
};

function normalizeGoogleThinkingLevel(
  budget: ThinkingBudget,
  modelId: string
): GoogleThinkingLevel {
  const supported = GOOGLE_THINKING_LEVELS[modelId] || ['low', 'medium', 'high'];
  if (budget === 'xhigh') return supported.includes('xhigh') ? 'xhigh' : 'high';
  if (budget === 'high' || budget === 'deep') return 'high';
  if (budget === 'low' || budget === 'fast' || budget === 'off') return 'low';
  return 'medium';
}

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
    command: '/swarm',
    title: 'Multi-Agent Swarm Board',
    description: 'Coordinate parallel specialist agents on a shared @mention board with live feed & roster',
    badge: 'Swarm',
    icon: <Network className="w-3.5 h-3.5 text-violet-400 shrink-0" />,
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
    command: '/vision',
    title: 'Strata Multimodal Vision & Screen Check',
    description: 'Inspect live desktop screen or verify Qwen 3.8 Flash-Next Vision on Strata port 8080',
    badge: 'Vision',
    icon: <Eye className="w-3.5 h-3.5 text-indigo-400 shrink-0" />,
  },
  {
    command: '/restart',
    title: 'Self-Restart Central Brain',
    description: 'Signal Windows Taskbar Supervisor to gracefully restart the server & reload state',
    badge: 'Watchdog',
    icon: <RefreshCw className="w-3.5 h-3.5 text-emerald-400 shrink-0" />,
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
    isGenerating: isGeneratingLegacy,
    activeTurn,
    brainProvider,
    selectedGoogleModel,
    setBrainProviderState,
    apiBaseUrl,
  } = useSessionStore();
  // Stop button / queue mode follow the authoritative server turn state.
  const isGenerating = activeTurn ? activeTurn.isActive : isGeneratingLegacy;

  const { workspaceFiles } = useArtifactStore();
  const { mcpServers } = useTelemetryStore();

  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<FileAttachmentItem[]>([]);

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };
  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [showSlashPopover, setShowSlashPopover] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showBudgetMenu, setShowBudgetMenu] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

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

    const cursor = textareaRef.current?.selectionStart ?? val.length;
    const beforeCursor = val.slice(0, cursor);

    // Trigger `/` slash commands at start of prompt or mid-sentence after whitespace
    const slashMatch = beforeCursor.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (slashMatch) {
      setSlashFilter(slashMatch[1].toLowerCase());
      setSlashSelectedIndex(0);
      setShowSlashPopover(true);
      setShowMentionPopover(false);
      return;
    } else {
      setShowSlashPopover(false);
    }

    // Trigger `@` context mentions at start of prompt or mid-sentence after whitespace
    const atMatch = beforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_./-]*)$/);
    if (atMatch) {
      setMentionFilter(atMatch[1].toLowerCase());
      setMentionSelectedIndex(0);
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

    const cursor = textareaRef.current?.selectionStart ?? input.length;
    const beforeCursor = input.slice(0, cursor);
    const afterCursor = input.slice(cursor);
    const replacedBefore = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.test(beforeCursor)
      ? beforeCursor.replace(/\/([a-zA-Z0-9_-]*)$/, `${cmd.command} `)
      : `${beforeCursor}${beforeCursor && !/\s$/.test(beforeCursor) ? ' ' : ''}${cmd.command} `;
    const nextVal = `${replacedBefore}${afterCursor.replace(/^\s+/, '')}`;
    setInput(nextVal);
    setShowSlashPopover(false);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(replacedBefore.length, replacedBefore.length);
      }
    });
  };

  const insertMention = (token: string) => {
    const cursor = textareaRef.current?.selectionStart ?? input.length;
    const beforeCursor = input.slice(0, cursor);
    const afterCursor = input.slice(cursor);
    const replacedBefore = /(?:^|\s)@([a-zA-Z0-9_./-]*)$/.test(beforeCursor)
      ? beforeCursor.replace(/@([a-zA-Z0-9_./-]*)$/, `@${token} `)
      : `${beforeCursor}${beforeCursor && !/\s$/.test(beforeCursor) ? ' ' : ''}@${token} `;
    const nextVal = `${replacedBefore}${afterCursor.replace(/^\s+/, '')}`;
    setInput(nextVal);
    setShowMentionPopover(false);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(replacedBefore.length, replacedBefore.length);
      }
    });
  };

  const addFile = (file: File) => {
    const isImg = file.type.startsWith('image/');
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return;
      const item: FileAttachmentItem = {
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        sizeHuman: formatFileSize(file.size),
        base64DataUrl: dataUrl,
        isImage: isImg,
      };
      setAttachments((prev) => [...prev, item]);
      if (isImg) {
        setImages((prev) => [...prev, dataUrl]);
      }
    };
    reader.readAsDataURL(file);
  };

  const addFiles = (files: FileList | File[]) => {
    Array.from(files).forEach(addFile);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) addFile(file);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) addFiles(files);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(e.target.files);
      e.target.value = ''; // allow re-attaching the same file later
    }
  };

  const handleEditInInput = (text: string, imgs?: string[]) => {
    setInput(text);
    if (imgs && imgs.length > 0) setImages(imgs);
    textareaRef.current?.focus();
  };

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed && images.length === 0 && attachments.length === 0) return;

    if (trimmed.toLowerCase() === '/clear') {
      setInput('');
      setImages([]);
      setAttachments([]);
      setShowSlashPopover(false);
      onClearContext?.();
      return;
    }

    if (isGenerating) {
      if (onQueue) {
        onQueue(
          trimmed,
          images.length > 0 ? images : undefined,
          attachments.length > 0 ? attachments : undefined
        );
        setInput('');
        setImages([]);
        setAttachments([]);
      }
      return;
    }

    const effectiveBudget: ThinkingBudget = /(?:^|\s)\/boost(?=\s|$)/i.test(trimmed)
      ? 'deep'
      : thinkingBudget;

    onSend(
      trimmed,
      images.length > 0 ? images : undefined,
      selectedTier,
      effectiveBudget,
      attachments.length > 0 ? attachments : undefined
    );
    setInput('');
    setImages([]);
    setAttachments([]);
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

    const visibleMentions = mentionCandidates.slice(0, 10);
    if (showMentionPopover && visibleMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSelectedIndex((prev) => (prev + 1) % visibleMentions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelectedIndex(
          (prev) => (prev - 1 + visibleMentions.length) % visibleMentions.length
        );
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const chosen = visibleMentions[mentionSelectedIndex] || visibleMentions[0];
        if (chosen) {
          insertMention(chosen.label);
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

  const handleSelectGoogleModel = async (modelId: GoogleModelId) => {
    setBrainProviderState({ selectedGoogleModel: modelId });
    if (!isGoogleOrchestratorModel(modelId)) {
      setThinkingBudget(normalizeGoogleThinkingLevel(thinkingBudget, modelId));
    }
    setShowModelMenu(false);
    try {
      const res = await fetch(`${apiBaseUrl}/api/brain/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedGoogleModel: modelId }),
      });
      if (res.ok) {
        const data = await res.json();
        setBrainProviderState(data);
      }
    } catch {}
  };

  const mentionCandidates = [
    { type: 'rule' as const, label: 'rule:RULES.md' },
    { type: 'rule' as const, label: 'rule:ARCHITECTURE.md' },
    { type: 'rule' as const, label: 'rule:EXPERIENCE.md' },
    { type: 'skill' as const, label: 'skill:workspace_search' },
    { type: 'skill' as const, label: 'skill:git_workflow' },
    { type: 'skill' as const, label: 'skill:vision_grounding' },
    ...mcpServers.map((s) => ({ type: 'mcp' as const, label: `mcp:${s.name}` })),
    ...(workspaceFiles.length > 0
      ? workspaceFiles.slice(0, 25).map((f) => ({
          type: f.type === 'directory' ? ('folder' as const) : ('file' as const),
          label: f.path,
        }))
      : [
          { type: 'file' as const, label: 'README.md' },
          { type: 'file' as const, label: 'launch.mjs' },
          { type: 'file' as const, label: 'mcp_config.json' },
          { type: 'folder' as const, label: 'server/src' },
          { type: 'folder' as const, label: 'client/src' },
        ]),
  ].filter((c) => c.label.toLowerCase().includes(mentionFilter));

  const activeSlashCmd = ANTIGRAVITY_SLASH_COMMANDS.find((c) =>
    new RegExp(`(?:^|\\s)${c.command}(?=\\s|$)`, 'i').test(input)
  );

  const hasContent = Boolean(input.trim() || images.length > 0 || attachments.length > 0);

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
      {/* LocalGravity `/` Slash Commands Popover */}
      {showSlashPopover && filteredSlashCommands.length > 0 && (
        <div className="absolute bottom-full left-3 mb-2 w-80 sm:w-96 max-h-72 overflow-y-auto bg-[#1B1B1E] border border-[#2E2E34] rounded-xl shadow-2xl p-1.5 z-50 space-y-0.5 select-none">
          <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-[#6E6E73] px-2.5 py-1">
            <span>LocalGravity Slash Commands</span>
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
          {mentionCandidates.slice(0, 10).map((item, idx) => {
            const isSelected = idx === mentionSelectedIndex;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => insertMention(item.label)}
                onMouseEnter={() => setMentionSelectedIndex(idx)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono text-left transition-colors ${
                  isSelected
                    ? 'bg-[#28282C] text-[#E3E3E3]'
                    : 'text-[#C4C7C5] hover:bg-[#28282C]/60'
                }`}
              >
                {item.type === 'mcp' ? (
                  <Plug className="w-3.5 h-3.5 text-[#C084FC] shrink-0" />
                ) : item.type === 'rule' ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : item.type === 'skill' ? (
                  <Wrench className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                ) : item.type === 'folder' ? (
                  <Folder className="w-3.5 h-3.5 text-[#FBBF24] shrink-0" />
                ) : (
                  <FileCode2 className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
                )}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
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

      {/* Attached Files & Screenshots Tray */}
      {attachments.length > 0 && (
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
                    onClick={() => {
                      setAttachments(attachments.filter((_, i) => i !== idx));
                      setImages(images.filter((img) => img !== att.base64DataUrl));
                    }}
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
                    onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))}
                    className="absolute top-2 right-1.5 p-0.5 rounded-full bg-transparent hover:bg-[#3C4044] text-[#9AA0A6] hover:text-white transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
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

      {/* Bottom Toolbar inside Composer (LocalGravity layout) */}
      <div className="flex items-center justify-between pt-1 gap-2 select-none">
        {/* Left side: + button, / Slash button, Model Dropdown, Thinking Budget Dropdown */}
        <div className="flex items-center gap-1.5 min-w-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            multiple
            onChange={handleImageUpload}
            className="hidden"
          />

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowAttachMenu((v) => !v);
                setShowMentionPopover(false);
                setShowSlashPopover(false);
              }}
              className="p-1.5 rounded-md text-[#9AA0A6] hover:text-[#E8EAED] hover:bg-[#282A2E] transition-colors"
              title="Add photos, files, or context (@file / @mcp)"
            >
              <Plus className="w-4 h-4" />
            </button>

            {showAttachMenu && (
              <div className="absolute bottom-full left-0 mb-1.5 w-60 bg-[#1E1E20] border border-[#2E2E32] rounded-xl shadow-2xl p-1 z-50 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowAttachMenu(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs text-[#E3E3E3] hover:bg-[#282A2E] transition-colors"
                >
                  <ImageIcon className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Attach photos or files</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowAttachMenu(false);
                    setInput((prev) => (prev.endsWith('@') ? prev : `${prev}@`));
                    setMentionFilter('');
                    setShowMentionPopover(true);
                    setShowSlashPopover(false);
                    textareaRef.current?.focus();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs text-[#E3E3E3] hover:bg-[#282A2E] transition-colors"
                >
                  <FileCode2 className="w-4 h-4 text-violet-400 shrink-0" />
                  <span>Mention context (@file / @mcp)</span>
                </button>

                <p className="px-2.5 py-1 text-[10px] leading-snug text-[#6E6E73]">
                  Images go to vision; code &amp; text files are inlined into your prompt. Paste or drag-drop also works.
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              const nextOpen = !showSlashPopover;
              if (nextOpen && !/(?:^|\s)\/$/.test(input)) {
                setInput((prev) =>
                  prev.length === 0 || /\s$/.test(prev) ? `${prev}/` : `${prev} /`
                );
              }
              setSlashFilter('');
              setSlashSelectedIndex(0);
              setShowSlashPopover(nextOpen);
              setShowMentionPopover(false);
              textareaRef.current?.focus();
            }}
            className="inline-flex p-1.5 rounded-md text-[#9AA0A6] hover:text-[#E8EAED] hover:bg-[#282A2E] transition-colors shrink-0"
            title="Slash Commands (/goal, /plan, /boost, /teamwork, /swarm...)"
          >
            <Slash className="w-3.5 h-3.5" />
          </button>

          {/* Model Tier Pill (Strata vs Google AI Studio) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowModelMenu(!showModelMenu);
                setShowBudgetMenu(false);
              }}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full text-xs font-medium text-[#E8EAED] bg-[#222327] border border-[#34363B] hover:bg-[#2A2B30] hover:border-[#42444A] transition-all"
            >
              <span className="truncate max-w-[118px] sm:max-w-[180px]">
                {brainProvider === 'google_ai_studio'
                  ? getGoogleModelOption(selectedGoogleModel).name
                  : TIER_LABELS[selectedTier].name}
              </span>
              <ChevronDown className="w-3 h-3 text-[#9AA0A6]" />
            </button>

            {showModelMenu && (
              <div className="absolute bottom-full left-0 mb-1.5 w-72 bg-[#1E1E20] border border-[#2E2E32] rounded-xl shadow-2xl p-1 z-50 space-y-0.5">
                {brainProvider === 'google_ai_studio' ? (
                  GOOGLE_MODEL_OPTIONS.map((opt) => {
                    const isActive = selectedGoogleModel === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelectGoogleModel(opt.id)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                          isActive
                            ? 'bg-[#28282C] text-[#E3E3E3]'
                            : 'text-[#9A9A9E] hover:bg-[#242428] hover:text-[#E3E3E3]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-medium truncate">{opt.name}</div>
                          <div className="text-[10px] text-sky-400 font-mono truncate">{opt.sub}</div>
                        </div>
                        {isActive && <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                      </button>
                    );
                  })
                ) : (
                  (['high'] as ModelTier[]).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => handleSelectTier(tier)}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors bg-[#28282C] text-[#E3E3E3]"
                    >
                      <div>
                        <div className="font-medium">{TIER_LABELS[tier].name}</div>
                        <div className="text-[10px] text-emerald-400 font-mono">{TIER_LABELS[tier].sub}</div>
                      </div>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Thinking Effort Dropdown (hidden for Google Orchestrators; always shown with valid levels for others) */}
          {!(brainProvider === 'google_ai_studio' && isGoogleOrchestratorModel(selectedGoogleModel)) && (() => {
            const isGoogle = brainProvider === 'google_ai_studio';
            const googleLevels =
              GOOGLE_THINKING_LEVELS[selectedGoogleModel] || ['low', 'medium', 'high'];
            const activeGoogleLevel = isGoogle
              ? normalizeGoogleThinkingLevel(thinkingBudget, selectedGoogleModel)
              : null;
            const buttonLabel = isGoogle && activeGoogleLevel
              ? GOOGLE_LEVEL_LABELS[activeGoogleLevel]
              : BUDGET_LABELS[thinkingBudget] || 'Fast';

            return (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowBudgetMenu(!showBudgetMenu);
                    setShowModelMenu(false);
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[#9AA0A6] hover:text-[#E3E3E3] hover:bg-[#28282C] transition-colors"
                  title={isGoogle ? 'Thinking Level' : 'Thinking Effort'}
                >
                  <span>{buttonLabel}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>

                {showBudgetMenu && (
                  <div className="absolute bottom-full right-0 sm:right-auto sm:left-0 mb-1.5 w-40 bg-[#1E1E20] border border-[#2E2E32] rounded-xl shadow-2xl p-1 z-50 space-y-0.5">
                    {isGoogle
                      ? googleLevels.map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => {
                              setThinkingBudget(lvl);
                              setShowBudgetMenu(false);
                            }}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                              activeGoogleLevel === lvl
                                ? 'bg-[#28282C] text-[#E3E3E3]'
                                : 'text-[#9A9A9E] hover:bg-[#242428] hover:text-[#E3E3E3]'
                            }`}
                          >
                            <span>{GOOGLE_LEVEL_LABELS[lvl]}</span>
                            {activeGoogleLevel === lvl && (
                              <Check className="w-3.5 h-3.5 text-[#E3E3E3]" />
                            )}
                          </button>
                        ))
                      : (['off', 'fast', 'deep'] as ThinkingBudget[]).map((b) => (
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
                            <span className="capitalize">
                              {b === 'off' ? 'Off' : `${b} Thinking`}
                            </span>
                            {thinkingBudget === b && (
                              <Check className="w-3.5 h-3.5 text-[#E3E3E3]" />
                            )}
                          </button>
                        ))}
                  </div>
                )}
              </div>
            );
          })()}
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

          {isGenerating && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onStop?.();
              }}
              className="w-8 h-8 rounded-full bg-[#DC2626] hover:bg-[#EF4444] active:bg-[#B91C1C] text-white flex items-center justify-center transition-colors shadow-md cursor-pointer select-none animate-pulse"
              title="Stop Generation Immediately"
              aria-label="Stop Generation"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          )}
          {(!isGenerating || hasContent) && (
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
