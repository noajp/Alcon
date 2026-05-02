'use client';

const ACTIVE_KEY = 'alcon:active-domain';
export const ACTIVE_DOMAIN_CHANGE_EVENT = 'alcon:active-domain-change';
export const CREATE_DOMAIN_EVENT = 'alcon:create-domain';

export function getActiveDomainId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveDomainId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
  window.dispatchEvent(new CustomEvent(ACTIVE_DOMAIN_CHANGE_EVENT, { detail: id }));
}
