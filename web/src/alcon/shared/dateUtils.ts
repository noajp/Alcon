// Single source of truth for date display logic across Element views and
// widgets. Intl-based so callers don't need date-fns for formatting.

const DAY_MS = 24 * 60 * 60 * 1000;

export type ElementDateStyle = 'short' | 'weekday' | 'monthYear';

/** "May 15" / "Fri, May 15" / "May 2026". Returns null for missing or invalid input. */
export function formatElementDate(
  value: string | Date | null | undefined,
  style: ElementDateStyle = 'short',
): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (style === 'weekday') {
    return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  if (style === 'monthYear') {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Local-timezone yyyy-MM-dd, for writing date-only columns (due_date etc.). */
export function toDateOnlyString(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * Inverse of `toDateOnlyString`. Parses `yyyy-MM-dd` in the *local* timezone.
 *
 * `new Date('2026-08-31')` is specified to parse as UTC midnight, so west of
 * Greenwich it renders as the 30th. Every date-only column in this app is a
 * calendar day, not an instant, so it must be built from the parts.
 */
export function fromDateOnlyString(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Signed whole days from now until the date (negative = already past). */
export function daysUntil(value: string | Date): number {
  const date = value instanceof Date ? value : new Date(value);
  return Math.trunc((date.getTime() - Date.now()) / DAY_MS);
}

/** A due date counts as overdue only while the Element isn't done. */
export function isOverdue(value: string | Date | null | undefined, isDone = false): boolean {
  if (!value || isDone) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
}

/** Whole days a due date is past (0 when not overdue). */
export function daysOverdue(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.trunc((Date.now() - date.getTime()) / DAY_MS));
}

/** "Today" / "Yesterday" / "3d ago" / "May 15" — recency label for activity rows. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  if (diffMs < DAY_MS) return 'Today';
  if (diffMs < 2 * DAY_MS) return 'Yesterday';
  if (diffMs < 7 * DAY_MS) return `${Math.floor(diffMs / DAY_MS)}d ago`;
  return formatElementDate(iso) ?? '—';
}
