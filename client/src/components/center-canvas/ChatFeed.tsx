import React, { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import ReactMarkdown, { type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Info,
  FileCode2,
  ExternalLink,
  Sparkles,
  Copy,
  Check,
  RotateCcw,
  GitBranch,
  Eye,
  Target,
  Map,
  Cpu,
  Image as ImageIcon,
  Download,
  Send,
  MessageSquare,
} from 'lucide-react';
import {
  useSessionStore,
  ToolCallItemData,
  ChatMessage,
  GoogleModelId,
  selectIsTurnActive,
  selectStatusLabel,
  getGoogleModelOption,
} from '../../store/useSessionStore';
import { useTelemetryStore } from '../../store/useTelemetryStore';
import { useArtifactStore, WorkbenchTab, ArtifactRecord } from '../../store/useArtifactStore';
import { ThoughtAccordion } from './ThoughtAccordion';
import { AgentEmbedWidget } from './AgentEmbedWidget';

const OUTER_PIN_THRESHOLD_PX = 40;
const NESTED_PIN_THRESHOLD_PX = 28;

const REMARK_PLUGINS: React.ComponentProps<typeof ReactMarkdown>['remarkPlugins'] = [
  remarkGfm,
  remarkMath,
];

const REHYPE_PLUGINS: React.ComponentProps<typeof ReactMarkdown>['rehypePlugins'] = [
  [rehypeKatex, { throwOnError: false, errorColor: '#f87171' }],
  [rehypeHighlight, { detect: false, plainText: ['diff', 'patch', 'txt', 'text', 'plaintext'] }],
];

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'file:', 'sidecar:']);
const SAFE_IMG_PROTOCOLS = new Set(['http:', 'https:']);
const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,[A-Za-z0-9+/]+=*$/i;

const safeUrlTransform: UrlTransform = (url, key, node) => {
  if (!url || typeof url !== 'string') return '';
  // Reject ASCII control characters (prevents \0, \t, \n, \r scheme obfuscation)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(url)) return '';

  const trimmed = url.trim();
  if (!trimmed) return '';

  const isImg = node?.tagName === 'img' && key === 'src';

  // Fragment-only links
  if (trimmed.startsWith('#')) {
    return isImg ? '' : trimmed;
  }

  // Single-slash relative paths (block protocol-relative //evil.com)
  if (trimmed.startsWith('/')) {
    return trimmed.startsWith('//') ? '' : trimmed;
  }

  // Strip internal whitespace when inspecting scheme
  const compact = trimmed.replace(/\s+/g, '');
  const schemeMatch = compact.match(/^([a-z][a-z0-9+.-]*):/i);

  if (!schemeMatch) {
    // Reject obfuscated/malformed scheme before first /, ?, #
    const colon = compact.indexOf(':');
    if (colon !== -1) {
      const slash = compact.indexOf('/');
      const q = compact.indexOf('?');
      const hash = compact.indexOf('#');
      const beforeSep =
        (slash === -1 || colon < slash) &&
        (q === -1 || colon < q) &&
        (hash === -1 || colon < hash);
      if (beforeSep) return '';
    }
    // Safe scheme-less relative path (e.g. server/src/index.ts#L10)
    return trimmed;
  }

  const protocol = `${schemeMatch[1].toLowerCase()}:`;
  if (protocol === 'data:') {
    // Only safe raster base64 images on <img src>, never SVG/HTML or <a>
    return isImg && SAFE_DATA_IMAGE_RE.test(compact) ? compact : '';
  }

  if (isImg) {
    return SAFE_IMG_PROTOCOLS.has(protocol) ? trimmed : '';
  }

  return SAFE_LINK_PROTOCOLS.has(protocol) ? trimmed : '';
};

function resolveServerAssetUrl(url: string | undefined, apiBaseUrl: string): string | undefined {
  if (!url) return url;
  if (/^\/api\/(?:uploads|mcp-outputs)\//i.test(url)) {
    const base = (apiBaseUrl || '').replace(/\/+$/, '');
    return base ? `${base}${url}` : url;
  }
  return url;
}

function extractReactText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractReactText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractReactText(node.props.children);
  }
  return '';
}

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

function baseFilename(rawPath: string): string {
  if (!rawPath) return '.';
  const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const last = normalized.split('/').pop();
  return last || normalized;
}

const FileTypeBadge: React.FC<{ filename: string }> = ({ filename }) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) {
    return (
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        <ellipse cx="12" cy="12" rx="10" ry="4.2" />
        <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)" />
      </svg>
    );
  }
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return <span className="text-[10px] font-bold tracking-tight text-[#38BDF8] shrink-0 font-mono">TS</span>;
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return <span className="text-[10px] font-bold tracking-tight text-[#FACC15] shrink-0 font-mono">JS</span>;
  }
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return <span className="text-[10.5px] font-bold text-[#A78BFA] shrink-0 font-mono">Y</span>;
  }
  if (lower.endsWith('.kt') || lower.endsWith('.kts')) {
    return <span className="text-[10.5px] font-bold text-[#C084FC] shrink-0 font-mono">K</span>;
  }
  if (lower === '.gitignore' || lower === '.gitattributes' || lower.endsWith('.git')) {
    return (
      <span className="inline-block w-2.5 h-2.5 rotate-45 bg-[#F97316] rounded-[1px] shrink-0 mx-0.5" />
    );
  }
  if (lower.endsWith('.json')) {
    return <span className="text-[10px] font-bold text-[#FBBF24] shrink-0 font-mono">{'{}'}</span>;
  }
  if (lower.endsWith('.md')) {
    return <span className="text-[10px] font-bold text-[#60A5FA] shrink-0 font-mono">M</span>;
  }
  if (lower.endsWith('.rs')) {
    return <span className="text-[10px] font-bold text-[#FB923C] shrink-0 font-mono">RS</span>;
  }
  if (lower.endsWith('.py')) {
    return <span className="text-[10px] font-bold text-[#60A5FA] shrink-0 font-mono">PY</span>;
  }
  return <FileCode2 className="w-3.5 h-3.5 text-[#8AB4F8] shrink-0" />;
};

function formatCompactToolLabel(item: ToolCallItemData): {
  prefix: string;
  target: string;
  detail?: string;
  filePath?: string;
  isFileRow: boolean;
  isRead: boolean;
  isEdit: boolean;
  isDir: boolean;
  isSearch: boolean;
  diffStats?: { added: number; removed: number };
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
    const rawPath = args?.path || args?.Path;
    const fullPath = rawPath ? String(rawPath) : rawCmd.replace(/^read_file\s*/i, '');
    const sLine = args?.start_line || args?.StartLine;
    const eLine = args?.end_line || args?.EndLine;
    const detail = sLine || eLine ? `#L${sLine || 1}${eLine ? `-${eLine}` : ''}` : '';
    return {
      prefix: 'Analyzed',
      target: baseFilename(fullPath),
      detail,
      filePath: fullPath,
      isFileRow: true,
      isRead: true,
      isEdit: false,
      isDir: false,
      isSearch: false,
    };
  }

  if (
    toolName === 'write_file' ||
    toolName === 'apply_diff' ||
    toolName === 'edit_file' ||
    rawCmd.toLowerCase().startsWith('write_file') ||
    rawCmd.toLowerCase().startsWith('apply_diff') ||
    rawCmd.toLowerCase().startsWith('edit_file')
  ) {
    const rawPath = args?.path || args?.Path;
    const fullPath = rawPath ? String(rawPath) : rawCmd;
    let added = 0;
    let removed = 0;
    if (typeof args?.content === 'string' && args.content.length > 0) {
      added = args.content.split(/\r?\n/).length;
    } else if (
      typeof args?.replacement === 'string' ||
      typeof args?.Replacement === 'string' ||
      typeof args?.target === 'string' ||
      typeof args?.Target === 'string'
    ) {
      const rep = String(args?.replacement ?? args?.Replacement ?? '');
      const tgt = String(args?.target ?? args?.Target ?? '');
      if (rep) added = rep.split(/\r?\n/).length;
      if (tgt) removed = tgt.split(/\r?\n/).length;
    } else if (typeof args?.diff === 'string') {
      for (const ln of args.diff.split(/\r?\n/)) {
        if (ln.startsWith('+') && !ln.startsWith('+++')) added++;
        else if (ln.startsWith('-') && !ln.startsWith('---')) removed++;
      }
    }
    return {
      prefix: toolName === 'write_file' ? 'Created' : 'Edited',
      target: baseFilename(fullPath),
      filePath: fullPath,
      isFileRow: true,
      isRead: false,
      isEdit: true,
      isDir: false,
      isSearch: false,
      diffStats: { added, removed },
    };
  }

  if (toolName === 'list_directory' || rawCmd.toLowerCase().startsWith('list_directory')) {
    const p = args?.path ? shortenPath(String(args.path)) : '.';
    return {
      prefix: 'Listed',
      target: p,
      isFileRow: false,
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
      isFileRow: false,
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
      isFileRow: false,
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
      isFileRow: false,
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
      isFileRow: false,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'code_outline' || rawCmd.toLowerCase().startsWith('code_outline')) {
    const fullPath = args?.path ? String(args.path) : rawCmd;
    return {
      prefix: 'Outlined',
      target: baseFilename(fullPath),
      filePath: fullPath,
      isFileRow: true,
      isRead: true,
      isEdit: false,
      isDir: false,
      isSearch: false,
    };
  }

  if (toolName === 'patch_json' || rawCmd.toLowerCase().startsWith('patch_json')) {
    const fullPath = args?.path ? String(args.path) : rawCmd;
    const act = args?.action ? String(args.action) : 'update';
    const kp = args?.key_path ? `${args.key_path}` : '';
    return {
      prefix: act === 'read' ? 'Inspected' : 'Edited',
      target: baseFilename(fullPath),
      detail: kp,
      filePath: fullPath,
      isFileRow: true,
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
      isFileRow: false,
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
      isFileRow: false,
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
      isFileRow: false,
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
      isFileRow: false,
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
      isFileRow: false,
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
      isFileRow: false,
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
      isFileRow: false,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'search_symbols' || rawCmd.toLowerCase().startsWith('search_symbols')) {
    return {
      prefix: 'Searched Symbols',
      target: shortenPath(String(args?.path || '.')),
      isFileRow: false,
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
    const exitDetail =
      item.status !== 'running' && item.exitCode !== null && item.exitCode !== undefined
        ? `· Exited with code ${item.exitCode}`
        : '';
    return {
      prefix: item.status === 'running' ? 'Running' : 'Ran',
      target: cmdStr.length > 58 ? cmdStr.slice(0, 58) + '…' : cmdStr,
      detail: exitDetail,
      isFileRow: false,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: false,
    };
  }

  if (toolName === 'ask_question') {
    const qCount = Array.isArray(args?.questions) ? args.questions.length : 1;
    return {
      prefix: 'Asked',
      target: `${qCount} design question${qCount === 1 ? '' : 's'}`,
      isFileRow: false,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName === 'swarm' || toolName === 'post_message' || toolName === 'read_board' || toolName === 'swarm_wait') {
    const detail =
      toolName === 'swarm'
        ? `${args?.action || 'status'}${args?.name ? ` (${args.name})` : ''}`
        : toolName === 'post_message'
        ? String(args?.text || '').slice(0, 42)
        : toolName;
    return {
      prefix: 'Swarm',
      target: detail,
      isFileRow: false,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  if (toolName.startsWith('mcp_') || toolName === 'call_mcp_tool') {
    let serverLabel = 'MCP';
    let cleanTool = toolName;
    let innerArgs = args;
    if (toolName === 'call_mcp_tool') {
      serverLabel = String(args?.ServerName || 'MCP');
      cleanTool = String(args?.ToolName || 'tool');
      innerArgs = args?.Arguments || args;
    } else {
      const mcpMatch = toolName.match(/^mcp_([^_]+(?:-[^_]+)*)_(.+)$/);
      if (mcpMatch) {
        serverLabel = mcpMatch[1];
        cleanTool = mcpMatch[2];
      }
    }
    const argPreviewRaw =
      innerArgs?.query ||
      innerArgs?.name ||
      innerArgs?.prompt ||
      innerArgs?.action ||
      innerArgs?.workflow_path ||
      innerArgs?.url ||
      '';
    const argPreview = argPreviewRaw ? String(argPreviewRaw).replace(/\s+/g, ' ').trim() : '';
    const trimmedPreview = argPreview.length > 38 ? `${argPreview.slice(0, 38)}…` : argPreview;
    return {
      prefix: `MCP • ${serverLabel}`,
      target: trimmedPreview ? `${cleanTool} (${trimmedPreview})` : cleanTool,
      isFileRow: false,
      isRead: false,
      isEdit: false,
      isDir: false,
      isSearch: true,
    };
  }

  const cleanCmd = rawCmd.replace(/\s+/g, ' ').trim();
  return {
    prefix: item.status === 'running' ? 'Running' : 'Ran',
    target: cleanCmd.length > 62 ? cleanCmd.slice(0, 62) + '…' : cleanCmd,
    isFileRow: false,
    isRead: false,
    isEdit: false,
    isDir: false,
    isSearch: false,
  };
}

/**
 * Code-fence-aware content cleaner. Never hides real prose:
 *  - closed <think>/<thought>/<tool_call> blocks are removed (outside code fences only)
 *  - an UNCLOSED tag is only stripped when it is at the trailing end AND the turn is streaming
 */
function maskCodeFences(text: string): { masked: string; restore: (s: string) => string } {
  const blocks: string[] = [];
  const masked = text.replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, (m) => {
    blocks.push(m);
    return `\u0000FENCE${blocks.length - 1}\u0000`;
  });
  return {
    masked,
    restore: (s: string) => s.replace(/\u0000FENCE(\d+)\u0000/g, (_m, i) => blocks[Number(i)] ?? ''),
  };
}

function parseMessageContent(rawContent: string, existingThought?: string, isStreaming?: boolean) {
  let thought = existingThought || '';
  const { masked, restore } = maskCodeFences(rawContent || '');
  let content = masked;

  // Closed think blocks
  content = content.replace(/<(thought|think)>([\s\S]*?)<\/\1>/gi, (_m, _t, body) => {
    if (!thought) thought = String(body).trim();
    return '';
  });
  // Closed tool_call blocks
  content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');

  if (isStreaming) {
    // Unclosed tag at the trailing end only
    const open = content.match(/<(thought|think|tool_call)>(?![\s\S]*<\/\1>)([\s\S]*)$/i);
    if (open && open.index !== undefined) {
      if (open[1].toLowerCase() !== 'tool_call' && !thought) thought = open[2].trim();
      content = content.slice(0, open.index);
    } else {
      // partially streamed opening tag, e.g. "<thi" or "<tool_ca"
      const partial = content.match(/<\/?([a-z_]{0,9})$/i);
      if (partial && partial.index !== undefined) {
        const frag = partial[1].toLowerCase();
        if (['thought', 'think', 'tool_call'].some((t) => t.startsWith(frag))) {
          content = content.slice(0, partial.index);
        }
      }
    }
  }

  content = restore(content).trim();
  return { thought, content };
}

const ToolExecutionRow: React.FC<{
  item: ToolCallItemData;
  onOpenInWorkbench: (item: ToolCallItemData) => void;
}> = ({ item, onOpenInWorkbench }) => {
  const [userOpen, setUserOpen] = useState(false);
  const { prefix, target, detail, isFileRow, diffStats } = formatCompactToolLabel(item);
  const hasOutput = Boolean(item.output && item.output.trim().length > 0);
  const isInteractiveExpand = !isFileRow && hasOutput;
  const isError = item.status === 'error';

  const handleRowClick = () => {
    if (isFileRow) {
      onOpenInWorkbench(item);
    } else if (hasOutput) {
      setUserOpen((prev) => !prev);
    } else {
      onOpenInWorkbench(item);
    }
  };

  return (
    <div className="py-[3px] select-none">
      <div
        className={`flex items-center justify-between gap-2 text-[13.5px] transition-colors max-w-full ${
          isError
            ? 'text-rose-300 hover:text-rose-200'
            : 'text-[#8E8E93] hover:text-[#E8EAED]'
        }`}
      >
        <button
          type="button"
          onClick={handleRowClick}
          className="inline-flex items-center gap-1.5 text-left cursor-pointer focus:outline-none min-w-0 flex-1 py-0.5"
        >
          {item.status === 'running' && (
            <Loader2 className="w-3.5 h-3.5 text-[#8AB4F8] animate-spin shrink-0" />
          )}
          {isError && (
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          )}

          <span className={`font-normal shrink-0 ${isError ? 'text-rose-400' : 'text-[#8E8E93]'}`}>
            {prefix}
          </span>

          {isFileRow && <FileTypeBadge filename={target} />}

          <span className={`truncate ${isError ? 'text-rose-200' : 'text-[#D4D4D8]'}`}>
            {target}
          </span>

          {detail && (
            <span className={`shrink-0 font-normal ${isError ? 'text-rose-300/80' : 'text-[#8E8E93]'}`}>
              {detail}
            </span>
          )}

          {diffStats && (diffStats.added > 0 || diffStats.removed > 0 || isFileRow) && (
            <span className="inline-flex items-center gap-1.5 shrink-0 font-mono text-[12px] ml-1">
              <span className="text-[#4ADE80]">+{diffStats.added}</span>
              <span className="text-[#F87171]">-{diffStats.removed}</span>
            </span>
          )}

          {isInteractiveExpand &&
            (userOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#70757A] shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#70757A] shrink-0" />
            ))}
        </button>

        {isFileRow && hasOutput && (
          <button
            type="button"
            onClick={() => setUserOpen((prev) => !prev)}
            className="text-[#70757A] hover:text-[#BDC1C6] px-1 py-0.5 cursor-pointer shrink-0"
            title={userOpen ? 'Hide details' : 'Show output'}
          >
            {userOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {userOpen && hasOutput && (
        <div
          className={`mt-1 ml-3 pl-3 border-l font-mono text-[12px] overflow-x-auto overflow-y-auto overscroll-contain p-2.5 rounded-lg max-h-56 select-text leading-relaxed ${
            isError
              ? 'border-rose-500/40 bg-rose-950/20 text-rose-200'
              : 'border-[#26282C] bg-[#101113] text-[#BDC1C6]'
          }`}
        >
          <pre className="whitespace-pre-wrap">{item.output}</pre>
        </div>
      )}
    </div>
  );
};

type TimelineStep =
  | { kind: 'thought'; key: string }
  | { kind: 'tool'; key: string; tool: ToolCallItemData };

function formatDurationCompact(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec >= 60) {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return rem ? `${mins}m ${rem}s` : `${mins}m`;
  }
  return `${sec}s`;
}

/**
 * Antigravity-style minimal work segment timeline (collapsed `Worked for Xs ›` when done;
 * expanded live steps + `Working` bottom indicator when active).
 */
const StepTimeline: React.FC<{
  thought: string;
  thoughtElapsedMs?: number;
  thoughtTokens?: number;
  thoughtStreaming: boolean;
  toolCalls: ToolCallItemData[];
  isActive: boolean;
  statusLabel?: string;
  onOpenInWorkbench: (item: ToolCallItemData) => void;
  onInspectChange?: (panelId: string, paused: boolean) => void;
  onCollapseReset?: (panelId: string) => void;
}> = ({
  thought,
  thoughtElapsedMs,
  thoughtTokens,
  thoughtStreaming,
  toolCalls,
  isActive,
  statusLabel,
  onOpenInWorkbench,
  onInspectChange,
  onCollapseReset,
}) => {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyContentRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const isPinnedRef = useRef(true);
  const prevScrollTopRef = useRef(0);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticRafRef = useRef<number | null>(null);
  const prevIsActiveRef = useRef(isActive);
  const userExpandedRef = useRef(userExpanded);
  userExpandedRef.current = userExpanded;

  const pinToBottom = useCallback((el: HTMLDivElement | null) => {
    if (!el || el.clientHeight === 0) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    prevScrollTopRef.current = el.scrollTop;
    if (programmaticRafRef.current !== null) {
      cancelAnimationFrame(programmaticRafRef.current);
    }
    programmaticRafRef.current = requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
      programmaticRafRef.current = null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (programmaticRafRef.current !== null) {
        cancelAnimationFrame(programmaticRafRef.current);
      }
      onInspectChange?.(panelId, false);
    };
  }, [onInspectChange, panelId]);

  const steps: TimelineStep[] = [];
  if (thought || thoughtStreaming) steps.push({ kind: 'thought', key: 'thought' });
  for (const tc of toolCalls) {
    steps.push({ kind: 'tool', key: tc.id, tool: tc });
  }

  // Open live steps while active; collapse to `Worked for Xs ›` once finished unless user opened it.
  const expanded = userExpanded ?? isActive;

  // Reset userExpanded to null ONLY when isActive transitions true -> false
  useEffect(() => {
    if (prevIsActiveRef.current && !isActive) {
      setUserExpanded(null);
      isPinnedRef.current = true;
      onInspectChange?.(panelId, false);
    }
    prevIsActiveRef.current = isActive;
  }, [isActive, onInspectChange, panelId]);

  // Independent ResizeObserver auto-scroll for Working timeline body while expanded & active
  useEffect(() => {
    if (!expanded || !isActive) return;
    const el = bodyRef.current;
    const content = bodyContentRef.current;
    if (!el || !content) return;
    if (isPinnedRef.current) {
      pinToBottom(el);
    }
    const ro = new ResizeObserver(() => {
      if (isPinnedRef.current) {
        pinToBottom(el);
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [expanded, isActive, pinToBottom]);

  const handleBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el || el.clientHeight === 0) return;
    const curTop = el.scrollTop;
    const prevTop = prevScrollTopRef.current;
    prevScrollTopRef.current = curTop;
    const distanceFromBottom = el.scrollHeight - curTop - el.clientHeight;
    const atBottom = distanceFromBottom <= NESTED_PIN_THRESHOLD_PX;
    const scrolledUp = curTop < prevTop - 1;

    if (scrolledUp && !atBottom) {
      isPinnedRef.current = false;
      onInspectChange?.(panelId, true);
    } else if (isProgrammaticScrollRef.current) {
      return;
    } else if (atBottom) {
      isPinnedRef.current = true;
      if (userExpandedRef.current !== true) {
        onInspectChange?.(panelId, false);
      }
    } else {
      isPinnedRef.current = false;
    }
  }, [onInspectChange, panelId]);

  const handleToggle = () => {
    const nextExpanded = !expanded;
    setUserExpanded(nextExpanded);
    isPinnedRef.current = true;
    if (nextExpanded) {
      onInspectChange?.(panelId, true);
      requestAnimationFrame(() => pinToBottom(bodyRef.current));
    } else {
      onCollapseReset?.(panelId);
    }
  };

  if (steps.length === 0 && !isActive) return null;

  const runningTool = toolCalls.find((t) => t.status === 'running');
  const latestTool = runningTool || (toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : undefined);
  const toolsDurationMs = toolCalls.reduce((sum, t) => sum + (t.durationMs || 0), 0);
  const totalElapsedMs =
    toolsDurationMs > 0
      ? Math.max(toolsDurationMs, thoughtElapsedMs || 0)
      : thoughtElapsedMs || (toolCalls.length > 0 ? toolCalls.length * 1000 : 0);
  const elapsedLabel = totalElapsedMs > 0 ? formatDurationCompact(totalElapsedMs) : '';

  const activeHeadline = runningTool
    ? (() => {
        const { prefix, target } = formatCompactToolLabel(runningTool);
        return `${prefix} ${target}`;
      })()
    : latestTool
    ? (() => {
        const { prefix, target } = formatCompactToolLabel(latestTool);
        return `${prefix} ${target}`;
      })()
    : thoughtStreaming
    ? 'Thinking'
    : statusLabel || 'Working';

  const headline = isActive
    ? activeHeadline
    : elapsedLabel
    ? `Worked for ${elapsedLabel}`
    : 'Worked';

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={steps.length === 0 && !isActive}
        className="inline-flex items-center gap-1.5 py-0.5 text-[13.5px] text-[#8E8E93] hover:text-[#E8EAED] transition-colors cursor-pointer select-none disabled:cursor-default"
      >
        <span className={isActive ? 'text-[#BDC1C6]' : 'text-[#8E8E93]'}>
          {headline}
        </span>
        {(steps.length > 0 || isActive) &&
          (expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#70757A] shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#70757A] shrink-0" />
          ))}
      </button>

      {expanded && (steps.length > 0 || isActive) && (
        <div
          ref={bodyRef}
          onScroll={handleBodyScroll}
          className="mt-1 max-h-96 overflow-y-auto overscroll-contain"
        >
          <div ref={bodyContentRef} className="space-y-0.5">
            {steps.map((s) => {
              if (s.kind === 'thought') {
                return (
                  <ThoughtAccordion
                    key={s.key}
                    thought={thought}
                    elapsedMs={thoughtElapsedMs}
                    tokenCount={thoughtTokens}
                    isStreaming={thoughtStreaming}
                    defaultOpen={false}
                    onInspectChange={onInspectChange}
                    onCollapseReset={onCollapseReset}
                  />
                );
              }
              return (
                <ToolExecutionRow
                  key={s.key}
                  item={s.tool}
                  onOpenInWorkbench={onOpenInWorkbench}
                />
              );
            })}
            {isActive && (
              <div className="pt-1.5 text-[13.5px] text-[#8E8E93] animate-pulse select-none">
                Working
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** Right-pane tab targets for sidecar://<id>/<view> links. */
const SIDECAR_TAB_MAP: Record<string, WorkbenchTab> = {
  swarm: 'swarm',
  plan: 'plan',
  preview: 'preview',
  terminal: 'terminal',
  editor: 'editor',
  files: 'editor',
  tasks: 'tasks',
  artifacts: 'plan',
  harness: 'harness',
  evidence: 'evidence',
  changes: 'changes',
  subagents: 'subagents',
};

type ContentSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'embed'; src: string; body: string };

/** Split message content into markdown segments and <agent-embed src="...">...</agent-embed> widgets. */
function splitAgentEmbeds(content: string): ContentSegment[] {
  const out: ContentSegment[] = [];
  const re = /<agent-embed\s+[^>]*src=["']([^"']+)["'][^>]*>([\s\S]*?)<\/agent-embed>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'markdown', text: content.slice(last, m.index) });
    }
    out.push({ kind: 'embed', src: m[1], body: m[2]?.trim() || '' });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    out.push({ kind: 'markdown', text: content.slice(last) });
  }
  return out;
}

const InlineArtifactCard: React.FC<{
  artifact: ArtifactRecord;
  onOpen: () => void;
}> = ({ artifact, onOpen }) => (
  <div className="my-2.5 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border border-[#2D2F34] bg-[#141518] hover:border-[#8AB4F8]/40 transition-colors">
    <div className="flex items-center gap-2.5 min-w-0">
      <Sparkles className="w-4 h-4 text-[#8AB4F8] shrink-0" />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[#E8EAED] truncate">
          {artifact.title || artifact.type}
        </div>
        {artifact.summary && (
          <div className="text-[11.5px] text-[#8E8E93] truncate">{artifact.summary}</div>
        )}
      </div>
    </div>
    <button
      type="button"
      onClick={onOpen}
      className="px-2.5 py-1 rounded-lg bg-[#8AB4F8]/15 hover:bg-[#8AB4F8]/25 border border-[#8AB4F8]/40 text-[#8AB4F8] text-[11.5px] font-medium shrink-0 cursor-pointer"
    >
      {artifact.requestFeedback ? 'Review & Proceed' : 'Open Artifact'}
    </button>
  </div>
);

function parseSidecarHref(href: string): { id: string; view: string } | null {
  const m = href.match(/^sidecar:\/\/([^/?#]*)\/?([^?#]*)/i);
  if (!m) return null;
  const view = decodeURIComponent(m[2] || m[1] || '').toLowerCase();
  return { id: decodeURIComponent(m[1] || ''), view };
}

function fileUriToPath(href: string): { path: string; startLine?: number; endLine?: number } {
  const [base, hash = ''] = href.split('#');
  const isFileUri = /^file:\/\//i.test(base);
  let p = isFileUri ? base.replace(/^file:\/\/\/?/i, '') : base;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep raw p */
  }
  if (isFileUri && /^[a-zA-Z]:/.test(p) === false && !p.startsWith('/')) p = '/' + p;
  if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
  const lm = hash.match(/^L(\d+)(?:-L?(\d+))?/i);
  return {
    path: p,
    startLine: lm ? Number(lm[1]) : undefined,
    endLine: lm && lm[2] ? Number(lm[2]) : undefined,
  };
}

const CodeBlockWithCopy: React.FC<{
  language: string;
  codeText: string;
  className?: string;
  children?: React.ReactNode;
}> = ({ language, codeText, className, children }) => {
  const [copied, setCopied] = useState(false);
  const normalizedCode = codeText.replace(/\n$/, '');
  const isDiff = /^(diff|patch)$/i.test(language);

  const handleCopy = () => {
    navigator.clipboard.writeText(normalizedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="not-prose my-4 rounded-xl overflow-hidden border border-[#2D2F34] bg-[#141518]">
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
      {isDiff ? (
        <pre className="py-3 text-[13.5px] sm:text-[14px] font-mono overflow-x-auto leading-relaxed">
          <code>
            {normalizedCode.split(/\r?\n/).map((line, i) => {
              let lineClass = 'text-[#D4D4D8]';
              if (line.startsWith('+++') || line.startsWith('---')) {
                lineClass = 'text-[#9AA0A6] font-semibold bg-[#1C1D20]/70';
              } else if (line.startsWith('@@')) {
                lineClass = 'text-[#38BDF8] bg-[#38BDF8]/10';
              } else if (line.startsWith('+')) {
                lineClass = 'text-[#4ADE80] bg-emerald-500/12 border-l-2 border-emerald-400/70';
              } else if (line.startsWith('-')) {
                lineClass = 'text-[#F87171] bg-rose-500/12 border-l-2 border-rose-400/70';
              }
              return (
                <span key={i} className={`block px-4 whitespace-pre ${lineClass}`}>
                  {line || ' '}
                </span>
              );
            })}
          </code>
        </pre>
      ) : (
        <pre className="p-4 text-[14.5px] sm:text-[15px] font-mono overflow-x-auto text-[#E8EAED] leading-relaxed">
          <code className={className}>{children ?? codeText}</code>
        </pre>
      )}
    </div>
  );
};

interface AskQuestionItem {
  question: string;
  options: string[];
  is_multi_select: boolean;
}

function extractOrchestratorPlan(
  thought: string
): { plannerName: string; executorName: string; planBody: string } | null {
  if (!thought) return null;
  const match = thought.match(
    /\[([^\]]*Formulating Plan[^\]]*)\]\s*([\s\S]*?)\[Orchestrator Hand-off → Flipping to ([^\]]+?) for Plan Execution\]/
  );
  if (!match) return null;
  const header = match[1].trim();
  const planBody = match[2].trim();
  if (!planBody) return null;
  const plannerName = header.replace(/•.*$/, '').trim() || 'Orchestrator Planner';
  const rawExecutor = match[3].trim();
  const executorName =
    rawExecutor.replace(/^Gemini\s+4\s+/i, '').trim() || rawExecutor || 'Hydrogen';
  return { plannerName, executorName, planBody };
}

interface ExtractedMediaItem {
  url: string;
  label: string;
  mediaKind: 'image' | 'video' | 'audio';
}

const MEDIA_PRODUCING_TOOLS = new Set(['comfyui', 'generate_image', 'capture_screen']);

function isMediaToolCall(tc: ToolCallItemData): boolean {
  if (tc.status !== 'success') return false;
  const rawName = (tc.toolName || (tc.command || '').split('(')[0] || '').trim().toLowerCase();
  return MEDIA_PRODUCING_TOOLS.has(rawName) || rawName.startsWith('mcp_');
}

function isValidMediaOutputUrl(rel: string): boolean {
  if (!rel || /[\s"'<>{}*$`]|(\.\.\.)/.test(rel)) return false;
  const clean = rel.split('?')[0].split('#')[0];
  const file = clean.split('/').pop() || '';
  if (!file || /^\.+$/.test(file)) return false;
  return /^[^/\\].*\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|wav|mp3|ogg|flac)$/i.test(file);
}

function detectMediaKind(filenameOrUrl: string): 'image' | 'video' | 'audio' {
  const clean = filenameOrUrl.split('?')[0].split('#')[0].toLowerCase();
  if (/\.(mp4|webm|mov)$/.test(clean)) return 'video';
  if (/\.(wav|mp3|ogg|flac)$/.test(clean)) return 'audio';
  return 'image';
}

function extractMcpImages(
  toolCalls: ToolCallItemData[],
  content: string,
  apiBaseUrl: string,
  isCurrentlyGenerating = false
): ExtractedMediaItem[] {
  const seen = new Set<string>();
  const images: ExtractedMediaItem[] = [];
  const collect = (text: string) => {
    if (!text) return;
    const re = /\/api\/mcp-outputs\/[^\s)"'\]]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const rel = m[0].replace(/[).,;:!?]+$/, '');
      if (!isValidMediaOutputUrl(rel)) continue;
      const fullUrl = resolveServerAssetUrl(rel, apiBaseUrl) || rel;
      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);
      const label = rel.split('/').pop() || 'Generated Media';
      images.push({ url: fullUrl, label, mediaKind: detectMediaKind(label) });
    }
  };
  for (const tc of toolCalls || []) {
    if (tc.output && isMediaToolCall(tc)) {
      collect(tc.output);
    }
  }
  if (!isCurrentlyGenerating) {
    collect(content || '');
  }
  return images;
}

const McpMediaCard: React.FC<{ item: ExtractedMediaItem }> = ({ item }) => {
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setLoadError(false);
  }, [item.url]);

  return (
    <div className="rounded-xl overflow-hidden border border-[#2D2F34] bg-[#141518] shadow-md group">
      {loadError ? (
        <div className="p-4 text-center text-[11px] text-[#7E828A] bg-[#0c0d0e]">
          Media preview unavailable ({item.label})
        </div>
      ) : item.mediaKind === 'video' ? (
        <video
          controls
          playsInline
          preload="metadata"
          src={item.url}
          onError={() => setLoadError(true)}
          className="w-full max-h-96 bg-[#0c0d0e]"
        />
      ) : item.mediaKind === 'audio' ? (
        <audio controls src={item.url} onError={() => setLoadError(true)} className="w-full p-3" />
      ) : (
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={item.url}
            alt={item.label}
            onError={() => setLoadError(true)}
            className="w-full max-h-80 object-contain bg-[#0c0d0e] cursor-pointer hover:opacity-95 transition-opacity"
          />
        </a>
      )}
      <div className="px-3 py-1.5 flex items-center justify-between gap-2 text-[11px] text-[#9AA0A6] border-t border-[#242528]">
        <span className="inline-flex items-center gap-1.5 truncate">
          <ImageIcon className="w-3 h-3 text-[#8AB4F8] shrink-0" />
          <span className="truncate font-mono">{item.label}</span>
        </span>
        <a
          href={item.url}
          download={item.label}
          className="inline-flex items-center gap-1 text-[#8AB4F8] hover:underline shrink-0"
        >
          <Download className="w-3 h-3" />
          <span>Save</span>
        </a>
      </div>
    </div>
  );
};

function extractAskQuestions(toolCalls: ToolCallItemData[]): AskQuestionItem[] {
  const out: AskQuestionItem[] = [];
  for (const tc of toolCalls || []) {
    const isAsk =
      (tc.toolName || '').toLowerCase() === 'ask_question' ||
      (tc.command || '').toLowerCase().startsWith('ask_question') ||
      (tc.output || '').includes('"__localgravity_widget": "ask_question"');
    if (!isAsk) continue;

    let parsed: any = null;
    if (tc.output) {
      try {
        parsed = JSON.parse(tc.output);
      } catch {}
    }
    if (!parsed && tc.argumentsJson) {
      try {
        parsed = JSON.parse(tc.argumentsJson);
      } catch {}
    }
    const qs = Array.isArray(parsed?.questions) ? parsed.questions : [];
    for (const q of qs) {
      if (q && typeof q.question === 'string' && Array.isArray(q.options)) {
        out.push({
          question: q.question,
          options: q.options.map(String).filter(Boolean),
          is_multi_select: Boolean(q.is_multi_select),
        });
      }
    }
  }
  return out;
}

const OrchestratorPlanCard: React.FC<{
  plannerName: string;
  executorName?: string;
  planBody: string;
  apiBaseUrl: string;
}> = ({ plannerName, executorName = 'Hydrogen', planBody, apiBaseUrl }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-xl border border-indigo-500/30 bg-indigo-950/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2 text-left hover:bg-indigo-950/35 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Map className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="text-[12.5px] font-medium text-[#E8EAED] truncate">
            Orchestrator Execution Plan
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-mono bg-indigo-500/15 text-indigo-300 border border-indigo-400/25 shrink-0">
            {plannerName} → {executorName}
          </span>
        </div>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-[#9AA0A6] shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[#9AA0A6] shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-4 py-3 border-t border-indigo-500/20 text-[13px] text-[#D4D4D8] prose prose-invert max-w-none leading-relaxed max-h-72 overflow-y-auto overscroll-contain">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            urlTransform={safeUrlTransform}
            components={{
              a({ href, children }) {
                if (!href) {
                  return (
                    <span className="text-[#9AA0A6] underline decoration-dotted" title="Blocked unsafe link">
                      {children}
                    </span>
                  );
                }
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="localgravity-link">
                    {children}
                  </a>
                );
              },
              img({ src, alt }) {
                const resolvedSrc = resolveServerAssetUrl(src, apiBaseUrl);
                if (!resolvedSrc) return null;
                return (
                  <img
                    src={resolvedSrc}
                    alt={alt || ''}
                    className="max-w-full rounded-xl border border-[#2D2F34] my-2"
                  />
                );
              },
            }}
          >
            {planBody}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
};

const AskQuestionCard: React.FC<{
  questions: AskQuestionItem[];
  onSubmitAnswers: (replyText: string) => void;
}> = ({ questions, onSubmitAnswers }) => {
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [customNotes, setCustomNotes] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const toggleOption = (qIdx: number, opt: string, multi: boolean) => {
    if (submitted) return;
    setSelections((prev) => {
      const cur = prev[qIdx] || [];
      if (multi) {
        const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
        return { ...prev, [qIdx]: next };
      }
      return { ...prev, [qIdx]: [opt] };
    });
  };

  const handleSubmit = () => {
    if (submitted) return;
    const lines = questions.map((q, idx) => {
      const chosen = selections[idx] || [];
      const custom = (customNotes[idx] || '').trim();
      const answerParts = [...chosen, ...(custom ? [`Other: ${custom}`] : [])];
      return `- **${q.question}**: ${answerParts.length > 0 ? answerParts.join(', ') : '(No selection)'}`;
    });
    setSubmitted(true);
    onSubmitAnswers(`Selected answers:\n${lines.join('\n')}`);
  };

  return (
    <div className="my-3 rounded-2xl border border-[#2E3440] bg-[#14161A] p-3.5 space-y-3.5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-[#8AB4F8]">
        <MessageSquare className="w-3.5 h-3.5 shrink-0" />
        <span>Design Clarification</span>
      </div>
      {questions.map((q, qIdx) => {
        const selected = selections[qIdx] || [];
        return (
          <div key={qIdx} className="space-y-2">
            <div className="text-[13.5px] font-medium text-[#E8EAED]">
              {qIdx + 1}. {q.question}
            </div>
            <div className="space-y-1.5">
              {q.options.map((opt, oIdx) => {
                const isSelected = selected.includes(opt);
                const isRecommended = opt.includes('(Recommended)');
                const cleanLabel = opt.replace('(Recommended)', '').trim();
                return (
                  <button
                    key={oIdx}
                    type="button"
                    disabled={submitted}
                    onClick={() => toggleOption(qIdx, opt, q.is_multi_select)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-left text-[13px] transition-colors cursor-pointer disabled:opacity-70 ${
                      isSelected
                        ? 'bg-[#8AB4F8]/15 border-[#8AB4F8]/60 text-white'
                        : 'bg-[#1B1D22] border-[#2A2D35] text-[#D4D4D8] hover:border-[#3D424F]'
                    }`}
                  >
                    <span className="min-w-0">{cleanLabel}</span>
                    {isRecommended && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-500/15 text-sky-300 border border-sky-400/30 shrink-0">
                        Recommended
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              disabled={submitted}
              value={customNotes[qIdx] || ''}
              onChange={(e) => setCustomNotes((prev) => ({ ...prev, [qIdx]: e.target.value }))}
              placeholder="Other details (optional)..."
              className="w-full bg-[#101215] border border-[#26282F] rounded-lg px-2.5 py-1.5 text-xs text-[#E8EAED] placeholder:text-[#6E6E73] outline-none focus:border-[#8AB4F8]/50"
            />
          </div>
        );
      })}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={submitted}
          onClick={handleSubmit}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#8AB4F8] hover:bg-[#A6C8FF] disabled:bg-[#2A2D35] text-[#0C0D0E] disabled:text-[#8E8E93] text-xs font-semibold transition-colors cursor-pointer"
        >
          <Send className="w-3 h-3" />
          <span>{submitted ? 'Answers Sent' : 'Submit Answers'}</span>
        </button>
      </div>
    </div>
  );
};

const AssistantMarkdownBlock: React.FC<{
  markdown: string;
  apiBaseUrl: string;
  onOpenFile: (url: string) => void;
  onOpenSidecar: (tab: WorkbenchTab) => void;
}> = ({ markdown, apiBaseUrl, onOpenFile, onOpenSidecar }) => (
  <div className="text-[14px] text-[#E8EAED] leading-[1.65] pt-0.5 prose prose-invert max-w-none">
    {splitAgentEmbeds(markdown).map((seg, segIdx) =>
      seg.kind === 'embed' ? (
        <AgentEmbedWidget
          key={`embed-${segIdx}`}
          src={seg.src}
          fallbackText={seg.body || undefined}
        />
      ) : !seg.text.trim() ? null : (
        <ReactMarkdown
          key={`md-${segIdx}`}
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          urlTransform={safeUrlTransform}
          components={{
            p({ children }) {
              return <p className="my-2.5 leading-[1.65] text-[14px] text-[#E8EAED]">{children}</p>;
            },
            ul({ children }) {
              return <ul className="list-disc pl-5 my-2.5 space-y-1.5 text-[14px] text-[#E8EAED] marker:text-[#8AB4F8]">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="list-decimal pl-5 my-2.5 space-y-1.5 text-[14px] text-[#E8EAED] marker:text-[#8AB4F8]">{children}</ol>;
            },
            li({ children }) {
              return <li className="leading-[1.65] text-[#E8EAED] pl-0.5">{children}</li>;
            },
            h1({ children }) {
              return <h1 className="text-[18px] font-semibold text-white mt-5 mb-2.5 pb-1 border-b border-[#26282C]">{children}</h1>;
            },
            h2({ children }) {
              return <h2 className="text-[16px] font-semibold text-white mt-4 mb-2">{children}</h2>;
            },
            h3({ children }) {
              return <h3 className="text-[15px] font-semibold text-white mt-3.5 mb-1.5">{children}</h3>;
            },
            h4({ children }) {
              return <h4 className="text-[14px] font-semibold text-[#E8EAED] mt-3 mb-1">{children}</h4>;
            },
            hr() {
              return <hr className="my-5 border-t border-[#26282C]" />;
            },
            strong({ children }) {
              return <strong className="font-semibold text-white">{children}</strong>;
            },
            a({ href, children }) {
              const url = href || '';
              if (!url) {
                return (
                  <span className="text-[#9AA0A6] underline decoration-dotted" title="Blocked unsafe link">
                    {children}
                  </span>
                );
              }
              if (
                /^file:\/\//i.test(url) ||
                /^(?:server|client|scripts|tray|skills|tools)\/[^\s)#]+(?:#L\d+(?:-L?\d+)?)?$/i.test(
                  url
                )
              ) {
                return (
                  <a
                    href={url}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenFile(url);
                    }}
                    className="localgravity-link cursor-pointer"
                    title="Open in Right Workbench"
                  >
                    {children}
                  </a>
                );
              }
              if (/^sidecar:\/\//i.test(url)) {
                const sc = parseSidecarHref(url);
                const tab = sc ? SIDECAR_TAB_MAP[sc.view] : undefined;
                return (
                  <button
                    type="button"
                    disabled={!tab}
                    onClick={() => tab && onOpenSidecar(tab)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 rounded-full bg-[#8AB4F8]/10 border border-[#8AB4F8]/30 text-[#8AB4F8] text-[0.85em] hover:bg-[#8AB4F8]/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default align-baseline"
                    title={tab ? `Open ${sc?.view} pane` : 'Unavailable pane'}
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>{children}</span>
                  </button>
                );
              }
              const resolvedUrl = resolveServerAssetUrl(url, apiBaseUrl) || url;
              return (
                <a href={resolvedUrl} target="_blank" rel="noopener noreferrer" className="localgravity-link">
                  {children}
                </a>
              );
            },
            img({ src, alt }) {
              const resolvedSrc = resolveServerAssetUrl(src, apiBaseUrl);
              if (!resolvedSrc) return null;
              return (
                <img
                  src={resolvedSrc}
                  alt={alt || ''}
                  className="max-w-full rounded-xl border border-[#2D2F34] my-2"
                />
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
            pre({ node, children }) {
              const hasCodeChild = node?.children?.some(
                (c) => c.type === 'element' && c.tagName === 'code'
              );
              if (hasCodeChild) return <>{children}</>;
              return (
                <pre className="not-prose my-4 p-4 rounded-xl border border-[#2D2F34] bg-[#141518] text-[14.5px] sm:text-[15px] font-mono overflow-x-auto text-[#E8EAED] leading-relaxed">
                  {children}
                </pre>
              );
            },
            code({ node, className, children, ...props }) {
              const match = /language-([^\s]+)/.exec(className || '');
              const codeStr = extractReactText(children);
              const isMultiLineNode = Boolean(
                node?.position && node.position.start.line !== node.position.end.line
              );
              const isBlock =
                Boolean(match) ||
                /\bhljs\b/.test(className || '') ||
                codeStr.includes('\n') ||
                isMultiLineNode;
              return isBlock ? (
                <CodeBlockWithCopy
                  language={match?.[1] || 'code'}
                  codeText={codeStr}
                  className={className}
                >
                  {children}
                </CodeBlockWithCopy>
              ) : (
                <code className="localgravity-code-badge" {...props}>
                  {children}
                </code>
              );
            },
          }}
        >
          {seg.text}
        </ReactMarkdown>
      )
    )}
  </div>
);

interface ChatMessageRowProps {
  msg: ChatMessage;
  retryPrompt?: string;
  canRewind: boolean;
  isCurrentlyGenerating: boolean;
  thoughtDone: boolean;
  streamingThought: string;
  streamingElapsedMs?: number;
  streamingTokens?: number;
  turnStatusLabel?: string;
  turnError?: string;
  apiBaseUrl: string;
  artifacts: ArtifactRecord[];
  isCopied: boolean;
  brainProvider: string;
  selectedGoogleModel: GoogleModelId;
  activeModelName?: string;
  liveTokensPerSec: number;
  onOpenFile: (href: string) => void;
  onOpenSidecar: (tab: WorkbenchTab) => void;
  onOpenInWorkbench: (tc: ToolCallItemData) => void;
  onQuickSend?: (prompt: string) => void;
  onCopyMessage: (msgId: string, content: string) => void;
  onBranchMessage: (msgId: string) => void;
  onRewindMessage: (msgId: string) => void;
  onOpenArtifact: (artifact: ArtifactRecord) => void;
  onNestedInspectChange?: (panelId: string, paused: boolean) => void;
  onNestedCollapseReset?: (panelId: string) => void;
}

const ChatMessageRow = React.memo<ChatMessageRowProps>(({
  msg,
  retryPrompt,
  canRewind,
  isCurrentlyGenerating,
  thoughtDone,
  streamingThought,
  streamingElapsedMs,
  streamingTokens,
  turnStatusLabel,
  turnError,
  apiBaseUrl,
  artifacts,
  isCopied,
  brainProvider,
  selectedGoogleModel,
  activeModelName,
  liveTokensPerSec,
  onOpenFile,
  onOpenSidecar,
  onOpenInWorkbench,
  onQuickSend,
  onCopyMessage,
  onBranchMessage,
  onRewindMessage,
  onOpenArtifact,
  onNestedInspectChange,
  onNestedCollapseReset,
}) => {
  if (msg.role === 'user') {
    return (
      <div className="w-full">
        <div className="w-full bg-[#1C1D20] border border-[#2B2C30] rounded-2xl px-4 py-2.5 text-[14px] text-[#E8EAED] space-y-2 shadow-sm">
          {/* File & Image Attachments */}
          {((msg.images && msg.images.length > 0) || (msg.attachments && msg.attachments.length > 0)) && (
            <div className="flex flex-wrap items-center gap-2.5 overflow-x-auto pb-1">
              {/* Render images */}
              {msg.attachments
                ? msg.attachments
                    .filter((a) => a.isImage || (a.type && a.type.startsWith('image/')) || (a.savedPath && /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(a.savedPath)))
                    .map((att, i) => {
                      const resolvedUrl = resolveServerAssetUrl(att.url, apiBaseUrl);
                      return (
                        <img
                          key={i}
                          src={resolvedUrl || att.base64DataUrl}
                          alt={att.name || 'image'}
                          className="w-24 h-24 object-cover rounded-xl border border-[#2D2F34] shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => resolvedUrl && window.open(resolvedUrl, '_blank')}
                        />
                      );
                    })
                : msg.images?.map((img, i) => (
                    <img
                      key={i}
                      src={resolveServerAssetUrl(img, apiBaseUrl)}
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

  if (msg.role === 'system') {
    return (
      <div className="w-full px-1">
        <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border border-[#2B2D33] bg-[#141518]/80 text-[#9AA0A6] text-[13px] leading-relaxed">
          <Info className="w-4 h-4 text-[#8AB4F8] shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 prose prose-invert max-w-none text-[13px] [&>p]:my-0 [&>p+p]:mt-1.5">
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              urlTransform={safeUrlTransform}
              components={{
                a({ href, children }) {
                  if (!href) {
                    return (
                      <span className="text-[#9AA0A6] underline decoration-dotted" title="Blocked unsafe link">
                        {children}
                      </span>
                    );
                  }
                  const resolved = resolveServerAssetUrl(href, apiBaseUrl) || href;
                  return (
                    <a href={resolved} target="_blank" rel="noopener noreferrer" className="localgravity-link">
                      {children}
                    </a>
                  );
                },
                img({ src, alt }) {
                  const resolvedSrc = resolveServerAssetUrl(src, apiBaseUrl);
                  if (!resolvedSrc) return null;
                  return (
                    <img
                      src={resolvedSrc}
                      alt={alt || ''}
                      className="max-w-full rounded-xl border border-[#2D2F34] my-2"
                    />
                  );
                },
              }}
            >
              {msg.content || ''}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  const { thought: parsedThought, content } = parseMessageContent(
    msg.content,
    msg.thought,
    isCurrentlyGenerating
  );
  const stepNotes = msg.stepNotes || [];

  const activeThought = isCurrentlyGenerating
    ? streamingThought || parsedThought
    : msg.thought || parsedThought;
  const activeElapsedMs = isCurrentlyGenerating ? streamingElapsedMs : msg.thoughtElapsedMs;
  const activeTokens = isCurrentlyGenerating ? streamingTokens : msg.thoughtTokenCount;
  const isStreaming = isCurrentlyGenerating && !thoughtDone;

  const allTools = msg.toolCalls || [];
  const toolCounts = msg.stepToolCounts || [];
  const hasValidPartition = stepNotes.length > 0 && toolCounts.length === stepNotes.length;

  const noteSegments: Array<{ tools: ToolCallItemData[]; note: string }> = [];
  let trailingTools: ToolCallItemData[] = allTools;
  if (stepNotes.length > 0) {
    if (hasValidPartition) {
      let cursor = 0;
      for (let i = 0; i < stepNotes.length; i++) {
        const end = Math.max(cursor, Math.min(allTools.length, toolCounts[i] ?? allTools.length));
        noteSegments.push({ tools: allTools.slice(cursor, end), note: stepNotes[i] });
        cursor = end;
      }
      trailingTools = allTools.slice(cursor);
    } else {
      noteSegments.push({ tools: allTools, note: stepNotes[0] });
      for (let i = 1; i < stepNotes.length; i++) {
        noteSegments.push({ tools: [], note: stepNotes[i] });
      }
      trailingTools = [];
    }
  }

  const showThoughtInTrailing =
    noteSegments.length === 0 ||
    (isCurrentlyGenerating && isStreaming && trailingTools.length === 0);

  const orchestratorPlan = extractOrchestratorPlan(activeThought || '');
  const mcpImages = extractMcpImages(allTools, content || '', apiBaseUrl, isCurrentlyGenerating);
  const askQuestions = extractAskQuestions(allTools);

  return (
    <div className="space-y-3.5 px-1">
      {noteSegments.map((seg, segIdx) => (
        <React.Fragment key={`seg-${segIdx}`}>
          <StepTimeline
            thought={!showThoughtInTrailing && segIdx === 0 ? activeThought || '' : ''}
            thoughtElapsedMs={!showThoughtInTrailing && segIdx === 0 ? activeElapsedMs : undefined}
            thoughtTokens={!showThoughtInTrailing && segIdx === 0 ? activeTokens : undefined}
            thoughtStreaming={false}
            toolCalls={seg.tools}
            isActive={false}
            onOpenInWorkbench={onOpenInWorkbench}
            onInspectChange={onNestedInspectChange}
            onCollapseReset={onNestedCollapseReset}
          />
          <AssistantMarkdownBlock
            markdown={seg.note}
            apiBaseUrl={apiBaseUrl}
            onOpenFile={onOpenFile}
            onOpenSidecar={onOpenSidecar}
          />
        </React.Fragment>
      ))}

      {/* Active or final work segment */}
      <StepTimeline
        thought={showThoughtInTrailing ? activeThought || '' : ''}
        thoughtElapsedMs={showThoughtInTrailing ? activeElapsedMs : undefined}
        thoughtTokens={showThoughtInTrailing ? activeTokens : undefined}
        thoughtStreaming={showThoughtInTrailing ? isStreaming : false}
        toolCalls={trailingTools}
        isActive={isCurrentlyGenerating}
        statusLabel={isCurrentlyGenerating ? turnStatusLabel : undefined}
        onOpenInWorkbench={onOpenInWorkbench}
        onInspectChange={onNestedInspectChange}
        onCollapseReset={onNestedCollapseReset}
      />

      {orchestratorPlan && (
        <OrchestratorPlanCard
          plannerName={orchestratorPlan.plannerName}
          executorName={orchestratorPlan.executorName}
          planBody={orchestratorPlan.planBody}
          apiBaseUrl={apiBaseUrl}
        />
      )}

      {mcpImages.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-2">
          {mcpImages.map((img, i) => (
            <McpMediaCard key={`${img.url}-${i}`} item={img} />
          ))}
        </div>
      )}

      {askQuestions.length > 0 && onQuickSend && (
        <AskQuestionCard
          questions={askQuestions}
          onSubmitAnswers={(ans) => onQuickSend(ans)}
        />
      )}

      {/* Clean Final Markdown Assistant Output (+ <agent-embed> & Artifact Cards) */}
      {content && (
        <div className="space-y-3">
          <AssistantMarkdownBlock
            markdown={content}
            apiBaseUrl={apiBaseUrl}
            onOpenFile={onOpenFile}
            onOpenSidecar={onOpenSidecar}
          />

          {artifacts
            .filter(
              (a) =>
                (a.userFacing || a.requestFeedback) &&
                (content.includes(a.id) ||
                  (a.title && content.includes(a.title)) ||
                  (a.filePath && content.includes(a.filePath)))
            )
            .map((a) => (
              <InlineArtifactCard
                key={a.id}
                artifact={a}
                onOpen={() => onOpenArtifact(a)}
              />
            ))}
        </div>
      )}

      {turnError && (
        <div
          role="alert"
          className="my-2 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 text-rose-200 text-[13px] leading-relaxed"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 break-words">{turnError}</div>
        </div>
      )}

      {/* LocalGravity Assistant Message Footer Bar */}
      {!isCurrentlyGenerating && content && (
        <div className="flex items-center justify-between pt-1 text-[11.5px] text-[#6E6E73] select-none group">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onCopyMessage(msg.id, content)}
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#1C1D20] text-[#80868B] hover:text-[#E8EAED] transition-colors cursor-pointer"
              title="Copy response"
            >
              {isCopied ? (
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

            {onQuickSend && retryPrompt !== undefined && (
              <button
                type="button"
                onClick={() => onQuickSend(retryPrompt)}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#1C1D20] text-[#80868B] hover:text-[#E8EAED] transition-colors cursor-pointer"
                title="Retry / Regenerate response"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onBranchMessage(msg.id)}
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#1C1D20] text-[#80868B] hover:text-violet-300 transition-colors cursor-pointer"
              title="Branch conversation from this turn (Session Tree)"
            >
              <GitBranch className="w-3 h-3" />
              <span>Branch</span>
            </button>

            {canRewind && (
              <button
                type="button"
                onClick={() => onRewindMessage(msg.id)}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#1C1D20] text-[#80868B] hover:text-amber-300 transition-colors cursor-pointer"
                title="Rewind thread & revert file changes after this turn"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Rewind</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10.5px] text-[#5F6368]">
            <span className="truncate max-w-[200px] sm:max-w-none">
              {msg.modelName ||
                (brainProvider === 'google_ai_studio'
                  ? getGoogleModelOption(selectedGoogleModel).name
                  : activeModelName
                  ? `Swift 1.5 (${activeModelName})`
                  : 'Swift 1.5 Flash-Next (Vision)')}
            </span>
            {Boolean(msg.outputTokens && msg.outputTokens > 0) && (
              <>
                <span>•</span>
                <span>{msg.outputTokens} tok</span>
              </>
            )}
            {Boolean((msg.tokensPerSec && msg.tokensPerSec > 0) || (isCurrentlyGenerating && liveTokensPerSec > 0)) && (
              <>
                <span>•</span>
                <span className="text-[#388BFD] font-semibold">
                  {(isCurrentlyGenerating ? liveTokensPerSec : (msg.tokensPerSec || liveTokensPerSec)).toFixed(1)} tok/s
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

interface ChatFeedProps {
  onQuickSend?: (prompt: string) => void;
}

export const ChatFeed: React.FC<ChatFeedProps> = ({ onQuickSend }) => {
  const sessionId = useSessionStore((s) => s.sessionId);
  const workspacePath = useSessionStore((s) => s.workspacePath);
  const messages = useSessionStore((s) => s.messages);
  const currentStreamingThought = useSessionStore((s) => s.currentStreamingThought);
  const currentThoughtElapsedMs = useSessionStore((s) => s.currentThoughtElapsedMs);
  const currentThoughtTokens = useSessionStore((s) => s.currentThoughtTokens);
  const isThinkingFinished = useSessionStore((s) => s.isThinkingFinished);
  const activeModelName = useSessionStore((s) => s.activeModelName);
  const brainProvider = useSessionStore((s) => s.brainProvider);
  const selectedGoogleModel = useSessionStore((s) => s.selectedGoogleModel);
  const branchFromMessage = useSessionStore((s) => s.branchFromMessage);
  const rewindToMessage = useSessionStore((s) => s.rewindToMessage);
  const activeTurn = useSessionStore((s) => s.activeTurn);
  const turnActive = useSessionStore(selectIsTurnActive);
  const turnStatusLabel = useSessionStore(selectStatusLabel);
  const apiBaseUrl = useSessionStore((s) => s.apiBaseUrl);

  const tokensPerSec = useTelemetryStore((s) => s.tokensPerSec);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const setActiveTab = useArtifactStore((s) => s.setActiveTab);
  const setActiveFile = useArtifactStore((s) => s.setActiveFile);
  const artifacts = useArtifactStore((s) => s.artifacts);
  const setActiveArtifactId = useArtifactStore((s) => s.setActiveArtifactId);
  const setActiveArtifactDoc = useArtifactStore((s) => s.setActiveArtifactDoc);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isPinnedRef = useRef(true);
  const outerManualPauseRef = useRef(false);
  const pausedPanelsRef = useRef<Set<string>>(new Set());
  const prevScrollTopRef = useRef(0);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticRafRef = useRef<number | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const pinOuterToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    isProgrammaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    prevScrollTopRef.current = el.scrollTop;
    if (programmaticRafRef.current !== null) {
      cancelAnimationFrame(programmaticRafRef.current);
    }
    programmaticRafRef.current = requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
      programmaticRafRef.current = null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (programmaticRafRef.current !== null) {
        cancelAnimationFrame(programmaticRafRef.current);
      }
    };
  }, []);

  const shouldAutoScroll = useCallback(
    () =>
      isPinnedRef.current &&
      !outerManualPauseRef.current &&
      pausedPanelsRef.current.size === 0,
    []
  );

  const syncJumpButton = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    const hasOverflow = el.scrollHeight > el.clientHeight + OUTER_PIN_THRESHOLD_PX;
    const awayFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight > OUTER_PIN_THRESHOLD_PX;
    const paused =
      outerManualPauseRef.current ||
      pausedPanelsRef.current.size > 0 ||
      (hasOverflow && awayFromBottom);
    setShowJumpToLatest(paused);
  }, []);

  const handleNestedInspectChange = useCallback(
    (panelId: string, paused: boolean) => {
      if (paused) {
        pausedPanelsRef.current.add(panelId);
      } else {
        pausedPanelsRef.current.delete(panelId);
      }
      syncJumpButton();
      if (shouldAutoScroll()) {
        requestAnimationFrame(() => pinOuterToBottom());
      }
    },
    [pinOuterToBottom, shouldAutoScroll, syncJumpButton]
  );

  const handleNestedCollapseReset = useCallback(
    (_panelId: string) => {
      pausedPanelsRef.current.clear();
      outerManualPauseRef.current = false;
      isPinnedRef.current = true;
      setShowJumpToLatest(false);
      requestAnimationFrame(() => pinOuterToBottom());
    },
    [pinOuterToBottom]
  );

  const handleJumpToLatest = useCallback(() => {
    pausedPanelsRef.current.clear();
    outerManualPauseRef.current = false;
    isPinnedRef.current = true;
    setShowJumpToLatest(false);
    pinOuterToBottom();
  }, [pinOuterToBottom]);

  const handleFeedScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    const curTop = el.scrollTop;
    const prevTop = prevScrollTopRef.current;
    prevScrollTopRef.current = curTop;
    const distanceFromBottom = el.scrollHeight - curTop - el.clientHeight;
    const atBottom = distanceFromBottom <= OUTER_PIN_THRESHOLD_PX;
    const scrolledUp = curTop < prevTop - 1;

    if (scrolledUp && !atBottom) {
      isPinnedRef.current = false;
      outerManualPauseRef.current = true;
      setShowJumpToLatest(true);
    } else if (isProgrammaticScrollRef.current) {
      return;
    } else if (atBottom) {
      isPinnedRef.current = true;
      outerManualPauseRef.current = false;
      syncJumpButton();
    } else {
      isPinnedRef.current = false;
      syncJumpButton();
    }
  }, [syncJumpButton]);

  // Observe both outer feed content wrapper and viewport container for streaming/layout resizes
  useEffect(() => {
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const ro = new ResizeObserver(() => {
      if (container.clientHeight === 0) return;
      if (shouldAutoScroll()) {
        pinOuterToBottom();
      } else {
        syncJumpButton();
      }
    });
    ro.observe(content);
    ro.observe(container);
    return () => ro.disconnect();
  }, [pinOuterToBottom, shouldAutoScroll, syncJumpButton]);

  const latestUserMsgId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].id;
    }
    return undefined;
  }, [messages]);

  const prevSessionIdRef = useRef(sessionId);
  const prevLatestUserMsgIdRef = useRef(latestUserMsgId);

  // Reset manual pauses and pin to bottom on thread switch or new user prompt submission
  useEffect(() => {
    const sessionChanged = prevSessionIdRef.current !== sessionId;
    const newUserMessage =
      Boolean(latestUserMsgId) && latestUserMsgId !== prevLatestUserMsgIdRef.current;
    prevSessionIdRef.current = sessionId;
    prevLatestUserMsgIdRef.current = latestUserMsgId;

    if (sessionChanged || newUserMessage) {
      pausedPanelsRef.current.clear();
      outerManualPauseRef.current = false;
      isPinnedRef.current = true;
      setShowJumpToLatest(false);
      requestAnimationFrame(() => pinOuterToBottom());
    }
  }, [sessionId, latestUserMsgId, pinOuterToBottom]);

  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  }, [messages]);

  const openFileInEditor = useCallback(
    async (href: string) => {
      const { path: filePath, startLine, endLine } = fileUriToPath(href);
      try {
        const params = new URLSearchParams({ path: filePath });
        if (workspacePath && workspacePath.trim()) {
          params.set('root_path', workspacePath);
        }
        const res = await fetch(`${apiBaseUrl}/api/workspace/file?${params.toString()}`);
        if (!res.ok) {
          console.warn(`[ChatFeed] Failed to open file (${res.status}):`, filePath);
          return;
        }
        const data = await res.json();
        if (typeof data?.content !== 'string') {
          console.warn('[ChatFeed] Invalid workspace file response:', filePath);
          return;
        }
        setActiveFile(filePath, data.content);
        setActiveTab('editor');
        window.dispatchEvent(new CustomEvent('localgravity:open-right-drawer'));
        if (startLine && startLine > 0) {
          const revealDetail = { path: filePath, startLine, endLine };
          try {
            sessionStorage.setItem(
              'localgravity:pendingEditorReveal',
              JSON.stringify(revealDetail)
            );
          } catch {}
          window.dispatchEvent(
            new CustomEvent('localgravity:reveal-editor-line', { detail: revealDetail })
          );
        }
      } catch (err) {
        console.warn('[ChatFeed] Error opening file in editor:', filePath, err);
      }
    },
    [apiBaseUrl, workspacePath, setActiveFile, setActiveTab]
  );

  const handleOpenInWorkbench = useCallback(
    (tc: ToolCallItemData) => {
      const cmd = tc.command.toLowerCase();
      const tryExtractFileArgs = (
        rawJson?: string
      ): { path: string; startLine?: number; endLine?: number } => {
        if (!rawJson) return { path: '' };
        try {
          const parsed = JSON.parse(rawJson);
          const path = String(
            parsed?.path || parsed?.Path || parsed?.target || parsed?.Target || ''
          );
          const sRaw = parsed?.start_line ?? parsed?.StartLine;
          const eRaw = parsed?.end_line ?? parsed?.EndLine;
          const startLine = sRaw !== undefined ? Number(sRaw) : undefined;
          const endLine = eRaw !== undefined ? Number(eRaw) : undefined;
          return {
            path,
            startLine: startLine && !Number.isNaN(startLine) ? startLine : undefined,
            endLine: endLine && !Number.isNaN(endLine) ? endLine : undefined,
          };
        } catch {
          return { path: '' };
        }
      };

      let extracted = tryExtractFileArgs(tc.argumentsJson);
      if (!extracted.path && tc.command) {
        const m = tc.command.match(/^[a-zA-Z0-9_:-]+\(([\s\S]*)\)$/);
        if (m?.[1]) extracted = tryExtractFileArgs(m[1]);
      }

      const isFileTool =
        cmd.includes('write_file') ||
        cmd.includes('edit_file') ||
        cmd.includes('apply_diff') ||
        cmd.includes('patch_json') ||
        cmd.includes('code_outline') ||
        cmd.includes('read_file');
      if (extracted.path && isFileTool) {
        const lineSuffix =
          extracted.startLine && extracted.startLine > 0
            ? `#L${extracted.startLine}${
                extracted.endLine && extracted.endLine >= extracted.startLine
                  ? `-L${extracted.endLine}`
                  : ''
              }`
            : '';
        void openFileInEditor(`${extracted.path}${lineSuffix}`);
        return;
      }
      if (isFileTool) {
        setActiveTab('editor');
      } else if (cmd.includes('capture_screen') || cmd.includes('inspect')) {
        setActiveTab('preview');
      } else if (cmd.includes('swarm') || cmd.includes('post_message') || cmd.includes('read_board')) {
        setActiveTab('swarm');
      } else {
        setActiveTab('terminal');
      }
      window.dispatchEvent(new CustomEvent('localgravity:open-right-drawer'));
    },
    [openFileInEditor, setActiveTab]
  );

  const handleCopyMessage = useCallback((msgId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId(null), 1800);
  }, []);

  const handleBranchMessage = useCallback(
    (msgId: string) => {
      void branchFromMessage(msgId);
    },
    [branchFromMessage]
  );

  const handleRewindMessage = useCallback(
    (msgId: string) => {
      void rewindToMessage(msgId);
    },
    [rewindToMessage]
  );

  const handleOpenSidecar = useCallback(
    (tab: WorkbenchTab) => {
      setActiveTab(tab);
      window.dispatchEvent(new CustomEvent('localgravity:open-right-drawer'));
    },
    [setActiveTab]
  );

  const handleOpenArtifact = useCallback(
    (a: ArtifactRecord) => {
      setActiveArtifactId(a.id);
      setActiveArtifactDoc(
        a.type === 'plan'
          ? 'plan.md'
          : a.type === 'walkthrough'
          ? 'walkthrough.md'
          : a.type === 'task'
          ? 'task.md'
          : a.id
      );
      setActiveTab('plan');
      window.dispatchEvent(new CustomEvent('localgravity:open-right-drawer'));
    },
    [setActiveArtifactId, setActiveArtifactDoc, setActiveTab]
  );

  const threadArtifacts = useMemo(
    () => artifacts.filter((a) => !a.threadId || a.threadId === sessionId),
    [artifacts, sessionId]
  );

  const matchedTurnMsg = useMemo(
    () => Boolean(activeTurn?.messageId && messages.some((m) => m.id === activeTurn.messageId)),
    [activeTurn?.messageId, messages]
  );

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-[#0c0d0e]">
      <div
        ref={scrollRef}
        onScroll={handleFeedScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6 bg-[#0c0d0e]"
      >
        <div ref={contentRef} className="max-w-3xl mx-auto space-y-6 px-1 sm:px-4">
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
                {brainProvider === 'google_ai_studio' ? (
                  <>
                    Powered by{' '}
                    <strong className="text-[#E8EAED]">
                      Google AI • {getGoogleModelOption(selectedGoogleModel).name}
                    </strong>{' '}
                    ({getGoogleModelOption(selectedGoogleModel).sub}). Reference context with{' '}
                    <code className="text-[#8AB4F8]">@</code> or trigger workflows with{' '}
                    <code className="text-[#8AB4F8]">/</code>.
                  </>
                ) : (
                  <>
                    Powered by <strong className="text-[#E8EAED]">Strata • Qwen 3.8 Flash-Next</strong>{' '}
                    (IQ3_S + Vision • 64k). Reference context with{' '}
                    <code className="text-[#8AB4F8]">@</code> or trigger workflows with{' '}
                    <code className="text-[#8AB4F8]">/</code>.
                  </>
                )}
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

                {brainProvider === 'google_ai_studio' ? (
                  <button
                    type="button"
                    onClick={() =>
                      onQuickSend('/swarm Coordinate parallel agents to research, build, and verify our next task')
                    }
                    className="p-3 rounded-xl bg-[#17181B] hover:bg-[#1F2024] border border-[#282A2F] hover:border-[#3A3D45] transition-all cursor-pointer group space-y-1"
                  >
                    <div className="flex items-center gap-2 text-xs font-medium text-[#E8EAED] group-hover:text-indigo-400">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      <span>/swarm Parallel Agent Swarm</span>
                    </div>
                    <p className="text-[11px] text-[#6E6E73] leading-snug">
                      Coordinate multiple agents in parallel with shared board synthesis
                    </p>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      onQuickSend('/vision Run inspect_models with test_vision and verify Strata Qwen 3.8 Flash-Next vision status')
                    }
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
                )}

                <button
                  type="button"
                  onClick={() =>
                    onQuickSend(
                      brainProvider === 'google_ai_studio'
                        ? '/boost Perform a deep architectural & code quality audit of the current workspace'
                        : '/boost Perform a deep architectural & performance check of the current system and GPU state'
                    )
                  }
                  className="p-3 rounded-xl bg-[#17181B] hover:bg-[#1F2024] border border-[#282A2F] hover:border-[#3A3D45] transition-all cursor-pointer group space-y-1"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-[#E8EAED] group-hover:text-[#C084FC]">
                    <Cpu className="w-3.5 h-3.5 text-[#C084FC]" />
                    <span>
                      {brainProvider === 'google_ai_studio'
                        ? '/boost Deep Architecture Audit'
                        : '/boost Deep System Audit'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#6E6E73] leading-snug">
                    {brainProvider === 'google_ai_studio'
                      ? 'Engage deep frontier reasoning to inspect architecture, edge cases, and code quality'
                      : 'Engage Deep Thinking mode to inspect hardware, VRAM, and code quality'}
                  </p>
                </button>
              </div>
            )}
          </div>
        )}

        {messages.map((msg, index) => {
          const isCurrentTurnMsg = matchedTurnMsg
            ? msg.id === activeTurn?.messageId
            : index === lastAssistantIdx && msg.role === 'assistant';
          const isCurrentlyGenerating = isCurrentTurnMsg && turnActive;
          const thoughtDone = isCurrentlyGenerating
            ? (activeTurn?.thinkingFinished ?? isThinkingFinished)
            : true;
          const retryPrompt =
            onQuickSend && index > 0 && messages[index - 1]?.role === 'user'
              ? messages[index - 1].content
              : undefined;

          return (
            <ChatMessageRow
              key={msg.id}
              msg={msg}
              retryPrompt={retryPrompt}
              canRewind={index < messages.length - 1}
              isCurrentlyGenerating={isCurrentlyGenerating}
              thoughtDone={thoughtDone}
              streamingThought={isCurrentlyGenerating ? currentStreamingThought : ''}
              streamingElapsedMs={isCurrentlyGenerating ? currentThoughtElapsedMs : undefined}
              streamingTokens={isCurrentlyGenerating ? currentThoughtTokens : undefined}
              turnStatusLabel={isCurrentlyGenerating ? turnStatusLabel : undefined}
              turnError={isCurrentTurnMsg ? activeTurn?.error : undefined}
              apiBaseUrl={apiBaseUrl}
              artifacts={threadArtifacts}
              isCopied={copiedMsgId === msg.id}
              brainProvider={brainProvider}
              selectedGoogleModel={selectedGoogleModel}
              activeModelName={activeModelName}
              liveTokensPerSec={isCurrentlyGenerating ? tokensPerSec : 0}
              onOpenFile={openFileInEditor}
              onOpenSidecar={handleOpenSidecar}
              onOpenInWorkbench={handleOpenInWorkbench}
              onQuickSend={onQuickSend}
              onCopyMessage={handleCopyMessage}
              onBranchMessage={handleBranchMessage}
              onRewindMessage={handleRewindMessage}
              onOpenArtifact={handleOpenArtifact}
              onNestedInspectChange={handleNestedInspectChange}
              onNestedCollapseReset={handleNestedCollapseReset}
            />
          );
        })}

        {lastAssistantIdx === -1 && activeTurn?.error && (
          <div
            role="alert"
            className="my-2 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 text-rose-200 text-[13px] leading-relaxed"
          >
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 break-words">{activeTurn.error}</div>
          </div>
        )}
        </div>
      </div>

      {showJumpToLatest && (
        <button
          type="button"
          onClick={handleJumpToLatest}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#1C1D20]/95 hover:bg-[#26282D] border border-[#3C4043] text-[#E8EAED] text-[12px] font-medium shadow-lg backdrop-blur-sm transition-all cursor-pointer"
        >
          <span>↓ Jump to latest</span>
        </button>
      )}
    </div>
  );
};
