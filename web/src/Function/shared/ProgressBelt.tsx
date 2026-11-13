import type React from 'react';
import { cn } from '@/lib/utils';
import { beltGradient } from '@/Function/shared/pace';

/**
 * Progress as a belt, in the Timeline's own manner: a quiet rounded track and a
 * fill that is clear at its start and deepens smoothly to its edge — the key
 * blue when the work is likely to make its date, red when it is not
 * (`outlook`, -1…1, from Function/shared/pace; left out, blue). The shared
 * progress visual for Object lists, detail rails and Strategy rows.
 */
export function ProgressBelt({ value, outlook = 0, className = '', style }: { value: number; outlook?: number; className?: string; style?: React.CSSProperties }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('relative h-2.5 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-foreground/[0.07]', className)}
      style={style}
    >
      {clamped > 0 && (
        <div className="absolute inset-y-0 left-0 rounded-[inherit]" style={{ width: `${clamped}%`, backgroundImage: beltGradient(outlook) }} />
      )}
    </div>
  );
}
