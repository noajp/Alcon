// The relative date ranges a due-date filter offers, and the arithmetic that
// turns one into a `dueFrom` / `dueTo` pair.
//
// Why presets exist at all: a raw `<input type="date">` asks for an absolute
// day, but almost every filter a person actually wants is relative — overdue,
// this week, the next 30 days. Linear's date filter leads with relative quick
// values ("N days" / Month / Quarter / Half-year / Year) and keeps the
// absolute picker behind an explicit choice. DESIGN.md §5.11.6 adopts that.
//
// Pure on purpose — no React, no Date.now() baked in. `today` is a parameter so
// the ranges are testable without freezing the clock.

import { toDateOnlyString } from '@/alcon/shared/dateUtils';

export type DueDatePresetId =
  | 'overdue'
  | 'today'
  | 'this_week'
  | 'next_7'
  | 'next_30'
  | 'this_month';

export interface DueDateRange {
  from: string | null;
  to: string | null;
}

export const DUE_DATE_PRESETS: { id: DueDatePresetId; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This week' },
  { id: 'next_7', label: 'Next 7 days' },
  { id: 'next_30', label: 'Next 30 days' },
  { id: 'this_month', label: 'This month' },
];

function shift(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Monday-based week start. Fixed rather than locale-derived so that the range a
 * preset produces does not depend on where the browser thinks it is — two
 * people filtering "This week" on the same board should see the same rows.
 */
function startOfWeek(base: Date): Date {
  const dow = base.getDay(); // 0 = Sunday
  return shift(base, dow === 0 ? -6 : 1 - dow);
}

/** The `dueFrom` / `dueTo` pair a preset stands for. */
export function dueDateRangeFor(id: DueDatePresetId, today: Date = new Date()): DueDateRange {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (id) {
    case 'overdue':
      // Open-ended on the left: everything already past, however old.
      return { from: null, to: toDateOnlyString(shift(t, -1)) };
    case 'today':
      return { from: toDateOnlyString(t), to: toDateOnlyString(t) };
    case 'this_week': {
      const start = startOfWeek(t);
      return { from: toDateOnlyString(start), to: toDateOnlyString(shift(start, 6)) };
    }
    case 'next_7':
      return { from: toDateOnlyString(t), to: toDateOnlyString(shift(t, 6)) };
    case 'next_30':
      return { from: toDateOnlyString(t), to: toDateOnlyString(shift(t, 29)) };
    case 'this_month': {
      const start = new Date(t.getFullYear(), t.getMonth(), 1);
      const end = new Date(t.getFullYear(), t.getMonth() + 1, 0);
      return { from: toDateOnlyString(start), to: toDateOnlyString(end) };
    }
  }
}

/**
 * Which preset a stored range corresponds to, or `null` when it is a custom
 * range (or no range at all).
 *
 * The filter state stays two plain date strings — presets are a way of writing
 * them, not a third field to keep in sync. That is what lets a range typed in
 * the custom fields light up a preset row when it happens to match, and what
 * keeps every existing consumer of `dueFrom` / `dueTo` working untouched.
 */
export function matchDueDatePreset(
  range: DueDateRange,
  today: Date = new Date(),
): DueDatePresetId | null {
  if (!range.from && !range.to) return null;
  for (const { id } of DUE_DATE_PRESETS) {
    const candidate = dueDateRangeFor(id, today);
    if (candidate.from === (range.from ?? null) && candidate.to === (range.to ?? null)) {
      return id;
    }
  }
  return null;
}
