// Single source of truth for date display logic across Element views and
// widgets. Intl-based so callers don't need date-fns for formatting.

import { translate } from '@/Function/i18n/I18nProvider';
import { LOCALE_STORAGE_KEY, resolveLocale } from '@/Function/i18n/locales';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The viewer's language as a BCP 47 tag for Intl (English stays en-US). */
function viewerDateLocale(): string {
  if (typeof window === 'undefined') return 'en-US';
  let saved: string | null = null;
  try { saved = window.localStorage.getItem(LOCALE_STORAGE_KEY); } catch { /* storage may be disabled */ }
  const locale = resolveLocale(saved, window.navigator.languages ?? [window.navigator.language]);
  return locale === 'en' ? 'en-US' : locale;
}

export type ElementDateStyle = 'short' | 'weekday' | 'monthYear';

/** "May 15" / "Fri, May 15" / "May 2026". Returns null for missing or invalid input. */
export function formatElementDate(
  value: string | Date | null | undefined,
  style: ElementDateStyle = 'short',
): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const locale = viewerDateLocale();
  if (style === 'weekday') {
    return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  if (style === 'monthYear') {
    return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** Local-timezone yyyy-MM-dd, for writing date-only columns (due_date etc.). */
export function toDateOnlyString(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/** Parse date-column parts at local midnight, avoiding UTC date-string parsing.
 * Calendar/Gantt callers pass null to preserve their empty-date sentinel.
 * Calendar overflow is intentionally normalized by Date, matching existing editors.
 */
export function parseDateOnly(value: string | null | undefined): Date | undefined;
export function parseDateOnly(value: string | null | undefined, empty: null): Date | null;
export function parseDateOnly(value: string | null | undefined, empty?: null): Date | null | undefined {
  if (!value) return empty;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return empty;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? empty : date;
}

/** Days since the epoch for a `yyyy-MM-dd` day, so two calendar days can be
 *  subtracted without going through timestamps. */
export function dayNumberOf(value: string): number {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** The same calendar day, moved by whole days. Built from the parts and read
 *  back the same way, so a daylight-saving boundary cannot shift it. */
export function shiftDateOnly(value: string, days: number): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  const mm = `${moved.getUTCMonth() + 1}`.padStart(2, '0');
  const dd = `${moved.getUTCDate()}`.padStart(2, '0');
  return `${moved.getUTCFullYear()}-${mm}-${dd}`;
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
  if (diffMs < DAY_MS) return translate('Today');
  if (diffMs < 2 * DAY_MS) return translate('Yesterday');
  if (diffMs < 7 * DAY_MS) return translate('{n}d ago', { n: Math.floor(diffMs / DAY_MS) });
  return formatElementDate(iso) ?? '—';
}
