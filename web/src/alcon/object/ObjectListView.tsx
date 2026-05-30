'use client';

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarIcon, ChevronDown, Plus, Check, Tag, Trash2 } from 'lucide-react';
import type { AlconObjectWithChildren, CustomColumnWithValues, ElementWithDetails } from '@/hooks/useSupabase';
import { deleteElement, reorderElements } from '@/hooks/useSupabase';
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Json } from '@/types/database';
import { ObjectIcon } from '@/shell/icons';
import { WorkerAvatarStack } from '@/alcon/shared/WorkerAvatar';
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
  CELL_TRIGGER_BASE,
  CELL_TRIGGER_EMPTY,
  CELL_POPOVER_RADIUS,
} from '@/alcon/tag/CustomColumnCell';
import { getElementProgress } from '@/alcon/shared/ElementProgressMark';
import { PriorityMark } from '@/alcon/shared/PriorityMark';
import { StatusPicker } from '@/alcon/element/StatusPicker';

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

// Element-specific columns the user can toggle on/off. (Status & priority
// show inline in the row — the status mark and the priority chevrons — so
// they aren't columns.)
export type ElementCol = 'due_date' | 'assignee';
const ALL_ELEMENT_COLS: { id: ElementCol; label: string }[] = [
  { id: 'due_date', label: 'Due date' },
  { id: 'assignee', label: 'Assignee' },
];
const DEFAULT_ELEMENT_COLS: ElementCol[] = ['due_date'];

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
  onObjectUpdate?: (objectId: string, updates: { type?: string | null }) => void | Promise<void>;
  /** Multi-select state: ids of currently selected Elements. */
  selectedElementIds?: Set<string>;
  /** Click handler for an Element row that signals selection intent.
   *  - `single`  : Cmd/Ctrl-click — toggle this id only
   *  - `range`   : Shift-click — extend selection to this id from the
   *    most-recent anchor
   *  - `replace` : plain click while another is already selected —
   *    parent decides (typically clears + selects this) */
  onElementRowSelect?: (elementId: string, mode: 'single' | 'range' | 'replace', orderedIds?: string[]) => void;
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
  onCustomColumnValueChange,
  onObjectCustomColumnValueChange,
  onAddColumn,
  onElementUpdate,
  onObjectUpdate,
  selectedElementIds,
  onElementRowSelect,
}: ObjectListViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Element column visibility (persisted in localStorage when a key is given).
  const [elementCols, setElementCols] = useState<Set<ElementCol>>(() => {
    if (typeof window !== 'undefined' && colStorageKey) {
      const raw = window.localStorage.getItem(`obj-list-cols:${colStorageKey}`);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as ElementCol[];
          if (Array.isArray(parsed)) return new Set(parsed);
        } catch { /* fall through */ }
      }
    }
    return new Set(DEFAULT_ELEMENT_COLS);
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !colStorageKey) return;
    window.localStorage.setItem(
      `obj-list-cols:${colStorageKey}`,
      JSON.stringify(Array.from(elementCols)),
    );
  }, [elementCols, colStorageKey]);
  const toggleCol = (id: ElementCol) =>
    setElementCols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Show Element-specific column headers only when at least one section
  // carries elements (otherwise the wide layout looks empty when listing
  // Objects only).
  const anyElements = sections.some((s) => (s.elements?.length ?? 0) > 0);
  const anyObjects  = sections.some((s) => (s.objects?.length ?? 0) > 0);
  // Memoised so the array reference is stable across the common re-render
  // trigger (an element edit changing `sections`) — required for the
  // memoised ElementRow below to actually skip unchanged rows.
  const visibleCols = useMemo(
    () => (anyElements ? ALL_ELEMENT_COLS.filter(c => elementCols.has(c.id)) : []),
    [anyElements, elementCols],
  );

  // Stable callback singletons via a latest-ref. The row callbacks keep a
  // fixed identity across renders (so React.memo can skip), while always
  // invoking the freshest handler the parent passed. Capability booleans
  // preserve the "read-only when no handler" branches inside the row.
  const cbRef = useRef({ onElementUpdate, onSelectElement, onElementRowSelect, onCustomColumnValueChange });
  cbRef.current = { onElementUpdate, onSelectElement, onElementRowSelect, onCustomColumnValueChange };
  // Flattened element ids in DISPLAY order (across all sections) — passed to
  // range-select so Shift-click fills the visible range, not the raw order.
  const displayedIdsRef = useRef<string[]>([]);
  displayedIdsRef.current = sections.flatMap((s) => (s.elements ?? []).map((e) => e.id));
  const stableElementUpdate = useCallback((id: string, u: ElementUpdate) => cbRef.current.onElementUpdate?.(id, u), []);
  const stableSelectElement = useCallback((id: string) => cbRef.current.onSelectElement?.(id), []);
  const stableRowSelect = useCallback((id: string, mode: 'single' | 'range' | 'replace') => cbRef.current.onElementRowSelect?.(id, mode, displayedIdsRef.current), []);
  const stableCustomColChange = useCallback((cid: string, eid: string, v: Json) => cbRef.current.onCustomColumnValueChange?.(cid, eid, v), []);
  const canUpdate = !!onElementUpdate;
  const canRowSelect = !!onElementRowSelect;
  const hasSelection = (selectedElementIds?.size ?? 0) > 0;
  // Stable handle to hasSelection for the rows' click logic — passing the
  // boolean directly would re-render all rows on the 0↔1 flip.
  const hasSelectionRef = useRef(hasSelection);
  hasSelectionRef.current = hasSelection;
  // The `type` column is always shown — both Object rows and Element rows
  // expose the same Domain-shared catalogue. Stays on so empty cells render
  // a "Set type" affordance instead of disappearing.
  const showTypeCol = anyElements || anyObjects;
  const totalDataColumns = 1 /* name */ + (showTypeCol ? 1 : 0) + visibleCols.length + customColumns.length;
  // Reserve a trailing "+ add column" slot whenever the parent wires up
  // either Element column toggles (anyElements) or a column-creation
  // handler (onAddColumn — used by the Domain Object list).
  const hasTrailingCol = anyElements || !!onAddColumn;

  // Drag-to-reorder. PointerSensor with a small activation distance so a
  // click still selects / opens — only a real drag (>6px) starts a sort.
  // Reorder is scoped to within the section that holds both rows; order is
  // persisted to elements.order_index (which the explorer RPC sorts by).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    for (const sec of sections) {
      const els = sec.elements ?? [];
      const from = els.findIndex((x) => x.id === active.id);
      const to = els.findIndex((x) => x.id === over.id);
      if (from === -1 || to === -1) continue;
      const reordered = arrayMove(els, from, to);
      void reorderElements(reordered.map((x, i) => ({ id: x.id, order_index: i + 1 })));
      return;
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
    <div className="overflow-x-auto h-full">
      <table
        className="group/list w-full bg-card border-separate border-spacing-0 text-[13px]"
        data-has-selection={hasSelection ? '' : undefined}
      >
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            <th className="w-7 px-1 py-2.5 text-center text-[11px] font-normal text-muted-foreground/80 bg-card" />
            <th className="w-7 px-1 py-2.5 text-center text-[11px] font-normal text-muted-foreground/80 bg-card" />
            <th className="md:min-w-[280px] pl-0.5 pr-3 py-2.5 text-left text-[11px] font-normal text-muted-foreground/80 bg-card">
              Name
            </th>
            {showTypeCol && (
              <th className="hidden md:table-cell w-px px-3 py-2.5 text-left text-[11px] font-normal text-muted-foreground/80 bg-card whitespace-nowrap">
                Type
              </th>
            )}
            {visibleCols.map((c) => (
              <th
                key={c.id}
                // assignee column gets a fixed width so the chip area
                // doesn't stretch with the longest contained name; due_date
                // keeps the shrink-wrap (`w-px`) behaviour.
                className={`hidden md:table-cell px-3 py-2.5 text-left text-[11px] font-normal text-muted-foreground/80 bg-card whitespace-nowrap ${
                  c.id === 'assignee' ? 'w-32 min-w-[8rem] max-w-[8rem]' : 'w-px'
                }`}
              >
                {c.label}
              </th>
            ))}
            {customColumns.map((col) => (
              <th
                key={`cc-${col.id}`}
                className="hidden md:table-cell w-px px-3 py-2.5 text-left text-[11px] font-normal text-muted-foreground/80 bg-card whitespace-nowrap"
              >
                {col.name}
              </th>
            ))}
            {hasTrailingCol && (
              <th className="hidden md:table-cell w-8 px-1 py-2.5 bg-card">
                {anyElements ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        title="Add column"
                        className="w-6 h-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[200px]">
                      <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Built-in columns
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {ALL_ELEMENT_COLS.map((c) => {
                        const on = elementCols.has(c.id);
                        return (
                          <DropdownMenuItem
                            key={c.id}
                            onSelect={(e) => { e.preventDefault(); toggleCol(c.id); }}
                            className="gap-2 text-[13px]"
                          >
                            <span className="w-4 h-4 inline-flex items-center justify-center text-foreground/70">
                              {on ? <Check size={12} /> : null}
                            </span>
                            <span>{c.label}</span>
                          </DropdownMenuItem>
                        );
                      })}
                      {onAddColumn && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={(e) => { e.preventDefault(); onAddColumn(); }}
                            className="gap-2 text-[13px]"
                          >
                            <span className="w-4 h-4 inline-flex items-center justify-center text-muted-foreground">
                              <Plus size={12} />
                            </span>
                            <span>New tag…</span>
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <button
                    type="button"
                    title="Add column"
                    onClick={onAddColumn}
                    className="w-6 h-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sections.map((section, sectionIndex) => {
            const isCollapsed = collapsed.has(section.id);
            const sectionElements = section.elements ?? [];
            const itemCount = section.objects.length + sectionElements.length;
            return (
              <Fragment key={section.id}>
                {!hideSectionHeaders && (
                  <tr className="group">
                    <td className={`w-7 pl-1 pb-0 ${sectionIndex === 0 ? 'pt-0' : 'pt-1.5'}`}>
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
                    <td colSpan={totalDataColumns + (hasTrailingCol ? 1 : 0) + 1} className={`pr-1 pb-0 ${sectionIndex === 0 ? 'pt-0' : 'pt-1.5'}`}>
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
                {!isCollapsed &&
                  section.objects.map((obj) => {
                    return (
                    <tr
                      key={`obj-${obj.id}`}
                      className="group cursor-pointer leading-[1.4] [&>td]:transition-colors [&:hover>td:not(:first-child):not(:last-child)]:bg-foreground/[0.06] [&>td:nth-child(2)]:rounded-l-lg [&>td:nth-last-child(2)]:rounded-r-lg"
                      onClick={() => onSelectObject(obj.id)}
                    >
                      <td className="w-7 px-1 py-2" />
                      {/* Object icon lives in col 2 — same x-offset as the
                          section header band's icon (which sits in a w-7
                          span at the start of its colspan'd td). Keeps the
                          Object name visually aligned across "Objects only"
                          views and "Elements grouped by Object" views. */}
                      <td className="w-7 px-1 py-2">
                        <div className="flex items-center justify-center text-muted-foreground/70">
                          <ObjectIcon size={14} />
                        </div>
                      </td>
                      <td className="pl-0.5 pr-2 py-2 min-w-0 max-w-0">
                        <div className="flex items-center min-w-0 min-h-[1.625rem]">
                          <span className="text-[13px] font-semibold text-foreground truncate flex-1 min-w-0">
                            {obj.name}
                          </span>
                        </div>
                      </td>
                      {showTypeCol && (
                        <td className="hidden md:table-cell w-px whitespace-nowrap px-2 py-1" onClick={(e) => e.stopPropagation()}>
                          <TypeCell
                            value={obj.type ?? null}
                            types={elementTypes}
                            onChange={onObjectUpdate ? (t) => onObjectUpdate(obj.id, { type: t }) : undefined}
                          />
                        </td>
                      )}
                      {visibleCols.map((c) => (
                        <td key={c.id} className="hidden md:table-cell px-3 py-2 text-muted-foreground/30" />
                      ))}
                      {customColumns.map((col) => {
                        // Domain-scoped columns store values keyed by object_id
                        // and render an editable cell. Element-scoped columns
                        // (object_id set on the column) leave the Object row
                        // empty since the values belong to that Object's
                        // Elements, not to the Object itself.
                        const isObjectScoped = col.domain_id != null;
                        if (!isObjectScoped) {
                          return (
                            <td key={`cc-${col.id}`} className="hidden md:table-cell w-px whitespace-nowrap px-3 py-2 text-muted-foreground/30" />
                          );
                        }
                        const cellValue = col.values?.[obj.id]?.value ?? null;
                        return (
                          <td
                            key={`cc-${col.id}`}
                            className="hidden md:table-cell w-px whitespace-nowrap px-2 py-1"
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
                      })}
                      {hasTrailingCol && (
                        <td className="hidden md:table-cell w-8 px-1 py-2" />
                      )}
                    </tr>
                    );
                  })}
                {!isCollapsed && (
                  <SortableContext
                    items={sectionElements.map((e) => e.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {sectionElements.map((el) => (
                      <ElementRow
                        key={`el-${el.id}`}
                        el={el}
                        isSelected={selectedElementIds?.has(el.id) ?? false}
                        hasSelectionRef={hasSelectionRef}
                        showTypeCol={showTypeCol}
                        elementTypes={elementTypes}
                        visibleCols={visibleCols}
                        customColumns={customColumns}
                        hasTrailingCol={hasTrailingCol}
                        canUpdate={canUpdate}
                        canRowSelect={canRowSelect}
                        onElementUpdate={stableElementUpdate}
                        onSelectElement={stableSelectElement}
                        onRowSelect={stableRowSelect}
                        onCustomColumnValueChange={stableCustomColChange}
                      />
                    ))}
                  </SortableContext>
                )}
                {!isCollapsed && onAddObject && (
                  <tr
                    className="group cursor-pointer [&>td]:transition-colors [&:hover>td:not(:first-child):not(:last-child)]:bg-foreground/[0.06] [&>td:nth-child(2)]:rounded-l-lg [&>td:nth-last-child(2)]:rounded-r-lg"
                    onClick={onAddObject}
                  >
                    <td className="w-7 px-1 py-2" />
                    <td className="w-7 px-1 py-2">
                      <div className="flex items-center justify-center text-muted-foreground">
                        <ObjectIcon size={14} />
                      </div>
                    </td>
                    <td colSpan={totalDataColumns + (hasTrailingCol ? 1 : 0)} className="pl-0.5 pr-2 py-2 min-w-0">
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
  showTypeCol: boolean;
  elementTypes: string[];
  visibleCols: { id: ElementCol; label: string }[];
  customColumns: CustomColumnWithValues[];
  hasTrailingCol: boolean;
  canUpdate: boolean;
  canRowSelect: boolean;
  onElementUpdate: (id: string, updates: ElementUpdate) => void | Promise<void>;
  onSelectElement: (id: string) => void;
  onRowSelect: (id: string, mode: 'single' | 'range' | 'replace') => void;
  onCustomColumnValueChange: (columnId: string, elementId: string, value: Json) => void | Promise<void>;
}

const ElementRow = memo(function ElementRow({
  el, isSelected, hasSelectionRef, showTypeCol, elementTypes, visibleCols,
  customColumns, hasTrailingCol, canUpdate, canRowSelect,
  onElementUpdate, onSelectElement, onRowSelect, onCustomColumnValueChange,
}: ElementRowProps) {
  const isOverdue = el.due_date && new Date(el.due_date) < new Date() && el.status !== 'done';
  const progress = getElementProgress(el, customColumns);
  const upd = canUpdate ? onElementUpdate : undefined;
  // Drag-to-reorder: the whole row is the handle. PointerSensor's distance
  // constraint (set on the DndContext) keeps clicks/selection working — only
  // a real drag moves the row.
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: el.id });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <tr
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      {...listeners}
      className={`group cursor-pointer leading-[1.4] [&>td]:transition-colors [&>td:nth-child(2)]:rounded-l-lg [&>td:nth-last-child(2)]:rounded-r-lg ${
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
          any row is selected / this row is selected. */}
      <td className="w-7 px-1 py-2" onClick={(e) => e.stopPropagation()}>
        {canRowSelect && (
          <button
            type="button"
            aria-label={isSelected ? 'Deselect element' : 'Select element'}
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
      <td className="w-7 px-1 py-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center">
          <PriorityCell element={el} onElementUpdate={upd} />
        </div>
      </td>
      <td className="pl-0.5 pr-2 py-2 min-w-0 max-w-0">
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
      {showTypeCol && (
        <td className="hidden md:table-cell w-px whitespace-nowrap px-2 py-1" onClick={(e) => e.stopPropagation()}>
          <TypeCell
            value={el.type ?? null}
            types={elementTypes}
            onChange={canUpdate ? (t) => onElementUpdate(el.id, { type: t }) : undefined}
          />
        </td>
      )}
      {visibleCols.map((c) => {
        if (c.id === 'due_date') {
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
              {display}
            </button>
          );
          return (
            <td key={c.id} className="hidden md:table-cell w-px whitespace-nowrap px-2 py-1" onClick={(e) => e.stopPropagation()}>
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
        if (c.id === 'assignee') {
          const visible = el.assignees?.slice(0, 3) ?? [];
          const empty = visible.length === 0;
          return (
            <td key={c.id} className="hidden md:table-cell w-32 min-w-[8rem] max-w-[8rem] whitespace-nowrap px-2 py-1">
              <span className={`${CELL_TRIGGER_BASE} ${empty ? CELL_TRIGGER_EMPTY : 'gap-1.5'}`}>
                {empty ? 'Empty' : (
                  <WorkerAvatarStack
                    workers={visible.map((a) => a.worker ?? null)}
                    max={3}
                    size={20}
                  />
                )}
              </span>
            </td>
          );
        }
        return null;
      })}
      {customColumns.map((col) => {
        const cellValue = col.values?.[el.id]?.value ?? null;
        return (
          <td
            key={`cc-${col.id}`}
            className="hidden md:table-cell w-px whitespace-nowrap px-2 py-1"
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
      })}
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

// Type cell — Domain-shared `type` for either an Element or an Object, shown
// as an always-on column. Editable inline when the Domain has types defined
// and an onChange is wired; otherwise the cell renders read-only.
function TypeCell({
  value, types, onChange,
}: {
  value: string | null;
  types: string[];
  onChange?: (next: string | null) => void | Promise<void>;
}) {
  const current = value ?? null;
  const trigger = (
    <button
      type="button"
      disabled={!onChange || types.length === 0}
      className={`${CELL_TRIGGER_BASE} ${current ? '' : 'text-amber-600 dark:text-amber-400'}`}
    >
      {current ?? 'Set type'}
    </button>
  );
  if (!onChange || types.length === 0) return trigger;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={`${CELL_POPOVER_RADIUS} min-w-[160px]`}>
        {types.map((t) => (
          <DropdownMenuItem
            key={t}
            onSelect={() => onChange(t)}
            className="text-[13px] gap-2 rounded-md"
          >
            <span className="flex-1 truncate">{t}</span>
            {t === current && <Check size={12} className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        {current && (
          <DropdownMenuItem
            onSelect={() => onChange(null)}
            className="text-[12px] text-muted-foreground rounded-md"
          >
            Clear
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
