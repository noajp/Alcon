// localStorage-backed store for craft sessions and finalized deliverables.
// Sessions are keyed by (element_id, format) so a Documentation draft and
// a Presentation draft can coexist on the same Element. The shape mirrors
// what a future Supabase table would hold so the swap is mechanical.

import type { Craft, CraftFormat, CraftSession } from './types';

const SESSION_KEY = (elementId: string, format: CraftFormat) =>
  `alcon:craft:session:${format}:${elementId}`;
const FINALIZED_KEY = (elementId: string) => `alcon:craft:finals:${elementId}`;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadSession(elementId: string, format: CraftFormat): CraftSession | null {
  if (typeof window === 'undefined') return null;
  return safeParse<CraftSession | null>(
    localStorage.getItem(SESSION_KEY(elementId, format)),
    null
  );
}

export function saveSession(session: CraftSession): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(
    SESSION_KEY(session.element_id, session.format),
    JSON.stringify(session)
  );
}

export function clearSession(elementId: string, format: CraftFormat): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_KEY(elementId, format));
}

export function loadFinalized(elementId: string): Craft[] {
  if (typeof window === 'undefined') return [];
  return safeParse<Craft[]>(localStorage.getItem(FINALIZED_KEY(elementId)), []);
}

export function saveFinalized(elementId: string, crafts: Craft[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(FINALIZED_KEY(elementId), JSON.stringify(crafts));
}

export function appendFinalized(craft: Craft): Craft[] {
  const existing = loadFinalized(craft.element_id);
  const next = [craft, ...existing];
  saveFinalized(craft.element_id, next);
  return next;
}

export function removeFinalized(elementId: string, craftId: string): Craft[] {
  const next = loadFinalized(elementId).filter((c) => c.id !== craftId);
  saveFinalized(elementId, next);
  return next;
}
