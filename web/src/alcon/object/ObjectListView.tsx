'use client';

import { Fragment, memo, useCallback, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarIcon, ChevronDown, EyeOff, Plus, Check, Tag, Trash2 } from 'lucide-react';
import type { AlconObjectWithChildren, CustomColumnWithValues, ElementWithDetails } from '@/hooks/useSupabase';
import { deleteElement, reorderElements, reorderObjects } from '@/hooks/useSupabase';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCenter, pointerWithin,
  type DragEndEvent, type DragStartEvent, type DragMoveEvent, type CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, verticalListSortingStrategy,
  horizontalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Json } from '@/types/database';
import { ObjectIcon } from '@/shell/icons';
import { WorkerAvatar, WorkerAvatarStack } from '@/alcon/shared/WorkerAvatar';
import { ElementProgressMark } from '@/alcon/shared/ElementProgressMark';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from '@/ui/context-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar } from '@/ui/calendar';
import {
  CustomColumnCell,
  CellText,
  CELL_TRIGGER_BASE,
  CELL_TRIGGER_EMPTY,
  CELL_POPOVER_RADIUS,
} from '@/alcon/tag/CustomColumnCell';
import { getElementProgress } from '@/alcon/shared/ElementProgressMark';
import { PriorityMark } from '@/alcon/shared/PriorityMark';
import { StatusPicker } from '@/alcon/element/StatusPicker';
import {
  useListColumns,
  sortElements,
  NAME_COL_KEY,
  type ColumnId,
  type ColumnSort,
  type DataColumn,
} from './useListColumns';

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

// Stable empty defaults — destructuring `= []` inline would allocate a NEW
// array every render, which breaks ElementRow's React.memo (the prop ref
// changes each time) and re-renders every row on any parent update (e.g. a
// checkbox toggle on a 100-row list). Shared frozen constants keep the ref
// identity stable so only the changed row re-renders.
const EMPTY_CUSTOM_COLUMNS: CustomColumnWithValues[] = [];
const EMPTY_ELEMENT_TYPES: string[] = [];

const STATUS_OPTIONS: { value: ElementWithDetails['status']; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'cancelled', label: 'Cancelled' },
];

export type ElementUpdate = Partial<Pick<ElementWithDetails, 'status' | 'priority' | 'due_date' | 'title' | 'type'>>;

function parseDateOnly(value: string | null): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateShort(value: string): string {
  const d = parseDateOnly(value);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : value;
}

export interface ListSection {
  id: string;
  name: string;
  /** Optional icon rendered in the section band before the name (e.g.
   *  ObjectIcon for "Elements grouped by Object" sections). */
  icon?: React.ReactNode;
  /** Optional small label rendered after the count, faded out (e.g.
   *  "no parent Object" on the Domain-direct elements band). */
  subtitle?: string;
  objects: AlconObjectWithChildren[];
  elements?: ElementWithDetails[];
}

// The column layout (visibility / order / width) lives in `useListColumns`.
// Status & priority show inline in the row — the status mark and the
// priority chevrons — so they aren't columns. Type, Due date, Assignee, and
// every user-defined Tag are columns the user can reorder, resize, and
// (where toggleable) show/hide.

// dnd-kit id prefixes — the shared DndContext routes drags by inspecting
// the active id. Header reorders, Object-row reorders, and Element-row
// reorders all live under one context and the prefix tells them apart.
const HEADER_DRAG_PREFIX = 'col:';
const OBJECT_DRAG_PREFIX = 'obj:';

// Blue insertion line drawn on a row that's the current drop target. An
// inset box-shadow (not a border) so it doesn't shift layout, applied to
// every <td> so the line runs unbroken across the row. The shadow VALUE is
// fed through an inherited `--drop-line` CSS variable set inline on the
// <tr> — Tailwind v4's arbitrary `shadow-[inset_0_-2px…]` mis-parses the
// negative offset, so we keep the class static and put the real CSS in the
// variable, which is plain CSS and reliable. `var(--primary)` is the app's
// Oxford-blue accent.
const DROP_LINE_CLASS = '[&>td]:shadow-[var(--drop-line,0_0_#0000)]';
// While a row shows the drop line, square off its cells. The hover/selection
// pill rounds the 2nd/2nd-last cells (rounded-l/r-lg); left as-is, the inset
// box-shadow hugs that radius and the line's left end reads as a curve. The
// `!` wins over the rounding utilities regardless of class order.
const DROP_LINE_SQUARE = '[&>td]:!rounded-none';
// Gray, slightly-thick (2px) insertion line — muted rather than the accent
// blue so it reads as a neutral "drops here" guide.
function dropLineVar(edge: 'before' | 'after' | undefined): string | undefined {
  if (edge === 'before') return 'inset 0 2px 0 0 var(--muted-foreground)';
  if (edge === 'after') return 'inset 0 -2px 0 0 var(--muted-foreground)';
  return undefined;
}

// Row hover / selection highlight is a rounded pill on the data cells (2nd …
// 2nd-last). A single hovered/selected row reads as a full rounded chip.
const ROW_ROUND_BASE = '[&>td:nth-child(2)]:rounded-l-lg [&>td:nth-last-child(2)]:rounded-r-lg';
// For a CONTIGUOUS block of selected rows, square off the corners that touch
// the neighbour so the block reads as one continuous pill instead of a stack
// of separate chips with notches between them. `selPrev`/`selNext` say whether
// the row immediately above / below is also selected.
function selectionSquareClass(selPrev?: boolean, selNext?: boolean): string {
  let s = '';
  if (selPrev) s += ' [&>td:nth-child(2)]:!rounded-tl-none [&>td:nth-last-child(2)]:!rounded-tr-none';
  if (selNext) s += ' [&>td:nth-child(2)]:!rounded-bl-none [&>td:nth-last-child(2)]:!rounded-br-none';
  return s;
}

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
//  `onPointer` is called with the live pointer Y so the edge calc in
//  onDragOver can use the cursor position too.
function makeRowAwareCollision(onPointerY: (y: number) => void): CollisionDetection {
  return (args) => {
    if (args.pointerCoordinates) onPointerY(args.pointerCoordinates.y);
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

interface ObjectListViewProps {
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
  /** User-defined columns (Tags) — Notion-style. When passed, they render
   *  to the right of the built-in columns and stay in sync with the
   *  Element detail panel via `custom_column_values`. */
  customColumns?: CustomColumnWithValues[];
  /** Domain-shared Element types — option list for the always-on `type`
   *  column. When non-empty and onElementUpdate is set, the cell is an
   *  editable dropdown; otherwise it renders read-only. */
  elementTypes?: string[];
  /** Add a brand-new Element type to the Domain catalogue (from the Type
   *  cell's chip-grid "+"). When omitted, the "+" is hidden. */
  onAddType?: (name: string) => void | Promise<void>;
  /** Save a custom-column value for an Element. Required when customColumns is set. */
  onCustomColumnValueChange?: (columnId: string, elementId: string, value: Json) => void | Promise<void>;
  /** Save a custom-column value for an Object. Required when the Domain
   *  Object list passes Domain-scoped customColumns. */
  onObjectCustomColumnValueChange?: (columnId: string, objectId: string, value: Json) => void | Promise<void>;
  /** Open the Add-Column modal from the column header's "+" button. When
   *  set, clicking "+" triggers this instead of the built-in toggle menu. */
  onAddColumn?: () => void;
  /** Inline-edit Element fields (status / priority / due_date) directly
   *  from list cells. When omitted the cells render read-only. */
  onElementUpdate?: (elementId: string, updates: ElementUpdate) => void | Promise<void>;
  /** Inline-edit Object fields (type / …) directly from list cells. When
   *  omitted, Object Type cells render read-only. */
  onObjectUpdate?: (objectId: string, updates: { type?: string | null; due_date?: string | null }) => void | Promise<void>;
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
export function ObjectListView({
  sections,
  onSelectObject,
  onSelectElement,
  onAddObject,
  onAddElement,
  hideSectionHeaders = false,
  colStorageKey,
  customColumns = EMPTY_CUSTOM_COLUMNS,
  elementTypes = EMPTY_ELEMENT_TYPES,
  onAddType,
  onCustomColumnValueChange,
  onObjectCustomColumnValueChange,
  onAddColumn,
  onElementUpdate,
  onObjectUpdate,
  selectedElementIds,
  onElementRowSelect,
  selectedObjectIds,
  onObjectRowSelect,
}: ObjectListViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
  const cols = useListColumns(colStorageKey, customColumns);

  // Show Element-specific data columns only when at least one section
  // carries elements (otherwise the wide layout looks empty when listing
  // Objects only). Object-only views still get the Type column inline on
  // each Object row, so they never see the data-column band.
  const anyElements = sections.some((s) => (s.elements?.length ?? 0) > 0);
  const anyObjects  = sections.some((s) => (s.objects?.length ?? 0) > 0);
  // Memoised so the array reference is stable across the common re-render
  // trigger (an element edit changing `sections`) — required for the
  // memoised ElementRow below to actually skip unchanged rows.
  const visibleColumns = useMemo<DataColumn[]>(
    () => (anyElements || anyObjects ? cols.visibleColumns : []),
    [anyElements, anyObjects, cols.visibleColumns],
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
  const sortedSections = useMemo(
    () => sections.map((s) => ({
      ...s,
      objects: sortElements(s.objects ?? [], cols.sort, customColumns),
      elements: sortElements(s.elements ?? [], cols.sort, customColumns),
    })),
    [sections, cols.sort, customColumns],
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
  const collisionDetection = useMemo(
    () => makeRowAwareCollision((y) => { pointerYRef.current = y; }),
    [],
  );

  // Stable callback singletons via a latest-ref. The row callbacks keep a
  // fixed identity across renders (so React.memo can skip), while always
  // invoking the freshest handler the parent passed. Capability booleans
  // preserve the "read-only when no handler" branches inside the row.
  const cbRef = useRef({ onElementUpdate, onSelectElement, onElementRowSelect, onCustomColumnValueChange, onObjectRowSelect, onSelectObject, onAddType });
  cbRef.current = { onElementUpdate, onSelectElement, onElementRowSelect, onCustomColumnValueChange, onObjectRowSelect, onSelectObject, onAddType };
  // Flattened element ids in DISPLAY order (across all sections) — passed to
  // range-select so Shift-click fills the visible range, not the raw order.
  const displayedIdsRef = useRef<string[]>([]);
  displayedIdsRef.current = sortedSections.flatMap((s) => (s.elements ?? []).map((e) => e.id));
  const displayedObjectIdsRef = useRef<string[]>([]);
  displayedObjectIdsRef.current = sortedSections.flatMap((s) => (s.objects ?? []).map((o) => o.id));
  const stableElementUpdate = useCallback((id: string, u: ElementUpdate) => cbRef.current.onElementUpdate?.(id, u), []);
  const stableSelectElement = useCallback((id: string) => cbRef.current.onSelectElement?.(id), []);
  const stableRowSelect = useCallback((id: string, mode: 'single' | 'range' | 'replace') => cbRef.current.onElementRowSelect?.(id, mode, displayedIdsRef.current), []);
  const stableObjectRowSelect = useCallback((id: string, mode: 'single' | 'range' | 'replace') => cbRef.current.onObjectRowSelect?.(id, mode, displayedObjectIdsRef.current), []);
  const stableSelectObjectCb = useCallback((id: string) => cbRef.current.onSelectObject?.(id), []);
  const stableCustomColChange = useCallback((cid: string, eid: string, v: Json) => cbRef.current.onCustomColumnValueChange?.(cid, eid, v), []);
  const stableAddType = useCallback((name: string) => cbRef.current.onAddType?.(name), []);
  const canAddType = !!onAddType;
  const canUpdate = !!onElementUpdate;
  const canRowSelect = !!onElementRowSelect;
  const canObjectRowSelect = !!onObjectRowSelect;
  const hasSelection = (selectedElementIds?.size ?? 0) > 0 || (selectedObjectIds?.size ?? 0) > 0;
  // Stable handle to hasSelection for the rows' click logic — passing the
  // boolean directly would re-render all rows on the 0↔1 flip.
  const hasSelectionRef = useRef(hasSelection);
  hasSelectionRef.current = hasSelection;
  // Name column is always present. Every visible data column (Type, Due
  // date, Assignee, custom Tags) sits to the right of it in the order the
  // user chose. The trailing `+` cell is the column-management affordance.
  const totalDataColumns = 1 /* name */ + visibleColumns.length;
  // Reserve a trailing "+ add column" slot whenever the parent wires up
  // either an element list (anyElements) or a column-creation handler
  // (onAddColumn — used by the Domain Object list).
  const hasTrailingCol = anyElements || !!onAddColumn;

  // Resolve the dragged row's data for the floating overlay card.
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
    if (a.startsWith(HEADER_DRAG_PREFIX)) return;
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
    setActiveRow(null);
    setDropTarget(null);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setDraggingColId(null);
    setActiveRow(null);
    setDropTarget(null);
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    // Column reorder branch.
    if (activeId.startsWith(HEADER_DRAG_PREFIX) && overId.startsWith(HEADER_DRAG_PREFIX)) {
      cols.moveColumn(
        activeId.slice(HEADER_DRAG_PREFIX.length),
        overId.slice(HEADER_DRAG_PREFIX.length),
      );
      return;
    }
    // Object row reorder branch — scoped to within the section that holds
    // both rows; persisted to objects.order_index. Object ids carry the
    // `obj:` prefix so this branch only fires for drags between two
    // Object rows (header→header and element→element are caught above).
    if (activeId.startsWith(OBJECT_DRAG_PREFIX) && overId.startsWith(OBJECT_DRAG_PREFIX)) {
      const aId = activeId.slice(OBJECT_DRAG_PREFIX.length);
      const oId = overId.slice(OBJECT_DRAG_PREFIX.length);
      // Reorder against the DISPLAYED (sorted) order so the new order_index
      // matches where the user dropped, not the raw fetch order.
      for (const sec of sortedSections) {
        const objs = sec.objects ?? [];
        const from = objs.findIndex((x) => x.id === aId);
        const to = objs.findIndex((x) => x.id === oId);
        if (from === -1 || to === -1) continue;
        const reordered = arrayMove(objs, from, to);
        void reorderObjects(reordered.map((x, i) => ({ id: x.id, order_index: i + 1 })));
        return;
      }
      return;
    }
    // Element row reorder branch — scoped to within the section that holds
    // both rows; persisted to elements.order_index (which the explorer RPC
    // sorts by). Element ids are raw UUIDs (no prefix).
    if (!activeId.startsWith(HEADER_DRAG_PREFIX) && !overId.startsWith(HEADER_DRAG_PREFIX) &&
        !activeId.startsWith(OBJECT_DRAG_PREFIX) && !overId.startsWith(OBJECT_DRAG_PREFIX)) {
      for (const sec of sortedSections) {
        const els = sec.elements ?? [];
        const from = els.findIndex((x) => x.id === activeId);
        const to = els.findIndex((x) => x.id === overId);
        if (from === -1 || to === -1) continue;
        const reordered = arrayMove(els, from, to);
        void reorderElements(reordered.map((x, i) => ({ id: x.id, order_index: i + 1 })));
        return;
      }
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
    <div className="overflow-x-auto h-full">
      <table
        // `min-w-full` so the table fills the wrap (rows + section bands span
        // the full width). The trailing column is given width:100% so it — and
        // only it — soaks up the surplus on wide screens, keeping Name and the
        // data columns at their defined widths packed flush LEFT, with empty
        // bg-card slack on the right. (An UNSIZED trailing col does NOT absorb
        // the surplus in fixed-table layout — the browser instead spreads it
        // proportionally across the sized columns, stretching everything.)
        // Resizing a data column shrinks the trailing slack instead of Name,
        // so the dragged column's LEFT edge stays put (no left-drift).
        className="group/list min-w-full table-fixed bg-card border-separate border-spacing-0 text-[13px]"
        data-has-selection={hasSelection ? '' : undefined}
      >
        {/* Authoritative column widths. `<col>` wins over per-cell widths
            in table-fixed mode, so resize/reorder rewrites here and the
            browser never redistributes extra space across data columns —
            only the unsized Name column absorbs leftover. We also pin
            minWidth so cols 0/1 don't shrink when the table needs to
            overflow horizontally past the wrap width. */}
        <colgroup>
          <col style={{ width: 28, minWidth: 28 }} />
          <col style={{ width: 28, minWidth: 28 }} />
          {/* Name has an explicit, resizable width (default 600). The data
              columns sit right after it (Linear look) and the trailing
              column flexes to soak up any remaining width. */}
          <col style={{ width: cols.widthFor(NAME_COL_KEY), minWidth: cols.widthFor(NAME_COL_KEY) }} />
          {visibleColumns.map((c) => {
            const w = cols.widthFor(c.id);
            return <col key={c.id} style={{ width: w, minWidth: w }} />;
          })}
          {hasTrailingCol && <col style={{ width: '100%' }} />}
        </colgroup>
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            {/* Cols 1-3 (checkbox / priority-or-icon / Name) are frozen on
                horizontal scroll. Both `top-0` (from thead) and `left-*` make
                them stay in place — they're the intersection corner, so
                z-30 keeps them above the row's sticky-left siblings and
                above any data column header that scrolls under. */}
            <th className="sticky top-0 left-0 z-30 w-7 px-1 py-2.5 text-center text-[11px] font-normal text-muted-foreground/80 bg-card border-b border-border/60" />
            <th className="sticky top-0 left-7 z-30 w-7 px-1 py-2.5 text-center text-[11px] font-normal text-muted-foreground/80 bg-card border-b border-border/60" />
            <th className="sticky top-0 left-14 z-30 relative pl-0.5 pr-3 py-2.5 text-left text-[11px] font-normal text-muted-foreground/80 bg-card border-b border-border/60">
              Name
              {/* Short centered vertical divider (30px) on the column's right
                  edge — a slim separator, not a full-header-height border. */}
              <span aria-hidden className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 h-[30px] w-px bg-border/60" />
              {/* Name is resizable too — same handle as the data columns,
                  persisted under NAME_COL_KEY. */}
              <ResizeHandle
                width={cols.widthFor(NAME_COL_KEY)}
                onResize={(w) => cols.setWidth(NAME_COL_KEY, w)}
              />
            </th>
            <SortableContext items={visibleColumnIds.map((id) => HEADER_DRAG_PREFIX + id)} strategy={horizontalListSortingStrategy}>
              {visibleColumns.map((col) => (
                <ColumnHeader
                  key={col.id}
                  column={col}
                  width={cols.widthFor(col.id)}
                  isDragging={draggingColId === col.id}
                  sort={cols.sort && cols.sort.id === col.id ? cols.sort.direction : null}
                  onResize={(w) => cols.setWidth(col.id, w)}
                  onToggleSort={() => cols.cycleSort(col.id)}
                  onHide={col.toggleable ? () => cols.toggleVisible(col.id) : undefined}
                />
              ))}
            </SortableContext>
            {hasTrailingCol && (
              // The trailing col flexes to width:100% to absorb slack, so keep
              // the +/column-menu button pinned LEFT (next to the last data
              // column) instead of centered in the wide empty cell (th default).
              <th className="hidden md:table-cell w-8 px-1 py-2.5 bg-card text-left border-b border-border/60">
                <ColumnMenu
                  allColumns={cols.allColumns}
                  isVisible={cols.isVisible}
                  onToggle={cols.toggleVisible}
                  onAddColumn={onAddColumn}
                />
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
                        chevron cell sticks at left:0; the band cell sticks at
                        left:28 (one chevron-width over), and its bg-card
                        layer hides the data columns scrolling underneath. */}
                    <td className={`sticky left-0 z-10 bg-card w-7 pl-1 pb-0 ${sectionIndex === 0 ? 'pt-0' : 'pt-1.5'}`}>
                      {/* Chevron lives inside the band visually — same
                          bg-muted as the colspan td next to it, with only
                          the outer corner rounded so the two tds join. */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggle(section.id); }}
                        className="w-full min-h-[2.625rem] flex items-center justify-center bg-muted/70 group-hover:bg-muted rounded-l-lg text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                      >
                        <ChevronDown
                          size={12}
                          className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                        />
                      </button>
                    </td>
                    <td colSpan={totalDataColumns + (hasTrailingCol ? 1 : 0) + 1} className={`sticky left-7 z-10 bg-card pr-1 pb-0 ${sectionIndex === 0 ? 'pt-0' : 'pt-1.5'}`}>
                      <button
                        type="button"
                        onClick={() => toggle(section.id)}
                      className="w-full min-h-[2.625rem] flex items-center min-w-0 pr-1 py-1.5 bg-muted/70 group-hover:bg-muted rounded-r-lg transition-colors text-left"
                        aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                      >
                        {/* Icon slot — same w-7 cell width as the row's ○
                            mark below, so section icons line up vertically
                            with the status circles. */}
                        <span className="w-7 shrink-0 flex items-center justify-center text-foreground/70">
                          {section.icon}
                        </span>
                        <span className="text-[13px] font-semibold text-foreground/95 min-w-0 truncate">
                          {section.name}
                        </span>
                        <span className="text-muted-foreground/60 font-normal tabular-nums text-[13px] ml-2">
                          {itemCount}
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
                            title={`Add element to ${section.name}`}
                            aria-label={`Add element to ${section.name}`}
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
                        dropEdge={dropTarget?.id === OBJECT_DRAG_PREFIX + obj.id ? dropTarget.edge : undefined}
                        selPrev={sel && i > 0 && (selectedObjectIds?.has(sectionObjects[i - 1].id) ?? false)}
                        selNext={sel && i < sectionObjects.length - 1 && (selectedObjectIds?.has(sectionObjects[i + 1].id) ?? false)}
                        onSelectObject={stableSelectObjectCb}
                        onRowSelect={stableObjectRowSelect}
                        onObjectUpdate={onObjectUpdate}
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
                        dropEdge={dropTarget?.id === el.id ? dropTarget.edge : undefined}
                        selPrev={sel && i > 0 && (selectedElementIds?.has(sectionElements[i - 1].id) ?? false)}
                        selNext={sel && i < sectionElements.length - 1 && (selectedElementIds?.has(sectionElements[i + 1].id) ?? false)}
                        onElementUpdate={stableElementUpdate}
                        onSelectElement={stableSelectElement}
                        onRowSelect={stableRowSelect}
                        onCustomColumnValueChange={stableCustomColChange}
                      />
                      );
                    })}
                  </SortableContext>
                )}
                {!isCollapsed && onAddObject && (
                  <tr
                    className={`group cursor-pointer [&>td]:transition-colors ${ROW_ROUND_BASE} [&:hover>td:not(:first-child):not(:last-child)]:bg-foreground/[0.06]`}
                    onClick={onAddObject}
                  >
                    <td className="sticky left-0 z-10 bg-card w-7 px-1 py-2" />
                    <td className="sticky left-7 z-10 bg-card w-7 px-1 py-2">
                      <div className="flex items-center justify-center text-muted-foreground">
                        <ObjectIcon size={14} />
                      </div>
                    </td>
                    <td colSpan={totalDataColumns + (hasTrailingCol ? 1 : 0)} className="sticky left-14 z-10 bg-card pl-0.5 pr-2 py-2 min-w-0">
                      <div className="flex items-center min-w-0 min-h-[1.625rem] text-muted-foreground">
                        <span className="text-[13px] group-hover:text-foreground transition-colors">
                          Add Object
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
      {activeRowData ? <DragCard data={activeRowData} /> : null}
    </DragOverlay>
    </DndContext>
  );
}

// Memoised element row. All props are reference-stable across the common
// re-render trigger (an element field edit changes only that element's `el`
// via structural sharing; callbacks are stable singletons; the column/type
// arrays are memoised). So editing one element re-renders only its row,
// not the whole list — Linear's "one delta, one cell" at the row level.
interface ElementRowProps {
  el: ElementWithDetails;
  isSelected: boolean;
  // A stable ref (not a boolean prop) so flipping "any selection exists" on
  // the 0↔1 transition doesn't re-render every row — checkbox VISIBILITY is
  // driven by CSS (the table's data-has-selection), and the click handler
  // reads the ref lazily. Only the toggled row (its isSelected) re-renders.
  hasSelectionRef: { readonly current: boolean };
  elementTypes: string[];
  visibleColumns: DataColumn[];
  hasTrailingCol: boolean;
  canUpdate: boolean;
  canRowSelect: boolean;
  canAddType: boolean;
  onAddType: (name: string) => void | Promise<void>;
  /** When this row is the active drop target, which edge the blue line
   *  draws on. `undefined` for every other row (so memo skips them). */
  dropEdge?: 'before' | 'after';
  /** Selection-block neighbours: is the row directly above / below also
   *  selected? Used to square the touching corners so a multi-row selection
   *  reads as one continuous pill. */
  selPrev?: boolean;
  selNext?: boolean;
  onElementUpdate: (id: string, updates: ElementUpdate) => void | Promise<void>;
  onSelectElement: (id: string) => void;
  onRowSelect: (id: string, mode: 'single' | 'range' | 'replace') => void;
  onCustomColumnValueChange: (columnId: string, elementId: string, value: Json) => void | Promise<void>;
}

const ElementRow = memo(function ElementRow({
  el, isSelected, hasSelectionRef, elementTypes, visibleColumns,
  hasTrailingCol, canUpdate, canRowSelect, canAddType, onAddType, dropEdge, selPrev, selNext,
  onElementUpdate, onSelectElement, onRowSelect, onCustomColumnValueChange,
}: ElementRowProps) {
  const isOverdue = el.due_date && new Date(el.due_date) < new Date() && el.status !== 'done';
  // The Element's own custom-column values live alongside the column
  // definitions; getElementProgress only needs the array to read those.
  const customColumns = useMemo(
    () => visibleColumns.filter((c) => c.kind === 'custom').map((c) => c.custom!),
    [visibleColumns],
  );
  const progress = getElementProgress(el, customColumns);
  const upd = canUpdate ? onElementUpdate : undefined;
  // Drag-to-reorder: the whole row is the handle. PointerSensor's distance
  // constraint (set on the DndContext) keeps clicks/selection working — only
  // a real drag moves the row. We DON'T apply the sortable transform: rows
  // stay put and a DragOverlay card + blue drop line provide the feedback,
  // which avoids repainting the whole table on every pointer move.
  const { setNodeRef, attributes, listeners, isDragging } = useSortable({ id: el.id });
  // Don't start a drag on a modifier-click — Shift/Cmd/Ctrl are selection
  // gestures (range / toggle), and letting them begin a sort made rows shift
  // around and flash stray lines while the user was only selecting.
  const dragListeners = {
    ...listeners,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
      listeners?.onPointerDown?.(e);
    },
  };
  // The source row dims to a placeholder while its overlay card flies; the
  // row stays in the layout so the surrounding rows don't jump. The drop
  // line (when this row is the target) rides an inherited CSS variable.
  const dragStyle: React.CSSProperties = {
    opacity: isDragging ? 0.4 : undefined,
    ['--drop-line' as string]: dropLineVar(dropEdge),
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <tr
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      {...dragListeners}
      className={`group cursor-pointer select-none leading-[1.4] [&>td]:transition-colors ${ROW_ROUND_BASE} ${isSelected ? selectionSquareClass(selPrev, selNext) : ''} ${DROP_LINE_CLASS} ${dropEdge ? DROP_LINE_SQUARE : ''} ${
        isSelected
          ? '[&>td:not(:first-child):not(:last-child)]:bg-blue-500/15 dark:[&>td:not(:first-child):not(:last-child)]:bg-blue-400/20 [&:hover>td:not(:first-child):not(:last-child)]:bg-blue-500/20 dark:[&:hover>td:not(:first-child):not(:last-child)]:bg-blue-400/25'
          : '[&:hover>td:not(:first-child):not(:last-child)]:bg-foreground/[0.06]'
      }`}
      onClick={(e) => {
        // Shift / Cmd / Ctrl click → row selection (multi-select).
        if (canRowSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onRowSelect(el.id, e.shiftKey ? 'range' : 'single');
          return;
        }
        // Plain click while a selection exists → replace selection.
        if (canRowSelect && hasSelectionRef.current) {
          onRowSelect(el.id, 'replace');
          return;
        }
        onSelectElement(el.id);
      }}
    >
      {/* Selection checkbox — hidden until row-hover, or pinned visible once
          any row is selected / this row is selected. Sticky-left freezes
          this column during horizontal scroll. */}
      <td className="sticky left-0 z-10 bg-card w-7 px-1 py-2" onClick={(e) => e.stopPropagation()}>
        {canRowSelect && (
          <button
            type="button"
            aria-label={isSelected ? 'Deselect element' : 'Select element'}
            // preventDefault on mousedown stops the click from focusing the
            // button (no stray focus ring on mouse-click) and stops Shift-
            // click from starting a browser text selection. Keyboard Tab
            // still focuses it (ring shown for a11y).
            onMouseDown={(e) => e.preventDefault()}
            // Shift-click extends the selection from the anchor to here
            // (range); a plain click toggles just this row (single).
            onClick={(e) => onRowSelect(el.id, e.shiftKey ? 'range' : 'single')}
            className={`size-4 rounded-[5px] border flex items-center justify-center mx-auto transition-opacity ${
              isSelected
                ? 'bg-primary border-primary text-primary-foreground opacity-100'
                : 'border-muted-foreground/40 text-transparent hover:border-muted-foreground opacity-0 group-hover:opacity-100 group-data-[has-selection]/list:opacity-100'
            }`}
          >
            <Check size={11} strokeWidth={3} />
          </button>
        )}
      </td>
      <td className="sticky left-7 z-10 bg-card w-7 px-1 py-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center">
          <PriorityCell element={el} onElementUpdate={upd} />
        </div>
      </td>
      <td className="sticky left-14 z-10 bg-card pl-0.5 pr-2 py-2 min-w-0 max-w-0">
        <div className="flex items-center gap-2 min-w-0 min-h-[1.625rem]">
          {el.seq_number != null && (
            <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground/60">
              ELE-{String(el.seq_number).padStart(3, '0')}
            </span>
          )}
          <span className="shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
            <StatusPicker
              element={el}
              progress={progress}
              size={16}
              onChanged={(status) => onElementUpdate(el.id, { status })}
            />
          </span>
          <span className="text-[13px] font-semibold truncate flex-1 min-w-0 text-foreground">
            {el.title}
          </span>
          {el.labels && el.labels.length > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              {el.labels.map((label) => (
                <LabelChip key={label} label={label} />
              ))}
            </span>
          )}
        </div>
      </td>
      {visibleColumns.map((col) => (
        <ElementCell
          key={col.id}
          column={col}
          el={el}
          elementTypes={elementTypes}
          canUpdate={canUpdate}
          isOverdue={!!isOverdue}
          onElementUpdate={onElementUpdate}
          onAddType={canAddType ? onAddType : undefined}
          onCustomColumnValueChange={onCustomColumnValueChange}
        />
      ))}
      {hasTrailingCol && (
        <td className="hidden md:table-cell w-8 px-1 py-2" />
      )}
    </tr>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[180px]">
        <ContextMenuItem onClick={() => onSelectElement(el.id)}>Open</ContextMenuItem>
        {canUpdate && (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>Status</ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-[170px]">
                {STATUS_OPTIONS.map((o) => (
                  <ContextMenuItem
                    key={o.value ?? 'none'}
                    className="gap-2"
                    onClick={() => onElementUpdate(el.id, { status: o.value })}
                  >
                    <ElementProgressMark status={o.value} size={14} />
                    <span className="flex-1">{o.label}</span>
                    {el.status === o.value && <Check className="size-3.5" />}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Priority</ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-[150px]">
                {PRIORITY_OPTIONS.map((o) => (
                  <ContextMenuItem
                    key={o.value}
                    className="gap-2"
                    onClick={() => onElementUpdate(el.id, { priority: o.value as ElementWithDetails['priority'] })}
                  >
                    <PriorityMark priority={o.value} />
                    <span className="flex-1">{o.label}</span>
                    {(el.priority ?? 'medium') === o.value && <Check className="size-3.5" />}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="gap-2 text-red-600 focus:text-red-600"
              onClick={() => { void deleteElement(el.id); }}
            >
              <Trash2 className="size-3.5" /> Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});

// Object row — sortable + selectable, mirrors ElementRow at the structural
// level. The checkbox affordance, hover/selected bg, and sticky-left
// frozen first three columns all behave the same so Object lists and
// Element lists feel like one surface.
interface ObjectRowProps {
  obj: AlconObjectWithChildren;
  isSelected: boolean;
  hasSelectionRef: { readonly current: boolean };
  visibleColumns: DataColumn[];
  hasTrailingCol: boolean;
  elementTypes: string[];
  canRowSelect: boolean;
  onAddType?: (name: string) => void | Promise<void>;
  dropEdge?: 'before' | 'after';
  selPrev?: boolean;
  selNext?: boolean;
  onSelectObject: (id: string) => void;
  onRowSelect: (id: string, mode: 'single' | 'range' | 'replace') => void;
  onObjectUpdate?: (objectId: string, updates: { type?: string | null; due_date?: string | null }) => void | Promise<void>;
  onObjectCustomColumnValueChange?: (columnId: string, objectId: string, value: Json) => void | Promise<void>;
}

const ObjectRow = memo(function ObjectRow({
  obj, isSelected, hasSelectionRef, visibleColumns, hasTrailingCol,
  elementTypes, canRowSelect, onAddType, dropEdge, selPrev, selNext, onSelectObject, onRowSelect,
  onObjectUpdate, onObjectCustomColumnValueChange,
}: ObjectRowProps) {
  const dragId = OBJECT_DRAG_PREFIX + obj.id;
  // No sortable transform — rows stay static; the DragOverlay card and blue
  // drop line carry the feedback (see ElementRow for the rationale).
  const { setNodeRef, attributes, listeners, isDragging } = useSortable({ id: dragId });
  // Modifier-clicks are selection gestures (range / toggle) — don't let dnd
  // pick them up.
  const dragListeners = {
    ...listeners,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
      listeners?.onPointerDown?.(e);
    },
  };
  const dragStyle: React.CSSProperties = {
    opacity: isDragging ? 0.4 : undefined,
    ['--drop-line' as string]: dropLineVar(dropEdge),
  };
  return (
    <tr
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      {...dragListeners}
      className={`group cursor-pointer select-none leading-[1.4] [&>td]:transition-colors ${ROW_ROUND_BASE} ${isSelected ? selectionSquareClass(selPrev, selNext) : ''} ${DROP_LINE_CLASS} ${dropEdge ? DROP_LINE_SQUARE : ''} ${
        isSelected
          ? '[&>td:not(:first-child):not(:last-child)]:bg-blue-500/15 dark:[&>td:not(:first-child):not(:last-child)]:bg-blue-400/20 [&:hover>td:not(:first-child):not(:last-child)]:bg-blue-500/20 dark:[&:hover>td:not(:first-child):not(:last-child)]:bg-blue-400/25'
          : '[&:hover>td:not(:first-child):not(:last-child)]:bg-foreground/[0.06]'
      }`}
      onClick={(e) => {
        if (canRowSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onRowSelect(obj.id, e.shiftKey ? 'range' : 'single');
          return;
        }
        if (canRowSelect && hasSelectionRef.current) {
          onRowSelect(obj.id, 'replace');
          return;
        }
        onSelectObject(obj.id);
      }}
    >
      {/* Selection checkbox — identical UI to ElementRow. */}
      <td className="sticky left-0 z-10 bg-card w-7 px-1 py-2" onClick={(e) => e.stopPropagation()}>
        {canRowSelect && (
          <button
            type="button"
            aria-label={isSelected ? 'Deselect object' : 'Select object'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => onRowSelect(obj.id, e.shiftKey ? 'range' : 'single')}
            className={`size-4 rounded-[5px] border flex items-center justify-center mx-auto transition-opacity ${
              isSelected
                ? 'bg-primary border-primary text-primary-foreground opacity-100'
                : 'border-muted-foreground/40 text-transparent hover:border-muted-foreground opacity-0 group-hover:opacity-100 group-data-[has-selection]/list:opacity-100'
            }`}
          >
            <Check size={11} strokeWidth={3} />
          </button>
        )}
      </td>
      <td className="sticky left-7 z-10 bg-card w-7 px-1 py-2">
        <div className="flex items-center justify-center text-muted-foreground/70">
          <ObjectIcon size={14} />
        </div>
      </td>
      <td className="sticky left-14 z-10 bg-card pl-0.5 pr-2 py-2 min-w-0 max-w-0">
        <div className="flex items-center min-w-0 min-h-[1.625rem]">
          <span className="text-[13px] font-semibold text-foreground truncate flex-1 min-w-0">
            {obj.name}
          </span>
        </div>
      </td>
      {visibleColumns.map((col) => (
        <ObjectCell
          key={col.id}
          column={col}
          obj={obj}
          elementTypes={elementTypes}
          onObjectUpdate={onObjectUpdate}
          onAddType={onAddType}
          onObjectCustomColumnValueChange={onObjectCustomColumnValueChange}
        />
      ))}
      {hasTrailingCol && (
        <td className="hidden md:table-cell w-8 px-1 py-2" />
      )}
    </tr>
  );
});

// Floating drag-preview card rendered inside DragOverlay. A compact, self-
// contained chip (not a table row) showing just enough to recognise the
// item being moved — status mark + ELE-id + title for Elements, icon + name
// for Objects.
function DragCard({
  data,
}: {
  data: { kind: 'element'; el: ElementWithDetails } | { kind: 'object'; obj: AlconObjectWithChildren };
}) {
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
          {data.el.seq_number != null && (
            <span className="shrink-0 tabular-nums text-muted-foreground/60">
              ELE-{String(data.el.seq_number).padStart(3, '0')}
            </span>
          )}
          <span className="font-semibold text-foreground truncate">{data.el.title}</span>
        </>
      ) : (
        <>
          <span className="shrink-0 flex items-center justify-center text-muted-foreground/70">
            <ObjectIcon size={14} />
          </span>
          <span className="font-semibold text-foreground truncate">{data.obj.name}</span>
        </>
      )}
    </div>
  );
}

// Type cell — Domain-shared `type` for either an Element or an Object, shown
// as an always-on column. Opens a chip-grid picker: every type as a pill, the
// current one highlighted, plus a dashed "+" that adds a brand-new type to the
// Domain (when onAddType is wired) and applies it to this row.
function TypeCell({
  value, types, onChange, onAddType,
}: {
  value: string | null;
  types: string[];
  onChange?: (next: string | null) => void | Promise<void>;
  onAddType?: (name: string) => void | Promise<void>;
}) {
  const current = value ?? null;
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const canEdit = !!onChange;

  const trigger = (
    <button
      type="button"
      disabled={!canEdit}
      className={`${CELL_TRIGGER_BASE} ${current ? '' : 'text-amber-600 dark:text-amber-400'}`}
    >
      <CellText>{current ?? 'Set type'}</CellText>
    </button>
  );
  // Read-only (no editor) when there's nothing to pick and no way to add.
  if (!canEdit || (types.length === 0 && !onAddType)) return trigger;

  const submitNew = async () => {
    const name = draft.trim();
    setAdding(false);
    setDraft('');
    if (!name) return;
    if (onAddType) await onAddType(name);
    const normalized = name.charAt(0).toUpperCase() + name.slice(1);
    await onChange?.(normalized);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setAdding(false); setDraft(''); } }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className={`${CELL_POPOVER_RADIUS} w-[230px] p-2`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => {
            const on = t === current;
            return (
              <button
                key={t}
                type="button"
                onClick={() => { onChange?.(t); setOpen(false); }}
                className={`px-2 py-1 text-[12px] rounded-full border transition-colors ${
                  on
                    ? 'bg-muted text-foreground border-border'
                    : 'bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground'
                }`}
              >
                {t}
              </button>
            );
          })}
          {onAddType && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              title="Add type"
              aria-label="Add type"
              className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              <Plus size={13} />
            </button>
          )}
        </div>
        {adding && (
          <input
            autoFocus
            value={draft}
            placeholder="New type…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void submitNew(); }
              else if (e.key === 'Escape') { setAdding(false); setDraft(''); }
            }}
            onBlur={() => void submitNew()}
            className="mt-2 w-full px-2 py-1 text-[12px] bg-muted/50 rounded-md text-foreground placeholder:text-muted-foreground/60"
          />
        )}
        {current && (
          <>
            {/* Thin divider above Clear; Clear sits on the right. */}
            <div className="mt-2 -mx-2 border-t border-border/60" />
            <button
              type="button"
              onClick={() => { onChange?.(null); setOpen(false); }}
              className="mt-2 w-full text-right px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors"
            >
              Clear
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Label chip — Tag icon + label text in a soft pill, shown left of the
// Type column. Icon mirrors the Label card header in the detail rail.
function LabelChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 max-w-[140px] px-2 py-0.5 rounded-full text-[11px] font-semibold text-muted-foreground bg-muted/60 ring-1 ring-border/60"
      title={label}
    >
      <Tag size={10} className="shrink-0 text-muted-foreground/80" />
      <span className="truncate">{label}</span>
    </span>
  );
}

// Header cell for a single data column. The entire `<th>` is the drag
// surface for reorder (no grab cursor — dnd-kit's distance constraint
// keeps small clicks as clicks). Inside:
//   - a sort button (label + asc/desc arrow) that cycles the column's sort
//   - an overflow menu for `Hide column` (toggleable columns only)
//   - a resize handle on the right edge
// Resize and the menu's trigger stop pointer propagation so they don't
// accidentally start a header drag.
function ColumnHeader({
  column, width, isDragging, sort, onResize, onToggleSort, onHide,
}: {
  column: DataColumn;
  width: number;
  isDragging: boolean;
  /** 'asc' | 'desc' when this column owns the active sort, else null. */
  sort: ColumnSort['direction'] | null;
  onResize: (width: number) => void;
  onToggleSort: () => void;
  /** Pass undefined for always-on columns (Type) to omit the Hide item. */
  onHide?: () => void;
}) {
  const dragId = HEADER_DRAG_PREFIX + column.id;
  const {
    setNodeRef, attributes, listeners, transform, transition,
  } = useSortable({ id: dragId });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    // Same drag-perf treatment as the row components.
    transition: isDragging ? 'none' : transition,
    willChange: isDragging ? 'transform' : undefined,
    width,
    minWidth: width,
    maxWidth: width,
    opacity: isDragging ? 0.4 : undefined,
  };
  const SortIcon = sort === 'asc' ? ArrowUp : sort === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <th
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      {...listeners}
      className="hidden md:table-cell group/col relative px-1.5 py-2.5 text-left text-[11px] font-normal text-muted-foreground/80 bg-card whitespace-nowrap select-none border-b border-border/60"
    >
      <div className="flex items-center gap-1 min-w-0">
        {/* Sort toggle — click cycles none → asc → desc → none. We do NOT
            stop pointerdown here: the label IS the column's drag surface,
            and the PointerSensor's 3px distance constraint already tells a
            click (→ sort) apart from a drag (→ reorder). Stopping pointerdown
            (as before) made the label un-draggable, so columns couldn't be
            reordered by grabbing their name. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSort(); }}
          title={
            sort === 'asc' ? `Sort by ${column.label} (asc) — click for desc` :
            sort === 'desc' ? `Sort by ${column.label} (desc) — click to clear` :
            `Sort by ${column.label}`
          }
          // px-1.5 mirrors the body trigger's inner padding (CELL_TRIGGER_BASE),
          // so the header text starts at the same x as the cell text below.
          // Without it the label sits 6px left of the body content.
          className="flex-1 min-w-0 flex items-center gap-1 px-1.5 text-left text-muted-foreground/80 hover:text-foreground transition-colors focus:outline-none"
        >
          <span className="truncate">{column.label}</span>
          <SortIcon
            size={11}
            className={`shrink-0 transition-opacity ${
              sort ? 'opacity-100 text-foreground' : 'opacity-0 group-hover/col:opacity-50'
            }`}
          />
        </button>
        {/* Overflow menu — opens on hover (or focus) to expose Hide for
            toggleable columns. Kept opacity-0 so it doesn't draw chrome
            on every header at rest. */}
        {onHide && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${column.label} options`}
                // hidden (not opacity-0) so it doesn't reserve layout space —
                // otherwise tight columns truncate their label to make room
                // for an invisible button.
                className="shrink-0 w-5 h-5 hidden items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground group-hover/col:inline-flex focus:inline-flex transition-colors"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onSelect={onHide} className="gap-2 text-[13px]">
                <EyeOff size={12} className="text-muted-foreground" />
                <span>Hide column</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {/* Short centered vertical divider (30px) on the column's right edge. */}
      <span aria-hidden className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 h-[30px] w-px bg-border/60" />
      {/* Resize handle — absolute on the right edge, visible on hover.
          PointerDown captures the pointer and updates width on move; the
          stopPropagation keeps dnd-kit's drag from kicking in. */}
      <ResizeHandle width={width} onResize={onResize} />
    </th>
  );
}

function ResizeHandle({
  width, onResize,
}: {
  width: number;
  onResize: (w: number) => void;
}) {
  const startRef = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      // Wide transparent grab area for an easy target; the visible feedback
      // is a thin 1px gray line on the right edge (group-hover), so it reads
      // as a slim divider rather than a fat blue bar.
      className="group/resize absolute top-0 right-0 h-full w-2 -mr-1 cursor-col-resize"
      onPointerDown={(e) => {
        startRef.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        if (!startRef.current) return;
        const next = startRef.current.w + (e.clientX - startRef.current.x);
        // Raw width — setWidth applies the right per-column min/max clamp
        // (the Name column has a higher floor than the data columns).
        onResize(next);
      }}
      onPointerUp={(e) => {
        if (!startRef.current) return;
        startRef.current = null;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* fine */ }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="absolute top-0 right-1 h-full w-px bg-muted-foreground/40 opacity-0 group-hover/resize:opacity-100 transition-opacity" />
    </div>
  );
}

// Column-management menu — trailing header cell's `+` button. Lists every
// column in display order with a check mark for the visible ones, plus the
// "New tag…" entry when a column-creation handler is wired.
function ColumnMenu({
  allColumns, isVisible, onToggle, onAddColumn,
}: {
  allColumns: DataColumn[];
  isVisible: (id: ColumnId) => boolean;
  onToggle: (id: ColumnId) => void;
  onAddColumn?: () => void;
}) {
  const builtIns = allColumns.filter((c) => c.kind === 'builtin');
  const customs = allColumns.filter((c) => c.kind === 'custom');
  const hasMenu = builtIns.length > 0 || customs.length > 0;
  if (!hasMenu && !onAddColumn) return null;
  // The `+` opens the property-type picker DIRECTLY whenever a creation handler
  // is wired — no intermediate show/hide toggle list. (Per-column hiding still
  // lives in each column header's own menu.)
  if (onAddColumn) {
    return (
      <button
        type="button"
        title="Add column"
        onClick={onAddColumn}
        className="w-6 h-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
      >
        <Plus size={14} />
      </button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Add or hide columns"
          className="w-6 h-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <Plus size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {builtIns.length > 0 && (
          <>
            <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Built-in
            </DropdownMenuLabel>
            {builtIns.map((c) => {
              const on = isVisible(c.id);
              const locked = !c.toggleable;
              return (
                <DropdownMenuItem
                  key={c.id}
                  disabled={locked}
                  onSelect={(e) => { e.preventDefault(); if (!locked) onToggle(c.id); }}
                  className="gap-2 text-[13px]"
                >
                  <span className="w-4 h-4 inline-flex items-center justify-center text-foreground/70">
                    {on ? <Check size={12} /> : null}
                  </span>
                  <span className="flex-1">{c.label}</span>
                  {locked && <span className="text-[10px] text-muted-foreground/70">Always</span>}
                </DropdownMenuItem>
              );
            })}
          </>
        )}
        {customs.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Tags
            </DropdownMenuLabel>
            {customs.map((c) => {
              const on = isVisible(c.id);
              return (
                <DropdownMenuItem
                  key={c.id}
                  onSelect={(e) => { e.preventDefault(); onToggle(c.id); }}
                  className="gap-2 text-[13px]"
                >
                  <span className="w-4 h-4 inline-flex items-center justify-center text-foreground/70">
                    {on ? <Check size={12} /> : null}
                  </span>
                  <Tag size={11} className="text-muted-foreground/70" />
                  <span className="flex-1 truncate">{c.label}</span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Body cell for an Element row, switched on column kind/id.
function ElementCell({
  column, el, elementTypes, canUpdate, isOverdue,
  onElementUpdate, onAddType, onCustomColumnValueChange,
}: {
  column: DataColumn;
  el: ElementWithDetails;
  elementTypes: string[];
  canUpdate: boolean;
  isOverdue: boolean;
  onElementUpdate: (id: string, updates: ElementUpdate) => void | Promise<void>;
  onAddType?: (name: string) => void | Promise<void>;
  onCustomColumnValueChange: (columnId: string, elementId: string, value: Json) => void | Promise<void>;
}) {
  // The dataset.gripVertical class isn't strictly used — kept for a future
  // header tooltip hook. Visible cell styling is handled per-branch below.
  if (column.kind === 'custom' && column.custom) {
    const col = column.custom;
    const cellValue = col.values?.[el.id]?.value ?? null;
    return (
      <td
        className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <CustomColumnCell
          column={col}
          elementId={el.id}
          value={cellValue}
          onChange={(v) => onCustomColumnValueChange(col.id, el.id, v)}
        />
      </td>
    );
  }
  if (column.id === 'type') {
    return (
      <td
        className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <TypeCell
          value={el.type ?? null}
          types={elementTypes}
          onChange={canUpdate ? (t) => onElementUpdate(el.id, { type: t }) : undefined}
          onAddType={onAddType}
        />
      </td>
    );
  }
  if (column.id === 'due_date') {
    const dateString = el.due_date ? el.due_date.slice(0, 10) : null;
    const selected = parseDateOnly(dateString);
    const display = dateString ? formatDateShort(dateString) : 'Empty';
    const trigger = (
      <button
        type="button"
        disabled={!canUpdate}
        className={`${CELL_TRIGGER_BASE} gap-1 ${dateString ? (isOverdue ? 'text-red-600' : '') : CELL_TRIGGER_EMPTY}`}
      >
        <CalendarIcon size={11} className="opacity-60" />
        <CellText>{display}</CellText>
      </button>
    );
    return (
      <td
        className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {canUpdate ? (
          <Popover>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent className={`w-auto p-0 ${CELL_POPOVER_RADIUS}`} align="start">
              <Calendar
                mode="single"
                selected={selected}
                onSelect={(d) => onElementUpdate(el.id, { due_date: d ? formatDateOnly(d) : null })}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        ) : trigger}
      </td>
    );
  }
  if (column.id === 'assignee') {
    const all = el.assignees ?? [];
    const empty = all.length === 0;
    // One assignee reads as avatar + name; two or more collapse to a stacked
    // avatar group only (names would never fit and the row gets noisy).
    const single = all.length === 1;
    return (
      <td className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden">
        <span className={`${CELL_TRIGGER_BASE} ${empty ? CELL_TRIGGER_EMPTY : 'gap-1.5'}`}>
          {empty ? 'Empty' : single ? (
            <>
              <WorkerAvatar worker={all[0].worker ?? null} size={16} />
              <CellText>{all[0].worker?.name ?? 'Unknown'}</CellText>
            </>
          ) : (
            <WorkerAvatarStack
              workers={all.slice(0, 3).map((a) => a.worker ?? null)}
              max={3}
              size={16}
            />
          )}
        </span>
      </td>
    );
  }
  return <td className="hidden md:table-cell" />;
}

// Body cell for an Object row. Mirrors ElementCell's column switch so the
// column model is the same shape on both row types. Object rows only fill
// the Type column and Domain-scoped custom columns; other columns show as
// dimmed placeholders.
function ObjectCell({
  column, obj, elementTypes, onObjectUpdate, onAddType, onObjectCustomColumnValueChange,
}: {
  column: DataColumn;
  obj: AlconObjectWithChildren;
  elementTypes: string[];
  onObjectUpdate?: (objectId: string, updates: { type?: string | null; due_date?: string | null }) => void | Promise<void>;
  onAddType?: (name: string) => void | Promise<void>;
  onObjectCustomColumnValueChange?: (columnId: string, objectId: string, value: Json) => void | Promise<void>;
}) {
  if (column.kind === 'custom' && column.custom) {
    const col = column.custom;
    // Domain-scoped Tags (`domain_id != null`) store values keyed by object_id;
    // Element-scoped Tags leave the Object row empty since their values live
    // on the Object's Elements.
    const isObjectScoped = col.domain_id != null;
    if (!isObjectScoped) {
      return <td className="hidden md:table-cell px-1.5 py-2 max-w-0 text-muted-foreground/30 overflow-hidden" />;
    }
    const cellValue = col.values?.[obj.id]?.value ?? null;
    return (
      <td
        className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <CustomColumnCell
          column={col}
          elementId={obj.id}
          value={cellValue}
          onChange={(v) => onObjectCustomColumnValueChange?.(col.id, obj.id, v)}
        />
      </td>
    );
  }
  if (column.id === 'type') {
    return (
      <td
        className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <TypeCell
          value={obj.type ?? null}
          types={elementTypes}
          onChange={onObjectUpdate ? (t) => onObjectUpdate(obj.id, { type: t }) : undefined}
          onAddType={onAddType}
        />
      </td>
    );
  }
  // Due date — editable on Objects too (same inline calendar as Elements).
  if (column.id === 'due_date') {
    const dateString = obj.due_date ? obj.due_date.slice(0, 10) : null;
    const selected = parseDateOnly(dateString);
    const display = dateString ? formatDateShort(dateString) : 'Empty';
    const canEdit = !!onObjectUpdate;
    const trigger = (
      <button
        type="button"
        disabled={!canEdit}
        className={`${CELL_TRIGGER_BASE} gap-1 ${dateString ? '' : CELL_TRIGGER_EMPTY}`}
      >
        <CalendarIcon size={11} className="opacity-60" />
        <CellText>{display}</CellText>
      </button>
    );
    return (
      <td
        className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {canEdit ? (
          <Popover>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent className={`w-auto p-0 ${CELL_POPOVER_RADIUS}`} align="start">
              <Calendar
                mode="single"
                selected={selected}
                onSelect={(d) => onObjectUpdate?.(obj.id, { due_date: d ? formatDateOnly(d) : null })}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        ) : trigger}
      </td>
    );
  }
  // assignee is Element-only; render an empty placeholder.
  return <td className="hidden md:table-cell px-1.5 py-2 max-w-0 text-muted-foreground/30 overflow-hidden" />;
}

// Priority cell — the Element's priority shown as a chevron mark, editable
// inline via a dropdown when onElementUpdate is wired.
function PriorityCell({
  element, onElementUpdate,
}: {
  element: ElementWithDetails;
  onElementUpdate?: (elementId: string, updates: ElementUpdate) => void | Promise<void>;
}) {
  const current = element.priority ?? null;
  const trigger = (
    <button
      type="button"
      disabled={!onElementUpdate}
      title={current ? `Priority: ${current}` : 'Set priority'}
      className="flex items-center justify-center rounded-md px-0.5 py-0.5 transition-colors hover:bg-muted/40"
    >
      <PriorityMark priority={current} />
    </button>
  );
  if (!onElementUpdate) return trigger;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={`${CELL_POPOVER_RADIUS} min-w-[150px]`}>
        {PRIORITY_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onSelect={() => onElementUpdate(element.id, { priority: opt.value as ElementWithDetails['priority'] })}
            className="text-[13px] gap-2 rounded-md"
          >
            <span className="flex w-5 items-center justify-center">
              <PriorityMark priority={opt.value} />
            </span>
            <span className="flex-1">{opt.label}</span>
            {opt.value === current && <Check size={12} className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          onSelect={() => onElementUpdate(element.id, { priority: null as ElementWithDetails['priority'] })}
          className="text-[13px] gap-2 rounded-md"
        >
          <span className="flex w-5 items-center justify-center">
            <PriorityMark priority={null} />
          </span>
          <span className="flex-1 text-muted-foreground">No priority</span>
          {current === null && <Check size={12} className="text-muted-foreground" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
