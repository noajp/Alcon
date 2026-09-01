'use client';

import { Fragment, memo, useCallback, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { DateRange } from 'react-day-picker';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarIcon, ChevronDown, EyeOff, Grip, Lock, Menu, MessageSquare, Plus, Check, Tag, Trash2, X } from 'lucide-react';
import { BUILTIN_COLUMN_ICONS } from '@/alcon/property/columnTypes';
import type { AlconObjectWithChildren, CustomColumnWithValues, ElementActivity, ElementWithDetails, Worker } from '@/hooks/useSupabase';
import { deleteElement, reorderElements, reorderObjects, addElementAssignee, removeElementAssignee, fetchAllWorkers, useElementActivity, useElementBlockers } from '@/hooks/useSupabase';
import { describeBlocker, type DependencyBlocker } from '@/alcon/element/dependencyReadiness';
import { displayIdOf } from '@/alcon/element/displayId';
import { formatRelative } from '@/alcon/shared/dateUtils';
import { AssigneeMenuContent } from '@/alcon/shared/AssigneeMenu';
import { getActiveDomainId } from '@/alcon/domain/domainsStore';
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
import { SegmentedProgress } from '@/alcon/shared/SegmentedProgress';
import { labelColor, useLabelColors } from '@/alcon/shared/labelColor';
import { ElementProgressMark } from '@/alcon/shared/ElementProgressMark';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu';
import { MenuShell, MenuSectionLabel } from '@/alcon/shared/menu';
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
} from '@/alcon/property/CustomColumnCell';
import { getElementProgress } from '@/alcon/shared/ElementProgressMark';
import { PriorityMark } from '@/alcon/shared/PriorityMark';
import { PriorityPicker, PRIORITY_OPTIONS } from '@/alcon/shared/PriorityPicker';
import { StatusPicker } from '@/alcon/element/StatusPicker';
import type { SectionGroup } from '@/alcon/shared/listControls/sectionGroup';
import {
  useListColumns,
  sortElements,
  NAME_COL_KEY,
  type ColumnId,
  type ColumnSort,
  type DataColumn,
  type ColumnEntity,
} from './useListColumns';

// Stable empty defaults — destructuring `= []` inline would allocate a NEW
// array every render, which breaks ElementRow's React.memo (the prop ref
// changes each time) and re-renders every row on any parent update (e.g. a
// checkbox toggle on a 100-row list). Shared frozen constants keep the ref
// identity stable so only the changed row re-renders.
const EMPTY_CUSTOM_COLUMNS: CustomColumnWithValues[] = [];
const EMPTY_ELEMENT_TYPES: string[] = [];
const EMPTY_WORKERS: Worker[] = [];
const EMPTY_ELEMENT_IDS: string[] = [];

const STATUS_OPTIONS: { value: ElementWithDetails['status']; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'cancelled', label: 'Cancelled' },
];

export type ElementUpdate = Partial<Pick<ElementWithDetails, 'status' | 'priority' | 'start_date' | 'due_date' | 'title' | 'type'>>;

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
  /** Set when the band is a group bucket rather than an Object — which field
   *  the list is grouped by and which of its values this band holds. The add
   *  paths read it so a row created here inherits the value that put every
   *  other row in the band. Absent for Object bands and un-grouped lists. */
  group?: SectionGroup;
}

// The column layout (visibility / order / width) lives in `useListColumns`.
// Status & priority show inline in the row — the status mark and the
// priority chevrons — so they aren't columns. Type, Due date, Assignee, and
// every user-defined Property are columns the user can reorder, resize, and
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
const DROP_LINE_CLASS = '[&>td]:shadow-[var(--drop-line,0_0_transparent)]';
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
// Object rows on the Objects list carry no trailing "+" column, so the pill
// runs all the way to the LAST cell (Elements) instead of stopping one short.
const ROW_ROUND_TO_LAST = '[&>td:nth-child(2)]:rounded-l-lg [&>td:last-child]:rounded-r-lg';
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
// ROW_ROUND_TO_LAST's counterpart — squares the last cell's corners instead.
function selectionSquareClassToLast(selPrev?: boolean, selNext?: boolean): string {
  let s = '';
  if (selPrev) s += ' [&>td:nth-child(2)]:!rounded-tl-none [&>td:last-child]:!rounded-tr-none';
  if (selNext) s += ' [&>td:nth-child(2)]:!rounded-bl-none [&>td:last-child]:!rounded-br-none';
  return s;
}

// Element rows still scroll horizontally, so their sticky cells (priority +
// Name) must keep an OPAQUE background-color to mask columns sliding under.
// The row tint therefore can't just swap their background-color to a
// translucent blue — instead these paint the translucent tint as a
// background-IMAGE (a flat gradient) layered over the opaque bg-card, which
// composites to the exact same colour the non-sticky cells show.
// blue-500 = rgb(59 130 246), blue-400 = rgb(96 165 250) — same tints as the
// non-sticky `bg-blue-500/15` band.
const STICKY_TINT_SELECTED =
  '[&>td.sticky:not(:first-child)]:bg-[linear-gradient(rgb(59_130_246/0.15),rgb(59_130_246/0.15))] dark:[&>td.sticky:not(:first-child)]:bg-[linear-gradient(rgb(96_165_250/0.2),rgb(96_165_250/0.2))] [&:hover>td.sticky:not(:first-child)]:bg-[linear-gradient(rgb(59_130_246/0.2),rgb(59_130_246/0.2))] dark:[&:hover>td.sticky:not(:first-child)]:bg-[linear-gradient(rgb(96_165_250/0.25),rgb(96_165_250/0.25))]';
const STICKY_TINT_HOVER =
  '[&:hover>td.sticky:not(:first-child)]:bg-[linear-gradient(color-mix(in_oklab,var(--foreground)_6%,transparent),color-mix(in_oklab,var(--foreground)_6%,transparent))]';

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
  const cols = useListColumns(colStorageKey, customColumns, {
    extraColumns,
    defaultVisible: defaultVisibleColumns,
    entity,
  });

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
  const cbRef = useRef({ onElementUpdate, onSelectElement, onElementRowSelect, onCustomColumnValueChange, onObjectRowSelect, onSelectObject, onAddType, onRemoveType, onRefresh });
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
  displayedIdsRef.current = displayedElementIds;
  // ONE aggregated fetch for the whole visible set — per-row activity comes
  // out of this map (entries are reference-stable while unchanged, so the
  // memoised ElementRow still skips rows whose thread didn't move).
  const elementActivity = useElementActivity(displayedElementIds);
  // Dependency blockers come from the host when it already has them (it needs
  // the same map for the Ready filter); otherwise the table fetches its own.
  // Passing an empty id list is what keeps the second fetch from happening.
  const ownBlockers = useElementBlockers(blockers ? EMPTY_ELEMENT_IDS : displayedElementIds);
  const elementBlockers = blockers ?? ownBlockers;
  const displayedObjectIdsRef = useRef<string[]>([]);
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
  hasSelectionRef.current = hasSelection;
  // Name column is always present. Every visible data column (Type, Due
  // date, Assignee, custom Properties) sits to the right of it in the order the
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
    {/* The Object list's columns all fit (Name shrinks; see colgroup), so it
        locks horizontal scroll entirely — the Element list can still grow
        wide with custom Properties and keeps the scroller. */}
    <div className={`${entity === 'object' ? 'overflow-x-hidden' : 'overflow-x-auto'} h-full`}>
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
          {/* Name flexes (auto) to absorb leftover width so the data columns
              and the add-column button pack flush to the right (Linear look),
              with a generous 550px floor on the Element list. The Object list
              only ever carries 5 narrow data columns, so pin Name AT (not a
              floor under) 550 and let it shrink instead of forcing the row
              past the panel width into a horizontal scrollbar. */}
          <col style={entity === 'object' ? { width: 550, minWidth: 0 } : { width: 'auto', minWidth: 550 }} />
          {visibleColumns.map((c) => {
            const w = cols.widthFor(c.id);
            // Match the data cells' `hidden md:table-cell` so the column track
            // isn't reserved below md — otherwise the hidden data columns leave
            // an empty gap and force horizontal scroll in narrow panels.
            return <col key={c.id} className="hidden md:table-column" style={{ width: w, minWidth: w }} />;
          })}
          {hasTrailingCol && <col className="hidden md:table-column" style={{ width: 40, minWidth: 40 }} />}
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
            <th className="sticky top-0 left-14 z-30 relative pl-0.5 pr-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground/80 bg-card border-b border-border/60">
              Name
              {/* Short centered vertical divider (30px) on the column's right
                  edge — a slim separator, not a full-header-height border. */}
              <span aria-hidden className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 h-[30px] w-px bg-border/60" />
              {/* Name is resizable too — same handle as the data columns,
                  persisted under NAME_COL_KEY. Fixed on the Object list
                  instead (see the colgroup above), so no handle there. */}
              {entity !== 'object' && (
                <ResizeHandle
                  width={cols.widthFor(NAME_COL_KEY)}
                  onResize={(w) => cols.setWidth(NAME_COL_KEY, w)}
                />
              )}
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
              // Fixed-width trailing cell at the right edge that holds the
              // add-column "+", lining it up under the header's right actions.
              <th className="hidden md:table-cell w-8 px-1 py-2.5 bg-card text-center border-b border-border/60">
                {/* Trailing "+": lists that can create a Property (a scope is
                    wired) open the add-property picker directly, anchored to
                    the button. Lists that can't (cross-Object: Domain Elements,
                    My Elements) fall back to the column show/hide menu so the
                    "+" is still present everywhere. */}
                {onAddColumn ? (
                  <button
                    type="button"
                    onClick={(e) => onAddColumn(e.currentTarget.getBoundingClientRect())}
                    title="Add property"
                    aria-label="Add property"
                    className="w-6 h-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                ) : (
                  <ColumnMenu
                    allColumns={cols.allColumns}
                    isVisible={cols.isVisible}
                    onToggle={cols.toggleVisible}
                  />
                )}
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
                        activity={elementActivity[el.id]}
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
  canRemoveType: boolean;
  onRemoveType: (name: string) => void | Promise<void>;
  /** When this row is the active drop target, which edge the blue line
   *  draws on. `undefined` for every other row (so memo skips them). */
  dropEdge?: 'before' | 'after';
  /** Selection-block neighbours: is the row directly above / below also
   *  selected? Used to square the touching corners so a multi-row selection
   *  reads as one continuous pill. */
  selPrev?: boolean;
  selNext?: boolean;
  onElementUpdate: (id: string, updates: ElementUpdate) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onSelectElement: (id: string) => void;
  onRowSelect: (id: string, mode: 'single' | 'range' | 'replace') => void;
  onCustomColumnValueChange: (columnId: string, elementId: string, value: Json) => void | Promise<void>;
  /** Every custom Property placed on this list (visible or not) — the
   *  context menu's "More properties" edits from here, so a hidden column
   *  is still reachable per-row. */
  allCustomColumns: CustomColumnWithValues[];
  /** Comment rollup (count + last activity) — undefined when the Element
   *  has no comments, so the row shows nothing. */
  activity?: ElementActivity;
  /** Unfinished `depends_on` upstreams — undefined when the Element is ready,
   *  so the row shows nothing. */
  blockers?: DependencyBlocker[];
}

const ElementRow = memo(function ElementRow({
  el, isSelected, hasSelectionRef, elementTypes, visibleColumns,
  hasTrailingCol, canUpdate, canRowSelect, canAddType, onAddType,
  canRemoveType, onRemoveType, dropEdge, selPrev, selNext,
  onElementUpdate, onRefresh, onSelectElement, onRowSelect, onCustomColumnValueChange,
  allCustomColumns, activity, blockers,
}: ElementRowProps) {
  const isOverdue = el.due_date && new Date(el.due_date) < new Date() && el.status !== 'done';
  const rowId = displayIdOf(el);
  // Computed once per render — the same string feeds the tooltip and the
  // visible text, so the two can't disagree across a date boundary.
  const activityRelative = activity ? formatRelative(activity.lastCommentAt) : null;
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
  // Context-menu submenus are exclusive: hovering a different trigger swaps
  // the open panel instead of stacking a second one (Radix's grace-polygon
  // hover logic happily left several siblings open at once). One controlled
  // key per level — top level here, the More-properties panel's nested
  // selects below. Entering any trigger claims it; entering a plain item
  // (Delete, a flat property row) clears its level.
  const [openSub, setOpenSubState] = useState<string | null>(null);
  const [openPropSub, setOpenPropSub] = useState<string | null>(null);
  const setOpenSub = (key: string | null) => {
    setOpenSubState(key);
    if (key !== 'more') setOpenPropSub(null); // nested state dies with its parent
  };
  const subProps = (key: string) => ({
    open: openSub === key,
    onOpenChange: (o: boolean) =>
      setOpenSubState((cur) => (o ? key : cur === key ? null : cur)),
  });
  return (
    <ContextMenu onOpenChange={(o) => { if (!o) setOpenSub(null); }}>
      <ContextMenuTrigger asChild>
    <tr
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      {...dragListeners}
      className={`group cursor-pointer select-none leading-[1.4] [&>td]:transition-colors ${ROW_ROUND_BASE} ${isSelected ? selectionSquareClass(selPrev, selNext) : ''} ${DROP_LINE_CLASS} ${dropEdge ? DROP_LINE_SQUARE : ''} ${
        isSelected
          ? `[&>td:not(.sticky):not(:last-child)]:bg-blue-500/15 dark:[&>td:not(.sticky):not(:last-child)]:bg-blue-400/20 [&:hover>td:not(.sticky):not(:last-child)]:bg-blue-500/20 dark:[&:hover>td:not(.sticky):not(:last-child)]:bg-blue-400/25 ${STICKY_TINT_SELECTED}`
          : `[&:hover>td:not(.sticky):not(:last-child)]:bg-foreground/[0.06] ${STICKY_TINT_HOVER}`
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
          {rowId && (
            <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground/60">
              {rowId}
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
          <span className="text-[13px] font-[550] truncate flex-1 min-w-0 text-foreground">
            {el.title}
          </span>
          {activity && activityRelative && (
            // Quiet activity signal — comment count + how recently the
            // thread moved, so active vs stalled Elements read at a glance
            // without opening the detail panel.
            <span
              className="shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground/70"
              title={`${activity.commentCount} comment${activity.commentCount === 1 ? '' : 's'} · ${activityRelative}`}
            >
              <MessageSquare size={12} />
              <span className="tabular-nums">{activity.commentCount}</span>
              <span className="text-muted-foreground/50">{activityRelative}</span>
            </span>
          )}
          {blockers && blockers.length > 0 && (
            // Waiting on an unfinished dependency. Deliberately the same quiet
            // register as the activity signal beside it — a row that cannot be
            // started is not an error, and colouring it would collide with the
            // status hue the mark already carries.
            <span
              className="shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground/70"
              title={`Waiting on ${blockers.map(describeBlocker).join(', ')}`}
              aria-label={`Waiting on ${blockers.length} unfinished ${blockers.length === 1 ? 'Element' : 'Elements'}`}
            >
              <Lock size={11} />
              <span className="tabular-nums">{blockers.length}</span>
            </span>
          )}
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
          onRefresh={onRefresh}
          onAddType={canAddType ? onAddType : undefined}
          onRemoveType={canRemoveType ? onRemoveType : undefined}
          onCustomColumnValueChange={onCustomColumnValueChange}
        />
      ))}
      {hasTrailingCol && (
        <td className="hidden md:table-cell w-8 px-1 py-2" />
      )}
    </tr>
      </ContextMenuTrigger>
      {canUpdate && (
      <ContextMenuContent className="min-w-[200px]">
        <ContextMenuSub {...subProps('status')}>
          <ContextMenuSubTrigger className="gap-2" onPointerEnter={() => setOpenSub('status')}>
            {BUILTIN_COLUMN_ICONS.status}
            Status
          </ContextMenuSubTrigger>
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
        <ContextMenuSub {...subProps('priority')}>
          <ContextMenuSubTrigger className="gap-2" onPointerEnter={() => setOpenSub('priority')}>
            {BUILTIN_COLUMN_ICONS.priority}
            Priority
          </ContextMenuSubTrigger>
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
        {onRefresh && (
          <AssigneeContextSub
            el={el}
            onRefresh={onRefresh}
            {...subProps('assignee')}
            onTriggerEnter={() => setOpenSub('assignee')}
          />
        )}
        <ContextMenuSub {...subProps('due')}>
          <ContextMenuSubTrigger className="gap-2" onPointerEnter={() => setOpenSub('due')}>
            {BUILTIN_COLUMN_ICONS.due_date}
            Due date
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[160px]">
            {dueDatePresets().map((p) => (
              <ContextMenuItem
                key={p.label}
                className="gap-2"
                onClick={() => onElementUpdate(el.id, { due_date: p.value })}
              >
                <span className="flex-1">{p.label}</span>
                <span className="text-[11px] text-muted-foreground">{p.hint}</span>
              </ContextMenuItem>
            ))}
            {el.due_date && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="text-muted-foreground"
                  onClick={() => onElementUpdate(el.id, { due_date: null })}
                >
                  Clear
                </ContextMenuItem>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        {elementScopedColumns(allCustomColumns).length > 0 && (
          <ContextMenuSub {...subProps('more')}>
            <ContextMenuSubTrigger className="gap-2" onPointerEnter={() => setOpenSub('more')}>
              <Grip className="size-4" />
              More properties
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-[190px] max-h-80 overflow-auto">
              {elementScopedColumns(allCustomColumns).map((col) => (
                <PropertyContextSub
                  key={col.id}
                  col={col}
                  el={el}
                  onChange={(v) => onCustomColumnValueChange(col.id, el.id, v)}
                  onOpenDetail={() => onSelectElement(el.id)}
                  subOpen={openPropSub === col.id}
                  onSubOpenChange={(o) => setOpenPropSub((cur) => (o ? col.id : cur === col.id ? null : cur))}
                  onTriggerEnter={() => setOpenPropSub(col.id)}
                  onFlatEnter={() => setOpenPropSub(null)}
                />
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          className="gap-2 text-red-600 focus:text-red-600"
          onPointerEnter={() => setOpenSub(null)}
          onClick={() => { void deleteElement(el.id); }}
        >
          <Trash2 className="size-3.5" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
      )}
    </ContextMenu>
  );
});

// ── Context-menu helpers (Element rows) ───────────────────────────────────

// Element-keyed Properties only — a Domain Object list's domain-scoped
// columns tag Objects, so they have no per-Element value to edit here.
function elementScopedColumns(cols: CustomColumnWithValues[]): CustomColumnWithValues[] {
  return cols.filter((c) => c.domain_id == null);
}

// Quick-set presets for the Due date submenu; a precise date is a cell /
// detail-panel edit.
function dueDatePresets(): { label: string; hint: string; value: string }[] {
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const short = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
  return [
    { label: 'Today', hint: short(today), value: fmt(today) },
    { label: 'Tomorrow', hint: short(tomorrow), value: fmt(tomorrow) },
    { label: 'Next week', hint: short(nextWeek), value: fmt(nextWeek) },
  ];
}

// Assignee submenu — workers load lazily on first hover/focus of the trigger.
// Toggling keeps the menu open (onSelect preventDefault) so multiple people
// can be assigned in one visit. Open state is controlled by the row menu so
// hovering another trigger swaps panels instead of stacking.
function AssigneeContextSub({
  el, onRefresh, open, onOpenChange, onTriggerEnter,
}: {
  el: ElementWithDetails;
  onRefresh: () => void | Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTriggerEnter: () => void;
}) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const load = () => {
    if (workers.length === 0) {
      fetchAllWorkers(getActiveDomainId()).then(setWorkers).catch((e) => console.error('Failed to load workers', e));
    }
  };
  const assignees = el.assignees ?? [];
  const toggle = async (workerId: string) => {
    const existing = assignees.find((a) => a.worker_id === workerId);
    try {
      if (existing) await removeElementAssignee(existing.id);
      else await addElementAssignee({ element_id: el.id, worker_id: workerId, role: 'assignee', worker: workers.find((w) => w.id === workerId) });
      await onRefresh();
    } catch (e) { console.error('Failed to toggle assignee', e); }
  };
  return (
    <ContextMenuSub open={open} onOpenChange={onOpenChange}>
      <ContextMenuSubTrigger
        className="gap-2"
        onPointerEnter={() => { load(); onTriggerEnter(); }}
        onFocus={load}
      >
        {BUILTIN_COLUMN_ICONS.assignees}
        Assignee
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-[190px] max-h-72 overflow-auto">
        {workers.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">Loading…</div>
        ) : (
          workers.map((w) => (
            <ContextMenuItem
              key={w.id}
              className="gap-2"
              onSelect={(e) => { e.preventDefault(); void toggle(w.id); }}
            >
              <WorkerAvatar worker={w} size={16} />
              <span className="flex-1 truncate">{w.name}</span>
              {assignees.some((a) => a.worker_id === w.id) && <Check className="size-3.5" />}
            </ContextMenuItem>
          ))
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

// One row inside "More properties". Enumerable types (select / status /
// multi_select / checkbox) edit inline; everything else shows the current
// value and opens the Element detail, where the full editor lives. Sub-open
// state is controlled by the parent so sibling panels swap, never stack.
function PropertyContextSub({
  col, el, onChange, onOpenDetail, subOpen, onSubOpenChange, onTriggerEnter, onFlatEnter,
}: {
  col: CustomColumnWithValues;
  el: ElementWithDetails;
  onChange: (value: Json) => void | Promise<void>;
  onOpenDetail: () => void;
  subOpen: boolean;
  onSubOpenChange: (open: boolean) => void;
  onTriggerEnter: () => void;
  onFlatEnter: () => void;
}) {
  const raw = col.values?.[el.id]?.value ?? null;

  if (col.column_type === 'select' || col.column_type === 'status') {
    const options = col.options?.options ?? [];
    const current = typeof raw === 'string' ? raw : '';
    return (
      <ContextMenuSub open={subOpen} onOpenChange={onSubOpenChange}>
        <ContextMenuSubTrigger onPointerEnter={onTriggerEnter}>{col.name}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-[160px]">
          {options.map((opt) => (
            <ContextMenuItem
              key={opt.value}
              className="gap-2"
              onClick={() => void onChange(opt.value)}
            >
              <span className="flex-1">{opt.value}</span>
              {current === opt.value && <Check className="size-3.5" />}
            </ContextMenuItem>
          ))}
          {current && (
            <ContextMenuItem className="text-muted-foreground" onClick={() => void onChange(null)}>
              Clear
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  }

  if (col.column_type === 'multi_select') {
    const options = col.options?.options ?? [];
    const current = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
    const toggle = (v: string) =>
      onChange(current.includes(v) ? current.filter((x) => x !== v) : [...current, v]);
    return (
      <ContextMenuSub open={subOpen} onOpenChange={onSubOpenChange}>
        <ContextMenuSubTrigger onPointerEnter={onTriggerEnter}>{col.name}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-[160px]">
          {options.map((opt) => (
            <ContextMenuItem
              key={opt.value}
              className="gap-2"
              onSelect={(e) => { e.preventDefault(); void toggle(opt.value); }}
            >
              <span className="flex-1">{opt.value}</span>
              {current.includes(opt.value) && <Check className="size-3.5" />}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  }

  if (col.column_type === 'checkbox') {
    const checked = !!raw;
    return (
      <ContextMenuItem
        className="gap-2"
        onPointerEnter={onFlatEnter}
        onSelect={(e) => { e.preventDefault(); void onChange(!checked); }}
      >
        <span className="flex-1">{col.name}</span>
        {checked && <Check className="size-3.5" />}
      </ContextMenuItem>
    );
  }

  const display = raw == null || raw === ''
    ? 'Empty'
    : typeof raw === 'object' ? '…' : String(raw);
  return (
    <ContextMenuItem className="gap-2" onPointerEnter={onFlatEnter} onClick={onOpenDetail}>
      <span className="flex-1 truncate">{col.name}</span>
      <span className={`text-[11px] truncate max-w-[110px] ${raw == null || raw === '' ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
        {display}
      </span>
    </ContextMenuItem>
  );
}

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
  onRemoveType?: (name: string) => void | Promise<void>;
  dropEdge?: 'before' | 'after';
  selPrev?: boolean;
  selNext?: boolean;
  onSelectObject: (id: string) => void;
  onRowSelect: (id: string, mode: 'single' | 'range' | 'replace') => void;
  onObjectUpdate?: (objectId: string, updates: { type?: string | null; due_date?: string | null; lead_id?: string | null }) => void | Promise<void>;
  objectWorkers: Worker[];
  onObjectCustomColumnValueChange?: (columnId: string, objectId: string, value: Json) => void | Promise<void>;
}

const ObjectRow = memo(function ObjectRow({
  obj, isSelected, hasSelectionRef, visibleColumns, hasTrailingCol,
  elementTypes, canRowSelect, onAddType, onRemoveType, dropEdge, selPrev, selNext, onSelectObject, onRowSelect,
  onObjectUpdate, objectWorkers, onObjectCustomColumnValueChange,
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
      // The Object list never scrolls horizontally (overflow-x-hidden on the
      // wrap), so nothing can slide under the sticky Name cells — the selected
      // tint safely spans the full rounded band. Without a trailing "+"
      // column the band (rounding + tint) runs to the LAST cell (Elements);
      // with one it stops a cell short, mirroring the Element rows.
      className={`group cursor-pointer select-none leading-[1.4] [&>td]:transition-colors ${hasTrailingCol ? ROW_ROUND_BASE : ROW_ROUND_TO_LAST} ${isSelected ? (hasTrailingCol ? selectionSquareClass(selPrev, selNext) : selectionSquareClassToLast(selPrev, selNext)) : ''} ${DROP_LINE_CLASS} ${dropEdge ? DROP_LINE_SQUARE : ''} ${
        isSelected
          ? (hasTrailingCol
              ? '[&>td:not(:first-child):not(:last-child)]:bg-blue-500/15 dark:[&>td:not(:first-child):not(:last-child)]:bg-blue-400/20 [&:hover>td:not(:first-child):not(:last-child)]:bg-blue-500/20 dark:[&:hover>td:not(:first-child):not(:last-child)]:bg-blue-400/25'
              : '[&>td:not(:first-child)]:bg-blue-500/15 dark:[&>td:not(:first-child)]:bg-blue-400/20 [&:hover>td:not(:first-child)]:bg-blue-500/20 dark:[&:hover>td:not(:first-child)]:bg-blue-400/25')
          : ''
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
          <span className="text-[13px] font-[550] text-foreground truncate flex-1 min-w-0">
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
          objectWorkers={objectWorkers}
          onAddType={onAddType}
          onRemoveType={onRemoveType}
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
          {elementId && (
            <span className="shrink-0 tabular-nums text-muted-foreground/60">
              {elementId}
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
// Shared bottom strip for cell-editor popovers (Type / Due date): full-bleed
// divider, optional status label on the left, an 11px Clear on the right.
// One component so the line position and Clear sizing never drift apart.
function CellClearFooter({
  label, onClear, className = '',
}: {
  label?: ReactNode;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="border-t border-border/60" />
      <div className="flex items-center justify-between px-3 h-9">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-muted/40 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// Industry starter vocabularies for the Type picker — each tab offers ~10
// Element type names that read naturally in that domain. Terms intentionally
// overlap across industries (Task, Customer, Order…); picking one adds it to
// this Domain's catalogue and assigns it.
const TYPE_PRESETS: { label: string; types: string[] }[] = [
  { label: 'General',        types: ['Task', 'Issue', 'Customer', 'Bug', 'Feature', 'Story', 'Epic', 'Goal', 'Risk', 'Note'] },
  { label: 'Project Office', types: ['Project', 'Deliverable', 'Milestone', 'Risk', 'Issue', 'Change Request', 'Action Item', 'Decision', 'Stakeholder', 'Resource'] },
  { label: 'CRM',            types: ['Lead', 'Contact', 'Account', 'Opportunity', 'Deal', 'Customer', 'Ticket', 'Campaign', 'Activity', 'Quote'] },
  { label: 'SCM',            types: ['Order', 'Shipment', 'Supplier', 'Inventory', 'SKU', 'Purchase Order', 'Warehouse', 'Lot', 'Delivery', 'Forecast'] },
  { label: 'Software',       types: ['Epic', 'Story', 'Task', 'Bug', 'Feature', 'Spike', 'Incident', 'Release', 'Sprint', 'Subtask'] },
  { label: 'Healthcare',     types: ['Patient', 'Encounter', 'Appointment', 'Order', 'Medication', 'Lab', 'Diagnosis', 'Procedure', 'Referral', 'Claim'] },
  { label: 'Finance',        types: ['Account', 'Transaction', 'Invoice', 'Payment', 'Journal', 'Budget', 'Expense', 'Asset', 'Ledger', 'Reconciliation'] },
  { label: 'Sales',          types: ['Lead', 'Prospect', 'Opportunity', 'Quote', 'Order', 'Contract', 'Account', 'Activity', 'Target', 'Renewal'] },
];

export function TypeCell({
  value, types, onChange, onAddType, onRemoveType,
}: {
  value: string | null;
  types: string[];
  onChange?: (next: string | null) => void | Promise<void>;
  onAddType?: (name: string) => void | Promise<void>;
  onRemoveType?: (name: string) => void | Promise<void>;
}) {
  const current = value ?? null;
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [presetTab, setPresetTab] = useState(0);
  const canEdit = !!onChange;

  // Pick an industry preset: register it on the Domain (if new) and assign it.
  const pickPreset = async (name: string) => {
    if (onAddType && !types.includes(name)) await onAddType(name);
    await onChange?.(name);
    setOpen(false);
  };

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

  const canManage = !!onRemoveType && types.length > 0;
  const showFooter = !!current || canManage;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setAdding(false); setDraft(''); setEditing(false); } }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        // With a footer, match the due-date Calendar popover's height so both
        // row editors put their divider + footer strip at the same spot.
        className={`${CELL_POPOVER_RADIUS} w-[230px] p-2 flex flex-col ${showFooter ? 'min-h-[370px]' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Industry presets — rectangular tabs over a chip list of starter
            Element type names. Picking one registers it on the Domain (if new)
            and assigns it. Hidden in delete/edit mode to keep that focused. */}
        {!editing && (
          <div className="mb-2 pb-2 border-b border-border/60">
            <div className="flex gap-1 overflow-x-auto pb-1.5">
              {TYPE_PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPresetTab(i)}
                  className={`shrink-0 px-2 py-1 text-[11px] rounded-md border whitespace-nowrap transition-colors ${
                    presetTab === i
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-transparent text-muted-foreground border-border/50 hover:text-foreground hover:border-border'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {TYPE_PRESETS[presetTab].types.map((name) => {
                // Highlight the *selected* type only — not every term already in
                // the catalogue — so the fill tracks the actual selection.
                const isCurrent = name === current;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => void pickPreset(name)}
                    className={`px-2 py-1 text-[12px] rounded-full border transition-colors ${
                      isCurrent
                        ? 'bg-muted text-foreground border-border'
                        : 'bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground'
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => {
            const on = t === current;
            return (
              <span key={t} className="relative">
                <button
                  type="button"
                  onClick={() => { if (editing) return; onChange?.(on ? null : t); setOpen(false); }}
                  className={`px-2 py-1 text-[12px] rounded-full border transition-colors ${
                    on
                      ? 'bg-muted text-foreground border-border'
                      : 'bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground'
                  }`}
                >
                  {t}
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => void onRemoveType?.(t)}
                    title={`Delete "${t}"`}
                    aria-label={`Delete "${t}"`}
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-muted text-muted-foreground border border-border/60 flex items-center justify-center hover:text-foreground hover:border-border transition-colors"
                  >
                    <X size={9} strokeWidth={2.5} />
                  </button>
                )}
              </span>
            );
          })}
          {onAddType && !adding && !editing && (
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
            className="mt-2 w-full px-2 py-1 text-[12px] bg-muted/50 rounded-md text-foreground placeholder:text-muted-foreground/60 border-none"
          />
        )}
        {showFooter && (
          // Pinned to the bottom edge (mt-auto); -mx/-mb cancel the p-2 so
          // the strip's geometry matches the due-date popover exactly.
          <CellClearFooter
            className="mt-auto -mx-2 -mb-2"
            label={canManage && (
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                title="Edit types"
                aria-label="Edit types"
                className={`p-1 rounded-md transition-colors ${
                  editing
                    ? 'text-foreground bg-muted/60'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
              >
                <Menu size={13} />
              </button>
            )}
            onClear={current ? () => { onChange?.(null); setOpen(false); } : undefined}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

// Due-date cell editor — a range Calendar (start → due) with year/month
// dropdowns. The draft range lives locally while the popover is open and is
// persisted once on close (or via Clear), so half-picked ranges never hit the
// DB. A single-day pick maps to due_date only; a two-day span writes both.
function DateRangeCellPopover({
  startDate, dueDate, trigger, onChange,
}: {
  startDate: string | null;
  dueDate: string | null;
  trigger: ReactElement;
  onChange: (start: string | null, due: string | null) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);

  const initialDraft = useCallback((): DateRange | undefined => {
    const from = parseDateOnly(startDate) ?? parseDateOnly(dueDate);
    const to = parseDateOnly(dueDate) ?? parseDateOnly(startDate);
    return from ? { from, to } : undefined;
  }, [startDate, dueDate]);

  const persist = (range: DateRange | undefined) => {
    const from = range?.from ?? range?.to ?? null;
    const to = range?.to ?? range?.from ?? null;
    const next: [string | null, string | null] = !from || !to
      ? [null, null]
      : formatDateOnly(from) === formatDateOnly(to)
        ? [null, formatDateOnly(to)]
        : [formatDateOnly(from), formatDateOnly(to)];
    if (next[0] !== startDate || next[1] !== dueDate) void onChange(next[0], next[1]);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(initialDraft());
        else persist(draft);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className={`w-auto p-0 ${CELL_POPOVER_RADIUS}`} align="start">
        <Calendar
          mode="range"
          captionLayout="dropdown"
          startMonth={new Date(2020, 0)}
          endMonth={new Date(2035, 11)}
          defaultMonth={draft?.from}
          selected={draft}
          onSelect={(r) => setDraft(r)}
          // Always render 6 week rows so the popover height never jumps
          // between months (and stays aligned with the Type popover).
          fixedWeeks
          showOutsideDays
          autoFocus
        />
        <CellClearFooter
          label={draft?.from
            ? `${formatDateShort(formatDateOnly(draft.from))} – ${draft.to ? formatDateShort(formatDateOnly(draft.to)) : '…'}`
            : 'Pick a day, or drag a range'}
          onClear={() => { setDraft(undefined); void onChange(null, null); setOpen(false); }}
        />
      </PopoverContent>
    </Popover>
  );
}

// Label chip — a coloured Tag mark + label text in a soft pill, shown left of
// the Type column. The mark colour comes from the Domain colour catalogue
// (picked colour, else an auto colour derived from the name).
function LabelChip({ label }: { label: string }) {
  useLabelColors(); // re-render when a colour is picked / the catalogue loads
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 max-w-[140px] px-2 py-0.5 rounded-full text-[11px] font-medium text-muted-foreground bg-muted/60 ring-1 ring-border/60"
      title={label}
    >
      <Tag size={10} className="shrink-0" style={{ color: labelColor(label) }} />
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
    // Don't animate layout changes — otherwise an unrelated re-render (e.g.
    // toggling a column's sort) makes dnd-kit transition the header's
    // transform, which reads as a visible stutter/jank. Active drag still
    // moves via `transform`; reordered columns just snap into place.
  } = useSortable({ id: dragId, animateLayoutChanges: () => false });
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
      className="hidden md:table-cell group/col relative px-1.5 py-2.5 text-left text-[11px] font-semibold text-muted-foreground/80 bg-card whitespace-nowrap select-none border-b border-border/60"
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
          className="flex-1 min-w-0 flex items-center justify-start gap-1 px-1.5 text-left text-muted-foreground/80 hover:text-foreground transition-colors focus:outline-none"
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
                className="shrink-0 w-5 h-4 hidden items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground group-hover/col:inline-flex focus:inline-flex transition-colors"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <MenuShell as="dropdown" align="end">
              <DropdownMenuItem onSelect={onHide} className="gap-2">
                <EyeOff size={12} className="text-muted-foreground" />
                <span>Hide column</span>
              </DropdownMenuItem>
            </MenuShell>
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

// (ColumnMenu removed — the trailing header "+" now opens the add-property
// picker directly. Column show/hide lives in the list's Display menu.)

// Body cell for an Element row, switched on column kind/id.
function ElementCell({
  column, el, elementTypes, canUpdate, isOverdue,
  onElementUpdate, onRefresh, onAddType, onRemoveType, onCustomColumnValueChange,
}: {
  column: DataColumn;
  el: ElementWithDetails;
  elementTypes: string[];
  canUpdate: boolean;
  isOverdue: boolean;
  onElementUpdate: (id: string, updates: ElementUpdate) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onAddType?: (name: string) => void | Promise<void>;
  onRemoveType?: (name: string) => void | Promise<void>;
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
          onRemoveType={onRemoveType}
        />
      </td>
    );
  }
  if (column.id === 'objects') {
    // Home Objects this Element belongs to (My Elements' "Projects" column).
    // Read-only chips — membership is edited from the Element detail panel.
    const homes = el.objects ?? [];
    const empty = homes.length === 0;
    return (
      <td className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden">
        {empty ? (
          <span className={`${CELL_TRIGGER_BASE} ${CELL_TRIGGER_EMPTY}`}>Empty</span>
        ) : (
          <span className="inline-flex items-center gap-1 max-w-full overflow-hidden">
            {homes.slice(0, 2).map((o) => (
              <span
                key={o.id}
                className="inline-flex items-center gap-1 shrink-0 max-w-[140px] px-2 py-0.5 rounded-full text-[11px] font-medium text-muted-foreground bg-muted/60 ring-1 ring-border/60"
                title={o.name}
              >
                <span className="shrink-0 inline-flex"><ObjectIcon size={10} /></span>
                <span className="truncate">{o.name}</span>
              </span>
            ))}
            {homes.length > 2 && (
              <span className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums">
                +{homes.length - 2}
              </span>
            )}
          </span>
        )}
      </td>
    );
  }
  if (column.id === 'due_date') {
    const startString = el.start_date ? el.start_date.slice(0, 10) : null;
    const dateString = el.due_date ? el.due_date.slice(0, 10) : null;
    // The "Due date" column shows the DUE date only — not the start→due range.
    // (start_date is still editable via the popover for the Gantt, just not
    // rendered as a range here.)
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
          <DateRangeCellPopover
            startDate={startString}
            dueDate={dateString}
            trigger={trigger}
            onChange={(start, due) => onElementUpdate(el.id, { start_date: start, due_date: due })}
          />
        ) : trigger}
      </td>
    );
  }
  if (column.id === 'assignee') {
    return (
      <td
        className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <AssigneeCell el={el} canUpdate={canUpdate} onRefresh={onRefresh} />
      </td>
    );
  }
  return <td className="hidden md:table-cell" />;
}

// Assignee cell — click opens a worker picker (the shared AssigneeMenuContent).
// Reads the current set from el.assignees; add/remove write element_assignees
// directly, then onRefresh reloads the row so the chips reflect the new set.
// Read-only (plain chips, no dropdown) when canUpdate is false or onRefresh
// isn't wired. Workers are fetched lazily on first open.
function AssigneeCell({
  el, canUpdate, onRefresh,
}: {
  el: ElementWithDetails;
  canUpdate: boolean;
  onRefresh?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const all = el.assignees ?? [];
  const empty = all.length === 0;

  const display = (
    <span className={`${CELL_TRIGGER_BASE} ${empty ? CELL_TRIGGER_EMPTY : 'gap-1.5'}`}>
      {empty ? 'Empty' : all.length === 1 ? (
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
  );

  if (!canUpdate || !onRefresh) return display;

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next && workers.length === 0) {
      fetchAllWorkers(getActiveDomainId()).then(setWorkers).catch((e) => console.error('Failed to load workers', e));
    }
  };
  const handleAdd = async (workerId: string) => {
    try {
      await addElementAssignee({ element_id: el.id, worker_id: workerId, role: 'assignee', worker: workers.find((w) => w.id === workerId) });
      setOpen(false);
      await onRefresh();
    } catch (e) { console.error('Failed to add assignee', e); }
  };
  const handleRemove = async (assigneeId: string) => {
    try {
      await removeElementAssignee(assigneeId);
      await onRefresh();
    } catch (e) { console.error('Failed to remove assignee', e); }
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex items-center max-w-full text-left">
          {display}
        </button>
      </DropdownMenuTrigger>
      <AssigneeMenuContent
        align="start"
        className="min-w-[180px]"
        onClick={(e) => e.stopPropagation()}
        assignees={el.assignees}
        workers={workers}
        onAdd={handleAdd}
        onRemove={handleRemove}
      />
    </DropdownMenu>
  );
}

// Body cell for an Object row. Mirrors ElementCell's column switch so the
// column model is the same shape on both row types. Object rows only fill
// the Type column and Domain-scoped custom columns; other columns show as
// dimmed placeholders.
function ObjectCell({
  column, obj, elementTypes, onObjectUpdate, objectWorkers, onAddType, onRemoveType, onObjectCustomColumnValueChange,
}: {
  column: DataColumn;
  obj: AlconObjectWithChildren;
  elementTypes: string[];
  onObjectUpdate?: (objectId: string, updates: { type?: string | null; due_date?: string | null; lead_id?: string | null }) => void | Promise<void>;
  objectWorkers: Worker[];
  onAddType?: (name: string) => void | Promise<void>;
  onRemoveType?: (name: string) => void | Promise<void>;
  onObjectCustomColumnValueChange?: (columnId: string, objectId: string, value: Json) => void | Promise<void>;
}) {
  if (column.kind === 'custom' && column.custom) {
    const col = column.custom;
    // Domain-scoped Properties (`domain_id != null`) store values keyed by object_id;
    // Element-scoped Properties leave the Object row empty since their values live
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
          onRemoveType={onRemoveType}
        />
      </td>
    );
  }
  // Due date — editable on Objects too (same inline calendar as Elements).
  if (column.id === 'due_date') {
    return (
      <td
        className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <DueDateCell obj={obj} onObjectUpdate={onObjectUpdate} />
      </td>
    );
  }
  // Elements count — read-only roll-up of the Object's direct Elements.
  if (column.id === 'elements') {
    const count = obj.elements?.length ?? 0;
    return (
      <td className="hidden md:table-cell px-1.5 py-2 max-w-0 overflow-hidden text-xs text-muted-foreground tabular-nums">
        {count === 0 ? '—' : count}
      </td>
    );
  }
  // Progress — share of the Object's Elements marked done (computed, read-only).
  if (column.id === 'progress') {
    const total = obj.elements?.length ?? 0;
    const done = obj.elements?.filter((e) => e.status === 'done').length ?? 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
      <td className="hidden md:table-cell px-1.5 py-2 max-w-0 overflow-hidden">
        <div className="flex items-center gap-2">
          <SegmentedProgress value={pct} className="flex-1" />
          <span className="text-[10px] text-muted-foreground w-7 text-right tabular-nums shrink-0">{pct}%</span>
        </div>
      </td>
    );
  }
  // Lead — the Object's responsible Worker (objects.lead_id), a single-select
  // worker picker. Read-only chip when onObjectUpdate isn't wired.
  if (column.id === 'lead') {
    return (
      <td
        className="hidden md:table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <LeadCell obj={obj} workers={objectWorkers} onObjectUpdate={onObjectUpdate} />
      </td>
    );
  }
  // assignee is Element-only — falls through to an empty placeholder.
  return <td className="hidden md:table-cell px-1.5 py-2 max-w-0 text-muted-foreground/30 overflow-hidden" />;
}

// Due date cell — the Object's due_date, editable via an inline calendar
// popover. Exported so non-table surfaces (e.g. a Strategy's Object-scope
// list) can show/edit the same built-in Property without re-implementing it.
export function DueDateCell({
  obj, onObjectUpdate,
}: {
  obj: Pick<AlconObjectWithChildren, 'id' | 'due_date'>;
  onObjectUpdate?: (objectId: string, updates: { due_date?: string | null }) => void | Promise<void>;
}) {
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
  if (!canEdit) return trigger;
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className={`w-auto p-0 ${CELL_POPOVER_RADIUS}`} align="start">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          startMonth={new Date(2020, 0)}
          endMonth={new Date(2035, 11)}
          selected={selected}
          onSelect={(d) => onObjectUpdate?.(obj.id, { due_date: d ? formatDateOnly(d) : null })}
          fixedWeeks
          showOutsideDays
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

// Lead cell — single-select Worker picker for objects.lead_id. Resolves the
// current lead from the passed worker list (for display) and offers a dropdown
// of all workers (+ Clear) to set it. Read-only chip when onObjectUpdate isn't
// wired. Exported for the same cross-surface reuse as DueDateCell above.
export function LeadCell({
  obj, workers, onObjectUpdate,
}: {
  obj: AlconObjectWithChildren;
  workers: Worker[];
  onObjectUpdate?: (objectId: string, updates: { lead_id?: string | null }) => void | Promise<void>;
}) {
  const empty = !obj.lead_id;
  const lead = obj.lead_id ? workers.find((w) => w.id === obj.lead_id) ?? null : null;
  const display = (
    <span className={`${CELL_TRIGGER_BASE} ${empty ? CELL_TRIGGER_EMPTY : 'gap-1.5'}`}>
      {empty ? 'Empty' : (
        <>
          <WorkerAvatar worker={lead} size={16} />
          <CellText>{lead?.name ?? 'Unknown'}</CellText>
        </>
      )}
    </span>
  );
  if (!onObjectUpdate) return display;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex items-center max-w-full text-left">
          {display}
        </button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="start">
        {workers.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No workers</div>
        )}
        {workers.map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => onObjectUpdate(obj.id, { lead_id: w.id })} className="gap-2">
            <WorkerAvatar worker={w} size={16} />
            <span className="flex-1 truncate">{w.name}</span>
            {obj.lead_id === w.id && <Check size={13} className="shrink-0" />}
          </DropdownMenuItem>
        ))}
        {!empty && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onObjectUpdate(obj.id, { lead_id: null })} className="text-muted-foreground">
              Clear
            </DropdownMenuItem>
          </>
        )}
      </MenuShell>
    </DropdownMenu>
  );
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
    <PriorityPicker
      value={current}
      onChange={(p) => onElementUpdate(element.id, { priority: p as ElementWithDetails['priority'] })}
      trigger={trigger}
    />
  );
}

// Column show/hide menu — trailing header "+" for lists that can't create a
// Property (no single scope: Domain Elements, My Elements). Toggles which
// built-in/custom columns are visible. Lists that CAN add a Property use a
// direct "+" instead (see the header cell above).
function ColumnMenu({
  allColumns, isVisible, onToggle,
}: {
  allColumns: DataColumn[];
  isVisible: (id: ColumnId) => boolean;
  onToggle: (id: ColumnId) => void;
}) {
  const builtIns = allColumns.filter((c) => c.kind === 'builtin');
  const customs = allColumns.filter((c) => c.kind === 'custom');
  if (builtIns.length === 0 && customs.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Show or hide columns"
          aria-label="Show or hide columns"
          className="w-6 h-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <Plus size={14} />
        </button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="end">
        {builtIns.length > 0 && (
          <>
            <MenuSectionLabel>Properties</MenuSectionLabel>
            {builtIns.map((c) => {
              const on = isVisible(c.id);
              const locked = !c.toggleable;
              return (
                <DropdownMenuItem
                  key={c.id}
                  disabled={locked}
                  onSelect={(e) => { e.preventDefault(); if (!locked) onToggle(c.id); }}
                  className="gap-2"
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
            <MenuSectionLabel>Custom</MenuSectionLabel>
            {customs.map((c) => {
              const on = isVisible(c.id);
              return (
                <DropdownMenuItem
                  key={c.id}
                  onSelect={(e) => { e.preventDefault(); onToggle(c.id); }}
                  className="gap-2"
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
      </MenuShell>
    </DropdownMenu>
  );
}
