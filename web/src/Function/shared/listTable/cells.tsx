'use client';

import { useUnreadCommentElementIds } from '@/hooks/notificationData';
import { AiWorkingMark } from '@/Function/shared/element/AiWorkingMark';
import { liveLease } from '@/Function/shared/element/lease';
import { useNow } from '@/Function/shared/useNow';
import { parseDateOnly, toDateOnlyString as formatDateOnly } from '@/Function/shared/dateUtils';
import { ActivitySignal } from '@/Function/shared/element/ActivitySignal';
import { Button } from '@/ui/button';
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { DateRange } from 'react-day-picker';
import { Plus, Check, ChevronLeft, ChevronRight, Tag, X } from '@/ui/icons';
import { TypeMark, useTypeIcons } from '@/Function/shared/elementTypeIcon';
import type { ClaywareObjectWithChildren, ElementWithDetails, Worker } from '@/hooks/useSupabase';
import { addElementAssignee, removeElementAssignee, fetchAssignableWorkers, useWorkerById, noticeAssignmentFailed } from '@/hooks/useSupabase';
import { AssigneeMenuContent } from '@/Function/shared/AssigneeMenu';
import type { Json } from '@/types/database';
import { ObjectIcon } from '@/Frame/icons';
import { QuickDates } from '@/Function/shared/date/QuickDates';
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
import { StatusPicker } from '@/Function/shared/StatusPicker';
import { type DataColumn } from '@/Function/shared/listTable/useListColumns';
import { type ElementUpdate, formatDateShort } from './shared';
import { completionOf } from '@/Function/shared/completion';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fieldDisplayLabel } from '@/Function/property/fieldModel';
import { PRIORITY, statusLabel } from '@/shared/designTokens';

const PRIORITY_LABELS: Record<string, string> = Object.fromEntries(Object.entries(PRIORITY).map(([key, value]) => [key, value.label]));

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
  const { t } = useI18n();
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
            {t('Clear')}
          </button>
        )}
      </div>
    </div>
  );
}

// Industry starter vocabularies for the Type picker — each tab offers ~10
// type names that read naturally in that field. Terms intentionally overlap
// across industries (Task, Customer, Order…); picking one adds it to this
// Domain's list and assigns it.
const TYPE_PRESETS: { label: string; types: string[] }[] = [
  // design-lint-ignore — preserve existing user-selectable type presets during extraction.
  { label: 'General',        types: ['Task', 'Issue', 'Customer', 'Bug', 'Feature', 'Story', 'Epic', 'Goal', 'Risk', 'Note'] },
  { label: 'Project Office', types: ['Project', 'Deliverable', 'Milestone', 'Risk', 'Issue', 'Change Request', 'Action Item', 'Decision', 'Stakeholder', 'Resource'] },
  { label: 'CRM',            types: ['Lead', 'Contact', 'Account', 'Opportunity', 'Deal', 'Customer', 'Ticket', 'Strategy', 'Activity', 'Quote'] },
  { label: 'SCM',            types: ['Order', 'Shipment', 'Supplier', 'Inventory', 'SKU', 'Purchase Order', 'Warehouse', 'Lot', 'Delivery', 'Forecast'] },
  // design-lint-ignore — preserve existing user-selectable type presets during extraction.
  { label: 'Software',       types: ['Epic', 'Story', 'Task', 'Bug', 'Feature', 'Spike', 'Incident', 'Release', 'Sprint', 'Subtask'] },
  { label: 'Healthcare',     types: ['Patient', 'Encounter', 'Appointment', 'Order', 'Medication', 'Lab', 'Diagnosis', 'Procedure', 'Referral', 'Claim'] },
  { label: 'Finance',        types: ['Account', 'Transaction', 'Invoice', 'Payment', 'Journal', 'Budget', 'Expense', 'Asset', 'Ledger', 'Reconciliation'] },
  { label: 'Sales',          types: ['Lead', 'Prospect', 'Opportunity', 'Quote', 'Order', 'Contract', 'Account', 'Activity', 'Target', 'Renewal'] },
];

/** A row of tabs wider than its box: no scrollbar — the row fades out toward
 *  a round arrow at the edge it can still move to, and the arrow moves it. */
function TabStrip({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);
  useEffect(() => { measure(); }, [measure]);
  const move = (by: number) => ref.current?.scrollBy({ left: by, behavior: 'smooth' });
  const fade = `linear-gradient(to right, ${edge.left ? 'transparent, black 44px' : 'black, black'}, ${edge.right ? 'black calc(100% - 44px), transparent' : 'black'})`;
  const ARROW = 'absolute top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground shadow-[var(--shadow-card)] transition-colors hover:text-foreground';
  return (
    <div className="relative">
      <div ref={ref} onScroll={measure}
        className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: fade, WebkitMaskImage: fade }}>
        {children}
      </div>
      {edge.left && (
        <button type="button" aria-label={t('Previous')} className={`${ARROW} left-0`} onClick={() => move(-160)}><ChevronLeft size={13} /></button>
      )}
      {edge.right && (
        <button type="button" aria-label={t('Next')} className={`${ARROW} right-0`} onClick={() => move(160)}><ChevronRight size={13} /></button>
      )}
    </div>
  );
}

/** The Type cell and its picker: a list of the Domain's types, each with its
 *  icon and a check on the current one; the first row is the plain kind
 *  itself (no type). "Create type" adds a name to the Domain and assigns it;
 *  Edit turns the checks into removes. Each type wears the icon the Domain
 *  gave it in Settings. */
export function TypeCell({
  value, types, onChange, onAddType, onRemoveType, kind = 'element',
}: {
  value: string | null;
  types: string[];
  onChange?: (next: string | null) => void | Promise<void>;
  onAddType?: (name: string) => void | Promise<void>;
  onRemoveType?: (name: string) => void | Promise<void>;
  /** Whose types these are. */
  kind?: 'element' | 'object';
}) {
  const { t: tr } = useI18n();
  const icons = useTypeIcons(kind);
  const current = value ?? null;
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [presetTab, setPresetTab] = useState(0);
  const canEdit = !!onChange;
  // A suggested name is registered on the Domain (if new) and assigned, both
  // at once: the menu closing is the click's receipt, not the write's.
  const pickPreset = (name: string) => {
    if (onAddType && !types.some((x) => x.toLowerCase() === name.toLowerCase())) void onAddType(name);
    void onChange?.(name);
    setOpen(false);
  };

  const trigger = (
    <button
      type="button"
      disabled={!canEdit}
      className={`${CELL_TRIGGER_BASE} ${current ? '' : CELL_TRIGGER_EMPTY}`}
    >
      {current ? <><TypeMark type={current} icons={icons} size={13} kind={kind} /><CellText>{current}</CellText></> : <EmptyCellMark />}
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
  const pick = (next: string | null) => { void onChange?.(next); setOpen(false); };
  const canManage = !!onRemoveType && types.length > 0;
  const ROW = 'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left text-[14px] text-foreground transition-colors hover:bg-muted/60';

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setAdding(false); setDraft(''); setEditing(false); } }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className={`${CELL_POPOVER_RADIUS} w-[320px] p-2`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-2 pb-1 pt-0.5">
          <span className="text-[12px] text-muted-foreground">{tr('Types')}</span>
          {canManage && (
            <button type="button" onClick={() => setEditing((v) => !v)}
              className="rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
              {editing ? tr('Done') : tr('Edit')}
            </button>
          )}
        </div>
        <div className="max-h-[240px] overflow-y-auto">
          <button type="button" className={ROW} onClick={() => pick(null)}>
            <TypeMark type={null} icons={icons} kind={kind} />
            <span className="min-w-0 truncate">{kind === 'object' ? 'Object' : 'Element'}</span>
            <span className="shrink-0 text-[12px] text-muted-foreground">{tr('(default)')}</span>
            <span className="flex-1" />
            {!current && <Check size={13} className="shrink-0 text-muted-foreground" />}
          </button>
          {types.map((name) => (
            <div key={name} className="flex min-w-0 items-center">
              <button type="button" className={ROW} onClick={() => { if (!editing) pick(name); }}>
                <TypeMark type={name} icons={icons} kind={kind} />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {!editing && name === current && <Check size={13} className="shrink-0 text-muted-foreground" />}
              </button>
              {editing && (
                <button type="button" onClick={() => void onRemoveType?.(name)}
                  title={tr('Delete “{name}”', { name })} aria-label={tr('Delete “{name}”', { name })}
                  className="mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        {onAddType && !editing && (
          <>
            <div className="my-1 border-t border-border/60" />
            {adding ? (
              <input
                autoFocus
                value={draft}
                placeholder={tr('New type…')}
                aria-label={tr('New type…')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submitNew(); }
                  else if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setDraft(''); }
                }}
                onBlur={submitNew}
                className="w-full rounded-md bg-muted/50 px-2 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/60"
              />
            ) : (
              <button type="button" className={ROW} onClick={() => setAdding(true)}>
                <Plus size={14} className="shrink-0 text-muted-foreground" />
                <span>{tr('Create type')}</span>
              </button>
            )}
            {/* Suggestions by field: tabs that scroll under a round arrow, and
                the field's names in two aligned columns. */}
            <div className="my-1 border-t border-border/60" />
            <div className="px-2 pb-1.5 pt-1 text-[12px] text-muted-foreground">{tr('Recommended')}</div>
            <TabStrip>
              {TYPE_PRESETS.map((p, i) => (
                <button key={p.label} type="button" onClick={() => setPresetTab(i)}
                  className={`shrink-0 whitespace-nowrap rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                    presetTab === i
                      ? 'border-border bg-muted text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}>
                  {tr(p.label)}
                </button>
              ))}
            </TabStrip>
            <div className="mt-1 grid grid-cols-2 gap-x-1">
              {TYPE_PRESETS[presetTab].types.map((name) => (
                <button key={name} type="button" className={`${ROW} !py-1.5 !text-[13px]`} onClick={() => pickPreset(name)}>
                  <TypeMark type={name} icons={icons} kind={kind} size={13} />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {name === current && <Check size={12} className="shrink-0 text-muted-foreground" />}
                </button>
              ))}
            </div>
          </>
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
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  // A due date is one click: a quick pick or a day on the grid saves it and
  // closes. "Range" (the tab at the top) takes a start and a due date; the
  // second day saves and closes.
  const [ranging, setRanging] = useState(false);
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

  // A single due date keeps the start only while it still comes first.
  const pickDue = (due: string) => {
    const start = startDate && startDate <= due ? startDate : null;
    if (start !== startDate || due !== dueDate) void onChange(start, due);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setDraft(initialDraft()); setRanging(!!startDate && startDate !== dueDate); }
        else if (ranging) persist(draft);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className={`w-auto p-0 ${CELL_POPOVER_RADIUS}`} align="start">
        {/* Due date or a range, chosen up front rather than hidden in the
            footer. */}
        <div className="flex gap-1 px-2 pt-2">
          <Button shape="tab" size="xs" variant={ranging ? 'ghost' : 'secondary'} aria-pressed={!ranging}
            onClick={() => { setRanging(false); setDraft(initialDraft()); }}>{t('Due date')}</Button>
          <Button shape="tab" size="xs" variant={ranging ? 'secondary' : 'ghost'} aria-pressed={ranging}
            onClick={() => { setRanging(true); setDraft(initialDraft()); }}>{t('Range')}</Button>
        </div>
        {!ranging && <QuickDates weekStartsOn={weekStartsOn} current={dueDate} onPick={pickDue} />}
        {ranging ? (
          <Calendar
            mode="range"
            captionLayout="dropdown"
            startMonth={new Date(2020, 0)}
            endMonth={new Date(2035, 11)}
            defaultMonth={draft?.from}
            selected={draft}
            // The second day closes the range: it saves and the popover shuts.
            onSelect={(r) => {
              setDraft(r);
              if (r?.from && r.to && formatDateOnly(r.from) !== formatDateOnly(r.to)) { persist(r); setOpen(false); }
            }}
            // Always render 6 week rows so the popover height never jumps
            // between months (and stays aligned with the Type popover).
            fixedWeeks
            showOutsideDays
            autoFocus
            weekStartsOn={weekStartsOn}
          />
        ) : (
          <Calendar
            mode="single"
            captionLayout="dropdown"
            startMonth={new Date(2020, 0)}
            endMonth={new Date(2035, 11)}
            defaultMonth={parseDateOnly(dueDate)}
            selected={parseDateOnly(dueDate)}
            onSelect={(d) => { if (d) pickDue(formatDateOnly(d)); }}
            fixedWeeks
            showOutsideDays
            autoFocus
            weekStartsOn={weekStartsOn}
          />
        )}
        <CellClearFooter
          label={ranging
            ? (draft?.from
              ? `${formatDateShort(formatDateOnly(draft.from), locale)} – ${draft.to ? formatDateShort(formatDateOnly(draft.to), locale) : '…'}`
              : t('Pick the start, then the due date'))
            : undefined}
          onClear={() => { setDraft(undefined); setRanging(false); void onChange(null, null); setOpen(false); }}
        />
      </PopoverContent>
    </Popover>
  );
}

// Label chip — the label's coloured tag (the same mark as the Element page's
// Label island) + its text in an outlined pill, shown left of the Type column. The mark colour comes from the Domain colour catalogue
// (picked colour, else an auto colour derived from the name).
export function LabelChip({ label }: { label: string }) {
  useLabelColors(); // re-render when a colour is picked / the catalogue loads
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1.5 shrink-0 max-w-[140px] px-2 rounded-full border border-[var(--border-default)] text-[12px] font-normal text-[var(--text-secondary)]"
      title={label}
    >
      <Tag aria-hidden size={10} className="shrink-0" style={{ color: labelColor(label) }} />
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
  const { t, locale } = useI18n();
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
    return <UpdatesCell el={el} />;
  }
  if (column.id === 'labels') {
    return <td className="table-cell px-2 py-1"><div className="flex gap-1 overflow-hidden">{(el.labels ?? []).map((label) => <LabelChip key={label} label={label} />)}</div></td>;
  }
  if (column.id === 'priority') {
    return <td className="table-cell px-2 py-1" onClick={(e) => e.stopPropagation()}><PriorityCell element={el} onElementUpdate={canUpdate ? onElementUpdate : undefined} /></td>;
  }
  if (column.id === 'status') {
    return <td className="table-cell px-2 py-1" onClick={(e) => e.stopPropagation()}>{canUpdate ? <StatusPicker element={el} onChanged={() => { void onRefresh?.(); }} trigger={<Button variant="ghost" size="xs">{t(statusLabel(el.status ?? 'todo'))}</Button>} /> : t(statusLabel(el.status ?? 'todo'))}</td>;
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
          onChange={canUpdate ? (type) => onElementUpdate(el.id, { type }) : undefined}
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
                className="inline-flex h-[22px] items-center gap-1.5 min-w-0 max-w-[140px] px-2 rounded-full border border-[var(--border-default)] text-[12px] font-normal text-[var(--text-secondary)]"
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
    const display = dateString ? formatDateShort(dateString, locale) : null;
    const trigger = (
      <button
        type="button"
        disabled={!canUpdate}
        className={`${CELL_TRIGGER_BASE} pr-0 ${dateString ? (isOverdue ? 'text-[var(--status-danger)]' : '') : CELL_TRIGGER_EMPTY}`}
      >
        {display ? <CellText>{display}</CellText> : <EmptyCellMark />}
      </button>
    );
    return (
      <td
        className="table-cell pl-0 pr-1.5 py-1 text-right max-w-0 overflow-hidden"
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const lease = liveLease(el, useNow());
  const all = el.assignees ?? [];
  const empty = all.length === 0;

  const display = (
    <span className={`${CELL_TRIGGER_BASE} ${empty ? CELL_TRIGGER_EMPTY : 'gap-1.5'}`}>
      {empty ? <EmptyCellMark /> : all.length === 1 ? (
        <>
          <WorkerAvatar worker={all[0].worker ?? null} size={16} />
          <CellText>{all[0].worker?.name ?? t('Unknown')}</CellText>
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
    } catch (e) { noticeAssignmentFailed(e); }
  };
  const handleRemove = async (assigneeId: string) => {
    try {
      await removeElementAssignee(assigneeId);
      await onRefresh();
    } catch (e) { noticeAssignmentFailed(e); }
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={workerTriggerLabel(t('Assignees'), all.map((a) => a.worker ?? null).filter((w): w is NonNullable<typeof w> => !!w))}
          className="inline-flex items-center gap-1.5 max-w-full text-left"
        >
          {display}
          {/* An AI holding it now: a spinner beside who it is assigned to. */}
          {lease && <AiWorkingMark lease={lease} />}
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
  obj: ClaywareObjectWithChildren;
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
          kind="object"
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
        className="table-cell pl-0 pr-1.5 py-1 text-right max-w-0 overflow-hidden"
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
      // pl-3: the read-only roll-ups start where their heading's label does.
      <td className="table-cell pl-3 pr-1.5 py-2 max-w-0 overflow-hidden text-[13px] text-muted-foreground tabular-nums">
        {count === 0 ? <EmptyCellMark /> : count}
      </td>
    );
  }
  // Progress — share of the Object's Elements marked done (computed, read-only).
  if (column.id === 'progress') {
    const { pct } = completionOf(obj.elements ?? []);
    return (
      <td className="table-cell pl-3 pr-1.5 py-2 max-w-0 overflow-hidden">
        <div className="flex items-center gap-2">
          <SegmentedProgress value={pct} className="flex-1" />
          <span className="text-[12px] text-muted-foreground w-9 text-right tabular-nums shrink-0">{pct}%</span>
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
  obj: Pick<ClaywareObjectWithChildren, 'id' | 'due_date'>;
  onObjectUpdate?: (objectId: string, updates: { due_date?: string | null }) => void | Promise<void>;
}) {
  const dateString = obj.due_date ? obj.due_date.slice(0, 10) : null;
  const selected = parseDateOnly(dateString);
  const { locale } = useI18n();
  const display = dateString ? formatDateShort(dateString, locale) : null;
  const canEdit = !!onObjectUpdate;
  const weekStartsOn = usePreference(getCachedWeekStartsOn);
  const [open, setOpen] = useState(false);
  // One click sets it: a quick pick or a day on the grid saves and closes.
  const pick = (value: string | null) => { void onObjectUpdate?.(obj.id, { due_date: value }); setOpen(false); };
  const trigger = (
    <button
      type="button"
      disabled={!canEdit}
      className={`${CELL_TRIGGER_BASE} pr-0 ${dateString ? '' : CELL_TRIGGER_EMPTY}`}
    >
      {display ? <CellText>{display}</CellText> : <EmptyCellMark />}
    </button>
  );
  if (!canEdit) return trigger;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className={`w-auto p-0 ${CELL_POPOVER_RADIUS}`} align="start">
        <QuickDates weekStartsOn={weekStartsOn} current={dateString} onPick={pick} />
        <Calendar
          mode="single"
          captionLayout="dropdown"
          startMonth={new Date(2020, 0)}
          endMonth={new Date(2035, 11)}
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => pick(d ? formatDateOnly(d) : null)}
          fixedWeeks
          showOutsideDays
          autoFocus
          weekStartsOn={weekStartsOn}
        />
        {dateString && <CellClearFooter onClear={() => pick(null)} />}
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
  obj: ClaywareObjectWithChildren;
  workers: Worker[];
  onObjectUpdate?: (objectId: string, updates: { lead_id?: string | null }) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const empty = !obj.lead_id;
  const lead = useWorkerById(obj.lead_id ?? null, workers);
  const display = (
    <span className={`${CELL_TRIGGER_BASE} ${empty ? CELL_TRIGGER_EMPTY : 'gap-1.5'}`}>
      {empty ? <EmptyCellMark /> : (
        <>
          <WorkerAvatar worker={lead} size={16} />
          <CellText>{lead?.name ?? t('Unknown')}</CellText>
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
          aria-label={workerTriggerLabel(fieldDisplayLabel(t, { id: 'lead', label: 'Lead' }), lead)}
          className="inline-flex items-center max-w-full text-left"
        >
          {display}
        </button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="start">
        {workers.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">{t('No Workers')}</div>
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
              {t('Clear')}
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
  const { t } = useI18n();
  const current = element.priority ?? null;
  const trigger = (
    <button
      type="button"
      disabled={!onElementUpdate}
      title={current ? t('Priority: {value}', { value: t(PRIORITY_LABELS[current] ?? current) }) : t('Set priority')}
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

/** The Updates column: the comment count, with a dot when one is unread. */
function UpdatesCell({ el }: { el: ElementWithDetails }) {
  const unread = useUnreadCommentElementIds().has(el.id);
  return <td className="table-cell px-2 py-1"><ActivitySignal activity={el.activity} unread={unread} /></td>;
}
