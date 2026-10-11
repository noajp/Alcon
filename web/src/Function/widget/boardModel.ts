import { WIDGET_REGISTRY } from './registry';
import {
  ZONES,
  emptyLayout,
  type BoardLayout,
  type SubjectKind,
  type WidgetInstance,
  type WidgetParams,
  type WidgetSize,
  type Zone,
} from './types';

// =============================================================
// Board model — the pure half of a board.
//
// A board is a subject's shared arrangement of widgets: one per surface and
// subject, the same for everyone who can see the subject. A widget is a row of
// its own, placed on a board by reference, so what it shows and who may see it
// do not depend on where it sits (docs/adr/0039).
//
// A surface's default instances are not rows until somebody edits the board.
// Until then they are read from `defaults.ts`, and `reconcileBoard` folds any
// default the stored board predates into it in place — people keep what they
// arranged and still get what a surface now shows by default, unless they took
// it off on purpose, which the board remembers.
// =============================================================

/** What each surface's board is about. A new surface is one entry here. */
export const SURFACE_SUBJECT: Record<string, SubjectKind> = {
  home: 'me',
  'object-overview': 'object',
  'object-summary': 'object',
  'domain-overview': 'domain',
  campaign: 'initiative',
  'element-detail': 'element',
};

export interface PlacementRow {
  id: string;
  widget_id: string;
  zone: string;
  position: number;
  size: string | null;
  default_id: string | null;
  /** null when the viewer cannot see the widget's origin. */
  widget: { id: string; kind: string; params: WidgetParams | null } | null;
}

export interface BoardRows {
  id: string;
  dismissed_defaults: string[] | null;
  board_placements: PlacementRow[] | null;
}

/** What a board remembers besides its arrangement. */
export interface BoardState {
  layout: BoardLayout;
  /** Ids of default instances somebody removed. Kept so a default that names
   *  them is not put back on the next load — removing Properties should stay
   *  removed, and adding it back is what the picker is for. */
  dismissed: Set<string>;
}

const isZone = (zone: string): zone is Zone => (ZONES as string[]).includes(zone);

/**
 * Stored rows as a layout. Drops anything the current build cannot render:
 * unknown kinds, widgets that do not fit the zone they were saved in,
 * duplicates of a singleton. Rows are other people's and other builds'
 * writing — they must never put the app in a state the code does not support.
 * A widget the viewer cannot see is kept as a `hidden` instance: its place on
 * the board is theirs to see even though its contents are not.
 */
export function layoutFromRows(rows: BoardRows | null): BoardState {
  const layout = emptyLayout();
  const seenIds = new Set<string>();
  const seenSingletons = new Set<string>();
  const placements = [...(rows?.board_placements ?? [])]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  for (const row of placements) {
    if (!isZone(row.zone)) continue;
    const id = row.default_id ?? row.widget_id;
    if (seenIds.has(id)) continue;
    const size: WidgetSize | undefined = row.size === 'full' || row.size === 'half' ? row.size : undefined;
    const placed = { id, size, widgetId: row.widget_id, placementId: row.id, position: row.position };
    if (!row.widget) {
      seenIds.add(id);
      layout[row.zone].push({ ...placed, type: '', hidden: true });
      continue;
    }
    const def = Object.hasOwn(WIDGET_REGISTRY, row.widget.kind) ? WIDGET_REGISTRY[row.widget.kind] : undefined;
    if (!def || !def.zones.includes(row.zone)) continue;
    if (def.singleton) {
      if (seenSingletons.has(def.type)) continue;
      seenSingletons.add(def.type);
    }
    seenIds.add(id);
    layout[row.zone].push({
      ...placed,
      type: def.type,
      // Kept as written and normalised at render, so a param this build has
      // no meaning for survives a round trip through an older client.
      params: row.widget.params && typeof row.widget.params === 'object' ? row.widget.params : undefined,
    });
  }
  return { layout, dismissed: new Set(rows?.dismissed_defaults ?? []) };
}

/**
 * Fold the defaults a stored board predates into it. Everything arranged
 * stays where it was put; a default instance the board has never held is
 * inserted at its default index in its default zone.
 *
 * Keyed on the default instance's OWN id, not its type, so it covers the
 * widgets a board may hold more than one of — Milestones and the two charts
 * are not singletons, and a type-keyed rule would leave a surface unable to
 * ever add one of those to its defaults again. Ids in `defaults.ts` are
 * hand-written and stable (`ov-trail`); a widget added from the picker is
 * addressed by its row id and never collides with them.
 *
 * The singleton check on top is what stops a second copy: a singleton removed
 * and re-added through the picker carries a fresh id, so its default id is
 * absent while its type is present.
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

export function boardLayout(rows: BoardRows | null, defaults: BoardLayout): BoardLayout {
  return reconcileBoard(layoutFromRows(rows), defaults);
}

/** A position strictly between two neighbours; either side may be the edge. */
export function positionBetween(prev: number | undefined, next: number | undefined): number {
  if (prev !== undefined && next !== undefined) return (prev + next) / 2;
  if (prev !== undefined) return prev + 1;
  if (next !== undefined) return next - 1;
  return 1;
}

export interface DefaultPlacement {
  default_id: string;
  kind: string;
  zone: Zone;
  position: number;
  size: WidgetSize | null;
  params: WidgetParams;
  singleton: boolean;
}

/**
 * The default instances of a layout that have no rows yet, each with a
 * position that keeps it where the layout shows it — between the stored
 * neighbours it sits among. This is what a board's first edit writes.
 */
export function unplacedDefaults(layout: BoardLayout): DefaultPlacement[] {
  const out: DefaultPlacement[] = [];
  for (const zone of ZONES) {
    const items = layout[zone];
    let start = 0;
    while (start < items.length) {
      if (items[start].placementId) { start += 1; continue; }
      let end = start;
      while (end < items.length && !items[end].placementId) end += 1;
      const prev = start > 0 ? items[start - 1].position : undefined;
      const next = end < items.length ? items[end].position : undefined;
      const count = end - start;
      for (let k = 0; k < count; k += 1) {
        const instance = items[start + k];
        const def = WIDGET_REGISTRY[instance.type];
        const position = prev !== undefined && next !== undefined
          ? prev + ((next - prev) * (k + 1)) / (count + 1)
          : prev !== undefined ? prev + k + 1
          : next !== undefined ? next - (count - k)
          : k + 1;
        out.push({
          default_id: instance.id,
          kind: instance.type,
          zone,
          position,
          size: instance.size ?? null,
          params: instance.params ?? {},
          singleton: !!def?.singleton,
        });
      }
      start = end;
    }
  }
  return out;
}

export type BoardEdit =
  | { op: 'add'; type: string; zone: Zone; index?: number }
  | { op: 'remove'; id: string }
  /** Reorders within a zone and carries across zones — one operation. */
  | { op: 'move'; id: string; zone: Zone; index: number }
  | { op: 'size'; id: string; size: WidgetSize }
  | { op: 'params'; id: string; params: WidgetParams | ((current: WidgetParams) => WidgetParams) }
  | { op: 'reset' };

export function findInstance(layout: BoardLayout, id: string): { zone: Zone; instance: WidgetInstance } | null {
  for (const zone of ZONES) {
    const instance = layout[zone].find((w) => w.id === id);
    if (instance) return { zone, instance };
  }
  return null;
}

/**
 * Whether a widget may be carried into a zone. A widget only goes where its
 * definition says it fits: a full-bleed table has no business in a 320px
 * rail, and refusing the drop is kinder than letting it land somewhere it
 * renders badly. A hidden widget's kind is unknown here, so it stays in the
 * zone somebody who could see it chose.
 */
export function fitsZone(instance: WidgetInstance, from: Zone, to: Zone): boolean {
  if (instance.hidden) return from === to;
  return !!WIDGET_REGISTRY[instance.type]?.zones.includes(to);
}

/** The position that lands `id` at `index` of `zone`, counted without itself. */
export function movePosition(layout: BoardLayout, id: string, zone: Zone, index: number): number {
  const others = layout[zone].filter((w) => w.id !== id);
  const at = Math.max(0, Math.min(index, others.length));
  return positionBetween(others[at - 1]?.position, others[at]?.position);
}

/**
 * What the board looks like once an edit lands — shown at once, while the
 * edit is on its way to the server. `add` is not anticipated: a widget keeps
 * its own data under its row id, which does not exist until the server makes
 * it.
 */
export function applyEdit(layout: BoardLayout, edit: BoardEdit, defaults: BoardLayout): BoardLayout {
  // A reset clears what the viewer can see; a hidden widget stays where it is.
  if (edit.op === 'reset') {
    const next = { ...defaults };
    for (const zone of ZONES) {
      const hidden = layout[zone].filter((w) => w.hidden);
      if (hidden.length) next[zone] = [...defaults[zone], ...hidden];
    }
    return next;
  }
  if (edit.op === 'add') return layout;
  const found = findInstance(layout, edit.id);
  if (!found) return layout;
  const { zone: from, instance } = found;
  if (edit.op === 'remove') {
    // Only someone who can see a widget may take it off the board.
    if (instance.hidden) return layout;
    return { ...layout, [from]: layout[from].filter((w) => w.id !== edit.id) };
  }
  if (edit.op === 'move') {
    if (!fitsZone(instance, from, edit.zone)) return layout;
    const next = { ...layout, [from]: layout[from].filter((w) => w.id !== edit.id) };
    const target = [...next[edit.zone]];
    target.splice(Math.max(0, Math.min(edit.index, target.length)), 0, instance);
    next[edit.zone] = target;
    return next;
  }
  const changed: WidgetInstance = edit.op === 'size'
    ? { ...instance, size: edit.size }
    : { ...instance, params: { ...instance.params, ...paramsPatch(instance, edit.params) } };
  return { ...layout, [from]: layout[from].map((w) => (w.id === edit.id ? changed : w)) };
}

/** Merged over what is there, so a caller sets one key without restating the rest. */
export function paramsPatch(
  instance: WidgetInstance,
  params: WidgetParams | ((current: WidgetParams) => WidgetParams),
): WidgetParams {
  return typeof params === 'function' ? params(instance.params ?? {}) : params;
}
