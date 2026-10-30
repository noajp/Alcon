'use client';

import { useSyncExternalStore } from 'react';

// Active ActivitySpace — the top-level org context (company / enterprise) the
// user is currently in. Mirrors domainsStore: localStorage + a CustomEvent so
// the shell and the Domain list react to a space switch. The active Domain is
// resolved *within* the active space.
const ACTIVE_KEY = 'alcon:active-space';
const ACTIVE_SPACE_CHANGE_EVENT = 'alcon:active-space-change';
export function getActiveSpaceId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveSpaceId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
  window.dispatchEvent(new CustomEvent(ACTIVE_SPACE_CHANGE_EVENT, { detail: id }));
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_KEY || event.key === null) listener();
  };
  window.addEventListener(ACTIVE_SPACE_CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(ACTIVE_SPACE_CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** A Space switch changes query identity before the next surface renders. */
export function useActiveSpaceId(): string | null {
  return useSyncExternalStore(subscribe, getActiveSpaceId, () => null);
}
