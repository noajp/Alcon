'use client';

import { useSyncExternalStore } from 'react';

// Coming back from Google sign-in (ADR 0035). integration-oauth redirects to
// `/?integration_oauth=ok|error&integration=<id>`; the page reads that once,
// opens Settings › Integrations, removes the parameters from the address and
// leaves the result here for the Integrations screen to show.

export interface OAuthReturn {
  ok: boolean;
  integrationId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pure. The sign-in result in a query string, or null when there is none. */
export function readOAuthReturn(search: string): OAuthReturn | null {
  const params = new URLSearchParams(search);
  const result = params.get('integration_oauth');
  if (result !== 'ok' && result !== 'error') return null;
  const id = params.get('integration');
  return { ok: result === 'ok', integrationId: id && UUID.test(id) ? id : null };
}

/** Pure. The URL without the sign-in parameters (path, other params and hash kept). */
export function stripOAuthReturn(href: string): string {
  const u = new URL(href);
  u.searchParams.delete('integration_oauth');
  u.searchParams.delete('integration');
  return `${u.pathname}${u.search}${u.hash}`;
}

let current: OAuthReturn | null = null;
const listeners = new Set<() => void>();

export function setOAuthReturn(next: OAuthReturn | null) {
  current = next;
  listeners.forEach((l) => l());
}

export function useOAuthReturn(): OAuthReturn | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
    () => null,
  );
}
