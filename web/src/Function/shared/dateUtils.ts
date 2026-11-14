// Single source of truth for date display logic across Element views and
// widgets. Intl-based so callers don't need date-fns for formatting.

import { translate } from '@/Function/i18n/I18nProvider';
import { LOCALE_STORAGE_KEY, resolveLocale } from '@/Function/i18n/locales';

export const DAY_MS = 24 * 60 * 60 * 1000;

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

/** A moment as the viewer reads it, in the app's language (not the
 *  browser's): "Nov 14, 2026, 18:06" / "2026年11月14日 18:06". Pass
 *  `options` for another shape; returns '' for missing or invalid input. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(viewerDateLocale(), options);
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
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** `dayNumberOf` for a value that should start with `yyyy-MM-dd` (a timestamp
 *  is read by its date part); null when it does not. */
export function dayNumberIfDate(value: string): number | null {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? dayNumberOf(value) : null;
}

/** Strict `dayNumberOf`: null unless the value is exactly `yyyy-MM-dd` and a
 *  real calendar day (2026-02-30 does not roll over into March). */
export function dayIndexOf(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / DAY_MS : null;
}

/** Inverse of `dayIndexOf`. */
export function dateOnlyFromDayIndex(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
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
 * Stricter than `parseDateOnly`: readers of stored columns reject anything
 * that is not fixed-width, where editors normalize what was typed.
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

/** Local midnight of the same day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The same local time, whole calendar days later (negative goes back). */
export function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

/** Whole days from a to b. Rounded, so a daylight-saving hour cannot cost a day. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** A date-only column in the given locale ("Jul 14" by default); null when missing or malformed. */
export function formatDateOnly(
  value: string | null | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
): string | null {
  return parseDateOnly(value)?.toLocaleDateString(locale, options) ?? null;
}

/** A due date as the local calendar day it names (a date-only column, never
 *  `new Date('yyyy-MM-dd')`, which is UTC midnight and lands on the wrong day
 *  on one side of Greenwich). */
function dueDay(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : startOfDay(value);
  return parseDateOnly(value, null);
}

/** Signed whole days from today until the date (negative = already past). */
export function daysUntil(value: string | Date): number {
  const due = dueDay(value);
  return due ? daysBetween(startOfDay(new Date()), due) : 0;
}

/** Overdue once the due day has passed — the due day itself is still on time.
 *  Never overdue while `isDone`. */
export function isOverdue(value: string | Date | null | undefined, isDone = false): boolean {
  if (isDone) return false;
  const due = dueDay(value);
  return !!due && due < startOfDay(new Date());
}

/** Whole days a due date is past (0 when not overdue). */
export function daysOverdue(value: string | Date | null | undefined): number {
  const due = dueDay(value);
  return due ? Math.max(0, daysBetween(due, startOfDay(new Date()))) : 0;
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

/** "just now" / "12m" / "3h" / "2d" — how long ago, coarse. `ago` spells it
 *  out ("12m ago") where the number would otherwise read as a duration. */
export function formatAge(value: string | Date, ago = false): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return translate('just now');
  if (minutes < 60) return translate(ago ? '{n}m ago' : '{n}m', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate(ago ? '{n}h ago' : '{n}h', { n: hours });
  return translate(ago ? '{n}d ago' : '{n}d', { n: Math.floor(hours / 24) });
}
