'use client';

/** A thin bar for a load ratio. Amber from 85%, red past 100% — the same
 *  thresholds wherever a load is shown, so a colour means one thing. */
export function LoadMeter({ value, className = '' }: { value: number; className?: string }) {
  const fill = Math.min(Math.max(value, 0), 1) * 100;
  const color = value > 1 ? 'var(--status-danger)' : value > 0.85 ? 'var(--status-warning)' : 'var(--accent-default)';
  return (
    <span className={`relative block h-1 overflow-hidden rounded-full bg-[var(--surface-strong)] ${className}`} aria-hidden="true">
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fill}%`, background: color }} />
    </span>
  );
}
