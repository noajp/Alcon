'use client';

import { Fragment, useEffect, useState } from 'react';
import { CalendarIcon, ChevronDown, Plus, Check } from 'lucide-react';
import { AtomIcon } from '@/alcon/shared/AtomIcon';
import type { AlconObjectWithChildren, CustomColumnWithValues, ElementWithDetails } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import { ObjectIcon } from '@/shell/icons';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar } from '@/ui/calendar';
import {
  CustomColumnCell,
  CELL_TRIGGER_BASE,
  CELL_TRIGGER_EMPTY,
  CELL_POPOVER_RADIUS,
} from '@/alcon/tag/CustomColumnCell';
import { getElementProgress } from '@/alcon/shared/ElementProgressMark';
import { StatusPicker } from '@/alcon/element/StatusPicker';

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export type ElementUpdate = Partial<Pick<ElementWithDetails, 'status' | 'priority' | 'due_date' | 'title'>>;

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200/70 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-400/20',
  high: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  medium: 'bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200/70 dark:bg-white/10 dark:text-zinc-300 dark:ring-white/10',
  low: 'bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200/70 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10',
};

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

// Element-specific columns the user can toggle on/off. (Status is shown
// inline by the ○ progress mark in the row, so it isn't a column.)
export type ElementCol = 'priority' | 'due_date' | 'assignee';
const ALL_ELEMENT_COLS: { id: ElementCol; label: string }[] = [
  { id: 'priority', label: 'Priority' },
  { id: 'due_date', label: 'Due date' },
  { id: 'assignee', label: 'Assignee' },
];
const DEFAULT_ELEMENT_COLS: ElementCol[] = ['priority', 'due_date'];

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
  /** Multi-select state: ids of currently selected Elements. */
  selectedElementIds?: Set<string>;
  /** Click handler for an Element row that signals selection intent.
   *  - `single`  : Cmd/Ctrl-click — toggle this id only
   *  - `range`   : Shift-click — extend selection to this id from the
   *    most-recent anchor
   *  - `replace` : plain click while another is already selected —
   *    parent decides (typically clears + selects this) */
  onElementRowSelect?: (elementId: string, mode: 'single' | 'range' | 'replace') => void;
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
  customColumns = [],
  onCustomColumnValueChange,
  onObjectCustomColumnValueChange,
  onAddColumn,
  onElementUpdate,
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
  const visibleCols = anyElements ? ALL_ELEMENT_COLS.filter(c => elementCols.has(c.id)) : [];
  const totalDataColumns = 1 /* name */ + visibleCols.length + customColumns.length;
  // Reserve a trailing "+ add column" slot whenever the parent wires up
  // either Element column toggles (anyElements) or a column-creation
  // handler (onAddColumn — used by the Domain Object list).
  const hasTrailingCol = anyElements || !!onAddColumn;

  return (
    <div className="overflow-x-auto h-full">
      <table className="w-full min-w-max bg-card border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            <th className="w-7 px-1 py-2.5 text-center text-[11px] font-normal text-muted-foreground/80 bg-card" />
            <th className="w-7 px-1 py-2.5 text-center text-[11px] font-normal text-muted-foreground/80 bg-card" />
            <th className="md:min-w-[280px] px-3 py-2.5 text-left text-[11px] font-normal text-muted-foreground/80 bg-card">
              Name
            </th>
            {visibleCols.map((c) => (
              <th
                key={c.id}
                className="hidden md:table-cell w-px px-3 py-2.5 text-left text-[11px] font-normal text-muted-foreground/80 bg-card whitespace-nowrap"
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
                        className="w-5 h-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                      >
                        <Plus size={12} />
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
                    className="w-5 h-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                  >
                    <Plus size={12} />
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
                    <td className={`w-7 px-1 pb-0 ${sectionIndex === 0 ? 'pt-0' : 'pt-1.5'}`}>
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
                    <td colSpan={totalDataColumns + (hasTrailingCol ? 1 : 0) + 1} className={`pb-0 pr-3 ${sectionIndex === 0 ? 'pt-0' : 'pt-1.5'}`}>
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
                        <span className="text-[13px] font-medium text-foreground/95 min-w-0 truncate">
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
                  section.objects.map((obj) => (
                    <tr
                      key={`obj-${obj.id}`}
                      className="group cursor-pointer leading-[1.4] [&>td]:transition-colors [&:hover>td:not(:first-child):not(:last-child)]:bg-muted/30 [&>td:nth-child(2)]:rounded-l-lg [&>td:nth-last-child(2)]:rounded-r-lg"
                      onClick={() => onSelectObject(obj.id)}
                    >
                      <td className="w-7 px-1 py-2" />
                      <td className="w-7 px-1 py-2">
                        <div className="flex items-center justify-center">
                          <div className="w-4 h-4 rounded-[2px] border border-muted-foreground/15 group-hover:border-muted-foreground/30 transition-colors" />
                        </div>
                      </td>
                      <td className="pl-1 pr-2 py-2 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem]">
                          <div className="w-3 shrink-0" />
                          <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground/70">
                            <ObjectIcon size={14} />
                          </span>
                          <span className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">
                            {obj.name}
                          </span>
                        </div>
                      </td>
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
                  ))}
                {!isCollapsed &&
                  sectionElements.map((el) => {
                    const isOverdue = el.due_date && new Date(el.due_date) < new Date() && el.status !== 'done';
                    const isSelected = selectedElementIds?.has(el.id) ?? false;
                    const progress = getElementProgress(el, customColumns);
                    return (
                      <tr
                        key={`el-${el.id}`}
                      className={`group cursor-pointer leading-[1.4] [&>td]:transition-colors [&>td:nth-child(2)]:rounded-l-lg [&>td:nth-last-child(2)]:rounded-r-lg ${
                          isSelected
                            ? '[&>td:not(:first-child):not(:last-child)]:bg-blue-500/10 [&:hover>td:not(:first-child):not(:last-child)]:bg-blue-500/15'
                            : '[&:hover>td:not(:first-child):not(:last-child)]:bg-muted/30'
                        }`}
                        onClick={(e) => {
                          // Shift / Cmd / Ctrl click → row selection (multi-select).
                          // Plain click → open detail (existing).
                          if (onElementRowSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            onElementRowSelect(el.id, e.shiftKey ? 'range' : 'single');
                            return;
                          }
                          // If something is already selected, plain click on
                          // another row replaces selection rather than opening
                          // detail — this matches Linear / Asana muscle memory.
                          if (onElementRowSelect && (selectedElementIds?.size ?? 0) > 0) {
                            onElementRowSelect(el.id, 'replace');
                            return;
                          }
                          onSelectElement?.(el.id);
                        }}
                      >
                        <td className="w-7 px-1 py-2" />
                        <td className="w-7 px-1 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center">
                            <StatusPicker element={el} progress={progress} size={16} />
                          </div>
                        </td>
                        <td className="pl-1 pr-2 py-2 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem]">
                            <div className="w-3 shrink-0" />
                            <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground/70">
                              <AtomIcon size={14} />
                            </span>
                            <span className="text-[13px] truncate flex-1 min-w-0 text-foreground">
                              {el.title}
                            </span>
                          </div>
                        </td>
                        {visibleCols.map((c) => {
                          if (c.id === 'priority') {
                            const current = el.priority ?? null;
                            const trigger = (
                              <button
                                type="button"
                                disabled={!onElementUpdate}
                                className={`${CELL_TRIGGER_BASE} ${current ? '' : CELL_TRIGGER_EMPTY}`}
                              >
                                {current ? (
                                  <span className={`text-[11px] font-medium px-1.5 py-0 rounded-full ${PRIORITY_BADGE[current] ?? PRIORITY_BADGE.medium}`}>
                                    {PRIORITY_OPTIONS.find((opt) => opt.value === current)?.label ?? current}
                                  </span>
                                ) : 'Empty'}
                              </button>
                            );
                            return (
                              <td key={c.id} className="hidden md:table-cell w-px whitespace-nowrap px-2 py-1" onClick={(e) => e.stopPropagation()}>
                                {onElementUpdate ? (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className={`${CELL_POPOVER_RADIUS} min-w-[160px]`}>
                                      {PRIORITY_OPTIONS.map((opt) => {
                                        const sel = opt.value === current;
                                        return (
                                          <DropdownMenuItem
                                            key={opt.value}
                                            onSelect={() => onElementUpdate(el.id, { priority: opt.value as ElementWithDetails['priority'] })}
                                            className="text-[13px] gap-2 rounded-md"
                                          >
                                            <span className={`text-[11px] font-medium px-1.5 py-0 rounded-full ${PRIORITY_BADGE[opt.value] ?? PRIORITY_BADGE.medium}`}>
                                              {opt.label}
                                            </span>
                                            {sel && <Check size={12} className="ml-auto text-muted-foreground" />}
                                          </DropdownMenuItem>
                                        );
                                      })}
                                      {current && (
                                        <DropdownMenuItem
                                          onSelect={() => onElementUpdate(el.id, { priority: null as ElementWithDetails['priority'] })}
                                          className="text-[12px] text-muted-foreground rounded-md"
                                        >
                                          Clear
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                ) : trigger}
                              </td>
                            );
                          }
                          if (c.id === 'due_date') {
                            const dateString = el.due_date ? el.due_date.slice(0, 10) : null;
                            const selected = parseDateOnly(dateString);
                            const display = dateString ? formatDateShort(dateString) : 'Empty';
                            const trigger = (
                              <button
                                type="button"
                                disabled={!onElementUpdate}
                                className={`${CELL_TRIGGER_BASE} gap-1 ${dateString ? (isOverdue ? 'text-red-600' : '') : CELL_TRIGGER_EMPTY}`}
                              >
                                <CalendarIcon size={11} className="opacity-60" />
                                {display}
                              </button>
                            );
                            return (
                              <td key={c.id} className="hidden md:table-cell w-px whitespace-nowrap px-2 py-1" onClick={(e) => e.stopPropagation()}>
                                {onElementUpdate ? (
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
                              <td key={c.id} className="hidden md:table-cell w-px whitespace-nowrap px-2 py-1">
                                <span className={`${CELL_TRIGGER_BASE} ${empty ? CELL_TRIGGER_EMPTY : 'gap-1.5'}`}>
                                  {empty ? 'Empty' : (
                                    <span className="flex -space-x-1.5">
                                      {visible.map((a) => (
                                        <span
                                          key={a.id}
                                          title={a.worker?.name}
                                          className="w-5 h-5 rounded-full bg-muted border border-card flex items-center justify-center text-[9px] font-medium text-muted-foreground"
                                        >
                                          {a.worker?.name?.charAt(0) || '?'}
                                        </span>
                                      ))}
                                    </span>
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
                                onChange={(v) => onCustomColumnValueChange?.(col.id, el.id, v)}
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
                {!isCollapsed && onAddObject && (
                  <tr
                    className="group cursor-pointer [&>td]:transition-colors [&:hover>td:not(:first-child):not(:last-child)]:bg-muted/30 [&>td:nth-child(2)]:rounded-l-lg [&>td:nth-last-child(2)]:rounded-r-lg"
                    onClick={onAddObject}
                  >
                    <td className="w-7 px-1 py-2" />
                    <td className="w-7 px-1 py-2" />
                    <td colSpan={totalDataColumns + (hasTrailingCol ? 1 : 0)} className="pl-1 pr-2 py-2 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem] text-muted-foreground">
                        <div className="w-3 shrink-0" />
                        <span className="size-3.5 shrink-0 flex items-center justify-center">
                          <ObjectIcon size={14} />
                        </span>
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
  );
}
