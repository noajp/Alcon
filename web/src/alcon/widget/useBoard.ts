'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { WIDGET_REGISTRY } from './registry';
import {
  ZONES,
  emptyLayout,
  type BoardLayout,
  type StoredBoard,
  type WidgetInstance,
  type WidgetSize,
  type Zone,
} from './types';

// =============================================================
// Board state — the placed widgets for one surface, and their persistence.
//
// The key is the SURFACE, not the row: every Object Overview shares one
// board, so arranging it once arranges it everywhere. Per-instance boards
// (this Campaign laid out differently from that one) arrive with the
// `widget_boards` table, and land as a different `boardKey` — nothing else
// here changes.
// =============================================================

// Bump when a default board gains something a stored board could not have
// known to include and must not be without — the Campaign's Measures,
// Assumptions and Decisions carry authored data, and a saved arrangement made
// before they existed would silently hide all three. A bump discards stored
// arrangements, which is the cheaper loss of the two. It is not the answer for
// an ordinary new widget: those simply appear in the picker.
const BOARD_SCHEMA_VERSION = 2;

// A fresh namespace, not a migration of `alcon:widget-layout:*`. Those blobs
// name widgets that no longer exist, and reading them is exactly how the old
// Overview resurrected a dashboard that had been deleted on purpose.
const STORAGE_PREFIX = 'alcon:board:v1:';

function genId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Drop anything the current build cannot render: unknown types, widgets that
 * no longer fit the zone they were saved in, duplicates of a singleton. A
 * stored layout is a user's arrangement, not a contract — it must never be
 * able to put the app in a state the code does not support.
 */
function migrate(raw: unknown): BoardLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const stored = raw as Partial<StoredBoard>;
  if (stored.version !== BOARD_SCHEMA_VERSION || !stored.zones) return null;

  const next = emptyLayout();
  const seenIds = new Set<string>();
  // Board-wide, matching addWidget: a singleton placed in two zones is still
  // two copies of a widget that must exist once.
  const seenSingletons = new Set<string>();
  for (const zone of ZONES) {
    const items = stored.zones[zone];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || typeof item.type !== 'string') continue;
      const def = WIDGET_REGISTRY[item.type];
      if (!def || !def.zones.includes(zone)) continue;
      if (def.singleton) {
        if (seenSingletons.has(def.type)) continue;
        seenSingletons.add(def.type);
      }
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      next[zone].push({
        id: item.id,
        type: item.type,
        size: item.size === 'full' || item.size === 'half' ? item.size : undefined,
      });
    }
  }
  return next;
}

function read(storageKey: string): BoardLayout | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch {
    // Corrupt or unreadable — fall back to defaults rather than blanking.
    return null;
  }
}

export interface Board {
  layout: BoardLayout;
  addWidget: (zone: Zone, type: string, index?: number) => void;
  removeWidget: (id: string) => void;
  /** Move a widget to `toZone` at `toIndex` — the same call reorders within
   *  a zone and carries one across, so the drag handler has one code path. */
  moveWidget: (id: string, toZone: Zone, toIndex: number) => void;
  /** Which zone a widget currently sits in, or null. */
  zoneOf: (id: string) => Zone | null;
  setSize: (id: string, size: WidgetSize) => void;
  /** Types already placed anywhere on this board — the picker greys these. */
  placedTypes: Set<string>;
  reset: () => void;
}

export function useBoard(boardKey: string, defaults: BoardLayout): Board {
  const storageKey = `${STORAGE_PREFIX}${boardKey}`;

  // Read once, lazily — the same shape `useRailApps` uses for the rail's own
  // localStorage state. The server has no storage and renders the defaults;
  // the client's first render reads the saved arrangement. `boardKey` is a
  // literal per surface, so there is no case where this needs re-reading
  // without the component having remounted.
  const [layout, setLayout] = useState<BoardLayout>(() => read(storageKey) ?? defaults);

  // The ref mirrors the state so an update can compute its next value in the
  // event handler rather than inside a state updater. Persisting from inside
  // an updater would be a side effect in a function React is free to call
  // twice; this way the write happens exactly once, where the change did.
  const layoutRef = useRef(layout);

  const commit = useCallback((next: BoardLayout) => {
    layoutRef.current = next;
    setLayout(next);
    if (typeof window === 'undefined') return;
    try {
      const payload: StoredBoard = { version: BOARD_SCHEMA_VERSION, zones: next };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Quota or private mode — the arrangement still works for this session.
    }
  }, [storageKey]);

  const update = useCallback(
    (fn: (prev: BoardLayout) => BoardLayout) => {
      const next = fn(layoutRef.current);
      if (next !== layoutRef.current) commit(next);
    },
    [commit],
  );

  const addWidget = useCallback((zone: Zone, type: string, index?: number) => {
    const def = WIDGET_REGISTRY[type];
    if (!def || !def.zones.includes(zone)) return;
    update((prev) => {
      if (def.singleton && ZONES.some((z) => prev[z].some((w) => w.type === type))) return prev;
      const instance: WidgetInstance = { id: genId(type), type, size: def.defaultSize };
      const items = [...prev[zone]];
      items.splice(index ?? items.length, 0, instance);
      return { ...prev, [zone]: items };
    });
  }, [update]);

  const removeWidget = useCallback((id: string) => {
    update((prev) => {
      const next = { ...prev };
      for (const zone of ZONES) next[zone] = prev[zone].filter((w) => w.id !== id);
      return next;
    });
  }, [update]);

  const moveWidget = useCallback((id: string, toZone: Zone, toIndex: number) => {
    update((prev) => {
      const fromZone = ZONES.find((z) => prev[z].some((w) => w.id === id));
      if (!fromZone) return prev;
      const moving = prev[fromZone].find((w) => w.id === id)!;
      // A widget only goes where its definition says it fits: a full-bleed
      // table has no business in a 320px rail, and refusing the drop is
      // kinder than letting it land somewhere it renders badly.
      const def = WIDGET_REGISTRY[moving.type];
      if (!def || !def.zones.includes(toZone)) return prev;

      const next = { ...prev };
      next[fromZone] = prev[fromZone].filter((w) => w.id !== id);
      const target = fromZone === toZone ? [...next[toZone]] : [...prev[toZone]];
      const clamped = Math.max(0, Math.min(toIndex, target.length));
      target.splice(clamped, 0, moving);
      next[toZone] = target;
      return next;
    });
  }, [update]);

  const zoneOf = useCallback(
    (id: string) => ZONES.find((z) => layout[z].some((w) => w.id === id)) ?? null,
    [layout],
  );

  const setSize = useCallback((id: string, size: WidgetSize) => {
    update((prev) => {
      const next = { ...prev };
      for (const zone of ZONES) {
        next[zone] = prev[zone].map((w) => (w.id === id ? { ...w, size } : w));
      }
      return next;
    });
  }, [update]);

  const reset = useCallback(() => commit(defaults), [commit, defaults]);

  const placedTypes = useMemo(() => {
    const set = new Set<string>();
    for (const zone of ZONES) for (const w of layout[zone]) set.add(w.type);
    return set;
  }, [layout]);

  return { layout, addWidget, removeWidget, moveWidget, zoneOf, setSize, placedTypes, reset };
}
