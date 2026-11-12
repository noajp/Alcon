'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { TypeMark, useTypeIcons } from '@/Function/shared/elementTypeIcon';
import { labelColor } from '@/Function/shared/labelColor';
import { Tag, User } from '@/ui/icons';
import { useElementMoveTimes } from '@/hooks/elementActivity';
import {
  buildProgressSeries, progressBreakdown, type ProgressAxis, type ProgressItem,
} from '@/Function/shared/progressModel';
import type { ElementWithDetails } from '@/types/database';

// Progress: how a body of work stands. Three counts — everything in scope,
// what has been started, what is done — and the done share split by
// assignee, label or type.
//
// The key color is "done"; "started" is a matte red; scope is a quiet grey.

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
