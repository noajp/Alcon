'use client';

import { useSyncExternalStore } from 'react';

// Coming back from an integration sign-in — Google or GitHub (ADR 0035).
// integration-oauth redirects to
//   /?integration_oauth=finish&handle=<one-time handle>&integration=<id>
//   /?integration_oauth=error&integration=<id>
// The page reads that once, removes it from the address, opens the screen the
// sign-in started from (Settings › AI, or Reviews when it began
// there) and, for `finish`, confirms the sign-in with POST /finish under the
// signed-in person's JWT — nothing is stored until then, and only for the
// person who started it. The outcome is left here for that screen to show.

export type OAuthReturn =
  | { kind: 'finish'; handle: string; integrationId: string | null }
  | { kind: 'error'; integrationId: string | null };

export interface OAuthOutcome {
  status: 'pending' | 'ok' | 'error';
  integrationId: string | null;
  /** The server's reason when finishing failed (an English source string for t()). */
  message: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE = /^[A-Za-z0-9_-]{43,128}$/;

/** Pure. The sign-in result in a query string, or null when there is none. */
export function readOAuthReturn(search: string): OAuthReturn | null {
  const params = new URLSearchParams(search);
  const result = params.get('integration_oauth');
  const id = params.get('integration');
  const integrationId = id && UUID.test(id) ? id : null;
  if (result === 'error') return { kind: 'error', integrationId };
  if (result !== 'finish') return null;
  const handle = params.get('handle') ?? '';
  return HANDLE.test(handle) ? { kind: 'finish', handle, integrationId } : { kind: 'error', integrationId };
}

/** Pure. The URL without the sign-in parameters (path, other params and hash kept). */
export function stripOAuthReturn(href: string): string {
  const u = new URL(href);
  for (const key of ['integration_oauth', 'integration', 'handle']) u.searchParams.delete(key);
  return `${u.pathname}${u.search}${u.hash}`;
}

/** sessionStorage: the view a sign-in was started from, when it is not Settings. */
export const OAUTH_RETURN_VIEW_KEY = 'alcon.integrationOAuth.returnView';
const RETURN_VIEWS = new Set(['reviews']);

/** The view to come back to, read once; null means Settings › AI. */
export function takeOAuthReturnView(): string | null {
  try {
    const view = sessionStorage.getItem(OAUTH_RETURN_VIEW_KEY);
    sessionStorage.removeItem(OAUTH_RETURN_VIEW_KEY);
    return view && RETURN_VIEWS.has(view) ? view : null;
  } catch {
    return null;
  }
}

/** sessionStorage: the Settings › AI tab a sign-in was started from, when it is not Connectors (a harness install returns to Harnesses). */
const OAUTH_RETURN_SETTINGS_TAB_KEY = 'alcon.integrationOAuth.returnTab';
const RETURN_TABS = new Set(['definitions', 'external']);

export function saveOAuthReturnSettingsTab(tab: string): void {
  try { sessionStorage.setItem(OAUTH_RETURN_SETTINGS_TAB_KEY, tab); } catch { /* storage unavailable */ }
}

/** The Settings › AI tab to come back to, read once; null means Connectors, as before. */
export function takeOAuthReturnSettingsTab(): string | null {
  try {
    const tab = sessionStorage.getItem(OAUTH_RETURN_SETTINGS_TAB_KEY);
    sessionStorage.removeItem(OAUTH_RETURN_SETTINGS_TAB_KEY);
    return tab && RETURN_TABS.has(tab) ? tab : null;
  } catch {
    return null;
  }
}

let current: OAuthOutcome | null = null;
const listeners = new Set<() => void>();
const finishing = new Set<string>();

export function setOAuthOutcome(next: OAuthOutcome | null) {
  current = next;
  listeners.forEach((l) => l());
}

/**
 * Records the return and, for `finish`, confirms it once with `finish`
 * (a handle is used at most once even if this is called again).
 */
export async function completeOAuthReturn(ret: OAuthReturn, finish: (handle: string) => Promise<string | null>): Promise<void> {
  if (ret.kind === 'error') {
    setOAuthOutcome({ status: 'error', integrationId: ret.integrationId, message: null });
    return;
  }
  if (finishing.has(ret.handle)) return;
  finishing.add(ret.handle);
  setOAuthOutcome({ status: 'pending', integrationId: ret.integrationId, message: null });
  try {
    const id = await finish(ret.handle);
    setOAuthOutcome({ status: 'ok', integrationId: id ?? ret.integrationId, message: null });
  } catch (e) {
    setOAuthOutcome({ status: 'error', integrationId: ret.integrationId, message: e instanceof Error ? e.message : null });
  }
}

export function useOAuthOutcome(): OAuthOutcome | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
    () => null,
  );
}
