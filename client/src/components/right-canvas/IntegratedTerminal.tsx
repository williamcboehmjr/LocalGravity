import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Terminal, Play, Trash2 } from 'lucide-react';
import { useSessionStore } from '../../store/useSessionStore';

export const IntegratedTerminal: React.FC = () => {
  const { hostUrl } = useSessionStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [quickCmd, setQuickCmd] = useState('');

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: '#101012',
        foreground: '#E3E3E3',
        cursor: '#8AB4F8',
        selectionBackground: 'rgba(138, 180, 248, 0.3)',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {}
    }, 50);

    xtermRef.current = term;

    const cleanHost = hostUrl.replace(/^http/, 'ws');
    const ws = new WebSocket(`${cleanHost}/ws/terminal`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'TERMINAL_HISTORY' || msg.type === 'TERMINAL_OUTPUT') {
          term.write(msg.chunk || '');
        }
      } catch {
        term.write(ev.data);
      }
    };

    const disp = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'TERMINAL_INPUT', data }));
      }
    });

    const onResize = () => {
      try {
        fitAddon.fit();
      } catch {}
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      disp.dispose();
      ws.close();
      term.dispose();
    };
  }, [hostUrl]);

  const handleRunQuickCmd = () => {
    if (!quickCmd.trim()) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'TERMINAL_EXEC', command: quickCmd.trim() }));
      setQuickCmd('');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#101012]">
      {/* Terminal Toolbar */}
      <div className="p-2 bg-[#101012] border-b border-[#222226] flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-[#E3E3E3] font-mono">
          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
          <span>Shared PTY Shell (PowerShell / Zsh)</span>
        </div>

        <button
          type="button"
          onClick={() => xtermRef.current?.clear()}
          className="p-1 rounded hover:bg-[#242427] text-[#9A9A9E] hover:text-[#E3E3E3]"
          title="Clear Terminal"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Quick Command Input Bar */}
      <div className="p-2 bg-[#131314] border-b border-[#222226] flex items-center gap-1.5">
        <input
          type="text"
          value={quickCmd}
          onChange={(e) => setQuickCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRunQuickCmd();
          }}
          placeholder="Run shared command (e.g. git status)..."
          className="flex-1 bg-[#18181B] border border-[#2C2C30] focus:border-[#8AB4F8] rounded-lg px-2.5 py-1 text-xs font-mono text-[#E3E3E3] outline-none"
        />
        <button
          type="button"
          onClick={handleRunQuickCmd}
          className="px-2.5 py-1 rounded-lg bg-[#242427] hover:bg-[#2E2E32] border border-[#34343A] text-[#E3E3E3] text-xs font-medium flex items-center gap-1"
        >
          <Play className="w-3 h-3" />
          <span>Run</span>
        </button>
      </div>

      {/* xterm.js Canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 p-2 overflow-hidden" />
    </div>
  );
};
