'use client';

import { useId, useMemo, useState } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { TypeMark, useTypeIcons } from '@/Function/shared/elementTypeIcon';
import { labelColor } from '@/Function/shared/labelColor';
import { Tag, User } from '@/ui/icons';
import { useElementMoveTimes } from '@/hooks/elementActivity';
import {
  buildProgressSeries, progressBreakdown, type ProgressAxis, type ProgressItem, type ProgressSeries,
} from '@/Function/shared/progressModel';
import type { ElementWithDetails } from '@/types/database';

// Progress: how a body of work is moving. Three counts — everything in
// scope, what has been started, what is done — over a chart of the same
// three through time (weekly completions as bars under them, today marked,
// the days ahead shaded, a dotted line to where "done" has to reach), and
// the done share split by assignee, label or type.
//
// The key color is "done"; "started" is a matte red; scope is the quiet
// grey line the other two climb toward.

const SCOPE = 'var(--text-tertiary)';
const STARTED = 'color-mix(in oklab, var(--status-danger) 72%, var(--card))';
const DONE = 'var(--accent-default)';

const AXES: { id: ProgressAxis; label: string }[] = [
  { id: 'assignee', label: 'Assignees' },
  { id: 'label', label: 'Labels' },
  { id: 'type', label: 'Types' },
];

export function ProgressPanel({ elements, end }: {
  elements: ElementWithDetails[];
  /** The target date ('yyyy-MM-dd'), when the work has one. */
  end?: string | null;
}) {
  const { t } = useI18n();
  const [now] = useState(() => Date.now());
  const [axis, setAxis] = useState<ProgressAxis>('assignee');
  const items = useMemo<ProgressItem[]>(() => elements.map((e) => ({
    id: e.id, status: e.status ?? null, createdAt: e.created_at ?? null, startDate: e.start_date ?? null,
    dueDate: e.due_date ?? null, updatedAt: e.updated_at ?? null, type: e.type ?? null,
    labels: Array.isArray(e.labels) ? e.labels.filter((l): l is string => typeof l === 'string') : [],
    assignees: (e.assignees ?? []).flatMap((a) => (a.worker ? [{ id: a.worker.id, name: a.worker.name }] : [])),
  })), [elements]);
  const moves = useElementMoveTimes(useMemo(() => items.map((i) => i.id), [items]));
  const series = useMemo(() => buildProgressSeries(items, moves, now, end), [items, moves, now, end]);
  const slices = useMemo(() => progressBreakdown(items, axis), [items, axis]);
  const workers = useMemo(() => new Map(elements.flatMap((e) => (e.assignees ?? []).flatMap((a) => (a.worker ? [[a.worker.id, a.worker] as const] : [])))), [elements]);
  const typeIcons = useTypeIcons('element');

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat color={SCOPE} label={t('Scope')} value={series.totals.scope} />
        <Stat color={STARTED} label={t('Started')} value={series.totals.started} />
        <Stat color={DONE} label={t('Completed')} value={series.totals.completed} />
      </div>

      <ProgressChart series={series} />

      <div className="flex gap-1.5" role="tablist" aria-label={t('Progress')}>
        {AXES.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={axis === a.id} onClick={() => setAxis(a.id)}
            className={`h-7 flex-1 rounded-full text-[12px] transition-colors ${axis === a.id ? 'bg-muted text-foreground' : 'border border-border/60 text-muted-foreground hover:text-foreground'}`}>
            {t(a.label)}
          </button>
        ))}
      </div>

      <ul className="flex flex-col">
        {slices.map((s) => {
          const share = s.total > 0 ? s.done / s.total : 0;
          const worker = axis === 'assignee' && s.key ? workers.get(s.key) : undefined;
          return (
            <li key={s.key || '_none'} className="flex h-9 min-w-0 items-center gap-2.5 text-[13px]">
              <span className="flex w-5 shrink-0 justify-center text-muted-foreground">
                {axis === 'assignee' ? (worker ? <WorkerAvatar worker={worker} size={20} /> : <User size={14} />)
                  : axis === 'label' ? <Tag size={13} style={s.key ? { color: labelColor(s.key) } : undefined} />
                  : <TypeMark type={s.key || null} icons={typeIcons} size={14} />}
              </span>
              <span className={`min-w-0 flex-1 truncate ${s.key ? 'text-foreground' : 'text-muted-foreground'}`}>
                {s.key ? s.label : axis === 'assignee' ? t('No assignee') : axis === 'label' ? t('No label') : t('No type')}
              </span>
              <Ring share={share} />
              <span className="w-[84px] shrink-0 text-right tabular-nums text-muted-foreground">
                {t('{pct}% of {n}', { pct: Math.round(share * 100), n: s.total })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stat({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/** A small ring filled to `share` (0–1), in the key color. */
function Ring({ share }: { share: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--border-default)" strokeWidth="2" />
      <circle cx="8" cy="8" r={r} fill="none" stroke={DONE} strokeWidth="2" strokeLinecap="round"
        strokeDasharray={`${c * Math.min(1, Math.max(0, share))} ${c}`} transform="rotate(-90 8 8)" />
    </svg>
  );
}

const W = 320, H = 168, PAD_T = 10, PAD_B = 24, PAD_X = 2;

function ProgressChart({ series }: { series: ProgressSeries }) {
  const { locale } = useI18n();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { t0, t1, now, points, weeks, totals } = series;
  const span = Math.max(1, t1 - t0);
  const yMax = Math.max(1, totals.scope);
  const x = (t: number) => PAD_X + ((W - 2 * PAD_X) * (t - t0)) / span;
  const y = (v: number) => H - PAD_B - ((H - PAD_T - PAD_B) * v) / yMax;
  const base = y(0);
  const line = (pick: (p: ProgressSeries['points'][number]) => number) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t).toFixed(1)} ${y(pick(p)).toFixed(1)}`).join(' ');
  const last = points.at(-1);
  const xNow = x(Math.min(now, t1));
  const weekMax = Math.max(1, ...weeks.map((w) => w.completed));
  const day = (t: number) => new Date(t).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Progress over time">
      <defs>
        <linearGradient id={`${id}-done`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: DONE, stopOpacity: 0.32 }} />
          <stop offset="100%" style={{ stopColor: DONE, stopOpacity: 0 }} />
        </linearGradient>
        <pattern id={`${id}-ahead`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: STARTED, strokeOpacity: 0.28 }} strokeWidth="1.5" />
        </pattern>
      </defs>

      {/* The days ahead, shaded; today, a line. */}
      {xNow < W - PAD_X && <rect x={xNow} y={PAD_T} width={W - PAD_X - xNow} height={base - PAD_T} fill={`url(#${id}-ahead)`} />}

      {/* Weekly completions, as bars on the floor. */}
      {weeks.map((w) => w.completed > 0 && (
        <rect key={w.t} x={x(w.t) + 1} width={Math.max(2, (W - 2 * PAD_X) * (5 * 86_400_000) / span)} rx="1"
          y={base - (H * 0.26 * w.completed) / weekMax} height={(H * 0.26 * w.completed) / weekMax} style={{ fill: DONE, fillOpacity: 0.85 }} />
      ))}

      {last && (
        <>
          <path d={`${line((p) => p.completed)} L ${x(last.t).toFixed(1)} ${base} L ${x(points[0].t).toFixed(1)} ${base} Z`} fill={`url(#${id}-done)`} />
          <path d={line((p) => p.scope)} fill="none" style={{ stroke: SCOPE }} strokeWidth="1.5" strokeLinejoin="round" />
          <path d={line((p) => p.started)} fill="none" style={{ stroke: STARTED }} strokeWidth="1.75" strokeLinejoin="round" />
          <path d={line((p) => p.completed)} fill="none" style={{ stroke: DONE }} strokeWidth="1.75" strokeLinejoin="round" />
          {/* Where each line has to go from here: all of scope by the right edge. */}
          <line x1={xNow} y1={y(last.scope)} x2={x(t1)} y2={y(last.scope)} style={{ stroke: SCOPE }} strokeWidth="1.5" />
          <line x1={xNow} y1={y(last.started)} x2={x(t1)} y2={y(last.scope)} style={{ stroke: STARTED }} strokeWidth="1" strokeDasharray="2 3" />
          <line x1={xNow} y1={y(last.completed)} x2={x(t1)} y2={y(last.scope)} style={{ stroke: DONE }} strokeWidth="1" strokeDasharray="2 3" />
          <circle cx={xNow} cy={y(last.started)} r="3" style={{ fill: STARTED }} />
          <circle cx={xNow} cy={y(last.completed)} r="3" style={{ fill: DONE }} />
        </>
      )}
      <line x1={xNow} y1={PAD_T - 4} x2={xNow} y2={base} style={{ stroke: 'var(--status-danger)' }} strokeWidth="1" />

      <line x1={PAD_X} y1={base} x2={W - PAD_X} y2={base} style={{ stroke: 'var(--border-default)' }} strokeWidth="1" />
      <text x={PAD_X} y={H - 6} className="fill-muted-foreground text-[10px]">{day(t0)}</text>
      {xNow > 60 && xNow < W - 60 && <text x={xNow} y={H - 6} textAnchor="middle" className="fill-foreground text-[10px]">{day(now)}</text>}
      <text x={W - PAD_X} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">{day(t1)}</text>
    </svg>
  );
}
