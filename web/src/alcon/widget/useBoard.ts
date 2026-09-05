'use client';

import { useCallback, useMemo } from 'react';
import { useWidgetBoard } from '@/hooks/useWidgetBoard';
import { WIDGET_REGISTRY } from './registry';
import {
  ZONES,
  type BoardLayout,
  type WidgetInstance,
  type WidgetParams,
  type WidgetSize,
  type Zone,
} from './types';

const STORAGE_PREFIX = 'alcon:board:v1:';
function genId(type: string): string { return `${type}-${crypto.randomUUID()}`; }
export { migrateForTest, reconcileBoard } from './boardModel';

export interface Board {
  layout: BoardLayout;
  loading: boolean;
  saving: boolean;
  error: string | null;
  retry: () => void;
  addWidget: (zone: Zone, type: string, index?: number) => void;
  removeWidget: (id: string) => void;
  /** Move a widget to `toZone` at `toIndex` — the same call reorders within
   *  a zone and carries one across, so the drag handler has one code path. */
  moveWidget: (id: string, toZone: Zone, toIndex: number) => void;
  /** Which zone a widget currently sits in, or null. */
  zoneOf: (id: string) => Zone | null;
  setSize: (id: string, size: WidgetSize) => void;
  /** Reconfigure one placed widget — the axes of a figure, say. Merged over
   *  what is there, so a caller sets one key without restating the rest. */
  setParams: (id: string, params: WidgetParams | ((current: WidgetParams) => WidgetParams)) => void;
  /** Types already placed anywhere on this board — the picker greys these. */
  placedTypes: Set<string>;
  reset: () => void;
}

export function useBoard(surface: string, defaults: BoardLayout, subjectId = 'me'): Board {
  const boardKey = `${surface}:${subjectId}`;
  const stored = useWidgetBoard(boardKey, `${STORAGE_PREFIX}${surface}`, defaults);
  const { layout, update } = stored;

  const addWidget = useCallback((zone: Zone, type: string, index?: number) => {
    const def = Object.hasOwn(WIDGET_REGISTRY, type) ? WIDGET_REGISTRY[type] : undefined;
    if (!def || !def.zones.includes(zone)) return;
    update((prev) => {
      if (def.singleton && ZONES.some((z) => prev[z].some((w) => w.type === type))) return prev;
      const instance: WidgetInstance = {
        id: genId(type),
        type,
        size: def.defaultSize,
        params: def.normalizeParams?.(undefined),
      };
      const items = [...prev[zone]];
      items.splice(index ?? items.length, 0, instance);
      return { ...prev, [zone]: items };
    });
  }, [update]);

  const removeWidget = useCallback((id: string) => {
    // Remembered by id, so a default naming this instance does not put it
    // straight back on the next load. An id the picker generated is not in
    // any defaults, so recording it costs a string and reconciles to nothing.
    update((prev) => {
      if (!ZONES.some((z) => prev[z].some((w) => w.id === id))) return prev;
      const next = { ...prev };
      for (const zone of ZONES) next[zone] = prev[zone].filter((w) => w.id !== id);
      return next;
    }, { id, dismissed: true });
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
      if (!ZONES.some((z) => prev[z].some((w) => w.id === id))) return prev;
      const next = { ...prev };
      for (const zone of ZONES) {
        next[zone] = prev[zone].map((w) => (w.id === id ? { ...w, size } : w));
      }
      return next;
    });
  }, [update]);

  const setParams = useCallback((id: string, params: WidgetParams | ((current: WidgetParams) => WidgetParams)) => {
    update((prev) => {
      const next = { ...prev };
      let touched = false;
      for (const zone of ZONES) {
        next[zone] = prev[zone].map((w) => {
          if (w.id !== id) return w;
          touched = true;
          const patch = typeof params === 'function' ? params(w.params ?? {}) : params;
          return { ...w, params: { ...w.params, ...patch } };
        });
      }
      return touched ? next : prev;
    });
  }, [update]);

  const reset = useCallback(() => update(() => defaults, undefined, true), [update, defaults]);

  const placedTypes = useMemo(() => {
    const set = new Set<string>();
    for (const zone of ZONES) for (const w of layout[zone]) set.add(w.type);
    return set;
  }, [layout]);

  return { layout, loading: stored.loading, saving: stored.saving, error: stored.error, retry: stored.retry, addWidget, removeWidget, moveWidget, zoneOf, setSize, setParams, placedTypes, reset };
}
