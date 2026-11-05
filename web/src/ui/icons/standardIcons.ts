'use client';

import { useSyncExternalStore } from 'react';
import type { LucideIcon } from 'lucide-react';

// The whole standard set as one lazily loaded map, for icons chosen at
// runtime by name. One request brings every drawing, so a list of items
// with their own icons — or the picker's grid — draws at once instead of
// fetching each icon on its own.

let icons: Record<string, LucideIcon> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadStandardIcons(): Promise<void> {
  loading ??= import('lucide-react')
    .then((m) => { icons = m.icons as Record<string, LucideIcon>; listeners.forEach((l) => l()); })
    .catch((e) => { loading = null; throw e; });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The standard set once loaded (null until then); starts loading on first use. */
export function useStandardIcons(): Record<string, LucideIcon> | null {
  const map = useSyncExternalStore(subscribe, () => icons, () => null);
  if (!map) void loadStandardIcons().catch(() => {});
  return map;
}

/** 'life-buoy' → 'LifeBuoy', the key the set is exported under. */
export function standardIconKey(name: string): string {
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}
