import { useSyncExternalStore } from 'react';
import { getActiveDomainId } from '@/Function/space/domainsStore';

// Named palette shown in the "Pick a color for label" picker. Keys are stored
// in domains.label_colors (name -> key); hex is what we actually render.
export const LABEL_PALETTE: { key: string; label: string; hex: string }[] = [
  { key: 'grey',     label: 'Grey',      hex: '#8b8d98' },
  { key: 'darkgrey', label: 'Dark Grey', hex: '#5f626b' },
  { key: 'purple',   label: 'Purple',    hex: '#8b5cf6' },
  { key: 'teal',     label: 'Teal',      hex: '#14b8a6' },
  { key: 'green',    label: 'Green',     hex: '#10b981' },
  { key: 'yellow',   label: 'Yellow',    hex: '#eab308' },
  { key: 'orange',   label: 'Orange',    hex: '#f97316' },
  { key: 'pink',     label: 'Pink',      hex: '#ec4899' },
  { key: 'red',      label: 'Red',       hex: '#ef4444' },
];
const PALETTE_HEX: Record<string, string> = Object.fromEntries(LABEL_PALETTE.map((p) => [p.key, p.hex]));

// Stable auto-colour from the name, used until a colour is picked.
const FALLBACK = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#14b8a6', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899'];
function deterministic(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

// Domain-scoped catalogue (label name -> palette key) + a tiny external store
// so every chip re-renders when the catalogue hydrates or a colour is picked.
const catalog = new Map<string, Record<string, string>>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version += 1; listeners.forEach((l) => l()); };

/** Seed/replace a Domain's colour catalogue (call when domains load). */
export function hydrateLabelColors(domainId: string, map: Record<string, string> | null | undefined) {
  const prev = catalog.get(domainId);
  const next = map ?? {};
  // Avoid a needless emit (and render loop) when nothing changed.
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
  catalog.set(domainId, next);
  emit();
}

/** Optimistically set one label's colour locally (pair with the DB write). */
export function setLabelColorLocal(domainId: string, name: string, colorKey: string) {
  catalog.set(domainId, { ...(catalog.get(domainId) ?? {}), [name]: colorKey });
  emit();
}

export function labelColorKey(name: string, domainId?: string | null): string | undefined {
  const d = domainId ?? getActiveDomainId();
  return d ? catalog.get(d)?.[name] : undefined;
}

/**
 * Every name the Domain's catalogue holds a colour for — including labels
 * Settings created ahead of use, which no Element mentions yet.
 */
export function domainLabelNames(domainId?: string | null): string[] {
  const d = domainId ?? getActiveDomainId();
  return d ? Object.keys(catalog.get(d) ?? {}) : [];
}

/** Hex colour for a label — the picked palette colour, else an auto colour. */
export function labelColor(name: string, domainId?: string | null): string {
  const key = labelColorKey(name, domainId);
  return (key && PALETTE_HEX[key]) || deterministic(name);
}

/** Subscribe a component so it re-renders on catalogue changes. */
export function useLabelColors(): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
    () => version,
  );
}
