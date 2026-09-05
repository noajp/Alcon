import { WIDGET_REGISTRY } from './registry';
import { ZONES, emptyLayout, type StoredBoard, type BoardLayout, type WidgetParams } from './types';

// Bump only when the stored SHAPE changes. A default board gaining a widget is
// not that: `reconcileBoard` folds new default singletons into a stored
// arrangement in place, so people keep what they arranged and still get what
// a surface now shows by default — unless they took it off on purpose, which
// the board remembers.
const BOARD_SCHEMA_VERSION = 2;

/**
 * Widget types that became a configuration of another widget.
 *
 * `status-chart` and `priority-chart` were one figure with its axis welded in
 * — the same count, drawn against a different dimension. They are `breakdown`
 * now, and a stored board naming either keeps its place and its look by being
 * rewritten to the widget plus the params that reproduce it. Dropping them as
 * unknown types would have taken two widgets off every board that had them.
 */
const RENAMED: Record<string, { type: string; params: WidgetParams }> = {
  'status-chart': { type: 'breakdown', params: { dimension: 'status', shape: 'bar' } },
  'priority-chart': { type: 'breakdown', params: { dimension: 'priority', shape: 'donut' } },
};

// A fresh namespace, not a migration of `alcon:widget-layout:*`. Those blobs
// name widgets that no longer exist, and reading them is exactly how the old
// Overview resurrected a dashboard that had been deleted on purpose.


/** What a board remembers besides its arrangement. */
export interface BoardState {
  layout: BoardLayout;
  /** Ids of default instances the user removed. Kept so a default that names
   *  them is not put back on the next load — removing Properties should stay
   *  removed, and adding it back is what the picker is for. */
  dismissed: Set<string>;
}

/**
 * Drop anything the current build cannot render: unknown types, widgets that
 * no longer fit the zone they were saved in, duplicates of a singleton. A
 * stored layout is a user's arrangement, not a contract — it must never be
 * able to put the app in a state the code does not support.
 */
/** `migrate`, exposed for the tests that pin the rename table. */
export function migrateForTest(raw: unknown): BoardLayout | null {
  return migrateBoard(raw)?.layout ?? null;
}

export function migrateBoard(raw: unknown): BoardState | null {
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
      const renamed = Object.hasOwn(RENAMED, item.type) ? RENAMED[item.type] : undefined;
      const type = renamed?.type ?? item.type;
      const def = Object.hasOwn(WIDGET_REGISTRY, type) ? WIDGET_REGISTRY[type] : undefined;
      const params = renamed?.params;
      if (!def || !def.zones.includes(zone)) continue;
      if (def.singleton) {
        if (seenSingletons.has(def.type)) continue;
        seenSingletons.add(def.type);
      }
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      next[zone].push({
        id: item.id,
        type: def.type,
        size: item.size === 'full' || item.size === 'half' ? item.size : undefined,
        // Kept as written and normalised at render, so a param this build has
        // no meaning for survives a round trip through an older client
        // instead of being quietly erased.
        params: params ?? (item.params && typeof item.params === 'object' ? item.params : undefined),
      });
    }
  }
  const dismissed = new Set<string>(
    Array.isArray(stored.dismissed) ? stored.dismissed.filter((t): t is string => typeof t === 'string') : [],
  );
  return { layout: next, dismissed };
}

/**
 * Fold the defaults a stored board predates into it. Everything the user
 * arranged stays where they put it; a default instance they have never seen
 * is inserted at its default index in its default zone.
 *
 * Keyed on the default instance's OWN id, not its type, so it covers the
 * widgets a board may hold more than one of — Milestones and the two charts
 * are not singletons, and a type-keyed rule would leave a surface unable to
 * ever add one of those to its defaults again. Ids in `defaults.ts` are
 * hand-written and stable (`ov-trail`); ids the picker generates never
 * collide with them.
 *
 * The singleton check on top is what stops a second copy: a singleton removed
 * and re-added through the picker carries a fresh id, so its default id is
 * absent while its type is present.
 *
 * Pure and exported so the rule is testable — it decides what a person sees
 * after every release that adds to a surface.
 */
export function reconcileBoard(state: BoardState, defaults: BoardLayout): BoardLayout {
  const placedIds = new Set<string>();
  const placedTypes = new Set<string>();
  for (const zone of ZONES) {
    for (const w of state.layout[zone]) {
      placedIds.add(w.id);
      placedTypes.add(w.type);
    }
  }

  let layout = state.layout;
  for (const zone of ZONES) {
    defaults[zone].forEach((instance, index) => {
      if (placedIds.has(instance.id) || state.dismissed.has(instance.id)) return;
      if (WIDGET_REGISTRY[instance.type]?.singleton && placedTypes.has(instance.type)) return;
      const items = [...layout[zone]];
      items.splice(Math.min(index, items.length), 0, instance);
      layout = { ...layout, [zone]: items };
      placedIds.add(instance.id);
      placedTypes.add(instance.type);
    });
  }
  return layout;
}

