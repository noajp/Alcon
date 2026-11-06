'use client';

import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { Plus } from '@/ui/icons';
import type { AlconObjectWithChildren, CustomColumnWithValues, ElementWithDetails, Worker } from '@/hooks/useSupabase';
import { reorderElements, reorderObjects, useElementCommentActivity, useElementBlockers, withCommentActivity } from '@/hooks/useSupabase';
import { type DependencyBlocker } from '@/Function/shared/element/dependencyReadiness';
import { displayIdOf } from '@/Function/shared/element/displayId';
import { DisplayIdChip } from '@/Function/shared/element/DisplayIdChip';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter, pointerWithin, type DragEndEvent, type DragStartEvent, type DragMoveEvent, type CollisionDetection } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import type { Json } from '@/types/database';
import { ObjectIcon } from '@/Frame/icons';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { getElementProgress } from '@/Function/shared/ElementProgressMark';
import { useListColumns, sortElements, NAME_COL_KEY, NAME_MIN_WIDTH, type ColumnId, type DataColumn, type ColumnEntity } from '@/Function/shared/listTable/useListColumns';
import { EMPTY_CUSTOM_COLUMNS, EMPTY_ELEMENT_TYPES, EMPTY_WORKERS, EMPTY_ELEMENT_IDS, type ElementUpdate, type ListSection, HEADER_DRAG_PREFIX, OBJECT_DRAG_PREFIX, ROW_ROUND_BASE, STICKY_TINT_HOVER, LEAD_CELL, LEAD_CELL_HOVER } from './shared';
import { ElementRow } from './ElementRow';
import { reorderWithinSections } from './rowReorder';
import { ObjectRow } from './ObjectRow';
import { ColumnHeader, ResizeHandle, FieldsMenu } from './ColumnHeaderMenu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fieldDisplayLabel } from '@/Function/property/fieldModel';
import { useOptionalExplorerData } from '@/Function/shared/ExplorerDataContext';

// Build a type-scoped, pointer-first collision detector. Two reasons it's
// custom:
//  1) All three sortable kinds (column headers, Object rows, Element rows)
//     share ONE DndContext, so we first filter droppables to the same kind
//     as the active item — otherwise a dragged row could match a column
//     header that happened to be nearest.
//  2) For rows we resolve by the POINTER, not the dragged rect's centre.
//     closestCenter compares the full-height dragged rect's centre, which
//     near the list's bottom edge flips to the wrong row (and never lets you
//     target "below the last row"). `pointerWithin` picks the row the cursor
//     is literally inside; when the cursor is past the last row, we fall
//     back to closestCenter so it resolves to that last row (→ drop after).
//  `onPointer` is called with the live pointer so the edge calc in
//  onDragMove can use the cursor position too (Y for rows, X for columns).
function makeRowAwareCollision(onPointer: (x: number, y: number) => void): CollisionDetection {
  return (args) => {
    if (args.pointerCoordinates) onPointer(args.pointerCoordinates.x, args.pointerCoordinates.y);
    const activeId = String(args.active.id);
    const isCol = activeId.startsWith(HEADER_DRAG_PREFIX);
    const isObj = activeId.startsWith(OBJECT_DRAG_PREFIX);
    const droppableContainers = args.droppableContainers.filter((c) => {
      const id = String(c.id);
      if (isCol) return id.startsWith(HEADER_DRAG_PREFIX);
      if (isObj) return id.startsWith(OBJECT_DRAG_PREFIX);
      return !id.startsWith(HEADER_DRAG_PREFIX) && !id.startsWith(OBJECT_DRAG_PREFIX);
    });
    const scoped = { ...args, droppableContainers };
    // Columns drag horizontally — closestCenter reads best there.
    if (isCol) return closestCenter(scoped);
    // Rows: the row the cursor is literally inside.
    const within = pointerWithin(scoped);
    if (within.length > 0) return within;
    // Cursor outside every row (above the first / below the last): pick the
    // row whose vertical midpoint is nearest the cursor Y, so dragging into
    // the empty space below the list still resolves to the last row (→ the
    // edge calc then reads "after"). closestCenter would use the dragged
    // rect's centre here and jump to the wrong row.
    const py = args.pointerCoordinates?.y;
    if (py == null) return closestCenter(scoped);
    let best: (typeof droppableContainers)[number] | null = null;
    let bestDist = Infinity;
    for (const c of droppableContainers) {
      const rect = args.droppableRects.get(c.id);
      if (!rect) continue;
      const dist = Math.abs(py - (rect.top + rect.height / 2));
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
    return best ? [{ id: best.id }] : [];
  };
}

interface ListTableProps {
  sections: ListSection[];
  onSelectObject: (id: string) => void;
  onSelectElement?: (id: string) => void;
  /** When set, renders an "Add Object" footer row inside each section. */
  onAddObject?: () => void;
  /** When set, renders a `+` button on the right of every section header
   *  (and the legacy "Add Element" footer row). The section is passed so
   *  callers can route the add to the right Object (or Domain-direct for
   *  the synthetic `__domain__` section). */
  onAddElement?: (section?: ListSection) => void;
  /** Hide the section header row entirely (still groups items underneath). */
  hideSectionHeaders?: boolean;
  /** localStorage key for the element column visibility set. Distinct keys
   *  let Domain root and per-Object views remember their own column choice. */
  colStorageKey?: string;
  /** User-defined columns (custom Properties) — Notion-style. When passed, they render
   *  to the right of the built-in columns and stay in sync with the
   *  Element detail panel via `custom_column_values`. */
  customColumns?: CustomColumnWithValues[];
  /** View-specific built-in columns injected into the catalogue (e.g. My
   *  Elements' "Objects" column). Pass a stable array reference. */
  extraColumns?: DataColumn[];
  /** Column ids visible by default for this view (overrides the global
   *  default). Pass a stable array reference. */
  defaultVisibleColumns?: ColumnId[];
  /** Which entity these rows are — picks the built-in column set + default
   *  visibility ('element' Type/Due/Assignee vs 'object' Type/Due/Lead/
   *  Progress/Elements). Defaults to 'element'. */
  entity?: ColumnEntity;
  /** Domain-shared Element types — option list for the always-on `type`
   *  column. When non-empty and onElementUpdate is set, the cell is an
   *  editable dropdown; otherwise it renders read-only. */
  elementTypes?: string[];
  /** Add a brand-new Element type to the Domain catalogue (from the Type
   *  cell's chip-grid "+"). When omitted, the "+" is hidden. */
  onAddType?: (name: string) => void | Promise<void>;
  /** Remove an Element type from the Domain catalogue (TypeCell edit mode's
   *  per-chip "×"). When omitted, the footer Edit toggle is hidden. */
  onRemoveType?: (name: string) => void | Promise<void>;
  /** Save a custom-column value for an Element. Required when customColumns is set. */
  onCustomColumnValueChange?: (columnId: string, elementId: string, value: Json) => void | Promise<void>;
  /** Save a custom-column value for an Object. Required when the Domain
   *  Object list passes Domain-scoped customColumns. */
  onObjectCustomColumnValueChange?: (columnId: string, objectId: string, value: Json) => void | Promise<void>;
  /** Open the Add-Column modal from the column header's "+" button. When
   *  set, clicking "+" triggers this instead of the built-in toggle menu. */
  onEditColumn?: (column: CustomColumnWithValues) => void;
  onAddColumn?: (anchor?: DOMRect) => void;
  /** Inline-edit Element fields (status / priority / due_date) directly
   *  from list cells. When omitted the cells render read-only. */
  onElementUpdate?: (elementId: string, updates: ElementUpdate) => void | Promise<void>;
  /** Refresh the list after a change that isn't a plain field edit — e.g.
   *  adding/removing an assignee (a junction-table write). Wired to the host's
   *  data reload so the Assignee cell can reflect the new set. */
  onRefresh?: () => void | Promise<void>;
  /** Inline-edit Object fields (type / due_date / lead) directly from list
   *  cells. When omitted, those Object cells render read-only. */
  onObjectUpdate?: (objectId: string, updates: { type?: string | null; due_date?: string | null; lead_id?: string | null }) => void | Promise<void>;
  /** Assignable Workers for the Object Lead cell picker (resolve lead_id →
   *  name + the dropdown options). Pass a stable array reference. */
  objectWorkers?: Worker[];
  /** Unresolved `depends_on` upstreams per Element, keyed by Element id.
   *  Hosts that already fetch this to drive the Ready filter pass it down so
   *  the map is fetched once; when omitted the table fetches its own. */
  blockers?: Record<string, DependencyBlocker[]>;
  /** Multi-select state: ids of currently selected Elements. */
  selectedElementIds?: Set<string>;
  /** Click handler for an Element row that signals selection intent.
   *  - `single`  : Cmd/Ctrl-click — toggle this id only
   *  - `range`   : Shift-click — extend selection to this id from the
   *    most-recent anchor
   *  - `replace` : plain click while another is already selected —
   *    parent decides (typically clears + selects this) */
  onElementRowSelect?: (elementId: string, mode: 'single' | 'range' | 'replace', orderedIds?: string[]) => void;
  /** Multi-select state for Object rows — mirrors selectedElementIds. */
  selectedObjectIds?: Set<string>;
  /** Click handler for Object rows. Same modes/semantics as
   *  onElementRowSelect, just scoped to Object ids. */
  onObjectRowSelect?: (objectId: string, mode: 'single' | 'range' | 'replace', orderedIds?: string[]) => void;
}

/**
 * Unified ListView used wherever Objects / Elements are listed at any
 * hierarchy level. The markup is shared so the Domain Object list and the
 * per-Object item list look identical — column header, optional section
 * header (bold name + count + collapse chevron), Object rows (grip + name),
 * optional Element rows (priority/status/due in extra columns), and inline
 * "Add" footers.
 */
export function ListTable({
  sections,
  onSelectObject,
  onSelectElement,
  onAddObject,
  onAddElement,
  hideSectionHeaders = false,
  colStorageKey,
  customColumns = EMPTY_CUSTOM_COLUMNS,
  extraColumns,
  defaultVisibleColumns,
  entity = 'element',
  elementTypes = EMPTY_ELEMENT_TYPES,
  onAddType,
  onRemoveType,
  onCustomColumnValueChange,
  onObjectCustomColumnValueChange,
  onAddColumn,
  onEditColumn,
  onElementUpdate,
  onObjectUpdate,
  objectWorkers = EMPTY_WORKERS,
  onRefresh,
  blockers,
  selectedElementIds,
  onElementRowSelect,
  selectedObjectIds,
  onObjectRowSelect,
}: ListTableProps) {
  const { t } = useI18n();
  const dndId = useId();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // The id column takes the width of the widest id drawn, so the status mark
  // and title start at one x down the whole list (9rem cap = the chip's
  // own max-w-36).
  const tableRef = useRef<HTMLTableElement | null>(null);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Single source of truth for column layout — visibility, order, width.
  // The hook persists each piece under `obj-list-cols:<key>:{visible,order,widths}`
  // and migrates the pre-existing visible-only entry once.
  const cols = useListColumns(colStorageKey, customColumns, {
    extraColumns,
    defaultVisible: defaultVisibleColumns,
    entity,
  });

  // Show Element-specific data columns only when at least one section
  // carries elements (otherwise the wide layout looks empty when listing
  // Objects only). Object-only views still get the Type column inline on
  // each Object row, so they never see the data-column band.
  // Memoised so the array reference is stable across the common re-render
  // trigger (an element edit changing `sections`) — required for the
  // memoised ElementRow below to actually skip unchanged rows.
  const visibleColumns = useMemo<DataColumn[]>(
    () => cols.visibleColumns,
    [cols.visibleColumns],
  );
  const visibleColumnIds = useMemo(
    () => visibleColumns.map((c) => c.id),
    [visibleColumns],
  );

  // Single source of truth for the on-screen order. Sorting is applied here
  // ONCE so the rendered rows, the range-select id lists, the drop-line edge
  // math, and the drag-end reorder all agree. (Computing it per-section in
  // the render map meant the displayed* refs — built from the raw section
  // arrays — disagreed with what was painted whenever a column sort was
  // active, putting the blue line on the wrong row.)
  // The rollup is fetched for the whole visible set and hung on each Element
  // before sorting, because sorting by Activity has to read it. The id list
  // comes from the unsorted sections — order never changes membership, and
  // taking it from the sorted ones would make the fetch depend on its own
  // result.
  const sectionElementIds = useMemo(
    () => sections.flatMap((s) => (s.elements ?? []).map((e) => e.id)),
    [sections],
  );
  const elementActivity = useElementCommentActivity(sectionElementIds);
  // The Objects column reads each Element's home Objects. Only some loaders
  // resolve them (My Elements); elsewhere they come from the explorer tree,
  // where an Element is listed under every Object it belongs to.
  const explorer = useOptionalExplorerData();
  const homesByElement = useMemo(() => {
    const m = new Map<string, { id: string; name: string }[]>();
    for (const o of explorer?.objects ?? []) for (const e of o.elements ?? []) {
      const list = m.get(e.id) ?? [];
      if (!list.some((h) => h.id === o.id)) list.push({ id: o.id, name: o.name });
      m.set(e.id, list);
    }
    return m;
  }, [explorer?.objects]);
  const sortedSections = useMemo(
    () => sections.map((s) => ({
      ...s,
      objects: sortElements(s.objects ?? [], cols.sort, customColumns),
      elements: sortElements(
        withCommentActivity(s.elements ?? [], elementActivity).map((e) => (e.objects ? e : { ...e, objects: homesByElement.get(e.id) ?? [] })),
        cols.sort, customColumns),
    })),
    [sections, cols.sort, customColumns, elementActivity, homesByElement],
  );

  // Header-drag tracking — keeps the dragged column dim while it's in flight
  // so the user can see where it'll land.
  const [draggingColId, setDraggingColId] = useState<ColumnId | null>(null);
  // Row drag-and-drop state. Instead of shifting every row to make space
  // (transform on each <tr>, which paints slowly inside a table), we keep
  // rows STATIC and show two cheap things: a floating DragOverlay card that
  // follows the pointer (one GPU-composited element), and a blue insertion
  // line drawn on the row the drop would land against.
  const [activeRow, setActiveRow] = useState<{ kind: 'element' | 'object'; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);
  // Live pointer Y during a drag (fed by the collision detector). The
  // drop-line edge is decided by where the CURSOR sits relative to the
  // hovered row's midline — predictable, unlike the dragged rect's centre.
  const pointerYRef = useRef(0);
  const pointerXRef = useRef(0);
  // A column being dragged: the header it would land against, and on which
  // side — drawn as a vertical line, like the rows' horizontal one.
  const [colDrop, setColDrop] = useState<{ id: ColumnId; edge: 'before' | 'after' } | null>(null);
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- Existing ListTable diagnostic retained during mechanical extraction.
  const collisionDetection = useMemo(
  // eslint-disable-next-line react-hooks/refs -- Existing ListTable diagnostic retained during mechanical extraction.
    () => makeRowAwareCollision((x, y) => { pointerXRef.current = x; pointerYRef.current = y; }),
    [],
  );

  // Stable callback singletons via a latest-ref. The row callbacks keep a
  // fixed identity across renders (so React.memo can skip), while always
  // invoking the freshest handler the parent passed. Capability booleans
  // preserve the "read-only when no handler" branches inside the row.
  const cbRef = useRef({ onElementUpdate, onSelectElement, onElementRowSelect, onCustomColumnValueChange, onObjectRowSelect, onSelectObject, onAddType, onRemoveType, onRefresh });
  // eslint-disable-next-line react-hooks/refs -- Existing ListTable diagnostic retained during mechanical extraction.
  cbRef.current = { onElementUpdate, onSelectElement, onElementRowSelect, onCustomColumnValueChange, onObjectRowSelect, onSelectObject, onAddType, onRemoveType, onRefresh };
  // Flattened element ids in DISPLAY order (across all sections) — one
  // source feeding both range-select (Shift-click fills the visible range)
  // and the comment-activity rollup, so the two can never disagree about
  // what "in view" means.
  const displayedElementIds = useMemo(
    () => sortedSections.flatMap((s) => (s.elements ?? []).map((e) => e.id)),
    [sortedSections],
  );
  const displayedIdsRef = useRef<string[]>([]);
  // eslint-disable-next-line react-hooks/refs -- Existing ListTable diagnostic retained during mechanical extraction.
  displayedIdsRef.current = displayedElementIds;
  // Dependency blockers come from the host when it already has them (it needs
  // the same map for the Ready filter); otherwise the table fetches its own.
  // Passing an empty id list is what keeps the second fetch from happening.
  const ownBlockers = useElementBlockers(blockers ? EMPTY_ELEMENT_IDS : displayedElementIds);
  const elementBlockers = blockers ?? ownBlockers;
  const displayedObjectIdsRef = useRef<string[]>([]);
  // eslint-disable-next-line react-hooks/refs -- Existing ListTable diagnostic retained during mechanical extraction.
  displayedObjectIdsRef.current = sortedSections.flatMap((s) => (s.objects ?? []).map((o) => o.id));
  const stableElementUpdate = useCallback((id: string, u: ElementUpdate) => cbRef.current.onElementUpdate?.(id, u), []);
  const stableRefresh = useCallback(() => cbRef.current.onRefresh?.(), []);
  const stableSelectElement = useCallback((id: string) => cbRef.current.onSelectElement?.(id), []);
  const stableRowSelect = useCallback((id: string, mode: 'single' | 'range' | 'replace') => cbRef.current.onElementRowSelect?.(id, mode, displayedIdsRef.current), []);
  const stableObjectRowSelect = useCallback((id: string, mode: 'single' | 'range' | 'replace') => cbRef.current.onObjectRowSelect?.(id, mode, displayedObjectIdsRef.current), []);
  const stableSelectObjectCb = useCallback((id: string) => cbRef.current.onSelectObject?.(id), []);
  const stableCustomColChange = useCallback((cid: string, eid: string, v: Json) => cbRef.current.onCustomColumnValueChange?.(cid, eid, v), []);
  const stableAddType = useCallback((name: string) => cbRef.current.onAddType?.(name), []);
  const canAddType = !!onAddType;
  const stableRemoveType = useCallback((name: string) => cbRef.current.onRemoveType?.(name), []);
  const canRemoveType = !!onRemoveType;
  const canUpdate = !!onElementUpdate;
  const canRowSelect = !!onElementRowSelect;
  const canObjectRowSelect = !!onObjectRowSelect;
  const hasSelection = (selectedElementIds?.size ?? 0) > 0 || (selectedObjectIds?.size ?? 0) > 0;
  // Stable handle to hasSelection for the rows' click logic — passing the
  // boolean directly would re-render all rows on the 0↔1 flip.
  const hasSelectionRef = useRef(hasSelection);
  // eslint-disable-next-line react-hooks/refs -- Existing ListTable diagnostic retained during mechanical extraction.
  hasSelectionRef.current = hasSelection;
  // Name column is always present. Every visible data column (Type, Due
  // date, Assignee, custom Properties) sits to the right of it in the order the
  // user chose. The trailing `+` cell is the column-management affordance.
  const totalDataColumns = 2 /* title + signals */ + visibleColumns.length;
  // Reserve a trailing "+ add column" slot whenever the parent wires up
  // either an element list (anyElements) or a column-creation handler
  // (onAddColumn — used by the Domain Object list).
  const hasTrailingCol = !!colStorageKey;

  // Resolve the dragged row's data for the floating overlay card.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- Existing ListTable diagnostic retained during mechanical extraction.
  const activeRowData = useMemo(() => {
    if (!activeRow) return null;
    for (const s of sections) {
      if (activeRow.kind === 'element') {
        const el = (s.elements ?? []).find((e) => e.id === activeRow.id);
        if (el) return { kind: 'element' as const, el };
      } else {
        const obj = (s.objects ?? []).find((o) => o.id === activeRow.id);
        if (obj) return { kind: 'object' as const, obj };
      }
    }
    return null;
  }, [activeRow, sections]);

  // Drag-to-reorder. PointerSensor with a small activation distance so a
  // click still selects / opens — only a real drag (>3px) starts a sort.
  // 3px is tight enough to feel immediate (the previous 6px made every
  // drag start with a noticeable "hitch") while still distinguishing a
  // genuine click. All three sortable contexts (header, object rows,
  // element rows) share this DndContext; the handler routes by id prefix.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }));
  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith(HEADER_DRAG_PREFIX)) {
      setDraggingColId(id.slice(HEADER_DRAG_PREFIX.length));
    } else if (id.startsWith(OBJECT_DRAG_PREFIX)) {
      setActiveRow({ kind: 'object', id: id.slice(OBJECT_DRAG_PREFIX.length) });
    } else {
      setActiveRow({ kind: 'element', id });
    }
  };
  // Track the row the pointer is over and which edge the drop would land on,
  // so the blue line renders in the right place. Uses onDragMove (fires on
  // every move, unlike onDragOver which only fires when `over` changes) so
  // the edge flips live as the cursor crosses a row's midline — including
  // moving within the same row. The setState is a no-op when {id,edge} is
  // unchanged, so rows only re-render when the line actually moves. Columns
  // keep their own in-place feedback and are ignored here.
  const handleDragMove = (e: DragMoveEvent) => {
    const { active, over } = e;
    const a = String(active.id);
    if (a.startsWith(HEADER_DRAG_PREFIX)) {
      const o = over ? String(over.id) : null;
      if (!o || !o.startsWith(HEADER_DRAG_PREFIX) || o === a || !over?.rect) { setColDrop(null); return; }
      const id = o.slice(HEADER_DRAG_PREFIX.length);
      const edge = pointerXRef.current < over.rect.left + over.rect.width / 2 ? 'before' : 'after';
      setColDrop((prev) => (prev && prev.id === id && prev.edge === edge) ? prev : { id, edge });
      return;
    }
    if (!over) { setDropTarget(null); return; }
    const o = String(over.id);
    if (a === o) { setDropTarget(null); return; }
    const isObj = a.startsWith(OBJECT_DRAG_PREFIX);
    // Active and over must be the same row kind (object vs element).
    if (isObj !== o.startsWith(OBJECT_DRAG_PREFIX)) { setDropTarget(null); return; }
    // Edge is decided geometrically: compare the dragged row's current
    // (translated) center to the hovered row's center. Above the midline →
    // the line goes before the row; below → after. This needs no index
    // lookup, so it's immune to display-order vs raw-order drift.
    // Edge from the cursor: above the hovered row's midline → line before it,
    // below → after. Cursor-based so dropping past the last row's midpoint
    // (or below it entirely) reliably reads as "after the last row".
    const overRect = over.rect;
    let edge: 'before' | 'after' = 'after';
    if (overRect) {
      const overMid = overRect.top + overRect.height / 2;
      edge = pointerYRef.current < overMid ? 'before' : 'after';
    }
    setDropTarget((prev) => (prev && prev.id === o && prev.edge === edge) ? prev : { id: o, edge });
  };
  const handleDragCancel = () => {
    setDraggingColId(null);
    setColDrop(null);
    setActiveRow(null);
    setDropTarget(null);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    const drop = colDrop;
    setDraggingColId(null);
    setColDrop(null);
    setActiveRow(null);
    setDropTarget(null);
    const activeId = String(active.id);
    // Column reorder: land on the side of the header the line was drawn on.
    // The new place is named by the visible column it now precedes (null =
    // last), so hidden columns keep their own places in the saved order.
    if (activeId.startsWith(HEADER_DRAG_PREFIX)) {
      if (!drop) return;
      const moving = activeId.slice(HEADER_DRAG_PREFIX.length);
      const rest = visibleColumnIds.filter((id) => id !== moving);
      const at = rest.indexOf(drop.id);
      if (at === -1) return;
      cols.moveColumn(moving, rest[drop.edge === 'before' ? at : at + 1] ?? null);
      return;
    }
    if (!over || active.id === over.id) return;
    const overId = String(over.id);
    // Object row reorder branch — scoped to within the section that holds
    // both rows; persisted to objects.order_index. Object ids carry the
    // `obj:` prefix so this branch only fires for drags between two
    // Object rows (header→header and element→element are caught above).
    if (activeId.startsWith(OBJECT_DRAG_PREFIX) && overId.startsWith(OBJECT_DRAG_PREFIX)) {
      const aId = activeId.slice(OBJECT_DRAG_PREFIX.length);
      const oId = overId.slice(OBJECT_DRAG_PREFIX.length);
      // Reorder against the DISPLAYED (sorted) order so the new order_index
      // matches where the user dropped, not the raw fetch order.
      const updates = reorderWithinSections(sortedSections.map((sec) => sec.objects ?? []), aId, oId);
      // A refused write rolls the rows back to where they were.
      if (updates) reorderObjects(updates).catch(err => console.error('Failed to reorder Objects:', err));
      return;
    }
    // Element row reorder branch — scoped to within the section that holds
    // both rows; persisted to elements.order_index (which the explorer RPC
    // sorts by). Element ids are raw UUIDs (no prefix).
    if (!activeId.startsWith(HEADER_DRAG_PREFIX) && !overId.startsWith(HEADER_DRAG_PREFIX) &&
        !activeId.startsWith(OBJECT_DRAG_PREFIX) && !overId.startsWith(OBJECT_DRAG_PREFIX)) {
      const updates = reorderWithinSections(sortedSections.map((sec) => sec.elements ?? []), activeId, overId);
      if (updates) reorderElements(updates).catch(err => console.error('Failed to reorder Elements:', err));
    }
  };

  // Until the person sizes Name, it takes whatever the data columns leave —
  // titles get the room, as in any list, and the data columns sit packed at
  // the right. Once sized, Name keeps that width and the trailing column
  // soaks up the slack instead.
  const nameFluid = !cols.isSized(NAME_COL_KEY);
  // Resizing any column first fixes Name at the width it is drawn at. While
  // Name is fluid it gives up whatever another column takes, so widening a
  // column would pull its left edge leftward instead of moving its right
  // edge with the pointer. Fixed, the columns to the left stay put and the
  // trailing space (or a horizontal scroll) takes up the change.
  const drawnNameWidth = () => {
    const table = tableRef.current;
    const th = table?.querySelector('thead th');
    if (!table || !th) return cols.widthFor(NAME_COL_KEY);
    return th.getBoundingClientRect().width - 52 + (parseFloat(getComputedStyle(table).getPropertyValue('--signals-w')) || 0);
  };
  const freezeName = () => { if (nameFluid) cols.setWidth(NAME_COL_KEY, drawnNameWidth()); };
  // A column only as wide as its words (the due date) has no room for the
  // sort arrow, so it grows by the arrow while it holds the sort.
  const drawnWidth = (c: DataColumn) => cols.widthFor(c.id) + (c.align === 'end' && cols.sort?.id === c.id ? 16 : 0);
  // Name is pinned while the rest scrolls under it, so a Name wider than the
  // pane would hide every other column for good. It is drawn no wider than
  // leaves the first stretch of data columns (up to 240px) in view; the
  // saved width comes back when the pane is wide enough again.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [viewWidth, setViewWidth] = useState(0);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setViewWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dataWidth = visibleColumns.reduce((sum, c) => sum + drawnWidth(c), 0);
  const nameWidth = viewWidth
    ? Math.min(cols.widthFor(NAME_COL_KEY), Math.max(NAME_MIN_WIDTH, viewWidth - 52 - Math.min(dataWidth, 240)))
    : cols.widthFor(NAME_COL_KEY);
  // Name is two tracks: the pinned title, then the rows' signals (comments,
  // labels…), which scroll with the data columns. The signals track is as
  // wide as the widest row's signals — measured once the rows are drawn and
  // handed to the columns as --signals-w — but never leaves the title less
  // than 160px.
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    let w = 0;
    table.querySelectorAll<HTMLElement>('[data-row-signals]').forEach((el) => { w = Math.max(w, el.scrollWidth); });
    table.style.setProperty('--signals-w', `${Math.max(0, Math.min(w, nameWidth - 160))}px`);
  }, [sortedSections, visibleColumns, nameWidth]);
  const titleWidth = `calc(${nameWidth}px - var(--signals-w, 0px))`;
  const packedWidth = 52 + nameWidth + visibleColumns.reduce((sum, c) => sum + drawnWidth(c), 0) + (hasTrailingCol ? 80 : 0);

  // With no rows the table is its header alone, and a horizontal scrollbar
  // (when the columns are wider than the pane) would sit right under it as a
  // stray bar. Nothing is there to scroll to, so an empty list does not scroll.
  const empty = sections.every((s) => s.objects.length === 0 && (s.elements?.length ?? 0) === 0);

  return (
    <DndContext id={dndId} sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
    <div
      ref={scrollerRef}
      data-list-scroller className={`${empty ? 'overflow-x-hidden' : 'overflow-x-auto'} h-full [overflow-anchor:none]`}>
      <table
        ref={tableRef}
        // `min-w-full` so the table fills the wrap (rows + section bands span
        // the full width). The title track is given width:100% and soaks up
        // the surplus on wide screens, so the data columns sit against the
        // right edge; a width set on Name is its least. (An UNSIZED col does
        // NOT absorb the surplus in fixed-table layout — the browser instead
        // spreads it proportionally across the sized columns.)
        style={{ width: '100%', minWidth: packedWidth }}
        className="group/list min-w-full table-fixed bg-card border-separate border-spacing-0 text-[14px] [--cell-text:14px]"
        data-has-selection={hasSelection ? '' : undefined}
      >
        {/* Fixed tracks retain their saved widths; the trailing percentage
            track absorbs only the remaining space. */}
        <colgroup>
          <col style={{ width: 52, minWidth: 52 }} />
          <col style={{ width: '100%', minWidth: titleWidth }} />
          <col style={{ width: 'var(--signals-w, 0px)', minWidth: 'var(--signals-w, 0px)' }} />
          {visibleColumns.map((c) => {
            const w = drawnWidth(c);
            // Match the data cells' `table-cell` so the column track
            // isn't reserved below md — otherwise the hidden data columns leave
            // an empty gap and force horizontal scroll in narrow panels.
            return <col key={c.id} className="table-column" style={{ width: w, minWidth: w }} />;
          })}
          {hasTrailingCol && <col className="table-column" style={{ width: 80, minWidth: 80 }} />}
        </colgroup>
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            {/* "Name" heads the pinned columns (the status mark or Object
                icon, then the title); the icons start where the word does,
                30px in. Both `top-0` (from thead) and `left-0` keep it in
                place: it is the intersection corner, so z-30 keeps it above
                the row's sticky-left cells and any data column header
                scrolling under. The signals track's header after it is
                blank and scrolls; Name's resize edge is at its end. */}
            <th colSpan={2} className="sticky top-0 left-0 z-30 relative pl-7.5 pr-3 py-2.5 text-left text-[13px] font-normal text-muted-foreground bg-card">
              {t('Name')}
            </th>
            <th className="relative p-0 bg-card">
              {/* Name is resizable too — same handle as the data columns,
                  persisted under NAME_COL_KEY. Fixed on the Object list
                  instead (see the colgroup above), so no handle there. */}
              {entity !== 'object' && (
                <ResizeHandle
                  width={nameWidth}
                  startWidth={drawnNameWidth}
                  onResizeStart={freezeName}
                  onResize={(w) => cols.setWidth(NAME_COL_KEY, w)}
                />
              )}
            </th>
            <SortableContext items={visibleColumnIds.map((id) => HEADER_DRAG_PREFIX + id)} strategy={horizontalListSortingStrategy}>
              {visibleColumns.map((col) => (
                <ColumnHeader
                  key={col.id}
                  column={col}
                  width={drawnWidth(col)}
                  inset={drawnWidth(col) - cols.widthFor(col.id)}
                  isDragging={draggingColId === col.id}
                  dropEdge={colDrop?.id === col.id ? colDrop.edge : null}
                  sort={cols.sort && cols.sort.id === col.id ? cols.sort.direction : null}
                  onResizeStart={freezeName}
                  onResize={(w) => cols.setWidth(col.id, w)}
                  onSort={(direction) => cols.setSort(direction ? { id: col.id, direction } : null)}
                  onEdit={col.custom && onEditColumn ? () => onEditColumn(col.custom!) : undefined}
                  onMoveLeft={visibleColumns.indexOf(col) > 0 ? () => cols.moveColumn(col.id, visibleColumns[visibleColumns.indexOf(col) - 1].id) : undefined}
                  onMoveRight={visibleColumns.indexOf(col) < visibleColumns.length - 1 ? () => cols.moveColumn(col.id, visibleColumns[visibleColumns.indexOf(col) + 2]?.id ?? null) : undefined}
                  onHide={col.toggleable ? () => cols.toggleVisible(col.id) : undefined}
                />
              ))}
            </SortableContext>
            {hasTrailingCol && (
              // Keep column controls at the right edge of the flexible spacer,
              // and pinned there while the list slides sideways (z-30 above
              // the data column headers scrolling under it).
              <th className="table-cell sticky top-0 right-0 z-30 w-8 px-1 py-2.5 bg-card text-center">
                {/* Trailing "+": which fields show as columns, and a new
                    field where the list has a scope to create one in. */}
                <div className="flex items-center justify-end">
                  <FieldsMenu allColumns={cols.allColumns} isVisible={cols.isVisible} onToggle={cols.toggleVisible} onCreate={onAddColumn} />
                </div>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sortedSections.map((section, sectionIndex) => {
            const isCollapsed = collapsed.has(section.id);
            // Already sorted by `sortedSections` (the single display-order
            // source). When no sort is active the natural order_index order
            // shines through and drag-to-reorder persists into it.
            const sectionObjects = section.objects ?? [];
            const sectionElements = section.elements ?? [];
            const itemCount = sectionObjects.length + sectionElements.length;
            return (
              <Fragment key={section.id}>
                {!hideSectionHeaders && (
                  <tr className="group">
                    {/* Section band — pinned to the left edge so the section
                        name stays readable during horizontal scroll. The
                        leading cell (left:0) holds the chevron near the edge
                        and the section icon 30px in, under "Name" and the
                        rows' marks; the band cell (left:52) starts the name
                        where the rows' names start, and its bg-card layer
                        hides the data columns scrolling underneath. */}
                    <td className={`sticky left-0 z-10 bg-card w-13 pl-1 pb-0 ${sectionIndex === 0 ? 'pt-0' : 'pt-1.5'}`}>
                      {/* Chevron lives inside the band visually — same
                          bg-muted as the colspan td next to it, with only
                          the outer corner rounded so the two tds join. */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggle(section.id); }}
                        className="relative w-full min-h-[2.625rem] flex items-center bg-muted/70 group-hover:bg-muted rounded-l-lg text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={isCollapsed ? t('Expand') : t('Collapse')}
                      >
                        <span className="absolute left-2 flex items-center"><DisclosureTriangle open={!isCollapsed} /></span>
                        <span className="absolute left-6.5 flex items-center text-foreground/70">{section.icon}</span>
                      </button>
                    </td>
                    <td colSpan={totalDataColumns + (hasTrailingCol ? 1 : 0)} className={`bg-card pr-1 pb-0 ${sectionIndex === 0 ? 'pt-0' : 'pt-1.5'}`}>
                      <button
                        type="button"
                        onClick={() => toggle(section.id)}
                      className="w-full min-h-[2.625rem] flex items-center min-w-0 pl-3.5 pr-1 py-1.5 bg-muted/70 group-hover:bg-muted rounded-r-lg transition-colors text-left"
                        aria-label={isCollapsed ? t('Expand') : t('Collapse')}
                      >
                        {/* The band spans the whole table, wider than the pane,
                            and a cell that wide cannot stick — so the name
                            and count stick inside it instead, at the x the
                            row titles stay at. */}
                        <span className="sticky left-[66px] flex min-w-0 items-center">
                          <span className="text-[15px] font-medium text-foreground min-w-0 truncate">
                            {section.name}
                          </span>
                          <span className="text-muted-foreground/60 font-normal tabular-nums text-[15px] ml-2">
                            {itemCount}
                          </span>
                        </span>
                        <span className="flex-1" />
                        {onAddElement && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); onAddElement(section); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                onAddElement(section);
                              }
                            }}
                            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                            title={t('Add Element to {name}', { name: section.name })}
                            aria-label={t('Add Element to {name}', { name: section.name })}
                          >
                            <Plus size={14} />
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                )}
                {!isCollapsed && (
                  // Object rows: drag-to-reorder + multi-select checkbox.
                  // Same dnd-kit context the headers and elements share; the
                  // `obj:` id prefix routes drops to reorderObjects.
                  <SortableContext
                    items={sectionObjects.map((o) => OBJECT_DRAG_PREFIX + o.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {sectionObjects.map((obj, i) => {
                      const sel = selectedObjectIds?.has(obj.id) ?? false;
                      return (
                      <ObjectRow
                        key={`obj-${obj.id}`}
                        obj={obj}
                        isSelected={sel}
                        hasSelectionRef={hasSelectionRef}
                        visibleColumns={visibleColumns}
                        hasTrailingCol={hasTrailingCol}
                        elementTypes={elementTypes}
                        canRowSelect={canObjectRowSelect}
                        onAddType={canAddType ? stableAddType : undefined}
                        onRemoveType={canRemoveType ? stableRemoveType : undefined}
                        dropEdge={dropTarget?.id === OBJECT_DRAG_PREFIX + obj.id ? dropTarget.edge : undefined}
                        selPrev={sel && i > 0 && (selectedObjectIds?.has(sectionObjects[i - 1].id) ?? false)}
                        selNext={sel && i < sectionObjects.length - 1 && (selectedObjectIds?.has(sectionObjects[i + 1].id) ?? false)}
                        onSelectObject={stableSelectObjectCb}
                        onRowSelect={stableObjectRowSelect}
                        onObjectUpdate={onObjectUpdate}
                        objectWorkers={objectWorkers}
                        onObjectCustomColumnValueChange={onObjectCustomColumnValueChange}
                      />
                      );
                    })}
                  </SortableContext>
                )}
                {!isCollapsed && (
                  <SortableContext
                    items={sectionElements.map((e) => e.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {sectionElements.map((el, i) => {
                      const sel = selectedElementIds?.has(el.id) ?? false;
                      return (
                      <ElementRow
                        key={`el-${el.id}`}
                        el={el}
                        isSelected={sel}
                        hasSelectionRef={hasSelectionRef}
                        elementTypes={elementTypes}
                        visibleColumns={visibleColumns}
                        hasTrailingCol={hasTrailingCol}
                        canUpdate={canUpdate}
                        canRowSelect={canRowSelect}
                        canAddType={canAddType}
                        onAddType={stableAddType}
                        canRemoveType={canRemoveType}
                        onRemoveType={stableRemoveType}
                        dropEdge={dropTarget?.id === el.id ? dropTarget.edge : undefined}
                        selPrev={sel && i > 0 && (selectedElementIds?.has(sectionElements[i - 1].id) ?? false)}
                        selNext={sel && i < sectionElements.length - 1 && (selectedElementIds?.has(sectionElements[i + 1].id) ?? false)}
                        onElementUpdate={stableElementUpdate}
                        onRefresh={stableRefresh}
                        onSelectElement={stableSelectElement}
                        onRowSelect={stableRowSelect}
                        onCustomColumnValueChange={stableCustomColChange}
                        allCustomColumns={customColumns}
                        blockers={elementBlockers[el.id]}
                      />
                      );
                    })}
                  </SortableContext>
                )}
                {!isCollapsed && onAddObject && (
                  <tr
                    className={`group cursor-pointer [&>td]:transition-colors ${ROW_ROUND_BASE} [&:hover>td:not(.sticky):not(:last-child)]:bg-foreground/[0.06] ${STICKY_TINT_HOVER}`}
                    onClick={onAddObject}
                  >
                    <td className={`sticky left-0 z-10 bg-card w-13 pl-7.5 pr-1.5 py-2 ${LEAD_CELL} ${LEAD_CELL_HOVER}`}>
                      <div className="flex items-center text-muted-foreground">
                        <ObjectIcon size={16} />
                      </div>
                    </td>
                    <td colSpan={totalDataColumns + (hasTrailingCol ? 1 : 0)} className="bg-card pl-3.5 pr-0.5 py-2 min-w-0">
                      <div className="sticky left-[66px] flex w-fit items-center min-w-0 min-h-[1.875rem] text-muted-foreground">
                        <span className="text-[14px] group-hover:text-foreground transition-colors">
                          {t('Add Object')}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
    {/* Floating drag preview — a single GPU-composited element that follows
        the pointer. Replaces the old per-row transform shuffle, so the list
        stays still and only this card moves. Rendered only for row drags;
        column drags keep their in-place feedback. */}
    <DragOverlay dropAnimation={null}>
      {activeRowData ? <DragCard data={activeRowData} /> : draggingColId ? (
        <div className="inline-flex h-7 items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-overlay)] px-2.5 text-[13px] text-foreground shadow-lg">
          {fieldDisplayLabel(t, cols.allColumns.find((c) => c.id === draggingColId) ?? { id: draggingColId, label: draggingColId })}
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}

// Floating drag-preview card rendered inside DragOverlay. A compact, self-
// contained chip (not a table row) showing just enough to recognise the
// item being moved — status mark + display id + title for Elements, icon +
// name for Objects.
function DragCard({
  data,
}: {
  data: { kind: 'element'; el: ElementWithDetails } | { kind: 'object'; obj: AlconObjectWithChildren };
}) {
  const elementId = data.kind === 'element' ? displayIdOf(data.el) : null;
  return (
    <div className="flex items-center gap-2 max-w-[360px] rounded-lg bg-popover/95 backdrop-blur-md shadow-2xl ring-1 ring-border px-3 py-2 text-[13px] cursor-grabbing">
      {data.kind === 'element' ? (
        <>
          <span className="shrink-0 flex items-center">
            <ElementProgressMark
              status={data.el.status}
              progress={getElementProgress(data.el)}
              size={16}
            />
          </span>
          <DisplayIdChip id={elementId} fit="full" />
          <span className="font-semibold text-foreground truncate">{data.el.title}</span>
        </>
      ) : (
        <>
          <span className="shrink-0 flex items-center justify-center text-muted-foreground/70">
            <ItemIcon icon={data.obj.icon} color={data.obj.color} size={14} fallback={<ObjectIcon size={14} />} />
          </span>
          <span className="font-semibold text-foreground truncate">{data.obj.name}</span>
        </>
      )}
    </div>
  );
}
