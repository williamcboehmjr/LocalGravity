interface ReconnectBadgeProps {
  secondsRemaining: number;
  totalSeconds: number; // initial countdown value (e.g. 3)
  attempt: number;
  /** Header text. Defaults to "Reconnecting" for backward compatibility. */
  label?: string;
  /** Tailwind color tone for the ring + accents. amber = reconnect, sky = generic timer. */
  tone?: 'amber' | 'sky';
}

/** Tone-driven color tokens so the badge can render for any timed operation. */
const TONES = {
  amber: {
    border: 'border-amber-500/40',
    bg: 'bg-[#1a1714]/95',
    track: '#3a2d1c',
    arc: '#f59e0b',
    number: 'text-amber-200',
    title: 'text-amber-100',
    attempt: 'text-amber-400/70',
    pulse: 'bg-amber-400',
  },
  sky: {
    border: 'border-sky-500/40',
    bg: 'bg-[#14233a]/95',
    track: '#1c2d3a',
    arc: '#38bdf8',
    number: 'text-sky-200',
    title: 'text-sky-100',
    attempt: 'text-sky-400/70',
    pulse: 'bg-sky-400',
  },
} as const;

/**
 * A self-contained, live SVG ring badge that visually counts down any timed
 * operation: server reconnection, model load, download, deploy, etc.
 * The ring sweeps from full to empty as secondsRemaining ticks toward 0.
 */
export function ReconnectBadge({
  secondsRemaining,
  totalSeconds,
  attempt,
  label = 'Reconnecting',
  tone = 'amber',
}: ReconnectBadgeProps) {
  const size = 56;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // fraction of time remaining: totalSeconds -> secondsRemaining maps to full->empty ring.
  const safeTotal = Math.max(totalSeconds, 1);
  const progress = Math.min(Math.max(secondsRemaining, 0), safeTotal) / safeTotal;
  const dashoffset = circumference * (1 - progress);

  const t = TONES[tone];

  return (
    <div className={`flex items-center gap-3 rounded-lg border ${t.border} ${t.bg} px-3 py-2 shadow-lg backdrop-blur-sm select-none`}>
      {/* Ring + centered seconds number */}
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={`${label} in ${secondsRemaining}s`}
        >
          {/* track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={t.track}
            strokeWidth={stroke}
          />
          {/* live progress arc (sweeps as countdown ticks) */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={t.arc}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        {/* centered seconds number overlaid on ring */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`font-mono text-lg font-bold ${t.number} tabular-nums leading-none`}>
            {secondsRemaining > 0 ? secondsRemaining : '··'}
          </span>
        </div>
      </div>

      {/* Text block */}
      <div className="flex flex-col leading-tight">
        <span className={`text-[12px] font-semibold ${t.title}`}>{label}</span>
        {attempt > 0 && (
          <span className={`font-mono text-[11px] ${t.attempt} tabular-nums`}>
            Attempt #{attempt}
          </span>
        )}
      </div>

      {/* pulse indicator */}
      <span className={`h-2 w-2 shrink-0 rounded-full ${t.pulse} animate-ping`} />
    </div>
  );
}
