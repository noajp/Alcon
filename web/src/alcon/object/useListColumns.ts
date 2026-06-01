'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';

// Column-state hook for ObjectListView. Owns four persisted pieces:
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
  /** For kind === 'custom': the backing Tag definition. */
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
// Name has its own wider default + a higher floor than the data columns —
// it holds the row's title (often long) so it shouldn't be squeezed thin.
const NAME_DEFAULT_WIDTH = 600;
const NAME_MIN_WIDTH = 600;
const NAME_MAX_WIDTH = 1200;

const BUILTIN_COLUMNS: DataColumn[] = [
  { id: 'type',     label: 'Type',     kind: 'builtin', toggleable: false, defaultWidth: DEFAULT_COLUMN_WIDTH },
  { id: 'due_date', label: 'Due date', kind: 'builtin', toggleable: true,  defaultWidth: DEFAULT_COLUMN_WIDTH },
  { id: 'assignee', label: 'Assignee', kind: 'builtin', toggleable: true,  defaultWidth: DEFAULT_COLUMN_WIDTH },
];

const DEFAULT_VISIBLE: ColumnId[] = ['type', 'due_date'];
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

function loadSnapshot(storageKey: string): Snapshot {
  const k = keysFor(storageKey);
  const order = readJSON<ColumnId[]>(k.order);
  let visibleIds = readJSON<ColumnId[]>(k.visible);
  if (!Array.isArray(visibleIds)) {
    // Migrate the pre-multi-key visible blob written under the bare key.
    const legacy = readJSON<ColumnId[]>(k.legacy);
    visibleIds = Array.isArray(legacy) ? legacy : DEFAULT_VISIBLE;
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

export function useListColumns(
  storageKey: string | undefined,
  customColumns: CustomColumnWithValues[],
): ListColumnsState {
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
    return [...BUILTIN_COLUMNS, ...customDefs];
  }, [customColumns]);

  // ─── Reconcile with catalogue ─────────────────────────────────────────────
  // 1) Order: keep stored entries that still exist; append catalogue
  //    additions (new Tags) in their default position.
  const effectiveOrder = useMemo<ColumnId[]>(() => {
    const known = new Set(catalogue.map((c) => c.id));
    const kept = order.filter((id) => known.has(id));
    const keptSet = new Set(kept);
    const missing = catalogue.map((c) => c.id).filter((id) => !keptSet.has(id));
    return [...kept, ...missing];
  }, [order, catalogue]);

  // 2) Visible: keep stored visibility for known ids; default-add new custom
  //    columns (so a freshly created Tag shows up immediately). New built-ins
  //    follow the DEFAULT_VISIBLE list.
  const effectiveVisible = useMemo<Set<ColumnId>>(() => {
    const known = new Set(catalogue.map((c) => c.id));
    const set = new Set<ColumnId>(visibleIds.filter((id) => known.has(id)));
    const everSeen = new Set<ColumnId>(visibleIds);
    for (const c of catalogue) {
      if (everSeen.has(c.id)) continue;
      if (c.kind === 'custom') set.add(c.id);
      else if (DEFAULT_VISIBLE.includes(c.id)) set.add(c.id);
    }
    return set;
  }, [visibleIds, catalogue]);

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

export { customId as customColumnId, BUILTIN_COLUMNS };

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
