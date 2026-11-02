'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  ChevronDown,
  Plus,

  X,
  Search, CircleDashed, Flag, Tag, UserRound, Box, CalendarDays, Shapes, ArrowDownWideNarrow, ArrowUpNarrowWide, RotateCcw, Play,
} from '@/ui/icons';
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
import { Popover, PopoverTrigger } from '@/ui/popover';
import {
  MenuShell, MenuSectionLabel, MENU_ROW, MENU_SEPARATOR,
} from '@/Function/shared/menu';
import { DueDateFilter } from '@/Function/shared/date';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { CONTROL, PRIORITY_ORDER, STATUS_ORDER } from '@/shared/designTokens';
import type { Worker } from '@/types/database';
import {
  DEFAULT_FILTER,
  hasActiveFilter,
  labelForPriority,
  labelForStatus,
  type ListControlsState,
  type ListDisplay,
  type ListFilter,
  type ListGroupBy,
  type ListOrderBy,
} from './types';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { PriorityMark } from '@/Function/shared/PriorityMark';
import { fieldDisplayLabel } from '@/Function/property/fieldModel';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import { useListColumns, type ColumnId } from '@/Function/shared/listTable/useListColumns';

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
  /** Connects Display Ordering to this view's data columns. Stays in lock-step with the column header's
   *  arrow via the shared useListColumns store. Same key the list passes
   *  to ListTable's `colStorageKey`. */
  sortColumnsStorageKey?: string;
  /** Custom (Property) columns the list view exposes — needed so the Ordering menu
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
// is the Ordering menu's candidate list; `cc:`-prefixed custom Properties are
// appended alongside it for whichever ones the user currently shows as
// columns (see OrderingControl below).
const SORTABLE_ELEMENT_FIELDS: { id: ColumnId; label: string }[] = [
  { id: 'title',     label: 'Title' },
  { id: 'type',      label: 'Type' },
  { id: 'status',    label: 'Status' },
  { id: 'priority',  label: 'Priority' },
  { id: 'due_date',  label: 'Due date' },
  { id: 'created_at', label: 'Created' },
  { id: 'updated_at', label: 'Updated' },
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
  const { t } = useI18n();

  const setFilter = (patch: Partial<ListFilter>) =>
    onChange({ ...state, filter: { ...state.filter, ...patch } });
  const setDisplay = (patch: Partial<ListDisplay>) =>
    onChange({ ...state, display: { ...state.display, ...patch } });

  return (
    <div className="flex items-center gap-1.5">
      {/* Filter */}
      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        {/* Toolbar icons are navigation, not commands: borderless, lit by
            background on hover and while active. Only the triggers — the
            panels they open keep their own controls' outlines. */}
        <ButtonAppearanceProvider appearance="navigation">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={filterActive}
            className={`relative ${filterActive ? 'bg-[var(--surface-strong)] text-[var(--text-primary)]' : ''}`}
            title={t('Filter')}
            aria-label={t('Filter')}
          >
            <FilterBarsIcon size={CONTROL.icon.sm} />
            {filterActive && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </PopoverTrigger>
        </ButtonAppearanceProvider>
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
        <ButtonAppearanceProvider appearance="navigation">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={t('Display options')}
            aria-label={t('Display options')}
          >
            <Grid6Icon size={CONTROL.icon.sm} />
          </Button>
        </PopoverTrigger>
        </ButtonAppearanceProvider>
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
  const { t } = useI18n();
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
            placeholder={t('Search title…')}
            aria-label={t('Search title')}
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
              title={t('Clear')}
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <Submenu icon={<CircleDashed size={15} />} label="Status" count={filter.status?.length ?? 0}>
        {STATUS_ORDER.map((s) => {
          const checked = (filter.status ?? []).includes(s);
          return (
            <MenuCheckRow
              key={s}
              icon={<ElementProgressMark status={s} size={15} />} label={t(labelForStatus(s))}
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

      <Submenu icon={<Flag size={15} />} label="Priority" count={filter.priority?.length ?? 0}>
        {PRIORITY_ORDER.map((p) => {
          const checked = (filter.priority ?? []).includes(p);
          return (
            <MenuCheckRow
              key={p}
              icon={<PriorityMark priority={p} />} label={t(labelForPriority(p))}
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
        <Submenu icon={<Shapes size={15} />} label="Type" count={filter.types?.length ?? 0}>
          {typeOptions.map((type) => {
            const checked = (filter.types ?? []).includes(type);
            return (
              <MenuCheckRow
                key={type}
                label={type}
                checked={checked}
                onClick={() => {
                  const next = new Set(filter.types ?? []);
                  if (checked) next.delete(type); else next.add(type);
                  setFilter({ types: next.size > 0 ? Array.from(next) : undefined });
                }}
              />
            );
          })}
        </Submenu>
      )}

      {labelOptions && labelOptions.length > 0 && (
        <Submenu icon={<Tag size={15} />} label="Labels" count={filter.labels?.length ?? 0}>
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
        <Submenu icon={<UserRound size={15} />} label="Assignee" count={filter.assigneeWorkerIds?.length ?? 0}>
          {workerOptions.map((w) => {
            const checked = (filter.assigneeWorkerIds ?? []).includes(w.id);
            return (
              <MenuCheckRow
                key={w.id}
                label={w.name ?? t('Unknown')}
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
        <Submenu icon={<Box size={15} />} label="Object" count={filter.objectIds?.length ?? 0}>
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
      <Submenu icon={<CalendarDays size={15} />} label="Due date" count={filter.dueFrom || filter.dueTo ? 1 : 0}>
      <DueDateFilter
        value={{ from: filter.dueFrom ?? null, to: filter.dueTo ?? null }}
        onChange={(next) => setFilter({ dueFrom: next.from, dueTo: next.to })}
      />
      </Submenu>

      <button
        type="button"
        onClick={() => setFilter({ readyOnly: !filter.readyOnly })}
        aria-pressed={Boolean(filter.readyOnly)}
        className={`${MENU_ROW} justify-between`}
        title={t('Hide Elements still waiting on an unfinished dependency')}
      >
        <Play size={15} className="text-muted-foreground" /><span className="flex-1">{t('Ready to start')}</span>
        {filter.readyOnly && <Check size={12} className="text-foreground" />}
      </button>

      {showOwnerFilter && (
        <button
          type="button"
          onClick={() => setFilter({ ownerOnly: !filter.ownerOnly })}
          aria-pressed={Boolean(filter.ownerOnly)}
          className={`${MENU_ROW} justify-between`}
        >
          <UserRound size={15} className="text-muted-foreground" /><span className="flex-1">{t('Owned by me only')}</span>
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
            {t('Clear filters')}
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
  const { t } = useI18n();
  const orderingColumns = useListColumns(propertiesStorageKey, propertiesCustom ?? EMPTY_CUSTOM, { entity: propertiesStorageKey === 'domain' ? 'object' : 'element' });
  // If the current grouping isn't an offered option (e.g. 'object' inside a
  // single-Object view where it's hidden), display it as 'No grouping' so the
  // select never shows a dangling value. The underlying list already renders
  // flat in that case.
  const groupByValue = groupOptions.some((o) => o.id === display.groupBy) ? display.groupBy : 'none';
  return (
    <div className="py-1">
      {/* Grouping and Ordering: a quiet label, a select box on the right —
          Linear's Display panel. Ordering carries its direction as the
          arrow button beside the select instead of a row of its own. */}
      <div className="space-y-1 px-1 pb-2">
        <LabeledSelect
          label="Grouping"
          value={groupByValue}
          options={groupOptions.map(option => ({ ...option, label: t(option.label) }))}
          onSelect={(id) => setDisplay({ groupBy: id })}
        />
        {propertiesStorageKey ? <OrderingControl storageKey={propertiesStorageKey} customColumns={propertiesCustom ?? EMPTY_CUSTOM} display={display} setDisplay={setDisplay} /> :
          <LabeledSelect label="Ordering" value={display.orderBy}
            leading={display.orderBy !== 'manual' ? <DirectionToggle direction={display.orderDir} onChange={(orderDir) => setDisplay({ orderDir })} /> : undefined}
            options={ORDER_OPTIONS.map(option => ({ ...option, label: fieldDisplayLabel(t, option) }))} onSelect={(id) => setDisplay({ orderBy: id })} />}
      </div>

      {/* Which properties show — the same store the list header's "+"
          toggles, so the two never disagree. */}
      {propertiesStorageKey ? (
        <PropertiesSection
          storageKey={propertiesStorageKey}
          customColumns={propertiesCustom ?? EMPTY_CUSTOM}
          onAddColumn={onAddColumn}
        />
      ) : displayProperties && displayProperties.options.length > 0 ? (
        <>
          <div className={MENU_SEPARATOR} />
          <div className="px-2 pt-2 pb-1">
            <div className="pb-2 text-[13px] text-muted-foreground">{t('Display properties')}</div>
            <div className="flex flex-wrap gap-1.5">
              {displayProperties.options.map((opt) => (
                <PropertyPill key={opt.id} active={displayProperties.active.has(opt.id)} onClick={() => displayProperties.onToggle(opt.id)}>
                  {t(opt.label)}
                </PropertyPill>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {onReset && (
        <>
          <div className={MENU_SEPARATOR} />
          <button
            type="button"
            onClick={() => { orderingColumns.setSort(null); onReset(); }}
            className={`${MENU_ROW} text-muted-foreground hover:text-foreground`}
          >
            <RotateCcw size={13} />{t('Reset to defaults')}
          </button>
        </>
      )}
    </div>
  );
}

// A label + select row (Linear's Display panel): the label quiet on the
// left, the current choice in a box on the right. `leading` sits just
// before the box (Ordering's direction arrow).
function LabeledSelect<T extends string>({
  label, value, options, onSelect, leading,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onSelect: (id: T) => void;
  leading?: React.ReactNode;
}) {
  const { t } = useI18n();
  const current = options.find((o) => o.id === value);
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 px-1">
      <span className="truncate text-[13px] text-muted-foreground">{t(label)}</span>
      <div className="flex shrink-0 items-center gap-1">
        {leading}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t(label)}
              className="inline-flex h-7 w-36 items-center justify-between gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-strong)] px-2.5 text-[13px] text-foreground transition-colors hover:border-[var(--border-strong)] data-[state=open]:border-[var(--border-strong)]"
            >
              <span className="truncate">{current?.label ?? value}</span>
              <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <MenuShell as="dropdown" align="end">
            {options.map((o) => (
              <DropdownMenuItem key={o.id} onSelect={() => onSelect(o.id)}>
                <span className="flex-1 truncate">{o.label}</span>
                {o.id === value && <Check size={13} className="text-foreground" />}
              </DropdownMenuItem>
            ))}
          </MenuShell>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Ordering's direction, as one arrow button that flips it. */
function DirectionToggle({ direction, onChange }: { direction: 'asc' | 'desc'; onChange: (d: 'asc' | 'desc') => void }) {
  const { t } = useI18n();
  const Icon = direction === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow;
  return (
    <button
      type="button"
      onClick={() => onChange(direction === 'asc' ? 'desc' : 'asc')}
      title={t(direction === 'asc' ? 'Ascending' : 'Descending')}
      aria-label={t(direction === 'asc' ? 'Ascending' : 'Descending')}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--surface-strong)] hover:text-foreground"
    >
      <Icon size={15} />
    </button>
  );
}

/** A display property's on/off pill. On reads as a filled chip, off as its
 *  name alone. */
function PropertyPill({ active, onClick, disabled, children, title }: {
  active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={`inline-flex h-7 max-w-full items-center rounded-full border px-3 text-[13px] transition-colors disabled:opacity-50 ${
        active
          ? 'border-[var(--border-default)] bg-[var(--surface-strong)] text-foreground hover:border-[var(--border-strong)]'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      <span className="truncate">{children}</span>
    </button>
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
  const { t } = useI18n();
  const cols = useListColumns(storageKey, customColumns, { entity: storageKey === 'domain' ? 'object' : 'element' });
  return (
    <>
      <div className={MENU_SEPARATOR} />
      <div className="px-2 pt-2 pb-1">
        <div className="pb-2 text-[13px] text-muted-foreground">{t('Display properties')}</div>
        <div className="flex flex-wrap gap-1.5">
          {cols.allColumns.map((c) => (
            <PropertyPill key={c.id} active={cols.isVisible(c.id)} disabled={!c.toggleable} onClick={() => cols.toggleVisible(c.id)} title={fieldDisplayLabel(t, c)}>
              {fieldDisplayLabel(t, c)}
            </PropertyPill>
          ))}
          {onAddColumn && (
            <button type="button" onClick={onAddColumn}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[var(--border-default)] px-3 text-[13px] text-muted-foreground transition-colors hover:border-[var(--border-strong)] hover:text-foreground">
              <Plus size={13} />{t('Add field')}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// -- Tiny primitives ------------------------------------------------------

function Submenu({ label, count, children, icon }: {
  label: string; count: number; children: React.ReactNode; icon: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className={`${MENU_ROW} justify-between`}
        onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); setOpen(true); } }}>
        <span className="flex items-center gap-2.5"><span className="text-muted-foreground">{icon}</span>{t(label)}</span>
        <span className="flex items-center gap-2">{count > 0 && <span className="text-xs text-muted-foreground">{count}</span>}<ChevronRight size={12} className="text-muted-foreground" /></span>
      </button>
    </PopoverTrigger>
    <MenuShell side="right" align="start" onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); setOpen(false); } }}>
      <MenuSectionLabel>{t(label)}</MenuSectionLabel>
      {children}
    </MenuShell>
  </Popover>;
}

function MenuCheckRow({ label, checked, onClick, icon }: {
  label: string; checked: boolean; onClick: () => void; icon?: React.ReactNode;
}) {
  return <button type="button" onClick={onClick} aria-pressed={checked} className={MENU_ROW}>
    {icon && <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>}
    <span className="flex-1 truncate">{label}</span>
    {checked && <Check size={12} className="text-foreground" />}
  </button>;
}

// Stable empty default for the optional Sort-menu custom columns array, so
// OrderingControl receives a stable empty list when no Properties are passed.
const EMPTY_CUSTOM: CustomColumnWithValues[] = [];

// Ordering uses the same column store as the table header. Legacy display
// ordering remains visible until the user changes it; a new choice clears
// that fallback so there is only one active ordering source.
const ORDER_COLUMN: Record<ListOrderBy, string | null> = {
  manual: null, priority: 'priority', due: 'due_date', created: 'created_at', updated: 'updated_at', title: 'title',
};
function OrderingControl({ storageKey, customColumns, display, setDisplay }: {
  storageKey: string;
  customColumns: CustomColumnWithValues[];
  display: ListDisplay;
  setDisplay: (patch: Partial<ListDisplay>) => void;
}) {
  const { t } = useI18n();
  const cols = useListColumns(storageKey, customColumns, { entity: storageKey === 'domain' ? 'object' : 'element' });
  const legacyId = ORDER_COLUMN[display.orderBy];
  const legacyDirection = display.orderBy === 'priority' ? (display.orderDir === 'asc' ? 'desc' : 'asc') : display.orderDir;
  const active = cols.sort ?? (legacyId ? { id: legacyId, direction: legacyDirection } : null);
  const candidates = [
    ...SORTABLE_ELEMENT_FIELDS.map(field => ({ ...field, label: fieldDisplayLabel(t, field) })),
    ...cols.visibleColumns.filter(c => c.kind === 'custom').map(c => ({ id: c.id, label: c.label })),
  ];
  // Header sorting may name another visible built-in (e.g. Object progress).
  const activeColumn = cols.allColumns.find(c => c.id === active?.id);
  if (activeColumn && !candidates.some(c => c.id === activeColumn.id)) candidates.push({ id: activeColumn.id, label: fieldDisplayLabel(t, activeColumn) });
  const choose = (id: string, direction: 'asc' | 'desc') => {
    cols.setSort(id === 'manual' ? null : { id, direction });
    setDisplay({ orderBy: 'manual', orderDir: direction });
  };
  return <LabeledSelect label="Ordering"
    leading={active ? <DirectionToggle direction={active.direction} onChange={(direction) => choose(active.id, direction)} /> : undefined}
    value={active?.id ?? 'manual'} options={[{ id: 'manual', label: t('Manual') }, ...candidates]}
    onSelect={(id) => choose(id, active?.direction ?? 'asc')} />;
}
