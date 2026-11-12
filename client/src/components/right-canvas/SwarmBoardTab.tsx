import React, { useState } from 'react';
import {
  Network,
  MessageSquare,
  Users,
  GitBranch,
  Send,
  Skull,
  Circle,
} from 'lucide-react';
import { useSessionStore, SwarmMemberState } from '../../store/useSessionStore';

type SwarmSubTab = 'feed' | 'roster' | 'graph';

const STATE_BADGE: Record<SwarmMemberState, string> = {
  working: 'bg-[#8AB4F8]/15 text-[#8AB4F8] border-[#8AB4F8]/40',
  waiting: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  stopped: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  killed: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

function renderMentions(text: string): React.ReactNode {
  const parts = text.split(/(@[a-zA-Z0-9_-]+)/g);
  return parts.map((p, idx) =>
    /^@[a-zA-Z0-9_-]+$/.test(p) ? (
      <span
        key={idx}
        className="inline-block px-1.5 py-0.2 rounded bg-[#8AB4F8]/15 text-[#8AB4F8] font-mono text-[11px] border border-[#8AB4F8]/30 mx-0.5"
      >
        {p}
      </span>
    ) : (
      <React.Fragment key={idx}>{p}</React.Fragment>
    )
  );
}

/** Live Swarm Board right-pane tab (Feed, Roster, @mention Graph). */
export const SwarmBoardTab: React.FC = () => {
  const swarmState = useSessionStore((s) => s.swarmState);
  const apiBaseUrl = useSessionStore((s) => s.apiBaseUrl);
  const sessionId = useSessionStore((s) => s.sessionId);

  const [subTab, setSubTab] = useState<SwarmSubTab>('feed');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  if (!swarmState) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2 bg-[#131314] text-[#8E8E93]">
        <Network className="w-7 h-7 text-[#5F6368]" />
        <div className="text-xs font-medium text-[#E3E3E3]">No active Swarm on this thread</div>
        <div className="text-[11px] max-w-xs text-[#6E6E73]">
          Start a multi-agent swarm with <code className="text-[#8AB4F8]">/swarm</code> in the prompt bar.
        </div>
      </div>
    );
  }

  const channels = Array.from(new Set(swarmState.messages.map((m) => m.channel || 'main')));
  const filteredMessages =
    channelFilter === 'all'
      ? swarmState.messages
      : swarmState.messages.filter((m) => (m.channel || 'main') === channelFilter);

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`${apiBaseUrl}/api/swarm/${encodeURIComponent(sessionId)}/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft.trim(), channel: channelFilter === 'all' ? 'main' : channelFilter }),
      });
      setDraft('');
    } catch {}
    setSending(false);
  };

  const handleKill = async (name: string) => {
    try {
      await fetch(
        `${apiBaseUrl}/api/swarm/${encodeURIComponent(sessionId)}/kill/${encodeURIComponent(name)}`,
        { method: 'POST' }
      );
    } catch {}
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 text-xs bg-[#131314]">
      {/* Header + Sub-tabs */}
      <div className="px-3 py-2 bg-[#161618] border-b border-[#222226] space-y-2 shrink-0 select-none">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Network className="w-3.5 h-3.5 text-[#8AB4F8] shrink-0" />
            <span className="font-medium text-[#E8EAED] truncate">{swarmState.title || 'Swarm Board'}</span>
          </div>
          <span className="px-1.5 py-0.5 rounded bg-[#222327] text-[#9AA0A6] font-mono text-[10px] shrink-0">
            head #{swarmState.head} • {swarmState.status}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {([
            { id: 'feed', label: `Feed (${swarmState.messages.length})`, icon: <MessageSquare className="w-3 h-3" /> },
            { id: 'roster', label: `Roster (${swarmState.members.length})`, icon: <Users className="w-3 h-3" /> },
            { id: 'graph', label: 'Graph', icon: <GitBranch className="w-3 h-3" /> },
          ] as const).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                subTab === t.id
                  ? 'bg-[#242529] text-[#E8EAED] border border-[#34363C]'
                  : 'text-[#8E8E93] hover:text-[#E8EAED] hover:bg-[#1C1D20]'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* FEED */}
      {subTab === 'feed' && (
        <>
          {channels.length > 1 && (
            <div className="flex items-center gap-1 px-3 py-1.5 bg-[#141518] border-b border-[#222226] overflow-x-auto shrink-0">
              {['all', ...channels].map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannelFilter(ch)}
                  className={`px-2 py-0.5 rounded text-[10.5px] font-mono cursor-pointer ${
                    channelFilter === ch
                      ? 'bg-[#8AB4F8]/20 text-[#8AB4F8] border border-[#8AB4F8]/40'
                      : 'text-[#8E8E93] hover:text-[#E3E3E3]'
                  }`}
                >
                  {ch === 'all' ? 'all' : `#${ch}`}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredMessages.length === 0 ? (
              <div className="text-[11px] text-[#6E6E73] text-center py-6">No messages posted yet.</div>
            ) : (
              filteredMessages.map((m) => (
                <div
                  key={m.seq}
                  className="p-2.5 rounded-lg bg-[#17181B] border border-[#242529] space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-[10.5px] text-[#8E8E93]">
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-[#5F6368]">#{m.seq}</span>
                      <span className="font-semibold text-[#E8EAED]">{m.agent}</span>
                      {m.channel && m.channel !== 'main' && (
                        <span className="text-[#8AB4F8]">#{m.channel}</span>
                      )}
                      {m.kind && (
                        <span className="px-1 rounded bg-[#222327] text-[#9AA0A6] text-[9.5px]">
                          {m.kind}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[12px] text-[#D4D4D8] whitespace-pre-wrap leading-relaxed">
                    {renderMentions(m.text)}
                  </div>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={handlePost}
            className="p-2.5 border-t border-[#222226] bg-[#161618] flex items-center gap-1.5 shrink-0"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Post to board (@name or @all)..."
              className="flex-1 bg-[#0E0F11] border border-[#2C2D32] focus:border-[#8AB4F8] rounded-lg px-2.5 py-1.5 text-xs text-[#E8EAED] outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="px-2.5 py-1.5 rounded-lg bg-[#8AB4F8] hover:bg-[#A8C7FA] text-[#101114] font-semibold flex items-center gap-1 disabled:opacity-40 cursor-pointer"
            >
              <Send className="w-3 h-3" />
            </button>
          </form>
        </>
      )}

      {/* ROSTER */}
      {subTab === 'roster' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {swarmState.members.map((mem) => (
            <div
              key={mem.id || mem.name}
              className="p-2.5 rounded-lg bg-[#17181B] border border-[#242529] space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Circle
                    className={`w-2 h-2 fill-current shrink-0 ${
                      mem.state === 'working'
                        ? 'text-[#8AB4F8] animate-pulse'
                        : mem.state === 'waiting'
                        ? 'text-emerald-400'
                        : mem.state === 'killed'
                        ? 'text-rose-400'
                        : 'text-amber-400'
                    }`}
                  />
                  <span className="font-mono font-semibold text-[#E8EAED] truncate">{mem.name}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                      STATE_BADGE[mem.state] || STATE_BADGE.waiting
                    }`}
                  >
                    {mem.state}
                  </span>
                </div>

                {mem.name !== 'coordinator' && mem.state !== 'killed' && (
                  <button
                    type="button"
                    onClick={() => handleKill(mem.name)}
                    className="px-1.5 py-0.5 rounded bg-[#222327] hover:bg-rose-950/60 text-[#9AA0A6] hover:text-rose-300 text-[10.5px] flex items-center gap-1 cursor-pointer"
                    title={`Kill ${mem.name}`}
                  >
                    <Skull className="w-3 h-3" />
                    <span>Kill</span>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-mono text-[#8E8E93]">
                {mem.model && <span>model: {mem.model}</span>}
                {mem.workspace_mode && <span>ws: {mem.workspace_mode}</span>}
                <span>read #{mem.last_read_seq ?? 0}</span>
                <span>post #{mem.last_post_seq ?? 0}</span>
              </div>

              {mem.brief && (
                <div className="text-[11px] text-[#9AA0A6] line-clamp-2 leading-snug">{mem.brief}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* GRAPH */}
      {subTab === 'graph' && <SwarmMentionGraph members={swarmState.members.map((m) => m.name)} messages={swarmState.messages} />}
    </div>
  );
};

const SwarmMentionGraph: React.FC<{
  members: string[];
  messages: Array<{ seq: number; agent: string; text: string; mentions?: string[] }>;
}> = ({ members, messages }) => {
  const nodes = Array.from(
    new Set([
      'coordinator',
      ...members,
      ...messages.map((m) => m.agent).filter(Boolean),
    ])
  );

  // Build weighted directed edges agent -> mentioned
  const edgeCounts = new Map<string, { from: string; to: string; count: number }>();
  for (const m of messages) {
    const found =
      m.mentions && m.mentions.length > 0
        ? m.mentions
        : Array.from(m.text.matchAll(/@([a-zA-Z0-9_-]+)/g)).map((x) => x[1]);
    for (const target of found) {
      if (target === 'all') {
        for (const n of nodes) {
          if (n !== m.agent) {
            const k = `${m.agent}->${n}`;
            edgeCounts.set(k, { from: m.agent, to: n, count: (edgeCounts.get(k)?.count || 0) + 1 });
          }
        }
      } else if (nodes.includes(target) && target !== m.agent) {
        const k = `${m.agent}->${target}`;
        edgeCounts.set(k, { from: m.agent, to: target, count: (edgeCounts.get(k)?.count || 0) + 1 });
      }
    }
  }

  const W = 340;
  const H = 260;
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(cx, cy) - 48;
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    pos.set(n, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  });

  const edges = Array.from(edgeCounts.values());

  return (
    <div className="flex-1 overflow-auto p-3 flex flex-col items-center justify-center bg-[#101113]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-sm h-64">
        <defs>
          <marker id="swarm-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#8AB4F8" />
          </marker>
        </defs>

        {edges.map((e) => {
          const p1 = pos.get(e.from);
          const p2 = pos.get(e.to);
          if (!p1 || !p2) return null;
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          return (
            <line
              key={`${e.from}->${e.to}`}
              x1={p1.x + ux * 20}
              y1={p1.y + uy * 20}
              x2={p2.x - ux * 24}
              y2={p2.y - uy * 24}
              stroke="#8AB4F8"
              strokeOpacity={0.55}
              strokeWidth={Math.min(3.5, 1 + e.count * 0.4)}
              markerEnd="url(#swarm-arrow)"
            />
          );
        })}

        {nodes.map((n) => {
          const p = pos.get(n)!;
          return (
            <g key={n} transform={`translate(${p.x}, ${p.y})`}>
              <circle r="18" fill="#1C1D20" stroke={n === 'coordinator' ? '#8AB4F8' : '#3C4043'} strokeWidth="1.5" />
              <text
                y="30"
                textAnchor="middle"
                fill="#E3E3E3"
                fontSize="10"
                fontFamily="monospace"
              >
                {n}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="text-[10.5px] text-[#6E6E73]">
        {edges.length === 0 ? 'No @mention handoffs recorded yet.' : `${edges.length} directed @mention paths`}
      </div>
    </div>
  );
};
