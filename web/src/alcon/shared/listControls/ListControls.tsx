'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  ChevronDown,
  Plus,
  Tag,
  X,
  Search,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuItem,
} from '@/ui/dropdown-menu';

// 3-bar filter glyph — top longest, middle shorter, bottom shortest.
// Abstracts the classic funnel without pulling in lucide's heavier shape.
function FilterBarsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="2"   y1="4"  x2="12"   y2="4"  />
      <line x1="3.5" y1="7"  x2="10.5" y2="7"  />
      <line x1="5"   y1="10" x2="9"    y2="10" />
    </svg>
  );
}

// 2 × 2 grid (4 cells) — square overall. Represents the Display /
// Grouping affordance: items bucketed into quadrants.
function Grid6Icon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="1.5" y="1.5" width="5" height="5" rx="0.8" />
      <rect x="7.5" y="1.5" width="5" height="5" rx="0.8" />
      <rect x="1.5" y="7.5" width="5" height="5" rx="0.8" />
      <rect x="7.5" y="7.5" width="5" height="5" rx="0.8" />
    </svg>
  );
}
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Popover, PopoverTrigger } from '@/ui/popover';
import {
  MenuShell, MenuSectionLabel, MENU_ROW, MENU_SEPARATOR,
} from '@/alcon/shared/menu';
import { DueDateFilter } from '@/alcon/shared/date';
import { Button } from '@/ui/button';
import { CONTROL } from '@/shared/designTokens';
import type { Worker } from '@/types/database';
import {
  DEFAULT_FILTER,
  DEFAULT_DISPLAY,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  hasActiveFilter,
  labelForPriority,
  labelForStatus,
  type ListControlsState,
  type ListDisplay,
  type ListFilter,
  type ListGroupBy,
  type ListOrderBy,
} from './types';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import { useListColumns, type ColumnId } from '@/alcon/object/useListColumns';

// Two pill buttons at the top of a list view. The Filter button opens a
// menu of filter facets; the Display button opens grouping / ordering /
// closed-toggle / display-property toggles. Active filters show a dot on
// the Filter button.

export interface DisplayPropertiesAPI<TPropKey extends string> {
  options: { id: TPropKey; label: string }[];
  active: Set<TPropKey>;
  onToggle: (id: TPropKey) => void;
}

interface ListControlsProps {
  state: ListControlsState;
  onChange: (next: ListControlsState) => void;
  /** Element `type` options (from the active Domain catalogue). */
  typeOptions?: string[];
  /** Free-form labels currently present in the visible Elements; powers
   *  the Labels multi-select. Computed by the caller from the dataset. */
  labelOptions?: string[];
  /** Workers shown in the Assignee filter. */
  workerOptions?: Worker[];
  /** Specific-Object filter options. Empty / undefined hides the section. */
  objectOptions?: { id: string; name: string }[];
  /** Disable / hide owner-only toggle (e.g. Domain Elements view doesn't
   *  surface personal Elements at all). */
  showOwnerFilter?: boolean;
  /** Display-properties toggles. Passed straight through to the panel. */
  displayProperties?: DisplayPropertiesAPI<string>;
  /** Reset both filter + display back to defaults. */
  onReset?: () => void;
  /** Label for the `groupBy='none'` pill. Defaults to "No grouping" but
   *  the Domain Elements view passes "By parent" since 'none' there
   *  preserves the natural Domain → Object header structure. */
  groupNoneLabel?: string;
  /** When set, renders a Sort button to the left of Filter that lists this
   *  view's data columns. Stays in lock-step with the column header's
   *  arrow via the shared useListColumns store. Same key the list passes
   *  to ListTable's `colStorageKey`. */
  sortColumnsStorageKey?: string;
  /** Custom (Property) columns the list view exposes — needed so the Sort menu
   *  surfaces them alongside built-ins. */
  sortColumnsCustom?: CustomColumnWithValues[];
  /** Open the Add-Property modal from the Display panel's Properties "+"
   *  button. */
  onAddColumn?: () => void;
  /** Hide the "Objects" grouping option (e.g. inside a single Object's
   *  Elements tab, where grouping by Object is redundant — you're already
   *  scoped to one). */
  hideObjectGrouping?: boolean;
}

const ORDER_OPTIONS: { id: ListOrderBy; label: string }[] = [
  { id: 'manual',   label: 'Manual' },
  { id: 'priority', label: 'Priority' },
  { id: 'due',      label: 'Due date' },
  { id: 'created',  label: 'Created' },
  { id: 'updated',  label: 'Updated' },
  { id: 'title',    label: 'Title' },
];

// Sort axes are independent of which columns the user has chosen to display
// (Type / Due date / Assignee are the only real "columns"; Priority, Status,
// Title, and Created live inline on every row already). This fixed catalogue
// is the Sort menu's candidate list; `cc:`-prefixed custom Properties are
// appended alongside it for whichever ones the user currently shows as
// columns (see SortMenu below).
const SORTABLE_ELEMENT_FIELDS: { id: ColumnId; label: string }[] = [
  { id: 'title',     label: 'Title' },
  { id: 'type',      label: 'Type' },
  { id: 'status',    label: 'Status' },
  { id: 'priority',  label: 'Priority' },
  { id: 'due_date',  label: 'Due date' },
  { id: 'created_at', label: 'Created' },
  { id: 'assignee',  label: 'Assignee' },
];

const GROUP_OPTIONS_BASE: { id: ListGroupBy; label: string }[] = [
  { id: 'none',       label: 'No grouping' },
  { id: 'object',     label: 'Objects' },
  { id: 'status',     label: 'Status' },
  { id: 'priority',   label: 'Priority' },
  { id: 'assignee',   label: 'Assignee' },
  { id: 'type',       label: 'Type' },
  { id: 'label',      label: 'Label' },
  { id: 'date_week',  label: 'Due — by week' },
  { id: 'date_month', label: 'Due — by month' },
];

function buildGroupOptions(noneLabel?: string): typeof GROUP_OPTIONS_BASE {
  if (!noneLabel) return GROUP_OPTIONS_BASE;
  return GROUP_OPTIONS_BASE.map((o) => (o.id === 'none' ? { ...o, label: noneLabel } : o));
}

export function ListControls({
  state,
  onChange,
  typeOptions,
  labelOptions,
  workerOptions,
  objectOptions,
  showOwnerFilter,
  displayProperties,
  onReset,
  groupNoneLabel,
  sortColumnsStorageKey,
  sortColumnsCustom,
  onAddColumn,
  hideObjectGrouping,
}: ListControlsProps) {
  const groupOptions = useMemo(() => {
    const opts = buildGroupOptions(groupNoneLabel);
    return hideObjectGrouping ? opts.filter((o) => o.id !== 'object') : opts;
  }, [groupNoneLabel, hideObjectGrouping]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const filterActive = hasActiveFilter(state.filter);

  const setFilter = (patch: Partial<ListFilter>) =>
    onChange({ ...state, filter: { ...state.filter, ...patch } });
  const setDisplay = (patch: Partial<ListDisplay>) =>
    onChange({ ...state, display: { ...state.display, ...patch } });

  return (
    <div className="flex items-center gap-1.5">
      {/* Sort — only rendered when the host wires up a column storage key */}
      {sortColumnsStorageKey && (
        <SortMenu
          storageKey={sortColumnsStorageKey}
          customColumns={sortColumnsCustom ?? EMPTY_CUSTOM}
        />
      )}

      {/* Filter */}
      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={filterActive}
            className={`relative ${filterActive ? 'bg-[var(--surface-strong)] text-[var(--text-primary)]' : ''}`}
            title="Filter"
            aria-label="Filter"
          >
            <FilterBarsIcon size={CONTROL.icon.sm} />
            {filterActive && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-500" />
            )}
          </Button>
        </PopoverTrigger>
        <MenuShell align="end" width="wide">
          <FilterPanel
            filter={state.filter}
            setFilter={setFilter}
            typeOptions={typeOptions}
            labelOptions={labelOptions}
            workerOptions={workerOptions}
            objectOptions={objectOptions}
            showOwnerFilter={showOwnerFilter}
          />
        </MenuShell>
      </Popover>

      {/* Display */}
      <Popover open={displayOpen} onOpenChange={setDisplayOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Display options"
            aria-label="Display options"
          >
            <Grid6Icon size={CONTROL.icon.sm} />
          </Button>
        </PopoverTrigger>
        <MenuShell align="end" width="wide">
          <DisplayPanel
            display={state.display}
            setDisplay={setDisplay}
            displayProperties={displayProperties}
            onReset={onReset}
            groupOptions={groupOptions}
            propertiesStorageKey={sortColumnsStorageKey}
            propertiesCustom={sortColumnsCustom}
            onAddColumn={onAddColumn}
          />
        </MenuShell>
      </Popover>
    </div>
  );
}

// -- Filter panel ---------------------------------------------------------

function FilterPanel({
  filter,
  setFilter,
  typeOptions,
  labelOptions,
  workerOptions,
  objectOptions,
  showOwnerFilter,
}: {
  filter: ListFilter;
  setFilter: (patch: Partial<ListFilter>) => void;
  typeOptions?: string[];
  labelOptions?: string[];
  workerOptions?: Worker[];
  objectOptions?: { id: string; name: string }[];
  showOwnerFilter?: boolean;
}) {
  const [query, setQuery] = useState(filter.query ?? '');
  useEffect(() => setQuery(filter.query ?? ''), [filter.query]);

  return (
    <div>
      <div className="px-2 pb-2">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50">
          <Search size={12} className="text-muted-foreground" />
          <input
            type="text"
            value={query}
            placeholder="Search title…"
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => setFilter({ query })}
            onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ query }); }}
            className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/60"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setFilter({ query: '' }); }}
              className="text-muted-foreground hover:text-foreground"
              title="Clear"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <Submenu label="Status" count={filter.status?.length ?? 0}>
        {STATUS_OPTIONS.map((s) => {
          const checked = (filter.status ?? []).includes(s);
          return (
            <MenuCheckRow
              key={s}
              label={labelForStatus(s)}
              checked={checked}
              onClick={() => {
                const next = new Set(filter.status ?? []);
                if (checked) next.delete(s); else next.add(s);
                setFilter({ status: next.size > 0 ? Array.from(next) : undefined });
              }}
            />
          );
        })}
      </Submenu>

      <Submenu label="Priority" count={filter.priority?.length ?? 0}>
        {PRIORITY_OPTIONS.map((p) => {
          const checked = (filter.priority ?? []).includes(p);
          return (
            <MenuCheckRow
              key={p}
              label={labelForPriority(p)}
              checked={checked}
              onClick={() => {
                const next = new Set(filter.priority ?? []);
                if (checked) next.delete(p); else next.add(p);
                setFilter({ priority: next.size > 0 ? Array.from(next) : undefined });
              }}
            />
          );
        })}
      </Submenu>

      {typeOptions && typeOptions.length > 0 && (
        <Submenu label="Type" count={filter.types?.length ?? 0}>
          {typeOptions.map((t) => {
            const checked = (filter.types ?? []).includes(t);
            return (
              <MenuCheckRow
                key={t}
                label={t}
                checked={checked}
                onClick={() => {
                  const next = new Set(filter.types ?? []);
                  if (checked) next.delete(t); else next.add(t);
                  setFilter({ types: next.size > 0 ? Array.from(next) : undefined });
                }}
              />
            );
          })}
        </Submenu>
      )}

      {labelOptions && labelOptions.length > 0 && (
        <Submenu label="Labels" count={filter.labels?.length ?? 0}>
          {labelOptions.map((l) => {
            const checked = (filter.labels ?? []).includes(l);
            return (
              <MenuCheckRow
                key={l}
                label={l}
                checked={checked}
                onClick={() => {
                  const next = new Set(filter.labels ?? []);
                  if (checked) next.delete(l); else next.add(l);
                  setFilter({ labels: next.size > 0 ? Array.from(next) : undefined });
                }}
              />
            );
          })}
        </Submenu>
      )}

      {workerOptions && workerOptions.length > 0 && (
        <Submenu label="Assignee" count={filter.assigneeWorkerIds?.length ?? 0}>
          {workerOptions.map((w) => {
            const checked = (filter.assigneeWorkerIds ?? []).includes(w.id);
            return (
              <MenuCheckRow
                key={w.id}
                label={w.name ?? 'Unknown'}
                checked={checked}
                onClick={() => {
                  const next = new Set(filter.assigneeWorkerIds ?? []);
                  if (checked) next.delete(w.id); else next.add(w.id);
                  setFilter({ assigneeWorkerIds: next.size > 0 ? Array.from(next) : undefined });
                }}
              />
            );
          })}
        </Submenu>
      )}

      {objectOptions && objectOptions.length > 0 && (
        <Submenu label="Object" count={filter.objectIds?.length ?? 0}>
          {objectOptions.map((o) => {
            const checked = (filter.objectIds ?? []).includes(o.id);
            return (
              <MenuCheckRow
                key={o.id}
                label={o.name}
                checked={checked}
                onClick={() => {
                  const next = new Set(filter.objectIds ?? []);
                  if (checked) next.delete(o.id); else next.add(o.id);
                  setFilter({ objectIds: next.size > 0 ? Array.from(next) : undefined });
                }}
              />
            );
          })}
        </Submenu>
      )}

      <div className={MENU_SEPARATOR} />
      <MenuSectionLabel>Due date</MenuSectionLabel>
      <DueDateFilter
        value={{ from: filter.dueFrom ?? null, to: filter.dueTo ?? null }}
        onChange={(next) => setFilter({ dueFrom: next.from, dueTo: next.to })}
      />

      {showOwnerFilter && (
        <button
          type="button"
          onClick={() => setFilter({ ownerOnly: !filter.ownerOnly })}
          className={`${MENU_ROW} justify-between`}
        >
          <span>Owned by me only</span>
          {filter.ownerOnly && <Check size={12} className="text-foreground" />}
        </button>
      )}

      {hasActiveFilter(filter) && (
        <>
          <div className={MENU_SEPARATOR} />
          <button
            type="button"
            onClick={() => {
              // Wipe the whole filter back to defaults; keep display.
              setFilter({ ...DEFAULT_FILTER });
              setQuery('');
            }}
            className={`${MENU_ROW} justify-center text-destructive hover:bg-destructive/10`}
          >
            Clear filters
          </button>
        </>
      )}
    </div>
  );
}

// -- Display panel --------------------------------------------------------

function DisplayPanel({
  display,
  setDisplay,
  displayProperties,
  onReset,
  groupOptions,
  propertiesStorageKey,
  propertiesCustom,
  onAddColumn,
}: {
  display: ListDisplay;
  setDisplay: (patch: Partial<ListDisplay>) => void;
  displayProperties?: DisplayPropertiesAPI<string>;
  onReset?: () => void;
  groupOptions: { id: ListGroupBy; label: string }[];
  propertiesStorageKey?: string;
  propertiesCustom?: CustomColumnWithValues[];
  onAddColumn?: () => void;
}) {
  // If the current grouping isn't an offered option (e.g. 'object' inside a
  // single-Object view where it's hidden), display it as 'No grouping' so the
  // select never shows a dangling value. The underlying list already renders
  // flat in that case.
  const groupByValue = groupOptions.some((o) => o.id === display.groupBy) ? display.groupBy : 'none';
  return (
    <div>
      {/* Grouping + Ordering as Linear-style labelled dropdowns. */}
      <LabeledSelect
        label="Grouping"
        value={groupByValue}
        options={groupOptions}
        onSelect={(id) => setDisplay({ groupBy: id })}
      />
      <LabeledSelect
        label="Ordering"
        value={display.orderBy}
        options={ORDER_OPTIONS}
        onSelect={(id) => setDisplay({ orderBy: id })}
      />

      {/* Properties — which data columns show. Driven by the same shared
          column store the list header uses, so toggles here and in the
          header stay in sync. The "+" adds a new Property. */}
      {propertiesStorageKey ? (
        <PropertiesSection
          storageKey={propertiesStorageKey}
          customColumns={propertiesCustom ?? EMPTY_CUSTOM}
          onAddColumn={onAddColumn}
        />
      ) : displayProperties && displayProperties.options.length > 0 ? (
        <>
          <div className={MENU_SEPARATOR} />
          <MenuSectionLabel>Properties</MenuSectionLabel>
          <div className="px-2 pb-2 flex flex-wrap gap-1.5">
            {displayProperties.options.map((opt) => {
              const active = displayProperties.active.has(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => displayProperties.onToggle(opt.id)}
                  className={`px-2 py-1 text-[12px] rounded-full transition-colors border ${
                    active
                      ? 'bg-muted text-foreground border-border'
                      : 'bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {onReset && (
        <>
          <div className={MENU_SEPARATOR} />
          <button
            type="button"
            onClick={onReset}
            className={`${MENU_ROW} justify-center text-muted-foreground hover:text-foreground`}
          >
            Reset to defaults
          </button>
        </>
      )}
    </div>
  );
}

// A label + dropdown-select row (Linear's Display menu pattern).
function LabeledSelect<T extends string>({
  label, value, options, onSelect,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onSelect: (id: T) => void;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <div className={`${MENU_ROW} justify-between hover:bg-transparent`}>
      <span className="text-[13px] text-foreground">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12.5px] text-foreground hover:bg-muted/60 transition-colors"
          >
            <span>{current?.label ?? value}</span>
            <ChevronDown size={13} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <MenuShell as="dropdown" align="end">
          {options.map((o) => (
            <DropdownMenuItem
              key={o.id}
              onSelect={() => onSelect(o.id)}
              className="gap-2 text-[13px]"
            >
              <span className="w-4 inline-flex justify-center">
                {o.id === value && <Check size={12} className="text-foreground" />}
              </span>
              <span className="flex-1">{o.label}</span>
            </DropdownMenuItem>
          ))}
        </MenuShell>
      </DropdownMenu>
    </div>
  );
}

// Properties section — toggle which data columns are visible, plus a "+"
// that opens the Add-Property modal. Reads/writes the shared useListColumns
// store (keyed by storageKey), so it mirrors the list header's column menu.
function PropertiesSection({
  storageKey, customColumns, onAddColumn,
}: {
  storageKey: string;
  customColumns: CustomColumnWithValues[];
  onAddColumn?: () => void;
}) {
  const cols = useListColumns(storageKey, customColumns);
  return (
    <>
      <div className={MENU_SEPARATOR} />
      <MenuSectionLabel>Properties</MenuSectionLabel>
      <div className="px-2 pb-2 flex flex-wrap gap-1.5">
        {cols.allColumns.map((c) => {
          const on = cols.isVisible(c.id);
          const locked = !c.toggleable;
          return (
            <button
              key={c.id}
              type="button"
              disabled={locked}
              onClick={() => { if (!locked) cols.toggleVisible(c.id); }}
              className={`inline-flex items-center gap-1 px-2 py-1 text-[12px] rounded-full transition-colors border ${
                on
                  ? 'bg-muted text-foreground border-border'
                  : 'bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground'
              } ${locked ? 'opacity-60 cursor-default' : ''}`}
            >
              {c.kind === 'custom' && <Tag size={10} className="text-muted-foreground/70" />}
              {c.label}
            </button>
          );
        })}
        {onAddColumn && (
          <button
            type="button"
            onClick={onAddColumn}
            title="Add property"
            aria-label="Add property"
            className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            <Plus size={13} />
          </button>
        )}
      </div>
    </>
  );
}

// -- Tiny primitives ------------------------------------------------------

function Submenu({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${MENU_ROW} justify-between`}
      >
        <span className="flex items-center gap-2">
          {label}
          {count > 0 && (
            <span className="text-[11px] text-muted-foreground">{count}</span>
          )}
        </span>
        <ChevronRight size={12} className={`text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

function MenuCheckRow({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${MENU_ROW} justify-between pl-7`}
    >
      <span className="truncate">{label}</span>
      {checked && <Check size={11} className="text-foreground" />}
    </button>
  );
}

// Stable empty default for the optional Sort-menu custom columns array, so
// SortMenu's parent doesn't re-render every tick when no Properties are passed.
const EMPTY_CUSTOM: CustomColumnWithValues[] = [];

// -- Sort menu ------------------------------------------------------------
// Mirrors the column header's sort arrow but driven from the toolbar.
// Reads / writes the same shared store (keyed by storageKey) so picking a
// sort here updates the matching column's arrow instantly, and vice versa.

function SortMenu({
  storageKey,
  customColumns,
}: {
  storageKey: string;
  customColumns: CustomColumnWithValues[];
}) {
  const cols = useListColumns(storageKey, customColumns);
  const [open, setOpen] = useState(false);
  const active = cols.sort;
  const ActiveIcon = active
    ? (active.direction === 'asc' ? ArrowUp : ArrowDown)
    : ArrowUpDown;
  // Sort candidates = the fixed field catalogue (independent of which
  // columns are on-screen) plus whichever custom Properties the user
  // currently shows as columns — those still need a visible column to make
  // their values legible while sorting by them.
  const sortCandidates = useMemo<{ id: ColumnId; label: string }[]>(() => {
    const customVisible = cols.visibleColumns.filter((c) => c.kind === 'custom');
    return [...SORTABLE_ELEMENT_FIELDS, ...customVisible.map((c) => ({ id: c.id, label: c.label }))];
  }, [cols.visibleColumns]);
  const activeLabel = active
    ? sortCandidates.find((c) => c.id === active.id)?.label ?? null
    : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* The trigger states the current sort in words. It used to be a bare
            26px arrow whose only account of itself was a `title` attribute
            reading "Sorted by column (asc)" — which does not even name the
            column, so the sort order was unknowable without opening the menu
            (DESIGN.md §5.11.5). Unsorted, it stays an icon-only square of the
            same step, so the toolbar does not jump when a sort is cleared. */}
        <Button
          type="button"
          variant="ghost"
          size={active ? 'sm' : 'icon-sm'}
          align="start"
          aria-pressed={Boolean(active)}
          className={active ? 'bg-[var(--surface-strong)] text-[var(--text-primary)]' : ''}
          title={activeLabel ? `Sorted by ${activeLabel}, ${active!.direction === 'asc' ? 'ascending' : 'descending'}` : 'Sort'}
          aria-label={activeLabel ? `Sorted by ${activeLabel}` : 'Sort'}
        >
          <ActiveIcon size={CONTROL.icon.sm} />
          {activeLabel ? <span className="truncate max-w-[120px]">{activeLabel}</span> : null}
        </Button>
      </PopoverTrigger>
      <MenuShell align="end">
        <div>
          <MenuSectionLabel>Sort by</MenuSectionLabel>
          {sortCandidates.length === 0 && (
            <div className="px-2 pb-2 text-[12px] text-muted-foreground/70">
              No columns to sort by.
            </div>
          )}
          {sortCandidates.map((col) => {
            const isActive = active?.id === col.id;
            const dir = isActive ? active!.direction : null;
            return (
              <div
                key={col.id}
                className={`${MENU_ROW} gap-1 hover:bg-transparent ${
                  isActive ? 'text-foreground' : 'text-foreground/90'
                }`}
              >
                <button
                  type="button"
                  onClick={() => cols.cycleSort(col.id)}
                  className="flex-1 min-w-0 text-left truncate hover:text-foreground transition-colors"
                  title={
                    dir === 'asc'  ? `Sorting by ${col.label} — ascending. Click for descending.` :
                    dir === 'desc' ? `Sorting by ${col.label} — descending. Click to clear.` :
                    `Sort by ${col.label}`
                  }
                >
                  {col.label}
                </button>
                <DirButton
                  active={dir === 'asc'}
                  onClick={() => cols.setSort(dir === 'asc' ? null : { id: col.id, direction: 'asc' })}
                  Icon={ArrowUp}
                  label={`Sort ${col.label} ascending`}
                />
                <DirButton
                  active={dir === 'desc'}
                  onClick={() => cols.setSort(dir === 'desc' ? null : { id: col.id, direction: 'desc' })}
                  Icon={ArrowDown}
                  label={`Sort ${col.label} descending`}
                />
              </div>
            );
          })}
          {active && (
            <>
              <div className={MENU_SEPARATOR} />
              <button
                type="button"
                onClick={() => cols.setSort(null)}
                className={`${MENU_ROW} justify-center text-muted-foreground hover:text-foreground`}
              >
                Clear sort
              </button>
            </>
          )}
        </div>
      </MenuShell>
    </Popover>
  );
}

function DirButton({
  active, onClick, Icon, label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof ArrowUp;
  label: string;
}) {
  // The row-inner step (24px). It used to be a 20px box with `rounded` (4px)
  // sitting inside menu rows whose every other corner is 6px — the mismatch is
  // small enough to read as sloppiness rather than as a decision.
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={active ? 'bg-[var(--surface-strong)] text-[var(--text-primary)]' : ''}
    >
      <Icon size={CONTROL.icon.xs} />
    </Button>
  );
}

// Re-export for convenience.
export { DEFAULT_DISPLAY, DEFAULT_FILTER };
export type { ListControlsState, ListDisplay, ListFilter, ListGroupBy, ListOrderBy };
