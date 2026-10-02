'use client';

import { parseDateOnly, toDateOnlyString as formatDateOnly } from '@/Function/shared/dateUtils';
import { ActivitySignal } from '@/ActivitySpace/execution/element/ActivitySignal';
import { Button } from '@/ui/button';
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarIcon, Menu, Plus, Check, Tag, X } from 'lucide-react';
import type { AlconObjectWithChildren, ElementWithDetails, Worker } from '@/hooks/useSupabase';
import { addElementAssignee, removeElementAssignee, fetchAssignableWorkers, useWorkerById } from '@/hooks/useSupabase';
import { AssigneeMenuContent } from '@/Function/shared/AssigneeMenu';
import type { Json } from '@/types/database';
import { ObjectIcon } from '@/shell/icons';
import { ReachHint, WorkerAvatar, WorkerAvatarStack } from '@/Function/shared/WorkerAvatar';
import { workerTriggerLabel } from '@/Function/shared/workerReach';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { labelColor, useLabelColors } from '@/Function/shared/labelColor';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import { CustomColumnCell, CellText, EmptyCellMark, CELL_TRIGGER_BASE, CELL_TRIGGER_EMPTY, CELL_POPOVER_RADIUS } from '@/Function/property/CustomColumnCell';
import { PriorityMark } from '@/Function/shared/PriorityMark';
import { PriorityPicker } from '@/Function/shared/PriorityPicker';
import { StatusPicker } from '@/ActivitySpace/execution/element/StatusPicker';
import { type DataColumn } from '@/ActivitySpace/execution/object/useListColumns';
import { type ElementUpdate, formatDateShort } from './shared';
import { completionOf } from '@/Function/shared/completion';

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
  // design-lint-ignore — preserve existing user-selectable type presets during extraction.
  { label: 'General',        types: ['Task', 'Issue', 'Customer', 'Bug', 'Feature', 'Story', 'Epic', 'Goal', 'Risk', 'Note'] },
  { label: 'Project Office', types: ['Project', 'Deliverable', 'Milestone', 'Risk', 'Issue', 'Change Request', 'Action Item', 'Decision', 'Stakeholder', 'Resource'] },
  { label: 'CRM',            types: ['Lead', 'Contact', 'Account', 'Opportunity', 'Deal', 'Customer', 'Ticket', 'Initiative', 'Activity', 'Quote'] },
  { label: 'SCM',            types: ['Order', 'Shipment', 'Supplier', 'Inventory', 'SKU', 'Purchase Order', 'Warehouse', 'Lot', 'Delivery', 'Forecast'] },
  // design-lint-ignore — preserve existing user-selectable type presets during extraction.
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
  // Fire both without waiting on the round trip — matches the plain
  // catalogue-chip click below, which never awaited onChange either. The
  // popover closing is a receipt for the click, not for the write; awaiting
  // both writes in sequence here (register the type, then assign it) meant
  // the popover sat open through two full write+refetch round trips before
  // the cell ever moved.
  const pickPreset = (name: string) => {
    if (onAddType && !types.includes(name)) void onAddType(name);
    void onChange?.(name);
    setOpen(false);
  };

  const trigger = (
    <button
      type="button"
      disabled={!canEdit}
      className={`${CELL_TRIGGER_BASE} ${current ? '' : CELL_TRIGGER_EMPTY}`}
    >
      <CellText>{current ?? 'Set type'}</CellText>
    </button>
  );
  // Read-only (no editor) when there's nothing to pick and no way to add.
  if (!canEdit || (types.length === 0 && !onAddType)) return trigger;

  const submitNew = () => {
    const name = draft.trim();
    setAdding(false);
    setDraft('');
    if (!name) return;
    if (onAddType) void onAddType(name);
    const normalized = name.charAt(0).toUpperCase() + name.slice(1);
    void onChange?.(normalized);
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
                        : 'bg-transparent text-muted-foreground border-[var(--border-strong)] hover:border-[var(--border-strong)] hover:text-foreground'
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
                      : 'bg-transparent text-muted-foreground border-[var(--border-strong)] hover:border-[var(--border-strong)] hover:text-foreground'
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
              else if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setDraft(''); }
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
  const weekStartsOn = usePreference(getCachedWeekStartsOn);

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
          weekStartsOn={weekStartsOn}
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
export function LabelChip({ label }: { label: string }) {
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

// (ColumnMenu removed — the trailing header "+" now opens the add-property
// picker directly. Column show/hide lives in the list's Display menu.)

// Body cell for an Element row, switched on column kind/id.
export function ElementCell({
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
        className="table-cell px-1.5 py-1 max-w-0 overflow-hidden"
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
  if (column.id === 'activity') {
    return <td className="table-cell px-2 py-1"><ActivitySignal activity={el.activity} /></td>;
  }
  if (column.id === 'labels') {
    return <td className="table-cell px-2 py-1"><div className="flex gap-1 overflow-hidden">{(el.labels ?? []).map((label) => <LabelChip key={label} label={label} />)}</div></td>;
  }
  if (column.id === 'priority') {
    return <td className="table-cell px-2 py-1" onClick={(e) => e.stopPropagation()}><PriorityCell element={el} onElementUpdate={canUpdate ? onElementUpdate : undefined} /></td>;
  }
  if (column.id === 'status') {
    return <td className="table-cell px-2 py-1" onClick={(e) => e.stopPropagation()}>{canUpdate ? <StatusPicker element={el} onChanged={() => { void onRefresh?.(); }} trigger={<Button variant="ghost" size="xs">{(el.status ?? 'todo').replaceAll('_', ' ')}</Button>} /> : (el.status ?? 'todo').replaceAll('_', ' ')}</td>;
  }
  if (column.id === 'type') {
    return (
      <td
        className="table-cell px-1.5 py-1 max-w-0 overflow-hidden"
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
      <td className="table-cell px-1.5 py-1 max-w-0 overflow-hidden">
        {empty ? (
          <span className={`${CELL_TRIGGER_BASE} ${CELL_TRIGGER_EMPTY}`}><EmptyCellMark /></span>
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
    const display = dateString ? formatDateShort(dateString) : null;
    const trigger = (
      <button
        type="button"
        disabled={!canUpdate}
        className={`${CELL_TRIGGER_BASE} gap-1 ${dateString ? (isOverdue ? 'text-[var(--status-danger)]' : '') : CELL_TRIGGER_EMPTY}`}
      >
        {display ? <><CalendarIcon size={11} className="opacity-60" /><CellText>{display}</CellText></> : <EmptyCellMark />}
      </button>
    );
    return (
      <td
        className="table-cell px-1.5 py-1 max-w-0 overflow-hidden"
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
        className="table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <AssigneeCell el={el} canUpdate={canUpdate} onRefresh={onRefresh} />
      </td>
    );
  }
  return <td className="table-cell" />;
}

// Assignee cell — click opens a worker picker (the shared AssigneeMenuContent).
// Reads the current set from el.assignees; add/remove write element_assignees
// directly, then onRefresh reloads the row so the chips reflect the new set.
// Read-only (plain chips, no dropdown) when canUpdate is false or onRefresh
// isn't wired. The Workers assignable to this Element are fetched lazily on
// first open.
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
      {empty ? <EmptyCellMark /> : all.length === 1 ? (
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
      fetchAssignableWorkers({ elementId: el.id }).then(setWorkers).catch((e) => console.error('Failed to load workers', e));
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
        <button
          type="button"
          aria-label={workerTriggerLabel('Assignees', all.map((a) => a.worker ?? null).filter((w): w is NonNullable<typeof w> => !!w))}
          className="inline-flex items-center max-w-full text-left"
        >
          {display}
        </button>
      </DropdownMenuTrigger>
      <AssigneeMenuContent
        align="start"
        className="min-w-[180px]"
        onClick={(e) => e.stopPropagation()}
        assignees={el.assignees}
        workers={workers}
        element={el}
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
export function ObjectCell({
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
      return <td className="table-cell px-1.5 py-2 max-w-0 text-muted-foreground/30 overflow-hidden" />;
    }
    const cellValue = col.values?.[obj.id]?.value ?? null;
    return (
      <td
        className="table-cell px-1.5 py-1 max-w-0 overflow-hidden"
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
        className="table-cell px-1.5 py-1 max-w-0 overflow-hidden"
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
        className="table-cell px-1.5 py-1 max-w-0 overflow-hidden"
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
      <td className="table-cell px-1.5 py-2 max-w-0 overflow-hidden text-xs text-muted-foreground tabular-nums">
        {count === 0 ? '—' : count}
      </td>
    );
  }
  // Progress — share of the Object's Elements marked done (computed, read-only).
  if (column.id === 'progress') {
    const { pct } = completionOf(obj.elements ?? []);
    return (
      <td className="table-cell px-1.5 py-2 max-w-0 overflow-hidden">
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
        className="table-cell px-1.5 py-1 max-w-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <LeadCell obj={obj} workers={objectWorkers} onObjectUpdate={onObjectUpdate} />
      </td>
    );
  }
  // assignee is Element-only — falls through to an empty placeholder.
  return <td className="table-cell px-1.5 py-2 max-w-0 text-muted-foreground/30 overflow-hidden" />;
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
  const display = dateString ? formatDateShort(dateString) : null;
  const canEdit = !!onObjectUpdate;
  const weekStartsOn = usePreference(getCachedWeekStartsOn);
  const trigger = (
    <button
      type="button"
      disabled={!canEdit}
      className={`${CELL_TRIGGER_BASE} gap-1 ${dateString ? '' : CELL_TRIGGER_EMPTY}`}
    >
      {display ? <><CalendarIcon size={11} className="opacity-60" /><CellText>{display}</CellText></> : <EmptyCellMark />}
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
          weekStartsOn={weekStartsOn}
        />
      </PopoverContent>
    </Popover>
  );
}

// Lead cell — single-select Worker picker for objects.lead_id. Resolves the
// current lead by id (from the passed list, else read on its own, so a lead
// outside the list still shows by name) and offers a dropdown of the passed
// workers (+ Clear) to set it. Read-only chip when onObjectUpdate isn't
// wired. Exported for the same cross-surface reuse as DueDateCell above.
export function LeadCell({
  obj, workers, onObjectUpdate,
}: {
  obj: AlconObjectWithChildren;
  workers: Worker[];
  onObjectUpdate?: (objectId: string, updates: { lead_id?: string | null }) => void | Promise<void>;
}) {
  const empty = !obj.lead_id;
  const lead = useWorkerById(obj.lead_id ?? null, workers);
  const display = (
    <span className={`${CELL_TRIGGER_BASE} ${empty ? CELL_TRIGGER_EMPTY : 'gap-1.5'}`}>
      {empty ? <EmptyCellMark /> : (
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
        <button
          type="button"
          aria-label={workerTriggerLabel('Lead', lead)}
          className="inline-flex items-center max-w-full text-left"
        >
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
            <ReachHint worker={w} />
            {obj.lead_id === w.id && <Check size={13} className="shrink-0" />}
          </DropdownMenuItem>
        ))}
        {!empty && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onObjectUpdate(obj.id, { lead_id: null })} className="h-6 py-0 text-muted-foreground">
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
