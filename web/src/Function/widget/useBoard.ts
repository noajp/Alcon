'use client';

import { useCallback, useMemo } from 'react';
import { useWidgetBoard } from '@/hooks/useWidgetBoard';
import {
  ZONES,
  type BoardLayout,
  type WidgetParams,
  type WidgetSize,
  type Zone,
} from './types';

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

/**
 * The board a surface shows for one subject. `subjectRef` is the subject's id;
 * on a personal surface (Home) it is the Space the board is kept for.
 */
export function useBoard(surface: string, defaults: BoardLayout, subjectRef = 'me'): Board {
  const stored = useWidgetBoard(surface, defaults, subjectRef);
  const { layout, update } = stored;

  const addWidget = useCallback((zone: Zone, type: string, index?: number) => {
    update({ op: 'add', type, zone, index });
  }, [update]);
  const removeWidget = useCallback((id: string) => update({ op: 'remove', id }), [update]);
  const moveWidget = useCallback((id: string, toZone: Zone, toIndex: number) => {
    update({ op: 'move', id, zone: toZone, index: toIndex });
  }, [update]);
  const setSize = useCallback((id: string, size: WidgetSize) => update({ op: 'size', id, size }), [update]);
  const setParams = useCallback((id: string, params: WidgetParams | ((current: WidgetParams) => WidgetParams)) => {
    update({ op: 'params', id, params });
  }, [update]);
  const reset = useCallback(() => update({ op: 'reset' }), [update]);

  const zoneOf = useCallback(
    (id: string) => ZONES.find((z) => layout[z].some((w) => w.id === id)) ?? null,
    [layout],
  );

  const placedTypes = useMemo(() => {
    const set = new Set<string>();
    for (const zone of ZONES) for (const w of layout[zone]) if (!w.hidden) set.add(w.type);
    return set;
  }, [layout]);

  return { layout, loading: stored.loading, saving: stored.saving, error: stored.error, retry: stored.retry, addWidget, removeWidget, moveWidget, zoneOf, setSize, setParams, placedTypes, reset };
}
