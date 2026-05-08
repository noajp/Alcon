'use client';

import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, GripVertical, Plus, Check } from 'lucide-react';
import type { AlconObjectWithChildren, CustomColumnWithValues, ElementWithDetails } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import { ObjectIcon } from '@/shell/icons';
import { AtomIcon } from '@/alcon/shared/AtomIcon';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu';
import { CustomColumnCell } from '@/alcon/tag/CustomColumnCell';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
];
const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export type ElementUpdate = Partial<Pick<ElementWithDetails, 'status' | 'priority' | 'due_date' | 'title'>>;

const STATUS_COLOR: Record<string, string> = {
  todo: 'text-muted-foreground',
  in_progress: 'text-amber-500',
  review: 'text-blue-500',
  done: 'text-emerald-500',
  blocked: 'text-rose-500',
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-50 text-red-700',
  high: 'bg-amber-50 text-amber-700',
  medium: 'bg-neutral-100 text-neutral-600',
  low: 'bg-neutral-100 text-neutral-400',
};

export interface ListSection {
  id: string;
  name: string;
  objects: AlconObjectWithChildren[];
  elements?: ElementWithDetails[];
}

// Element-specific columns the user can toggle on/off.
export type ElementCol = 'priority' | 'status' | 'due_date' | 'assignee';
const ALL_ELEMENT_COLS: { id: ElementCol; label: string }[] = [
  { id: 'priority', label: 'Priority' },
  { id: 'status', label: 'Status' },
  { id: 'due_date', label: 'Due date' },
  { id: 'assignee', label: 'Assignee' },
];
const DEFAULT_ELEMENT_COLS: ElementCol[] = ['priority', 'status', 'due_date'];

interface ObjectListViewProps {
  sections: ListSection[];
  onSelectObject: (id: string) => void;
  onSelectElement?: (id: string) => void;
  /** When set, renders an "Add Object" footer row inside each section. */
  onAddObject?: () => void;
  /** When set, renders an "Add Element" footer row inside each section. */
  onAddElement?: () => void;
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
      <table className="w-full min-w-max bg-card border-separate border-spacing-0">
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            <th className="w-8 px-1 py-2.5 text-center text-[11px] font-medium text-muted-foreground bg-card" />
            <th className="w-7 px-1 py-2.5 text-center text-[11px] font-medium text-muted-foreground bg-card" />
            <th className="md:min-w-[280px] px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground bg-card">
              Name
            </th>
            {visibleCols.map((c) => (
              <th
                key={c.id}
                className="hidden md:table-cell px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground bg-card whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
            {customColumns.map((col) => (
              <th
                key={`cc-${col.id}`}
                className="hidden md:table-cell px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground bg-card whitespace-nowrap"
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
                    <td className={`w-8 px-1 pb-1.5 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`} />
                    <td colSpan={totalDataColumns + (hasTrailingCol ? 1 : 0) + 1} className={`pb-1.5 pr-3 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`}>
                      <div className="flex items-center gap-2 min-w-0 px-3 py-1.5 bg-muted/50 hover:bg-muted/70 rounded-lg transition-colors">
                        <button
                          type="button"
                          onClick={() => toggle(section.id)}
                          className="size-3.5 shrink-0 flex items-center justify-center"
                          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                        >
                          <ChevronDown
                            size={12}
                            className={`text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle(section.id)}
                          className="text-[13px] font-semibold text-foreground min-w-0 truncate text-left"
                        >
                          {section.name}
                          <span className="ml-1.5 text-muted-foreground/60 font-normal tabular-nums">
                            {itemCount}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {!isCollapsed &&
                  section.objects.map((obj) => (
                    <tr
                      key={`obj-${obj.id}`}
                      className="group cursor-pointer tracking-[-0.3px] leading-[1.4] [&>td]:transition-colors [&:hover>td]:bg-muted/30 [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg"
                      onClick={() => onSelectObject(obj.id)}
                    >
                      <td className="w-8 px-1 py-2">
                        <div className="flex items-center justify-center text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors">
                          <GripVertical size={12} />
                        </div>
                      </td>
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
                            <td key={`cc-${col.id}`} className="hidden md:table-cell px-3 py-2 text-muted-foreground/30" />
                          );
                        }
                        const cellValue = col.values?.[obj.id]?.value ?? null;
                        return (
                          <td
                            key={`cc-${col.id}`}
                            className="hidden md:table-cell px-2 py-1"
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
                    const statusColor = STATUS_COLOR[el.status ?? 'todo'] ?? 'text-muted-foreground';
                    const priorityClass = PRIORITY_BADGE[el.priority ?? 'medium'] ?? PRIORITY_BADGE.medium;
                    const isOverdue = el.due_date && new Date(el.due_date) < new Date() && el.status !== 'done';
                    const isSelected = selectedElementIds?.has(el.id) ?? false;
                    return (
                      <tr
                        key={`el-${el.id}`}
                        className={`group cursor-pointer tracking-[-0.3px] leading-[1.4] [&>td]:transition-colors [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg ${
                          isSelected
                            ? '[&>td]:bg-blue-500/10 [&:hover>td]:bg-blue-500/15'
                            : '[&:hover>td]:bg-muted/30'
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
                        <td className="w-8 px-1 py-2">
                          <div className="flex items-center justify-center text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors">
                            <GripVertical size={12} />
                          </div>
                        </td>
                        <td className="w-7 px-1 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => onElementUpdate?.(el.id, { status: el.status === 'done' ? 'todo' : 'done' })}
                              disabled={!onElementUpdate}
                              title={el.status === 'done' ? 'Mark as todo' : 'Mark as done'}
                              className={`w-4 h-4 rounded-[2px] flex items-center justify-center transition-colors ${
                                el.status === 'done'
                                  ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                                  : 'border border-muted-foreground/20 group-hover:border-muted-foreground/40 hover:bg-muted/40'
                              } ${onElementUpdate ? 'cursor-pointer' : 'cursor-default'}`}
                            >
                              {el.status === 'done' && <Check size={11} strokeWidth={3} />}
                            </button>
                          </div>
                        </td>
                        <td className="pl-1 pr-2 py-2 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem]">
                            <div className="w-3 shrink-0" />
                            <span className={`size-3.5 shrink-0 flex items-center justify-center ${statusColor}`}>
                              <AtomIcon size={14} />
                            </span>
                            <span className="text-[13px] truncate flex-1 min-w-0 text-foreground">
                              {el.title}
                            </span>
                          </div>
                        </td>
                        {visibleCols.map((c) => {
                          if (c.id === 'priority') {
                            const pill = (
                              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${priorityClass}`}>
                                {(el.priority ?? 'medium')}
                              </span>
                            );
                            return (
                              <td key={c.id} className="hidden md:table-cell px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                {onElementUpdate ? (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button type="button" className="hover:opacity-80 transition-opacity">{pill}</button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="min-w-[140px]">
                                      {PRIORITY_OPTIONS.map((opt) => (
                                        <DropdownMenuItem
                                          key={opt.value}
                                          onSelect={() => onElementUpdate(el.id, { priority: opt.value as ElementWithDetails['priority'] })}
                                          className="text-[13px]"
                                        >
                                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${PRIORITY_BADGE[opt.value] ?? PRIORITY_BADGE.medium}`}>
                                            {opt.label}
                                          </span>
                                        </DropdownMenuItem>
                                      ))}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                ) : pill}
                              </td>
                            );
                          }
                          if (c.id === 'status') {
                            const pill = (
                              <span className={`inline-flex items-center gap-1.5 ${statusColor}`}>
                                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                                <span className="text-[11px] capitalize">{(el.status ?? 'todo').replace('_', ' ')}</span>
                              </span>
                            );
                            return (
                              <td key={c.id} className="hidden md:table-cell px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                {onElementUpdate ? (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button type="button" className="hover:opacity-80 transition-opacity">{pill}</button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="min-w-[160px]">
                                      {STATUS_OPTIONS.map((opt) => (
                                        <DropdownMenuItem
                                          key={opt.value}
                                          onSelect={() => onElementUpdate(el.id, { status: opt.value as ElementWithDetails['status'] })}
                                          className="text-[13px] gap-2"
                                        >
                                          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[opt.value] ?? 'text-muted-foreground'} bg-current`} />
                                          <span className="capitalize">{opt.label}</span>
                                        </DropdownMenuItem>
                                      ))}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                ) : pill}
                              </td>
                            );
                          }
                          if (c.id === 'due_date') {
                            const display = el.due_date ? (
                              <span className={`text-[11px] ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                                {new Date(el.due_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground/40">—</span>
                            );
                            return (
                              <td key={c.id} className="hidden md:table-cell px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                {onElementUpdate ? (
                                  <label className="cursor-pointer hover:opacity-80 transition-opacity inline-flex items-center">
                                    {display}
                                    <input
                                      type="date"
                                      value={el.due_date ? el.due_date.slice(0, 10) : ''}
                                      onChange={(e) => onElementUpdate(el.id, { due_date: e.target.value || null })}
                                      className="sr-only"
                                    />
                                  </label>
                                ) : display}
                              </td>
                            );
                          }
                          if (c.id === 'assignee') {
                            const visible = el.assignees?.slice(0, 3) ?? [];
                            return (
                              <td key={c.id} className="hidden md:table-cell px-3 py-2">
                                {visible.length === 0 ? (
                                  <span className="text-[11px] text-muted-foreground/40">—</span>
                                ) : (
                                  <div className="flex -space-x-1.5">
                                    {visible.map((a) => (
                                      <div
                                        key={a.id}
                                        title={a.worker?.name}
                                        className="w-5 h-5 rounded-full bg-muted border border-card flex items-center justify-center text-[9px] font-medium text-muted-foreground"
                                      >
                                        {a.worker?.name?.charAt(0) || '?'}
                                      </div>
                                    ))}
                                  </div>
                                )}
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
                              className="hidden md:table-cell px-2 py-1"
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
                    className="group cursor-pointer [&>td]:transition-colors [&:hover>td]:bg-muted/30 [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg"
                    onClick={onAddObject}
                  >
                    <td className="w-8 px-1 py-2" />
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
                {!isCollapsed && onAddElement && (
                  <tr
                    className="group cursor-pointer [&>td]:transition-colors [&:hover>td]:bg-muted/30 [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg"
                    onClick={onAddElement}
                  >
                    <td className="w-8 px-1 py-2" />
                    <td className="w-7 px-1 py-2" />
                    <td colSpan={totalDataColumns + (hasTrailingCol ? 1 : 0)} className="pl-1 pr-2 py-2 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem] text-muted-foreground">
                        <div className="w-3 shrink-0" />
                        <span className="size-3.5 shrink-0 flex items-center justify-center">
                          <AtomIcon size={14} />
                        </span>
                        <span className="text-[13px] group-hover:text-foreground transition-colors">
                          Add Element
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
