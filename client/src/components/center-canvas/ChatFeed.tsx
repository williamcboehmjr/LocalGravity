import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Terminal,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Globe,
  Loader2,
  FileCode2,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  FolderOpen,
  Layers,
  Copy,
  Check,
  RotateCcw,
  Eye,
  Target,
  Map,
  Cpu,
} from 'lucide-react';
import { useSessionStore, ToolCallItemData } from '../../store/useSessionStore';
import { useArtifactStore } from '../../store/useArtifactStore';
import { ThoughtAccordion } from './ThoughtAccordion';

function shortenPath(rawPath: string): string {
  if (!rawPath) return '.';
  const normalized = rawPath.replace(/\\/g, '/');
  const markers = ['/LocalGravity/', '/scratch/'];
  for (const m of markers) {
    const idx = normalized.indexOf(m);
    if (idx !== -1) {
      const rel = normalized.slice(idx + m.length);
      return rel || '.';
    }
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length > 3) {
    return parts.slice(-3).join('/');
  }
  return normalized;
}

function formatCompactToolLabel(item: ToolCallItemData): {
  prefix: string;
  target: string;
  isRead: boolean;
  isEdit: boolean;
  isDir: boolean;
  isSearch: boolean;
} {
  const rawCmd = item.command || '';
  const match = rawCmd.match(/^([a-zA-Z0-9_:-]+)\(([\s\S]*)\)$/);
  const toolName = (item.toolName || (match ? match[1] : '')).toLowerCase();
  let args: any = null;
  if (match && match[2]) {
    try {
      args = JSON.parse(match[2]);
    } catch {}
  } else if (item.argumentsJson) {
    try {
      args = JSON.parse(item.argumentsJson);
    } catch {}
  }

  if (toolName === 'read_file' || rawCmd.toLowerCase().startsWith('read_file')) {
    const p = args?.path ? shortenPath(String(args.path)) : rawCmd.replace(/^read_file\s*/i, '');
    const range =
      args?.start_line || args?.end_line
        ? ` (L${args.start_line || 1}–${args.end_line || 'end'})`
        : '';
    return {
      prefix: 'Analyzed',
      target: `${p}${range}`,
      isRead: true,
      isEdit: false,
      isDir: false,
      isSearch: false,
    };
  }

  if (
    toolName === 'write_file' ||
    toolName === 'apply_diff' ||
    rawCmd.toLowerCase().startsWith('write_file') ||
    rawCmd.toLowerCase().startsWith('apply_diff')
  ) {
    const p = args?.path ? shortenPath(String(args.path)) : rawCmd;
    return {
      prefix: 'Edited',
      target: p,
      isRead: false,
      isEdit: true,
      isDir: false,
      isSearch: false,
    };
  }

  if (toolName === 'list_directory' || rawCmd.toLowerCase().startsWith('list_directory')) {
    const p = args?.path ? shortenPath(String(args.path)) : '.';
    return {
      prefix: 'Listed',
      target: p,
      isRead: false,
      isEdit: false,
      isDir: true,
      isSearch: false,
    };
  }

  if (toolName === 'search_web' || rawCmd.toLowerCase().startsWith('search_web')) {
    const q = args?.query ? String(args.query) : rawCmd;
    return {
      prefix: 'Searched web',
      target: q.length > 55 ? q.slice(0, 55) + '…' : q,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (
    toolName === 'search_models' ||
    rawCmd.toLowerCase().startsWith('search_models')
  ) {
    const q = args?.repo || args?.query ? String(args.repo || args.query) : rawCmd;
    return {
      prefix: 'Searched models',
      target: q.length > 55 ? q.slice(0, 55) + '…' : q,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'find_files' || rawCmd.toLowerCase().startsWith('find_files')) {
    const p = args?.pattern ? String(args.pattern) : rawCmd;
    return {
      prefix: 'Located files',
      target: p,
      isRead: false,
      isEdit: false,
      isDir: true,
      isSearch: true,
    };
  }

  if (toolName === 'search_codebase' || rawCmd.toLowerCase().startsWith('search_codebase')) {
    const q = args?.query ? `"${String(args.query)}"` : rawCmd;
    return {
      prefix: 'Searched',
      target: q.length > 55 ? q.slice(0, 55) + '…' : q,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'code_outline' || rawCmd.toLowerCase().startsWith('code_outline')) {
    const p = args?.path ? shortenPath(String(args.path)) : rawCmd;
    return {
      prefix: 'Outlined',
      target: p,
      isRead: true,
      isEdit: false,
      isDir: false,
      isSearch: false,
    };
  }

  if (toolName === 'patch_json' || rawCmd.toLowerCase().startsWith('patch_json')) {
    const p = args?.path ? shortenPath(String(args.path)) : rawCmd;
    const act = args?.action ? String(args.action) : 'update';
    const kp = args?.key_path ? `: ${args.key_path}` : '';
    return {
      prefix: act === 'read' ? 'Inspected config' : 'Configured',
      target: `${p}${kp}`,
      isRead: act === 'read',
      isEdit: act !== 'read',
      isDir: false,
      isSearch: false,
    };
  }

  if (toolName === 'download_file' || rawCmd.toLowerCase().startsWith('download_file')) {
    const fn = args?.filename || (args?.url ? String(args.url).split('/').pop() : 'file');
    return {
      prefix: 'Downloaded',
      target: String(fn).slice(0, 50),
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'http_request' || rawCmd.toLowerCase().startsWith('http_request')) {
    const m = args?.method || 'GET';
    const u = args?.url ? String(args.url) : rawCmd;
    return {
      prefix: `HTTP ${m}`,
      target: u.length > 55 ? u.slice(0, 55) + '…' : u,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'manage_files' || rawCmd.toLowerCase().startsWith('manage_files')) {
    const act = args?.action || 'File op';
    const s = args?.source ? shortenPath(String(args.source)) : '';
    return {
      prefix: act.charAt(0).toUpperCase() + act.slice(1),
      target: s,
      isRead: act === 'stat',
      isEdit: act === 'delete',
      isDir: true,
      isSearch: false,
    };
  }

  if (toolName === 'inspect_system' || rawCmd.toLowerCase().startsWith('inspect_system')) {
    const act = args?.action || 'hardware';
    const label = act === 'gpu_stats' ? 'Nvidia GPU & VRAM' : act === 'list_ports' ? 'Active Listeners' : `Process: ${args?.filter || 'all'}`;
    return {
      prefix: 'Telemetry',
      target: label,
      isRead: true,
      isEdit: false,
      isDir: false,
      isSearch: false,
    };
  }

  if (toolName === 'capture_screen' || toolName === 'inspect_window') {
    return {
      prefix: 'Captured',
      target: 'Workstation Screen Display',
      isRead: true,
      isEdit: false,
      isDir: false,
      isSearch: false,
    };
  }

  if (
    toolName === 'browse_url' ||
    toolName === 'browser_inspect' ||
    rawCmd.toLowerCase().startsWith('browse_url') ||
    rawCmd.toLowerCase().startsWith('browser_inspect')
  ) {
    const u = args?.url ? String(args.url) : rawCmd;
    return {
      prefix: 'Inspected',
      target: u,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'inspect_models' || rawCmd.toLowerCase().startsWith('inspect_models')) {
    const act = args?.action ? String(args.action) : 'inspect';
    return {
      prefix: act === 'test_vision' ? 'Tested Vision' : act === 'restart' ? 'Restarted Engine' : 'Inspected Engine',
      target: 'Strata • Qwen 3.8 Flash-Next (Port 8080)',
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'capture_screen' || rawCmd.toLowerCase().startsWith('capture_screen')) {
    return {
      prefix: 'Captured',
      target: 'Windows Desktop Screenshot',
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'find_files' || rawCmd.toLowerCase().startsWith('find_files')) {
    return {
      prefix: 'Found Files',
      target: String(args?.pattern || '*'),
      isRead: false,
      isEdit: false,
      isDir: true,
      isSearch: true,
    };
  }

  if (toolName === 'search_symbols' || rawCmd.toLowerCase().startsWith('search_symbols')) {
    return {
      prefix: 'Searched Symbols',
      target: shortenPath(String(args?.path || '.')),
      isRead: true,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'run_terminal' || rawCmd.toLowerCase().startsWith('run_terminal')) {
    const cmdStr = args?.command
      ? String(args.command).replace(/\s+/g, ' ').trim()
      : rawCmd.replace(/^run_terminal\s*/i, '');
    return {
      prefix: item.status === 'running' ? 'Running' : 'Ran',
      target: cmdStr.length > 70 ? cmdStr.slice(0, 70) + '…' : cmdStr,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: false,
    };
  }

  const cleanCmd = rawCmd.replace(/\s+/g, ' ').trim();
  return {
    prefix: item.status === 'running' ? 'Running' : 'Ran',
    target: cleanCmd.length > 70 ? cleanCmd.slice(0, 70) + '…' : cleanCmd,
    isRead: false,
    isEdit: false,
    isDir: false,
    isSearch: false,
  };
}

function parseMessageContent(
  rawContent: string,
  existingThought?: string,
  existingStepNotes?: string[],
  hasTools?: boolean
) {
  let thought = existingThought || '';
  let content = rawContent || '';

  const thoughtMatch = content.match(/<(thought|think)>([\s\S]*?)<\/(thought|think)>/i);
  if (thoughtMatch) {
    if (!thought) {
      thought = thoughtMatch[2].trim();
    }
    content = content.replace(thoughtMatch[0], '').trim();
  }

  const openMatch = content.match(/<(thought|think)>([\s\S]*)/i);
  if (openMatch) {
    if (!thought) {
      thought = openMatch[2].trim();
    }
    content = content.replace(openMatch[0], '').trim();
  }

  // Strip raw <tool_call> tags (both closed and open streaming)
  content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
  content = content.replace(/<tool_call>[\s\S]*/gi, '').trim();

  // Separate transitional step chatter lines when tools are present so the main message stays clean
  const stepNotes: string[] = [...(existingStepNotes || [])];
  if (hasTools && content) {
    const lines = content.split(/\r?\n/);
    const remainingLines: string[] = [];
    let stillInLeadingChatter = true;

    const chatterRegex =
      /^(let me\s+|now let me\s+|now i\s+|i will\s+|i'll\s+|first,\s+|next,\s+|checking\s+|running\s+|looking at\s+|analyzing\s+|reading\s+|i need to\s+|we need to\s+|the file is large|the tool output|the read_file tool|the read tool|both tools truncate|small chunks work|the \$ is being)/i;

    for (let i = 0; i < lines.length; i++) {
      const trimmedLine = lines[i].trim();
      if (!trimmedLine) {
        if (!stillInLeadingChatter) remainingLines.push(lines[i]);
        continue;
      }
      if (
        stillInLeadingChatter &&
        trimmedLine.length < 240 &&
        !trimmedLine.startsWith('#') &&
        !trimmedLine.startsWith('-') &&
        !trimmedLine.startsWith('*') &&
        !trimmedLine.startsWith('1.') &&
        chatterRegex.test(trimmedLine)
      ) {
        if (!stepNotes.includes(trimmedLine)) {
          stepNotes.push(trimmedLine);
        }
      } else {
        stillInLeadingChatter = false;
        remainingLines.push(lines[i]);
      }
    }

    content = remainingLines.join('\n').trim();
  }

  return { thought, content, stepNotes };
}

const ToolExecutionRow: React.FC<{
  item: ToolCallItemData;
  onOpenInWorkbench: (item: ToolCallItemData) => void;
}> = ({ item, onOpenInWorkbench }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { prefix, target, isRead, isEdit, isDir, isSearch } = formatCompactToolLabel(item);

  return (
    <div className="py-0.5 select-none">
      <div className="flex items-center justify-between gap-2.5 text-[13px] sm:text-[13.5px] text-[#A0A0A5] hover:text-[#E8EAED] transition-colors px-2 py-1 rounded-lg hover:bg-[#1F2023] max-w-full">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-2 text-left cursor-pointer focus:outline-none min-w-0 flex-1"
        >
          {item.status === 'running' ? (
            <Loader2 className="w-3.5 h-3.5 text-[#8AB4F8] animate-spin shrink-0" />
          ) : item.status === 'error' ? (
            <AlertCircle className="w-3.5 h-3.5 text-[#F28B82] shrink-0" />
          ) : isRead || isEdit ? (
            <FileCode2 className="w-3.5 h-3.5 text-[#8AB4F8] shrink-0" />
          ) : isDir ? (
            <FolderOpen className="w-3.5 h-3.5 text-[#FDD663] shrink-0" />
          ) : isSearch ? (
            <Globe className="w-3.5 h-3.5 text-[#81C995] shrink-0" />
          ) : (
            <Terminal className="w-3.5 h-3.5 text-[#C58AF9] shrink-0" />
          )}

          <span className="text-[#9AA0A6] font-medium shrink-0">{prefix}</span>

          <span className="font-mono text-[12.5px] sm:text-[13px] text-[#E8EAED] truncate">
            {target}
          </span>

          {item.durationMs !== undefined && item.status !== 'running' && (
            <span className="text-[11.5px] text-[#5F6368] shrink-0 ml-auto pl-2 font-mono">
              {item.durationMs < 1000
                ? `${item.durationMs}ms`
                : `${(item.durationMs / 1000).toFixed(1)}s`}
            </span>
          )}

          {item.output &&
            (isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#70757A] shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#70757A] shrink-0" />
            ))}
        </button>

        <button
          type="button"
          onClick={() => onOpenInWorkbench(item)}
          className="opacity-70 hover:opacity-100 text-[11px] text-[#8E8E93] hover:text-[#8AB4F8] flex items-center gap-1 transition-opacity shrink-0 px-1 py-0.5 rounded hover:bg-[#282A2E]"
          title="Open in Right Workbench"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {isOpen && item.output && (
        <div className="mt-1 ml-5 pl-3 border-l border-[#2D2F34] font-mono text-[12px] sm:text-[12.5px] text-[#BDC1C6] overflow-x-auto bg-[#101113] p-3 rounded-lg border border-[#242528] max-h-56 select-text leading-relaxed">
          <pre className="whitespace-pre-wrap">{item.output}</pre>
        </div>
      )}
    </div>
  );
};

/**
 * Antigravity-Style Activity Status Bar:
 * - Stays collapsed by default into a sleek, 1-line status banner while working.
 * - Stays collapsed once completed into a clean summary badge.
 * - Expands on demand if the user clicks it.
 */
const AgentActivityBox: React.FC<{
  toolCalls: ToolCallItemData[];
  stepNotes: string[];
  isCurrentlyGenerating: boolean;
  onOpenInWorkbench: (item: ToolCallItemData) => void;
}> = ({ toolCalls, stepNotes, isCurrentlyGenerating, onOpenInWorkbench }) => {
  // Stay collapsed by default to keep the interface minimalist and clean
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const listScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the list if the user has it open
  useEffect(() => {
    if (isExpanded && listScrollRef.current) {
      listScrollRef.current.scrollTop = listScrollRef.current.scrollHeight;
    }
  }, [toolCalls.length, stepNotes.length, isExpanded]);

  const totalActions = toolCalls.length;
  if (totalActions === 0 && stepNotes.length === 0) return null;

  const runningTool = toolCalls.find((t) => t.status === 'running');
  const lastTool = toolCalls[toolCalls.length - 1];
  const lastNote = stepNotes[stepNotes.length - 1];

  const readCount = toolCalls.filter((t) =>
    (t.toolName || t.command).toLowerCase().includes('read_file')
  ).length;
  const dirCount = toolCalls.filter((t) =>
    (t.toolName || t.command).toLowerCase().includes('list_directory')
  ).length;
  const editCount = toolCalls.filter((t) => {
    const c = (t.toolName || t.command).toLowerCase();
    return c.includes('write_file') || c.includes('apply_diff');
  }).length;
  const cmdCount = Math.max(0, totalActions - readCount - dirCount - editCount);

  const summaryParts: string[] = [];
  if (readCount > 0) summaryParts.push(`${readCount} file${readCount > 1 ? 's' : ''} analyzed`);
  if (dirCount > 0) summaryParts.push(`${dirCount} dir${dirCount > 1 ? 's' : ''} listed`);
  if (editCount > 0) summaryParts.push(`${editCount} edit${editCount > 1 ? 's' : ''}`);
  if (cmdCount > 0) summaryParts.push(`${cmdCount} cmd${cmdCount > 1 ? 's' : ''} run`);

  const activeHeadline = runningTool
    ? (() => {
        const { prefix, target } = formatCompactToolLabel(runningTool);
        return `${prefix} ${target}`;
      })()
    : lastTool
    ? (() => {
        const { prefix, target } = formatCompactToolLabel(lastTool);
        return `${prefix} ${target}`;
      })()
    : lastNote || 'Executing actions...';

  return (
    <div className="my-2 rounded-xl border border-[#26282C] bg-[#141518] overflow-hidden shadow-sm transition-all">
      {/* Header Bar (Click to Expand / Collapse on Demand) */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2 text-xs text-left hover:bg-[#1C1D21] transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {isCurrentlyGenerating ? (
            <Loader2 className="w-4 h-4 text-[#8AB4F8] animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}

          {isCurrentlyGenerating ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-semibold text-[13.5px] text-[#E8EAED] shrink-0">Working</span>
              <span className="text-[#5F6368] shrink-0">•</span>
              <span className="font-mono text-[13px] text-[#BDC1C6] truncate">
                {activeHeadline}
              </span>
              {totalActions > 1 && (
                <span className="text-[12px] text-[#70757A] shrink-0 font-sans hidden sm:inline">
                  ({totalActions} actions)
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-medium text-[13.5px] text-[#BDC1C6] shrink-0">
                Completed {totalActions} action{totalActions === 1 ? '' : 's'}
              </span>
              {summaryParts.length > 0 && (
                <span className="text-[12px] text-[#70757A] truncate hidden sm:inline">
                  ({summaryParts.join(', ')})
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {stepNotes.length > 0 && (
            <span className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1F2023] text-[11px] text-[#9AA0A6]">
              <Layers className="w-3 h-3" />
              {stepNotes.length} note{stepNotes.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="text-[12px] text-[#8AB4F8] hover:text-[#AECBFA] font-medium flex items-center gap-0.5">
            {isExpanded ? (
              <>
                <span>Hide</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <span>{isCurrentlyGenerating ? 'View live' : 'Details'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </>
            )}
          </span>
        </div>
      </button>

      {/* Expanded Activity Stream Window (On demand only) */}
      {isExpanded && (
        <div
          ref={listScrollRef}
          className="px-3 pb-2.5 pt-1.5 border-t border-[#222327] max-h-56 overflow-y-auto space-y-1 bg-[#101113]"
        >
          {toolCalls.map((tc) => (
            <ToolExecutionRow
              key={tc.id}
              item={tc}
              onOpenInWorkbench={onOpenInWorkbench}
            />
          ))}

          {stepNotes.length > 0 && (
            <div className="pt-1.5 mt-1.5 border-t border-[#1F2023] space-y-1">
              {stepNotes.map((note, idx) => (
                <div
                  key={idx}
                  className="text-[12.5px] sm:text-[13px] text-[#8E8E93] px-2 py-0.5 flex items-start gap-2 leading-relaxed"
                >
                  <span className="text-[#55555A] shrink-0 mt-0.5">↳</span>
                  <span>{note}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const CodeBlockWithCopy: React.FC<{ language: string; codeText: string; className?: string }> = ({
  language,
  codeText,
  className,
}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(codeText.replace(/\n$/, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="my-4 rounded-xl overflow-hidden border border-[#2D2F34] bg-[#141518]">
      <div className="px-4 py-1.5 bg-[#1C1D20] border-b border-[#2D2F34] text-[12px] font-mono text-[#9AA0A6] flex items-center justify-between select-none">
        <span className="uppercase tracking-wider text-[11px] text-[#8AB4F8]">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#282A2E] text-[#9AA0A6] hover:text-[#E8EAED] transition-colors cursor-pointer text-[11px] font-sans"
          title="Copy code block"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 text-[14.5px] sm:text-[15px] font-mono overflow-x-auto text-[#E8EAED] leading-relaxed">
        <code className={className}>{codeText}</code>
      </pre>
    </div>
  );
};

interface ChatFeedProps {
  onQuickSend?: (prompt: string) => void;
}

export const ChatFeed: React.FC<ChatFeedProps> = ({ onQuickSend }) => {
  const {
    messages,
    currentStreamingThought,
    currentThoughtElapsedMs,
    currentThoughtTokens,
    isThinkingFinished,
    isGenerating,
  } = useSessionStore();
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const { setActiveTab } = useArtifactStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, currentStreamingThought, isGenerating]);

  const handleOpenInWorkbench = (tc: ToolCallItemData) => {
    const cmd = tc.command.toLowerCase();
    if (cmd.includes('write_file') || cmd.includes('apply_diff') || cmd.includes('read_file')) {
      setActiveTab('editor');
    } else if (cmd.includes('capture_screen') || cmd.includes('inspect')) {
      setActiveTab('preview');
    } else {
      setActiveTab('terminal');
    }
  };

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6 bg-[#0c0d0e]"
    >
      <div className="max-w-3xl mx-auto space-y-6 px-1 sm:px-4">
        {messages.length === 0 && (
          <div className="min-h-[55vh] flex flex-col items-center justify-center text-center p-6 space-y-5 select-none">
            <div className="w-12 h-12 rounded-2xl bg-[#1A1B1E] border border-[#2D2F34] flex items-center justify-center text-[#9AA0A6] shadow-md">
              <Sparkles className="w-6 h-6 text-[#8AB4F8]" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-[19px] font-medium text-[#E8EAED] tracking-tight">
                What would you like to build?
              </h2>
              <p className="text-[14px] text-[#80868B] max-w-md leading-relaxed">
                Powered by <strong className="text-[#E8EAED]">Strata • Qwen 3.8 Flash-Next</strong> (IQ3_S + Vision • 64k). Reference context with <code className="text-[#8AB4F8]">@</code> or trigger workflows with <code className="text-[#8AB4F8]">/</code>.
              </p>
            </div>

            {onQuickSend && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg pt-2 text-left">
                <button
                  type="button"
                  onClick={() => onQuickSend('/plan Design an architectural implementation plan for our next feature')}
                  className="p-3 rounded-xl bg-[#17181B] hover:bg-[#1F2024] border border-[#282A2F] hover:border-[#3A3D45] transition-all cursor-pointer group space-y-1"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-[#E8EAED] group-hover:text-[#8AB4F8]">
                    <Map className="w-3.5 h-3.5 text-[#60A5FA]" />
                    <span>/plan Architecture & Specs</span>
                  </div>
                  <p className="text-[11px] text-[#6E6E73] leading-snug">
                    Inspect codebase and generate a step-by-step plan in the Plan Workbench
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onQuickSend('/goal Audit the workspace, fix any issues, and verify the build end-to-end')}
                  className="p-3 rounded-xl bg-[#17181B] hover:bg-[#1F2024] border border-[#282A2F] hover:border-[#3A3D45] transition-all cursor-pointer group space-y-1"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-[#E8EAED] group-hover:text-emerald-400">
                    <Target className="w-3.5 h-3.5 text-emerald-400" />
                    <span>/goal Autonomous Execution</span>
                  </div>
                  <p className="text-[11px] text-[#6E6E73] leading-snug">
                    Multi-step autonomous execution with self-catching verification
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onQuickSend('/vision Run inspect_models with test_vision and verify Strata Qwen 3.8 Flash-Next vision status')}
                  className="p-3 rounded-xl bg-[#17181B] hover:bg-[#1F2024] border border-[#282A2F] hover:border-[#3A3D45] transition-all cursor-pointer group space-y-1"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-[#E8EAED] group-hover:text-indigo-400">
                    <Eye className="w-3.5 h-3.5 text-indigo-400" />
                    <span>/vision Test Strata Vision</span>
                  </div>
                  <p className="text-[11px] text-[#6E6E73] leading-snug">
                    Verify live multimodal vision on Strata port 8080 with Qwen 3.8 Flash-Next
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => onQuickSend('/boost Perform a deep architectural & performance check of the current system and GPU state')}
                  className="p-3 rounded-xl bg-[#17181B] hover:bg-[#1F2024] border border-[#282A2F] hover:border-[#3A3D45] transition-all cursor-pointer group space-y-1"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-[#E8EAED] group-hover:text-[#C084FC]">
                    <Cpu className="w-3.5 h-3.5 text-[#C084FC]" />
                    <span>/boost Deep System Audit</span>
                  </div>
                  <p className="text-[11px] text-[#6E6E73] leading-snug">
                    Engage Deep Thinking mode to inspect hardware, VRAM, and code quality
                  </p>
                </button>
              </div>
            )}
          </div>
        )}

        {messages.map((msg, index) => {
          const isLast = index === messages.length - 1;
          const isCurrentlyGenerating = isLast && isGenerating && msg.role === 'assistant';
          const hasTools = Boolean(msg.toolCalls && msg.toolCalls.length > 0);

          const {
            thought: parsedThought,
            content,
            stepNotes,
          } = parseMessageContent(msg.content, msg.thought, msg.stepNotes, hasTools);

          const activeThought = isCurrentlyGenerating
            ? currentStreamingThought || parsedThought
            : msg.thought || parsedThought;
          const activeElapsedMs = isCurrentlyGenerating
            ? currentThoughtElapsedMs
            : msg.thoughtElapsedMs;
          const activeTokens = isCurrentlyGenerating
            ? currentThoughtTokens
            : msg.thoughtTokenCount;
          const isStreaming = isCurrentlyGenerating && !isThinkingFinished;

          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="w-full">
                <div className="w-full bg-[#1C1D20] border border-[#2B2C30] rounded-2xl px-5 py-4 text-[16px] sm:text-[17px] text-[#E8EAED] space-y-2.5 shadow-sm">
                  {/* File & Image Attachments */}
                  {((msg.images && msg.images.length > 0) || (msg.attachments && msg.attachments.length > 0)) && (
                    <div className="flex flex-wrap items-center gap-2.5 overflow-x-auto pb-1">
                      {/* Render images */}
                      {msg.attachments
                        ? msg.attachments
                            .filter((a) => a.isImage || (a.type && a.type.startsWith('image/')) || (a.savedPath && /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(a.savedPath)))
                            .map((att, i) => (
                              <img
                                key={i}
                                src={att.url || att.base64DataUrl}
                                alt={att.name || 'image'}
                                className="w-24 h-24 object-cover rounded-xl border border-[#2D2F34] shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => att.url && window.open(att.url, '_blank')}
                              />
                            ))
                        : msg.images?.map((img, i) => (
                            <img
                              key={i}
                              src={img}
                              alt="attachment"
                              className="w-24 h-24 object-cover rounded-xl border border-[#2D2F34]"
                            />
                          ))}

                      {/* Render non-image files */}
                      {msg.attachments
                        ?.filter((a) => !a.isImage && (!a.type || !a.type.startsWith('image/')) && (!a.savedPath || !/\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(a.savedPath)))
                        .map((att, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-[#2E2E32] bg-[#141518] hover:border-[#3E4046] transition-colors max-w-sm select-none"
                          >
                            <FileCode2 className="w-5 h-5 text-sky-400 shrink-0" />
                            <div className="min-w-0 text-left">
                              <div className="text-[13px] font-medium text-[#E8EAED] truncate" title={att.name}>
                                {att.name}
                              </div>
                              <div className="text-[11px] text-[#9AA0A6] flex items-center gap-1.5 font-mono">
                                <span>{att.sizeHuman || (att.size ? `${Math.round(att.size / 1024)} KB` : 'file')}</span>
                                {att.savedPath && (
                                  <span className="text-emerald-400/80 truncate max-w-[140px]" title={att.savedPath}>
                                    • {shortenPath(att.savedPath)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap leading-[1.7]">{msg.content}</div>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="space-y-3.5 px-1">
              {/* Step Timeline: Thoughts & Collapsible Activity Bar */}
              <div className="space-y-1">
                {(activeThought || isStreaming) && (
                  <ThoughtAccordion
                    thought={activeThought || ''}
                    elapsedMs={activeElapsedMs}
                    tokenCount={activeTokens}
                    isStreaming={isStreaming}
                  />
                )}

                {((msg.toolCalls && msg.toolCalls.length > 0) || stepNotes.length > 0) && (
                  <AgentActivityBox
                    toolCalls={msg.toolCalls || []}
                    stepNotes={stepNotes}
                    isCurrentlyGenerating={isCurrentlyGenerating}
                    onOpenInWorkbench={handleOpenInWorkbench}
                  />
                )}

                {isCurrentlyGenerating &&
                  !content &&
                  (!msg.toolCalls || msg.toolCalls.length === 0) &&
                  !activeThought && (
                    <div className="flex items-center gap-2 text-[14px] text-[#9AA0A6] py-1 select-none">
                      <Loader2 className="w-4 h-4 text-[#8AB4F8] animate-spin" />
                      <span>Working...</span>
                    </div>
                  )}
              </div>

              {/* Clean Final Markdown Assistant Output with Large, Clear Typography */}
              {content && (
                <div className="text-[16px] sm:text-[17px] text-[#E8EAED] leading-[1.75] pt-1 prose prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p({ children }) {
                        return <p className="my-3 leading-[1.75] text-[16px] sm:text-[17px] text-[#E8EAED]">{children}</p>;
                      },
                      ul({ children }) {
                        return <ul className="list-disc pl-5 sm:pl-6 my-3.5 space-y-2 text-[16px] sm:text-[17px] text-[#E8EAED] marker:text-[#8AB4F8]">{children}</ul>;
                      },
                      ol({ children }) {
                        return <ol className="list-decimal pl-5 sm:pl-6 my-3.5 space-y-2 text-[16px] sm:text-[17px] text-[#E8EAED] marker:text-[#8AB4F8]">{children}</ol>;
                      },
                      li({ children }) {
                        return <li className="leading-[1.75] text-[#E8EAED] pl-0.5">{children}</li>;
                      },
                      h1({ children }) {
                        return <h1 className="text-[22px] sm:text-[24px] font-semibold text-white mt-6 mb-3.5 pb-1.5 border-b border-[#26282C]">{children}</h1>;
                      },
                      h2({ children }) {
                        return <h2 className="text-[19px] sm:text-[21px] font-semibold text-white mt-5 mb-3">{children}</h2>;
                      },
                      h3({ children }) {
                        return <h3 className="text-[17.5px] sm:text-[18.5px] font-semibold text-white mt-4 mb-2">{children}</h3>;
                      },
                      h4({ children }) {
                        return <h4 className="text-[16px] sm:text-[17px] font-semibold text-[#E8EAED] mt-3 mb-1.5">{children}</h4>;
                      },
                      hr() {
                        return <hr className="my-5 border-t border-[#26282C]" />;
                      },
                      strong({ children }) {
                        return <strong className="font-semibold text-white">{children}</strong>;
                      },
                      a({ href, children }) {
                        return (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="antigravity-link"
                          >
                            {children}
                          </a>
                        );
                      },
                      blockquote({ children }) {
                        return (
                          <blockquote className="border-l-3 border-[#8AB4F8] bg-[#8AB4F8]/10 pl-4 py-2 my-3 rounded-r-lg text-[15.5px] sm:text-[16px] text-[#D2E3FC] leading-relaxed">
                            {children}
                          </blockquote>
                        );
                      },
                      table({ children }) {
                        return (
                          <div className="my-3.5 overflow-x-auto rounded-xl border border-[#2D2F34]">
                            <table className="w-full text-left text-[14px] border-collapse">{children}</table>
                          </div>
                        );
                      },
                      th({ children }) {
                        return <th className="bg-[#1C1D20] px-4 py-2.5 font-semibold text-white border-b border-[#2D2F34]">{children}</th>;
                      },
                      td({ children }) {
                        return <td className="px-4 py-2.5 border-b border-[#242528] text-[#D4D4D8]">{children}</td>;
                      },
                      code({ className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeStr = String(children || '');
                        const isBlock = Boolean(match) || codeStr.includes('\n');
                        return isBlock ? (
                          <CodeBlockWithCopy
                            language={match?.[1] || 'code'}
                            codeText={codeStr}
                            className={className}
                          />
                        ) : (
                          <code
                            className="antigravity-code-badge"
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </div>
              )}

              {/* Antigravity 2.0 Assistant Message Footer Bar */}
              {!isCurrentlyGenerating && content && (
                <div className="flex items-center justify-between pt-1 text-[11.5px] text-[#6E6E73] select-none group">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(content);
                        setCopiedMsgId(msg.id);
                        setTimeout(() => setCopiedMsgId(null), 1800);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#1C1D20] text-[#80868B] hover:text-[#E8EAED] transition-colors cursor-pointer"
                      title="Copy response"
                    >
                      {copiedMsgId === msg.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    {onQuickSend && index > 0 && messages[index - 1]?.role === 'user' && (
                      <button
                        type="button"
                        onClick={() => onQuickSend(messages[index - 1].content)}
                        className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#1C1D20] text-[#80868B] hover:text-[#E8EAED] transition-colors cursor-pointer"
                        title="Retry / Regenerate response"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Retry</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 font-mono text-[10.5px] text-[#5F6368]">
                    <span>{msg.modelName || 'Qwen 3.8 Flash-Next (Strata IQ3_S + Vision)'}</span>
                    {Boolean(msg.outputTokens && msg.outputTokens > 0) && (
                      <>
                        <span>•</span>
                        <span>{msg.outputTokens} tok</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {isCurrentlyGenerating && content && isGenerating && (
                <div className="flex items-center gap-2 text-[13px] text-[#80868B] pt-1.5 select-none">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#8AB4F8]" />
                  <span>Synthesizing response…</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
