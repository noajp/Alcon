'use client';

const ACTIVE_KEY = 'alcon:active-domain';
export const ACTIVE_DOMAIN_CHANGE_EVENT = 'alcon:active-domain-change';
export const CREATE_DOMAIN_EVENT = 'alcon:create-domain';
// Fired when the Domain *list* changes (create / delete / join), so every
// useDomains instance refetches — page + sidebar each hold their own and don't
// otherwise share state.
export const DOMAINS_CHANGED_EVENT = 'alcon:domains-changed';

export function notifyDomainsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DOMAINS_CHANGED_EVENT));
}

// One-time cleanup of legacy localStorage keys from the System era.
// Bumps the version to wipe again if needed.
const CLEANUP_KEY = 'alcon:storage-cleanup-v1';
function runLegacyCleanup() {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(CLEANUP_KEY)) return;
  localStorage.removeItem('alcon:systems');
  localStorage.removeItem('alcon:active-system');
  localStorage.setItem(CLEANUP_KEY, '1');
}

export function getActiveDomainId(): string | null {
  if (typeof window === 'undefined') return null;
  runLegacyCleanup();
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveDomainId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
  window.dispatchEvent(new CustomEvent(ACTIVE_DOMAIN_CHANGE_EVENT, { detail: id }));
}
