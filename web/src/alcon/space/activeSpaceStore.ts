'use client';

// Active ActivitySpace — the top-level org context (company / enterprise) the
// user is currently in. Mirrors domainsStore: localStorage + a CustomEvent so
// the shell and the Domain list react to a space switch. The active Domain is
// resolved *within* the active space.
const ACTIVE_KEY = 'alcon:active-space';
export const ACTIVE_SPACE_CHANGE_EVENT = 'alcon:active-space-change';
export const CREATE_SPACE_EVENT = 'alcon:create-space';

export function getActiveSpaceId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveSpaceId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
  window.dispatchEvent(new CustomEvent(ACTIVE_SPACE_CHANGE_EVENT, { detail: id }));
}
