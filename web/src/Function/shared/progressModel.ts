// Progress over time for a set of Elements — the numbers behind the Progress
// panel: how much work there is (scope), how much has been started, how much
// is done, day by day; and the same split by who, by label, by type.
//
// The record of when a Status changed (element_activity) says when work was
// started and finished. Where there is no record — work entered already in
// its Status — the dates on the Element stand in: its start date for
// "started", its due date (once past) or last update for "done". Cancelled
// work is not counted anywhere.
//
// Pure. `now` is a parameter; the caller owns the clock.

import { parseDateOnly } from '@/Function/shared/dateUtils';

export const DAY_MS = 86_400_000;

export interface ProgressItem {
  id: string;
  status: string | null;
  createdAt: string | null;
  startDate: string | null;
  dueDate: string | null;
  updatedAt: string | null;
  assignees: { id: string; name: string }[];
  labels: string[];
  type: string | null;
}

/** What the Status record says about one Element (ISO instants). */
export interface MoveTimes { startedAt?: string; doneAt?: string }

const STARTED = new Set(['in_progress', 'review', 'blocked', 'done']);
/** An instant in ms. A calendar day ('yyyy-MM-dd') is that day's local start. */
const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return parseDateOnly(iso, null)?.getTime() ?? null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Pure. When an Element entered scope, was started and was done (ms);
 *  null for a step it has not reached. Never after `now`, never out of order. */
export function itemTimes(item: ProgressItem, moves: MoveTimes | undefined, now: number): { scope: number; started: number | null; done: number | null } {
  const created = ms(item.createdAt);
  const start = ms(item.startDate);
  const scope = Math.min(now, ...[created, start].filter((t): t is number => t !== null));
  const status = item.status ?? 'todo';
  let started: number | null = null;
  if (STARTED.has(status)) started = Math.max(scope, Math.min(now, ms(moves?.startedAt) ?? start ?? created ?? now));
  let done: number | null = null;
  if (status === 'done') {
    const due = ms(item.dueDate);
    const guess = due !== null && due <= now ? due : ms(item.updatedAt) ?? now;
    done = Math.max(started ?? scope, Math.min(now, ms(moves?.doneAt) ?? guess));
  }
  return { scope, started, done };
}

export interface ProgressPoint { t: number; scope: number; started: number; completed: number }
export interface ProgressSeries {
  t0: number;
  /** The right edge: the target date, or a little past today. */
  t1: number;
  now: number;
  /** One point a day from t0 to today. */
  points: ProgressPoint[];
  /** Completions per week, at each week's start. */
  weeks: { t: number; completed: number }[];
  totals: { scope: number; started: number; completed: number };
}

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Pure. The day-by-day series. `end` is the target date (ISO day), if any;
 *  the window opens at the first Element's entry, at most `maxDays` back. */
export function buildProgressSeries(items: readonly ProgressItem[], moves: ReadonlyMap<string, MoveTimes>, now: number, end?: string | null, maxDays = 180): ProgressSeries {
  const live = items.filter((i) => i.status !== 'cancelled');
  const times = live.map((i) => itemTimes(i, moves.get(i.id), now));
  const today = startOfDay(now);
  const earliest = times.length ? Math.min(...times.map((x) => x.scope)) : today;
  const t0 = Math.max(startOfDay(earliest), today - maxDays * DAY_MS);
  const target = ms(end ?? null);
  const lastDue = Math.max(0, ...live.map((i) => ms(i.dueDate) ?? 0));
  const t1 = Math.max(today + 7 * DAY_MS, target ?? 0, Math.min(lastDue, today + maxDays * DAY_MS));
  const points: ProgressPoint[] = [];
  for (let t = t0; t <= today; t += DAY_MS) {
    const edge = t === today ? now : t + DAY_MS - 1;
    points.push({
      t,
      scope: times.filter((x) => x.scope <= edge).length,
      started: times.filter((x) => x.started !== null && x.started <= edge).length,
      completed: times.filter((x) => x.done !== null && x.done <= edge).length,
    });
  }
  const weeks: { t: number; completed: number }[] = [];
  for (let t = t0; t <= today; t += 7 * DAY_MS) {
    weeks.push({ t, completed: times.filter((x) => x.done !== null && x.done >= t && x.done < t + 7 * DAY_MS).length });
  }
  return {
    t0, t1, now, points, weeks,
    totals: {
      scope: live.length,
      started: times.filter((x) => x.started !== null && x.done === null).length,
      completed: times.filter((x) => x.done !== null).length,
    },
  };
}

export interface ProgressSlice { key: string; label: string; total: number; done: number }
export type ProgressAxis = 'assignee' | 'label' | 'type';

/** Pure. Done of total along one axis, biggest first; work with no value on
 *  the axis is the last slice (key ''). An Element with two labels or two
 *  assignees counts in both. */
export function progressBreakdown(items: readonly ProgressItem[], axis: ProgressAxis): ProgressSlice[] {
  const slices = new Map<string, ProgressSlice>();
  const add = (key: string, label: string, done: boolean) => {
    const s = slices.get(key) ?? { key, label, total: 0, done: 0 };
    s.total += 1;
    if (done) s.done += 1;
    slices.set(key, s);
  };
  for (const item of items) {
    if (item.status === 'cancelled') continue;
    const done = item.status === 'done';
    const keys: [string, string][] = axis === 'assignee' ? item.assignees.map((a) => [a.id, a.name])
      : axis === 'label' ? item.labels.map((l) => [l, l])
      : item.type ? [[item.type, item.type]] : [];
    if (keys.length === 0) add('', '', done);
    for (const [key, label] of keys) add(key, label, done);
  }
  return [...slices.values()].sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : b.total - a.total || a.label.localeCompare(b.label)));
}
