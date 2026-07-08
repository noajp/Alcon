'use client';

import { useLayoutEffect, useRef, useState } from 'react';

// Fixed tick geometry — 5px-wide, 10px-tall rounded pills with a 3px gap,
// packed to fill whatever width the parent gives the bar.
const SEG_W = 5;
const SEG_H = 10;
const SEG_GAP = 3;

/**
 * Segmented progress bar — a row of small vertical pills, the leading share
 * filled to `value`%. The shared progress visual for Object lists / detail
 * rails / Strategy scope rows (replaces the old continuous h-1.5 bar).
 * Neutral greys only; no per-status colouring.
 */
export function SegmentedProgress({ value, className = '' }: { value: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(0);

  // Tick count follows the measured width (rails / table cells / flex rows
  // all give this different space), re-packing live on resize.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setCount(Math.max(1, Math.floor((w + SEG_GAP) / (SEG_W + SEG_GAP))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((count * clamped) / 100);

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`flex items-center overflow-hidden ${className}`}
      style={{ gap: SEG_GAP, height: SEG_H }}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`shrink-0 rounded-full ${i < filled ? 'bg-foreground/70' : 'bg-muted-foreground/25'}`}
          style={{ width: SEG_W, height: SEG_H }}
        />
      ))}
    </div>
  );
}
