'use client';

import { useState } from 'react';
import type { Phase } from '@/hooks/useSupabase';
import { parseYMD, phaseWindowMs } from '@/alcon/shared/phaseWindow';

// =============================================================
// PhaseBurnup — the plan layer's one instrument for "are we going to make
// it". Lives here rather than in PhaseView because Phase is not the only
// surface that asks: a Campaign asks it too, of the slice of a Phase its own
// Objects own. Same chart, different scope — the caller does the counting and
// passes the tallies in, so nothing here knows what a Campaign is.
// =============================================================

// Burn-up panel for the current Phase. We keep no historical snapshots, so
// this draws what's honestly known: weekend bands + a muted wash over the
// remaining days, the dashed ideal line (0 → scope by the end date), and
// straight guide lines from the start to today's live Started / Completed
// tallies — trend since the phase began, not a day-by-day record.
export function PhaseBurnup({
  phase,
  scope,
  started,
  completed,
}: {
  phase: Phase;
  scope: number;
  started: number;
  completed: number;
}) {
  // Sampled once, in a state initialiser rather than in the render body, and
  // above every early return so the hook order cannot depend on the props. The
  // clock is not a pure input: a render that reads it produces a different tree
  // from the same props, which is exactly the render React is free to run twice
  // and throw away. One sample per mount also means the marker and the lines
  // that are supposed to meet it are drawn against the same instant.
  const [now] = useState(() => Date.now());

  const W = 640, H = 190, padL = 8, padR = 8, padT = 16, padB = 30;
  const window = phaseWindowMs(phase);
  if (!window) return null;
  const { t0, t1 } = window;
  const x = (t: number) => padL + ((W - padL - padR) * (t - t0)) / (t1 - t0);
  const yMax = Math.max(scope, 1);
  const y = (v: number) => H - padB - ((H - padT - padB) * v) / yMax;

  const tNow = Math.max(t0, Math.min(now, t1));

  // Weekend bands + weekly tick marks, walked day by day.
  const weekendRects: { x1: number; x2: number }[] = [];
  const ticks: { x: number; label: string }[] = [];
  const day = 24 * 60 * 60 * 1000;
  const startD = parseYMD(phase.start_date!);
  ticks.push({ x: x(t0), label: fmtDate(phase.start_date)! });
  for (let t = t0; t < t1; t += day) {
    const d = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate() + Math.round((t - t0) / day));
    if (d.getDay() === 6) {
      weekendRects.push({ x1: x(t), x2: x(Math.min(t + 2 * day, t1)) });
    }
    // A tick each Monday, skipping ones that crowd the endpoints.
    if (d.getDay() === 1 && t - t0 > 2 * day && t1 - t > 2 * day) {
      ticks.push({ x: x(t), label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
    }
  }
  ticks.push({ x: x(t1), label: fmtDate(phase.end_date)! });

  const hatchId = `phase-hatch-${phase.id}`;
  const baseline = H - padB;

  return (
    <div className="flex items-center gap-10 pb-8 pl-8 pr-2">
      <div className="flex-1 min-w-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="Phase burn-up">
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--border)" strokeWidth="1.5" />
            </pattern>
          </defs>

          {/* Weekends */}
          {weekendRects.map((r, i) => (
            <rect key={i} x={r.x1} y={padT} width={r.x2 - r.x1} height={baseline - padT} fill={`url(#${hatchId})`} opacity={0.5} />
          ))}
          {/* Remaining days — a quiet wash from today to the end. */}
          {tNow < t1 && (
            <rect x={x(tNow)} y={padT} width={x(t1) - x(tNow)} height={baseline - padT} fill="var(--muted)" opacity={0.18} />
          )}

          {/* Baseline + today marker */}
          <line x1={padL} y1={baseline} x2={W - padR} y2={baseline} stroke="var(--border)" strokeWidth="1" />
          <line x1={x(tNow)} y1={padT} x2={x(tNow)} y2={baseline} stroke="var(--border)" strokeWidth="1" />

          {scope > 0 && (
            <>
              {/* Scope level (assumed flat — no snapshot history). */}
              <line x1={x(t0)} y1={y(scope)} x2={x(tNow)} y2={y(scope)} stroke="var(--muted-foreground)" strokeWidth="1.5" opacity={0.5} />
              {/* Ideal: everything done by the end. */}
              <line x1={x(t0)} y1={y(0)} x2={x(t1)} y2={y(scope)} stroke="var(--status-success)" strokeWidth="1.5" strokeDasharray="2 4" opacity={0.6} />
              {/* Started / Completed since the phase began — the chart's
                  own warm/cool pair (see --chart-started/--chart-completed),
                  kept distinct from the green Ideal line above. */}
              <line x1={x(t0)} y1={y(0)} x2={x(tNow)} y2={y(started + completed)} stroke="var(--chart-started)" strokeWidth="1.5" />
              <line x1={x(t0)} y1={y(0)} x2={x(tNow)} y2={y(completed)} stroke="var(--chart-completed)" strokeWidth="1.5" />
              <circle cx={x(tNow)} cy={y(started + completed)} r={3} fill="var(--chart-started)" />
              <circle cx={x(tNow)} cy={y(completed)} r={3} fill="var(--chart-completed)" />
            </>
          )}
          {/* Start dot on the baseline (matches the rail's filled dot). */}
          <circle cx={x(t0)} cy={baseline} r={3} fill="var(--primary)" />

          {/* Date ticks */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={t.x} y1={baseline} x2={t.x} y2={baseline + 4} stroke="var(--border)" strokeWidth="1" />
              <text
                x={t.x}
                y={baseline + 18}
                textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
                className="fill-[var(--text-tertiary)]"
                fontSize="11"
              >
                {t.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Legend — live tallies. */}
      <div className="w-60 shrink-0 text-[12px]">
        <div className="flex items-center gap-2 py-2.5 border-b border-border/50">
          <span aria-hidden className="size-2 rounded-[2px] bg-muted-foreground/60 shrink-0" />
          <span className="text-foreground/90 flex-1">Scope</span>
          <span className="text-foreground font-medium tabular-nums">{scope}</span>
        </div>
        <div className="flex items-center gap-2 py-2.5 border-b border-border/50">
          <span aria-hidden className="size-2 rounded-[2px] bg-[var(--chart-started)] shrink-0" />
          <span className="text-foreground/90 flex-1">Started</span>
          <span className="text-foreground font-medium tabular-nums">{started}</span>
          <span className="text-muted-foreground tabular-nums">· {scope > 0 ? Math.round((started / scope) * 100) : 0}%</span>
        </div>
        <div className="flex items-center gap-2 py-2.5">
          <span aria-hidden className="size-2 rounded-[2px] bg-[var(--chart-completed)] shrink-0" />
          <span className="text-foreground/90 flex-1">Completed</span>
          <span className="text-foreground font-medium tabular-nums">{completed}</span>
          <span className="text-muted-foreground tabular-nums">· {scope > 0 ? Math.round((completed / scope) * 100) : 0}%</span>
        </div>
      </div>
    </div>
  );
}

// 'YYYY-MM-DD' → "Jul 14" (local, no timezone drift on bare dates).
function fmtDate(s: string | null): string | null {
  if (!s) return null;
  const [y, m, d] = s.split('T')[0].split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
