import React, { useEffect, useRef, useState } from 'react';

interface CountdownPillProps {
  /** Total seconds for one cycle (e.g. reconnect poll interval). */
  durationSeconds: number;
  /** Human label shown under the ring (Reconnecting / Downloading model / Deploying). */
  label: string;
  /** Tailwind color family for ring + text. */
  tone?: 'amber' | 'sky' | 'emerald';
}

const TONE = {
  amber: { stroke: '#f59e0b', text: 'text-amber-300', bg: 'bg-amber-400/15', ring: 'ring-amber-400/30' },
  sky:   { stroke: '#38bdf8', text: 'text-sky-300',   bg: 'bg-sky-400/15',     ring: 'ring-sky-400/30' },
  emerald:{stroke: '#34d399', text: 'text-emerald-300',bg:'bg-emerald-400/15',  ring: 'ring-emerald-400/30' },
} as const;

/**
 * Generic countdown pill. Counts down every second, drains an SVG ring,
 * flips to READY at zero, then loops. Reusable for ANY timed task:
 * reconnect attempts, model downloads, deploys, etc. Pass duration + label + tone.
 */
export const CountdownPill: React.FC<CountdownPillProps> = ({
  durationSeconds,
  label,
  tone = 'amber',
}) => {
  const [remaining, setRemaining] = useState(durationSeconds);
  const ready = remaining <= 0;
  const t = TONE[tone];

  // Ref keeps latest duration for the interval closure.
  const durRef = useRef(durationSeconds);
  durRef.current = durationSeconds;

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((r) => (r <= 1 ? durRef.current : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Reset when duration prop changes.
  useEffect(() => {
    setRemaining(durationSeconds);
  }, [durationSeconds]);

  const frac = durationSeconds > 0 ? remaining / durationSeconds : 0;
  const R = 15;
  const C = 2 * Math.PI * R;
  const dashOffset = C * (1 - frac); // sweep drains as time elapses

  return (
    <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${t.bg} ring-1 ${t.ring}`}>
      {/* SVG countdown ring */}
      <svg width="34" height="34" viewBox="0 0 34 34" className="shrink-0">
        <circle cx="17" cy="17" r={R} fill="none" stroke="#2a2b2d" strokeWidth="3" />
        <circle
          cx="17"
          cy="17"
          r={R}
          fill="none"
          stroke={t.stroke}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 17 17)"
        />
        <text x="17" y="17" textAnchor="middle" dominantBaseline="central" className={`fill-current ${t.text}`} fontSize="10" fontWeight="600">
          {ready ? '✓' : remaining}
        </text>
      </svg>

      {/* Label + status line */}
      <div className="flex flex-col leading-tight min-w-0">
        <span className={`text-[12px] font-semibold ${t.text}`}>
          {ready ? 'Ready' : label}
        </span>
        <span className="text-[10px] text-[#6E6E73] truncate max-w-[120px]">
          {ready ? `Polling · retry in 0s` : `Counting down · ${remaining}s`}
        </span>
      </div>
    </div>
  );
};
