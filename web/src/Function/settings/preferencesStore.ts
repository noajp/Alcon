'use client';

import { useEffect, useState } from 'react';

// Synchronous localStorage cache for the handful of `user_preferences` fields
// that something needs to read *before* the Supabase-backed value has loaded
// (e.g. which view a brand-new tab opens to). `user_preferences` in Supabase
// stays the source of truth — this is a read-through cache, refreshed
// whenever useUserPreferences loads or saves a value. Mirrors the sync-store
// pattern in Function/space/domainsStore.ts.
//
// Unlike domainsStore's list, a preference's *own* getCached* read has no
// natural refetch point of its own — nothing calls it again once a component
// has mounted. The shell keeps every kept view's `MainContent` mounted in
// parallel, so a Settings edit in one tab previously never reached a value
// already read into an already-mounted sibling instance until that instance
// itself reloaded (ELE_QLT-025). `usePreference` below is what call sites
// showing a preference's current value on screen should use instead of a
// bare `getCached*()` read; PREFERENCES_CHANGED_EVENT is what every setter
// fires so it takes effect immediately, everywhere already mounted — not
// just in the tab that changed it.

// Not exported — every reader goes through usePreference below, so nothing
// outside this module needs the event name itself (unlike domainsStore.ts's
// DOMAINS_CHANGED_EVENT, which useSupabase.ts's useDomains also listens for
// directly). Export it if that changes.
const PREFERENCES_CHANGED_EVENT = 'alcon:preferences-changed';

function notifyPreferencesChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PREFERENCES_CHANGED_EVENT));
}

/** Subscribes a component to every Settings > Preferences change, re-running
 *  `read` (one of the getCached* functions below) each time one fires — not
 *  just at mount. Pass the function reference itself (`usePreference(
 *  getCachedWeekStartsOn)`), not a wrapping arrow, so the effect doesn't
 *  resubscribe on every render. */
export function usePreference<T>(read: () => T): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const handle = () => setValue(read());
    window.addEventListener(PREFERENCES_CHANGED_EVENT, handle);
    return () => window.removeEventListener(PREFERENCES_CHANGED_EVENT, handle);
  }, [read]);
  return value;
}

export type HomeView = 'Now' | 'My Elements' | 'Inbox' | 'Calendar';
export type SendCommentShortcut = '⌘+Enter' | 'Enter';
export type FirstDayOfWeek = 'Monday' | 'Sunday' | 'Saturday';
export type DisplayNames = 'Full name' | 'Short name' | 'Username';
export type TimelineScale = 'month' | 'quarter';

const HOME_VIEW_KEY = 'alcon:pref:home-view';
const SEND_SHORTCUT_KEY = 'alcon:pref:send-comment-shortcut';
const FIRST_DAY_KEY = 'alcon:pref:first-day-of-week';
const DISPLAY_NAMES_KEY = 'alcon:pref:display-names';
const EMOTICONS_KEY = 'alcon:pref:convert-emoticons';

const HOME_VIEW_TO_VIEW_ID: Record<HomeView, string> = {
  Now: 'home',
  'My Elements': 'my-elements',
  Inbox: 'inbox',
  Calendar: 'calendar',
};

export function getCachedHomeViewId(): string {
  if (typeof window === 'undefined') return 'inbox';
  const v = localStorage.getItem(HOME_VIEW_KEY) as HomeView | null;
  return HOME_VIEW_TO_VIEW_ID[v as HomeView] ?? 'inbox';
}

export function setCachedHomeView(v: HomeView) {
  try { localStorage.setItem(HOME_VIEW_KEY, v); } catch { /* ignore */ }
  notifyPreferencesChanged();
}

export function getCachedSendCommentShortcut(): SendCommentShortcut {
  if (typeof window === 'undefined') return '⌘+Enter';
  return localStorage.getItem(SEND_SHORTCUT_KEY) === 'Enter' ? 'Enter' : '⌘+Enter';
}

export function setCachedSendCommentShortcut(v: SendCommentShortcut) {
  try { localStorage.setItem(SEND_SHORTCUT_KEY, v); } catch { /* ignore */ }
  notifyPreferencesChanged();
}

function getCachedFirstDayOfWeek(): FirstDayOfWeek {
  if (typeof window === 'undefined') return 'Monday';
  const v = localStorage.getItem(FIRST_DAY_KEY);
  return v === 'Sunday' || v === 'Saturday' ? v : 'Monday';
}

export function setCachedFirstDayOfWeek(v: FirstDayOfWeek) {
  try { localStorage.setItem(FIRST_DAY_KEY, v); } catch { /* ignore */ }
  notifyPreferencesChanged();
}

// 0 = Sunday … 6 = Saturday, matching Date#getDay() and react-day-picker's
// own `weekStartsOn` prop type.
export function firstDayOfWeekToIndex(v: FirstDayOfWeek): 0 | 1 | 6 {
  return v === 'Sunday' ? 0 : v === 'Saturday' ? 6 : 1;
}

// Convenience for the `<Calendar weekStartsOn={...}>` date-picker call
// sites — one localStorage read + conversion instead of two imports each.
export function getCachedWeekStartsOn(): 0 | 1 | 6 {
  return firstDayOfWeekToIndex(getCachedFirstDayOfWeek());
}

export function getCachedDisplayNames(): DisplayNames {
  if (typeof window === 'undefined') return 'Full name';
  const v = localStorage.getItem(DISPLAY_NAMES_KEY);
  return v === 'Short name' || v === 'Username' ? v : 'Full name';
}

export function setCachedDisplayNames(v: DisplayNames) {
  try { localStorage.setItem(DISPLAY_NAMES_KEY, v); } catch { /* ignore */ }
  notifyPreferencesChanged();
}

export function getCachedConvertEmoticons(): boolean {
  if (typeof window === 'undefined') return true;
  const v = localStorage.getItem(EMOTICONS_KEY);
  return v === null ? true : v === '1';
}

export function setCachedConvertEmoticons(v: boolean) {
  try { localStorage.setItem(EMOTICONS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  notifyPreferencesChanged();
}

// Applies Settings > Preferences > "Display names" to a comment author's
// stored full name / email, at the point a comment is authored (the name is
// denormalized onto the comment row, so this governs how *authors* choose to
// sign their comments — not a per-viewer reformat of existing history).
export function formatDisplayName(
  fullName: string | null | undefined,
  email: string | null | undefined,
  mode: DisplayNames,
): string {
  const full = (fullName ?? '').trim();
  const emailName = email?.split('@')[0];
  if (mode === 'Username') return emailName || full || 'You';
  if (mode === 'Short name') return full.split(/\s+/)[0] || emailName || 'You';
  return full || emailName || 'You';
}

// A small, deliberately conservative set — full text-emoticon detection is
// out of scope here; this covers the common cases the setting's own
// description promises ("Strings like :) will be converted to 🙂"). Every
// pattern requires both a left boundary (start/whitespace) and a right
// boundary (whitespace/end/punctuation) so words like ":Done", "<300ms" or
// "awk -F: -v m=:D" aren't partially eaten — only the tokens standing alone.
const EMOTICON_MAP: [RegExp, string][] = [
  [/(^|\s):-?\)(?=\s|$)/g, '$1🙂'],
  [/(^|\s):-?\((?=\s|$)/g, '$1🙁'],
  [/(^|\s):-?D(?=\s|$)/gi, '$1😀'],
  [/(^|\s);-?\)(?=\s|$)/g, '$1😉'],
  [/(^|\s):-?P(?=\s|$)/gi, '$1😛'],
  [/(^|\s)<3(?=\s|$)/g, '$1❤️'],
];

export function convertEmoticons(text: string): string {
  return EMOTICON_MAP.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

// ── Timeline display (Settings > Strategy > Timeline) ─────────────────
const TIMELINE_SCALE_KEY = 'alcon:pref:timeline-scale';
const TIMELINE_BACK_KEY = 'alcon:pref:timeline-months-back';
const TIMELINE_AHEAD_KEY = 'alcon:pref:timeline-months-ahead';
const TIMELINE_TODAY_KEY = 'alcon:pref:timeline-today-marker';
const TIMELINE_FILL_KEY = 'alcon:pref:timeline-progress-fill';

const TIMELINE_MONTHS_BACK_RANGE = { min: 0, max: 12, fallback: 2 } as const;
const TIMELINE_MONTHS_AHEAD_RANGE = { min: 3, max: 36, fallback: 10 } as const;

function readInt(key: string, range: { min: number; max: number; fallback: number }): number {
  if (typeof window === 'undefined') return range.fallback;
  const raw = localStorage.getItem(key);
  const n = raw === null || raw === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n >= range.min && n <= range.max ? n : range.fallback;
}
function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === '1';
}
function write(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
  notifyPreferencesChanged();
}

export function getCachedTimelineScale(): TimelineScale {
  if (typeof window === 'undefined') return 'month';
  return localStorage.getItem(TIMELINE_SCALE_KEY) === 'quarter' ? 'quarter' : 'month';
}
export function setCachedTimelineScale(v: TimelineScale) { write(TIMELINE_SCALE_KEY, v); }
export function getCachedTimelineMonthsBack(): number { return readInt(TIMELINE_BACK_KEY, TIMELINE_MONTHS_BACK_RANGE); }
export function setCachedTimelineMonthsBack(v: number) { write(TIMELINE_BACK_KEY, String(v)); }
export function getCachedTimelineMonthsAhead(): number { return readInt(TIMELINE_AHEAD_KEY, TIMELINE_MONTHS_AHEAD_RANGE); }
export function setCachedTimelineMonthsAhead(v: number) { write(TIMELINE_AHEAD_KEY, String(v)); }
export function getCachedTimelineTodayMarker(): boolean { return readBool(TIMELINE_TODAY_KEY, true); }
export function setCachedTimelineTodayMarker(v: boolean) { write(TIMELINE_TODAY_KEY, v ? '1' : '0'); }
export function getCachedTimelineProgressFill(): boolean { return readBool(TIMELINE_FILL_KEY, true); }
export function setCachedTimelineProgressFill(v: boolean) { write(TIMELINE_FILL_KEY, v ? '1' : '0'); }
