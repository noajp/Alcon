'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import { ELEMENT_DEFAULT_VISIBLE, OBJECT_DEFAULT_VISIBLE } from '@/alcon/shared/listConfig';

export type ColumnEntity = 'element' | 'object';

// Column-state hook for ListTable. Owns four persisted pieces:
//   - order:   ColumnId[]              user-chosen left→right sequence
//   - visible: ColumnId[]              which columns currently render
//   - widths:  Record<ColumnId,number> per-column pixel width
//   - sort:    ColumnSort | null       active sort applied to elements
//
// All four are scoped by `storageKey` so the Domain Elements view and a
// per-Object Elements tab remember their own choices independently.
//
// State lives in a module-level shared store keyed by `storageKey`. Calling
// useListColumns from multiple places with the same key reads the same
// snapshot and re-renders together — that's how the ListControls toolbar's
// Sort menu stays in lock-step with the column header's sort arrow.

export type ColumnKind = 'builtin' | 'custom';
export type ColumnId = string; // 'type' | 'due_date' | 'assignee' | `cc:${customId}`

export interface DataColumn {
  id: ColumnId;
  label: string;
  kind: ColumnKind;
  /** Built-in `type` is non-toggleable (always on); others can be hidden. */
  toggleable: boolean;
  defaultWidth: number;
  /** For kind === 'custom': the backing Property (custom_columns) definition. */
  custom?: CustomColumnWithValues;
}

// One shared default width across every data column — built-in or custom —
// so the column rhythm stays even out of the box. Tuned to Asana's typical
// custom-field column (~120px): tag chips and date ranges land with a
// little slack instead of truncating, while the table still reads dense.
// Users can per-column resize from there.
const DEFAULT_COLUMN_WIDTH = 110;

// Special width key for the Name column (not a real DataColumn — it isn't
// toggleable or reorderable). Stored alongside data-column widths so resize
// + persistence reuse the same code path.
export const NAME_COL_KEY = '__name__';
// Name has its own wider default than the data columns — it holds the row's
// title (often long). The floor was previously pinned to the default (450),
// which meant the Name column could never shrink: in a narrow panel (e.g.
// My Elements in a split view) the sticky Name alone filled the viewport and
// the data columns hid underneath it, unreachable. Drop the default to a
// still-comfortable width and give it a real (low) floor so it shrinks with
// the panel and the data cells stay visible / resizable.
const NAME_DEFAULT_WIDTH = 300;
const NAME_MIN_WIDTH = 140;
const NAME_MAX_WIDTH = 1200;

// Built-in (code-defined) columns per entity. 'type' is always-on (leftmost,
// non-toggleable) on both. Elements carry an Assignee; Objects carry a Lead
// (objects.lead_id), a computed Progress bar, and an Elements count instead.
const ELEMENT_BUILTIN_COLUMNS: DataColumn[] = [
  { id: 'type',     label: 'Type',     kind: 'builtin', toggleable: false, defaultWidth: DEFAULT_COLUMN_WIDTH },
  { id: 'due_date', label: 'Due date', kind: 'builtin', toggleable: true,  defaultWidth: DEFAULT_COLUMN_WIDTH },
  { id: 'assignee', label: 'Assignee', kind: 'builtin', toggleable: true,  defaultWidth: DEFAULT_COLUMN_WIDTH },
];
const OBJECT_BUILTIN_COLUMNS: DataColumn[] = [
  { id: 'type',     label: 'Type',     kind: 'builtin', toggleable: false, defaultWidth: DEFAULT_COLUMN_WIDTH },
  { id: 'due_date', label: 'Due date', kind: 'builtin', toggleable: true,  defaultWidth: DEFAULT_COLUMN_WIDTH },
  { id: 'lead',     label: 'Lead',     kind: 'builtin', toggleable: true,  defaultWidth: DEFAULT_COLUMN_WIDTH },
  { id: 'progress', label: 'Progress', kind: 'builtin', toggleable: true,  defaultWidth: 160 },
  { id: 'elements', label: 'Elements', kind: 'builtin', toggleable: true,  defaultWidth: DEFAULT_COLUMN_WIDTH },
];

function builtinsFor(entity: ColumnEntity): DataColumn[] {
  return entity === 'object' ? OBJECT_BUILTIN_COLUMNS : ELEMENT_BUILTIN_COLUMNS;
}
function defaultVisibleFor(entity: ColumnEntity): ColumnId[] {
  return entity === 'object' ? OBJECT_DEFAULT_VISIBLE : ELEMENT_DEFAULT_VISIBLE;
}

// Element default — the SSR/empty snapshot fallback (the hook reconciles to the
// per-entity set once it knows the entity).
const DEFAULT_VISIBLE: ColumnId[] = ELEMENT_DEFAULT_VISIBLE;
// Floor matches the default width so columns never resize below their
// natural readable size — labels stay fully visible and tags/chips don't
// truncate from a drag-down.
export const COLUMN_MIN_WIDTH = 110;
export const COLUMN_MAX_WIDTH = 600;

/** Active sort applied to every section's elements. `null` means natural
 *  order (whatever the data layer returned — usually elements.order_index). */
export type SortDirection = 'asc' | 'desc';
export interface ColumnSort {
  id: ColumnId;
  direction: SortDirection;
}

function customId(c: CustomColumnWithValues): ColumnId {
  return `cc:${c.id}`;
}

function isSort(v: unknown): v is ColumnSort {
  if (!v || typeof v !== 'object') return false;
  const s = v as { id?: unknown; direction?: unknown };
  return typeof s.id === 'string' && (s.direction === 'asc' || s.direction === 'desc');
}

function readJSON<T>(key: string | null): T | null {
  if (typeof window === 'undefined' || !key) return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function writeJSON(key: string | null, value: unknown) {
  if (typeof window === 'undefined' || !key) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

// ─── Shared store ─────────────────────────────────────────────────────────
// One snapshot per storageKey. Mutators replace the snapshot by reference so
// useSyncExternalStore subscribers re-render. Reading on the server returns
// a stable EMPTY_SNAPSHOT so SSR doesn't hydrate-mismatch.

interface Snapshot {
  order: ColumnId[];
  visibleIds: ColumnId[];
  widths: Record<ColumnId, number>;
  sort: ColumnSort | null;
}

interface StoreEntry {
  snapshot: Snapshot;
  listeners: Set<() => void>;
}

const EMPTY_SNAPSHOT: Snapshot = Object.freeze({
  order: [],
  visibleIds: DEFAULT_VISIBLE,
  widths: {},
  sort: null,
}) as Snapshot;

const STORES = new Map<string, StoreEntry>();

function keysFor(storageKey: string) {
  return {
    order:   `obj-list-cols:${storageKey}:order`,
    visible: `obj-list-cols:${storageKey}:visible`,
    widths:  `obj-list-cols:${storageKey}:widths`,
    sort:    `obj-list-cols:${storageKey}:sort`,
    legacy:  `obj-list-cols:${storageKey}`,
  };
}

// One-time migration: when customs stop auto-showing as columns, prune any
// previously persisted custom-column ids (`cc:*`) from the visible list so the
// list collapses to its default Properties. Idempotent — gated by a per-key
// sentinel so each list migrates once and lists opened later still get pruned
// (a single global flag would skip migration for any list not yet initialised
// when the flag latched). Users who later re-enable a custom column via the
// "+" menu have it written back into `visible`, so their explicit pick survives.
function prunedSentinelKey(storageKey: string): string {
  return `obj-list-cols:${storageKey}:customs-pruned-v1`;
}
function shouldPrunePerKey(storageKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return !window.localStorage.getItem(prunedSentinelKey(storageKey)); } catch { return false; }
}
function markPrunedPerKey(storageKey: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(prunedSentinelKey(storageKey), '1'); } catch { /* ignore */ }
}

function loadSnapshot(storageKey: string): Snapshot {
  const k = keysFor(storageKey);
  const order = readJSON<ColumnId[]>(k.order);
  let visibleIds = readJSON<ColumnId[]>(k.visible);
  if (!Array.isArray(visibleIds)) {
    // Migrate the pre-multi-key visible blob written under the bare key.
    const legacy = readJSON<ColumnId[]>(k.legacy);
    visibleIds = Array.isArray(legacy) ? legacy : DEFAULT_VISIBLE;
  }
  // One-time prune: drop previously auto-shown custom columns (`cc:*`) so
  // existing users see the default Properties on their first load after the
  // change. Run per-storageKey via a per-key sentinel so this doesn't depend on
  // which list the user opens first (a single global flag would skip migration
  // for lists initialised after the flag latched).
  if (shouldPrunePerKey(storageKey)) {
    const pruned = visibleIds.filter((id) => !String(id).startsWith('cc:'));
    if (pruned.length !== visibleIds.length) {
      visibleIds = pruned;
      writeJSON(k.visible, pruned);
    }
    markPrunedPerKey(storageKey);
  }
  const widths = readJSON<Record<ColumnId, number>>(k.widths);
  const sortRaw = readJSON<unknown>(k.sort);
  return {
    order: Array.isArray(order) ? order : [],
    visibleIds,
    widths: widths && typeof widths === 'object' ? widths : {},
    sort: isSort(sortRaw) ? sortRaw : null,
  };
}

function getEntry(storageKey: string): StoreEntry {
  let entry = STORES.get(storageKey);
  if (!entry) {
    entry = { snapshot: loadSnapshot(storageKey), listeners: new Set() };
    STORES.set(storageKey, entry);
  }
  return entry;
}

function setSnapshot(storageKey: string, updater: (prev: Snapshot) => Snapshot) {
  const entry = getEntry(storageKey);
  const next = updater(entry.snapshot);
  if (next === entry.snapshot) return;
  entry.snapshot = next;
  const k = keysFor(storageKey);
  writeJSON(k.order,   next.order);
  writeJSON(k.visible, next.visibleIds);
  writeJSON(k.widths,  next.widths);
  writeJSON(k.sort,    next.sort);
  entry.listeners.forEach((fn) => fn());
}

export interface ListColumnsState {
  /** Every column the row renderer should emit, left→right, already filtered
   *  by visibility. */
  visibleColumns: DataColumn[];
  /** Every column the toggle menu should expose, in display order. */
  allColumns: DataColumn[];
  /** Resolved width for any column id (falls back to defaultWidth). */
  widthFor: (id: ColumnId) => number;
  /** True when `id` is in the visible set. */
  isVisible: (id: ColumnId) => boolean;
  /** Toggle a column's visibility. */
  toggleVisible: (id: ColumnId) => void;
  /** Reorder: drop the column with id `activeId` immediately before `overId`
   *  (or to the end when `overId` is null). */
  moveColumn: (activeId: ColumnId, overId: ColumnId | null) => void;
  /** Set the live width of `id` (persisted on every change so a reload
   *  recovers the last sized state). */
  setWidth: (id: ColumnId, width: number) => void;
  /** Currently active sort (or null = natural order). */
  sort: ColumnSort | null;
  /** Cycle this column's sort: none → asc → desc → none. Sorting by a
   *  different column always starts over at asc. */
  cycleSort: (id: ColumnId) => void;
  /** Direct setter for the sort state — used by toolbar menus that pick
   *  both column and direction in one click rather than cycling. */
  setSort: (sort: ColumnSort | null) => void;
}

export interface UseListColumnsOptions {
  /** View-specific built-in columns injected into the catalogue (e.g. My
   *  Elements' "Objects" column). Kept out of the global BUILTIN_COLUMNS so
   *  they don't pollute views where they're meaningless. */
  extraColumns?: DataColumn[];
  /** Which column ids are visible by default for this view, overriding the
   *  per-entity default. Used to default-show an injected column. */
  defaultVisible?: ColumnId[];
  /** Which entity's built-in column set + default visibility to use.
   *  'element' (default) → Type / Due date / Assignee.
   *  'object' → Type / Due date / Lead / Progress / Elements. */
  entity?: ColumnEntity;
}

export function useListColumns(
  storageKey: string | undefined,
  customColumns: CustomColumnWithValues[],
  options: UseListColumnsOptions = {},
): ListColumnsState {
  const { extraColumns, entity = 'element' } = options;
  // Per-entity built-in set + default visibility, unless the caller overrides
  // defaultVisible explicitly. Both fall back to stable module constants.
  const defaultVisible = options.defaultVisible ?? defaultVisibleFor(entity);
  // Subscribe to the shared store for this storageKey. When the storageKey
  // is missing the hook still returns a usable (read-only-ish) snapshot so
  // callers don't need to branch.
  const subscribe = useCallback((listener: () => void) => {
    if (!storageKey) return () => {};
    const entry = getEntry(storageKey);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, [storageKey]);
  const getSnapshot = useCallback(() => {
    if (!storageKey) return EMPTY_SNAPSHOT;
    return getEntry(storageKey).snapshot;
  }, [storageKey]);
  const getServerSnapshot = useCallback(() => EMPTY_SNAPSHOT, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { order, visibleIds, widths, sort } = snapshot;

  // The full catalogue of columns this view knows about right now.
  const catalogue = useMemo<DataColumn[]>(() => {
    const customDefs: DataColumn[] = customColumns.map((c) => ({
      id: customId(c),
      label: c.name,
      kind: 'custom',
      toggleable: true,
      defaultWidth: DEFAULT_COLUMN_WIDTH,
      custom: c,
    }));
    return [...builtinsFor(entity), ...(extraColumns ?? []), ...customDefs];
  }, [customColumns, extraColumns, entity]);

  // ─── Reconcile with catalogue ─────────────────────────────────────────────
  // 1) Order: keep stored entries that still exist; append catalogue
  //    additions (new Properties) in their default position.
  const effectiveOrder = useMemo<ColumnId[]>(() => {
    const known = new Set(catalogue.map((c) => c.id));
    const kept = order.filter((id) => known.has(id));
    const keptSet = new Set(kept);
    const missing = catalogue.map((c) => c.id).filter((id) => !keptSet.has(id));
    return [...kept, ...missing];
  }, [order, catalogue]);

  // 2) Visible: keep stored visibility for known ids. New built-ins follow the
  //    per-entity default-visible list. Custom Properties default OFF — they
  //    live in the column "+" menu until the user toggles them on, so the list
  //    shows only its default Properties out of the box (custom Properties no longer
  //    auto-appear as columns and clutter the table).
  const effectiveVisible = useMemo<Set<ColumnId>>(() => {
    const known = new Set(catalogue.map((c) => c.id));
    const set = new Set<ColumnId>(visibleIds.filter((id) => known.has(id)));
    const everSeen = new Set<ColumnId>(visibleIds);
    for (const c of catalogue) {
      if (everSeen.has(c.id)) continue;
      if (c.kind === 'builtin' && defaultVisible.includes(c.id)) set.add(c.id);
    }
    return set;
  }, [visibleIds, catalogue, defaultVisible]);

  const catalogueById = useMemo(() => {
    const m = new Map<ColumnId, DataColumn>();
    for (const c of catalogue) m.set(c.id, c);
    return m;
  }, [catalogue]);

  const allColumns = useMemo<DataColumn[]>(
    () => effectiveOrder.map((id) => catalogueById.get(id)!).filter(Boolean),
    [effectiveOrder, catalogueById],
  );
  const visibleColumns = useMemo<DataColumn[]>(
    () => allColumns.filter((c) => effectiveVisible.has(c.id)),
    [allColumns, effectiveVisible],
  );

  // ─── Mutators ─────────────────────────────────────────────────────────────
  const widthFor = useCallback((id: ColumnId): number => {
    const stored = widths[id];
    if (typeof stored === 'number' && stored > 0) return stored;
    if (id === NAME_COL_KEY) return NAME_DEFAULT_WIDTH;
    return catalogueById.get(id)?.defaultWidth ?? DEFAULT_COLUMN_WIDTH;
  }, [widths, catalogueById]);

  const isVisible = useCallback(
    (id: ColumnId) => effectiveVisible.has(id),
    [effectiveVisible],
  );

  const toggleVisible = useCallback((id: ColumnId) => {
    if (!storageKey) return;
    setSnapshot(storageKey, (prev) => {
      const set = new Set(prev.visibleIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, visibleIds: Array.from(set) };
    });
  }, [storageKey]);

  const moveColumn = useCallback((activeId: ColumnId, overId: ColumnId | null) => {
    if (!storageKey || activeId === overId) return;
    setSnapshot(storageKey, (prev) => {
      // Reconcile here too — the persisted order may be missing the dragged
      // column if it's a new custom one. Use the effective order as base.
      const known = new Set(catalogue.map((c) => c.id));
      const kept = prev.order.filter((id) => known.has(id));
      const keptSet = new Set(kept);
      const base = [...kept, ...catalogue.map((c) => c.id).filter((id) => !keptSet.has(id))];
      const from = base.indexOf(activeId);
      if (from === -1) return prev;
      const next = [...base];
      next.splice(from, 1);
      if (overId == null) {
        next.push(activeId);
      } else {
        const to = next.indexOf(overId);
        if (to === -1) next.push(activeId);
        else next.splice(to, 0, activeId);
      }
      return { ...prev, order: next };
    });
  }, [storageKey, catalogue]);

  const setWidth = useCallback((id: ColumnId, width: number) => {
    if (!storageKey) return;
    // Name uses its own floor/ceiling; data columns use the shared bounds.
    const lo = id === NAME_COL_KEY ? NAME_MIN_WIDTH : COLUMN_MIN_WIDTH;
    const hi = id === NAME_COL_KEY ? NAME_MAX_WIDTH : COLUMN_MAX_WIDTH;
    const clamped = Math.max(lo, Math.min(hi, Math.round(width)));
    setSnapshot(storageKey, (prev) => {
      if (prev.widths[id] === clamped) return prev;
      return { ...prev, widths: { ...prev.widths, [id]: clamped } };
    });
  }, [storageKey]);

  const cycleSort = useCallback((id: ColumnId) => {
    if (!storageKey) return;
    setSnapshot(storageKey, (prev) => {
      const cur = prev.sort;
      let next: ColumnSort | null;
      if (!cur || cur.id !== id) next = { id, direction: 'asc' };
      else if (cur.direction === 'asc') next = { id, direction: 'desc' };
      else next = null;
      return { ...prev, sort: next };
    });
  }, [storageKey]);

  const setSortDirect = useCallback((nextSort: ColumnSort | null) => {
    if (!storageKey) return;
    setSnapshot(storageKey, (prev) => ({ ...prev, sort: nextSort }));
  }, [storageKey]);

  return {
    visibleColumns,
    allColumns,
    widthFor,
    isVisible,
    toggleVisible,
    moveColumn,
    setWidth,
    sort,
    cycleSort,
    setSort: setSortDirect,
  };
}

export { customId as customColumnId };

// ─── Sort helpers ──────────────────────────────────────────────────────────
// Apply a ColumnSort to a list of Elements. Nulls always sort last regardless
// of direction so an empty cell never floats to the top when the user toggles
// desc. Uses localeCompare for strings, numeric comparison for numbers.

type ElementLike = {
  type?: string | null;
  due_date?: string | null;
  assignees?: { worker?: { name?: string | null } | null }[] | null;
  custom_column_values?: Record<string, { value: unknown } | undefined> | null;
};

function compareKeys(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function keyOf(el: ElementLike, sort: ColumnSort, customColumns: CustomColumnWithValues[]): unknown {
  if (sort.id === 'type') return el.type ?? null;
  if (sort.id === 'due_date') return el.due_date ?? null;
  if (sort.id === 'assignee') {
    const first = el.assignees?.[0]?.worker?.name;
    return first ?? null;
  }
  if (sort.id.startsWith('cc:')) {
    const colId = sort.id.slice(3);
    // Two storage shapes coexist: the live custom_column_values map on the
    // Element, or the per-column `values` map on the column definition. Read
    // both so sort works whichever the page loaded.
    const fromElement = el.custom_column_values?.[colId]?.value;
    if (fromElement !== undefined) return fromElement;
    const col = customColumns.find((c) => c.id === colId);
    const fromCol = col?.values?.[(el as { id?: string }).id ?? '']?.value;
    return fromCol ?? null;
  }
  return null;
}

export function sortElements<T extends ElementLike>(
  elements: T[],
  sort: ColumnSort | null,
  customColumns: CustomColumnWithValues[],
): T[] {
  if (!sort) return elements;
  const dir = sort.direction === 'asc' ? 1 : -1;
  const out = [...elements];
  out.sort((a, b) => {
    const ka = keyOf(a, sort, customColumns);
    const kb = keyOf(b, sort, customColumns);
    // Nulls always last, irrespective of direction.
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    return dir * compareKeys(ka, kb);
  });
  return out;
}
