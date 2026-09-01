'use client';

// Synchronous localStorage cache for the handful of `user_preferences` fields
// that something needs to read *before* the Supabase-backed value has loaded
// (e.g. which view a brand-new tab opens to). `user_preferences` in Supabase
// stays the source of truth — this is a read-through cache, refreshed
// whenever useUserPreferences loads or saves a value. Mirrors the sync-store
// pattern in alcon/domain/domainsStore.ts.

export type HomeView = 'My Elements' | 'Inbox' | 'Calendar';
export type SendCommentShortcut = '⌘+Enter' | 'Enter';
export type FirstDayOfWeek = 'Monday' | 'Sunday' | 'Saturday';
export type DisplayNames = 'Full name' | 'Short name' | 'Username';

const HOME_VIEW_KEY = 'alcon:pref:home-view';
const SEND_SHORTCUT_KEY = 'alcon:pref:send-comment-shortcut';
const FIRST_DAY_KEY = 'alcon:pref:first-day-of-week';
const DISPLAY_NAMES_KEY = 'alcon:pref:display-names';
const EMOTICONS_KEY = 'alcon:pref:convert-emoticons';

const HOME_VIEW_TO_VIEW_ID: Record<HomeView, string> = {
  'My Elements': 'my-elements',
  Inbox: 'inbox',
  Calendar: 'calendar',
};

export function getCachedHomeViewId(): string {
  if (typeof window === 'undefined') return 'my-elements';
  const v = localStorage.getItem(HOME_VIEW_KEY) as HomeView | null;
  return HOME_VIEW_TO_VIEW_ID[v as HomeView] ?? 'my-elements';
}

export function setCachedHomeView(v: HomeView) {
  try { localStorage.setItem(HOME_VIEW_KEY, v); } catch { /* ignore */ }
}

export function getCachedSendCommentShortcut(): SendCommentShortcut {
  if (typeof window === 'undefined') return 'Enter';
  return localStorage.getItem(SEND_SHORTCUT_KEY) === '⌘+Enter' ? '⌘+Enter' : 'Enter';
}

export function setCachedSendCommentShortcut(v: SendCommentShortcut) {
  try { localStorage.setItem(SEND_SHORTCUT_KEY, v); } catch { /* ignore */ }
}

export function getCachedFirstDayOfWeek(): FirstDayOfWeek {
  if (typeof window === 'undefined') return 'Monday';
  const v = localStorage.getItem(FIRST_DAY_KEY);
  return v === 'Sunday' || v === 'Saturday' ? v : 'Monday';
}

export function setCachedFirstDayOfWeek(v: FirstDayOfWeek) {
  try { localStorage.setItem(FIRST_DAY_KEY, v); } catch { /* ignore */ }
}

// 0 = Sunday … 6 = Saturday, matching Date#getDay().
export function firstDayOfWeekToIndex(v: FirstDayOfWeek): number {
  return v === 'Sunday' ? 0 : v === 'Saturday' ? 6 : 1;
}

export function getCachedDisplayNames(): DisplayNames {
  if (typeof window === 'undefined') return 'Full name';
  const v = localStorage.getItem(DISPLAY_NAMES_KEY);
  return v === 'Short name' || v === 'Username' ? v : 'Full name';
}

export function setCachedDisplayNames(v: DisplayNames) {
  try { localStorage.setItem(DISPLAY_NAMES_KEY, v); } catch { /* ignore */ }
}

export function getCachedConvertEmoticons(): boolean {
  if (typeof window === 'undefined') return true;
  const v = localStorage.getItem(EMOTICONS_KEY);
  return v === null ? true : v === '1';
}

export function setCachedConvertEmoticons(v: boolean) {
  try { localStorage.setItem(EMOTICONS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
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
// description promises ("Strings like :) will be converted to 🙂").
const EMOTICON_MAP: [RegExp, string][] = [
  [/(^|\s):-?\)/g, '$1🙂'],
  [/(^|\s):-?\(/g, '$1🙁'],
  [/(^|\s):-?D/g, '$1😀'],
  [/(^|\s);-?\)/g, '$1😉'],
  [/(^|\s):-?P/gi, '$1😛'],
  [/(^|\s)<3/g, '$1❤️'],
];

export function convertEmoticons(text: string): string {
  return EMOTICON_MAP.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}
