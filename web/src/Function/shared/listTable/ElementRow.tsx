'use client';

import { memo, useState } from 'react';
import { Grip, Lock, Check, Trash2, Fingerprint } from 'lucide-react';
import { BUILTIN_COLUMN_ICONS } from '@/Function/property/columnTypes';
import type { CustomColumnWithValues, ElementWithDetails, Worker } from '@/hooks/useSupabase';
import { scheduleElementDetailPrefetch, cancelElementDetailPrefetch } from '@/hooks/elementDetailQueries';
import { deleteElement, addElementAssignee, removeElementAssignee, fetchAssignableWorkers, noticeAssignmentFailed } from '@/hooks/useSupabase';
import { withCurrentWorkers } from '@/Function/shared/assignableWorkers';
import { describeBlocker, type DependencyBlocker } from '@/Function/shared/element/dependencyReadiness';
import { liveLease, holderLabel, formatRemaining } from '@/Function/shared/element/lease';
import { useNow } from '@/Function/shared/useNow';
import { useSortable } from '@dnd-kit/sortable';
import type { Json } from '@/types/database';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { ElementProgressMark, getElementProgress } from '@/Function/shared/ElementProgressMark';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from '@/ui/context-menu';
import { PriorityMark } from '@/Function/shared/PriorityMark';
import { PRIORITY_OPTIONS, STATUS_OPTIONS } from '@/shared/designTokens';
import { ActivitySignal } from '@/Function/shared/element/ActivitySignal';
import { StatusPicker } from '@/Function/shared/StatusPicker';
import { type DataColumn } from '@/Function/shared/listTable/useListColumns';
import { type ElementUpdate, DROP_LINE_CLASS, DROP_LINE_SQUARE, dropLineVar, ROW_ROUND_BASE, selectionSquareClass, STICKY_TINT_SELECTED, STICKY_TINT_HOVER } from './shared';
import { ElementCell, LabelChip } from './cells';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { statusLabel } from '@/shared/designTokens';
import { isOverdue } from '@/Function/shared/dateUtils';

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
  /** Unfinished `depends_on` upstreams — undefined when the Element is ready,
   *  so the row shows nothing. */
  blockers?: DependencyBlocker[];
}

export const ElementRow = memo(function ElementRow({
  el, isSelected, hasSelectionRef, elementTypes, visibleColumns,
  hasTrailingCol, canUpdate, canRowSelect, canAddType, onAddType,
  canRemoveType, onRemoveType, dropEdge, selPrev, selNext,
  onElementUpdate, onRefresh, onSelectElement, onRowSelect, onCustomColumnValueChange,
  allCustomColumns, blockers,
}: ElementRowProps) {
  const { t, locale } = useI18n();
  const overdue = isOverdue(el.due_date, el.status === 'done');
  const showsActivityColumn = visibleColumns.some((c) => c.id === 'activity');
  // One shared 30s clock for the whole table; a lapsed lease disappears from
  // the row on the next tick without a refetch.
  const lease = liveLease(el, useNow());
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
      // Warm the detail facets while the pointer rests on the row, so the
      // click opens onto cached data (dwell-gated: a sweep warms nothing).
      onMouseEnter={() => scheduleElementDetailPrefetch(el)}
      onMouseLeave={cancelElementDetailPrefetch}
      className={`group cursor-pointer select-none leading-[1.4] [&>td]:transition-colors ${ROW_ROUND_BASE} ${isSelected ? selectionSquareClass(selPrev, selNext) : ''} ${DROP_LINE_CLASS} ${dropEdge ? DROP_LINE_SQUARE : ''} ${
        isSelected
          ? `[&>td:not(.sticky):not(:last-child)]:bg-[var(--accent-default)]/15 dark:[&>td:not(.sticky):not(:last-child)]:bg-[var(--accent-default)]/20 [&:hover>td:not(.sticky):not(:last-child)]:bg-[var(--accent-default)]/20 dark:[&:hover>td:not(.sticky):not(:last-child)]:bg-[var(--accent-default)]/25 ${STICKY_TINT_SELECTED}`
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
      {/* Status leads the row, where the eye lands — no checkbox, priority
          or id: Shift- or ⌘-click selects (the bulk bar appears), and
          priority and the id live in the Element's own page. */}
      <td className="sticky left-0 z-10 bg-card w-13 pl-7.5 pr-1.5 py-2">
        <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
          {canUpdate ? (
            <StatusPicker
              element={el}
              onChanged={() => { void onRefresh?.(); }}
              trigger={
                <button
                  type="button"
                  title={t('Status: {value}', { value: t(statusLabel(el.status ?? 'todo')) })}
                  className="flex size-4 items-center justify-center rounded-md transition-colors hover:bg-muted/40"
                >
                  <ElementProgressMark status={el.status} progress={getElementProgress(el, allCustomColumns)} size={16} />
                </button>
              }
            />
          ) : (
            <ElementProgressMark status={el.status} progress={getElementProgress(el, allCustomColumns)} size={16} />
          )}
        </span>
      </td>
      <td className="md:sticky md:left-13 z-10 bg-card pl-3.5 pr-0.5 py-2 min-w-0 max-w-0">
        {/* @container: the lease chip below decides how much of itself to
            show from this cell's own width, not the viewport's — the Name
            column is user-resizable and shares the row with the sidebar. */}
        {/* One rhythm across the row: status → title → signals → labels →
            the date column all sit 20px apart (the cell's pl-3.5 and pr-0.5
            add up with the neighbouring cells' padding to the same 20px). */}
        <div className="@container flex items-center gap-5 min-w-0 min-h-[1.875rem]">
          <div className="flex flex-1 min-w-0 items-center gap-2">
            <span className="text-[15px] font-medium truncate flex-1 min-w-0 text-foreground">{el.title}</span>
          </div>
          {lease && (
            // Who holds this right now. Only a live lease is shown — a lapsed
            // one is nobody, and painting a dead session's token here is how
            // an orphan gets mistaken for staffed work. Same quiet register
            // as the activity signal; the full token, branch and time left
            // are one hover away.
            <span
              // The title is what a person scans, so this chip never competes
              // with it for width: below a 28rem cell it is the icon alone
              // (token, branch and time still one hover away), above it the
              // label comes back. A flex-shrink approach cannot do this — the
              // flex-1 title has basis 0, so the row never overflows and
              // shrink never fires; review measured the title at 24px.
              className="shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground/70 max-w-32"
              title={lease.branch
                ? t('Held by {holder} on {branch} · {time} left', { holder: lease.holder, branch: lease.branch, time: formatRemaining(lease.remainingMs) })
                : t('Held by {holder} · {time} left', { holder: lease.holder, time: formatRemaining(lease.remainingMs) })}
              aria-label={t('Held by {holder}', { holder: lease.holder })}
            >
              <Fingerprint size={11} className="shrink-0" />
              <span className="hidden @[28rem]:inline truncate">{holderLabel(lease.holder)}</span>
            </span>
          )}
          {/* Quiet activity signal — the comment count, so discussed and
              silent Elements read at a glance without
              opening the detail panel. It is a stand-in for the Activity
              column, so it steps aside when that column is on: the same
              number twice on one row reads as two different facts. */}
          {!showsActivityColumn && <ActivitySignal activity={el.activity} />}
          {blockers && blockers.length > 0 && (
            // Waiting on an unfinished dependency. Deliberately the same quiet
            // register as the activity signal beside it — a row that cannot be
            // started is not an error, and colouring it would collide with the
            // status hue the mark already carries.
            <span
              className="shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground/70"
              title={t('Waiting on {list}', { list: blockers.map(describeBlocker).join(', ') })}
              aria-label={blockers.length === 1 ? t('Waiting on 1 unfinished Element') : t('Waiting on {n} unfinished Elements', { n: blockers.length })}
            >
              <Lock size={11} />
              <span className="tabular-nums">{blockers.length}</span>
            </span>
          )}

          {/* Labels last, so they line up at the cell's right edge whatever
              signals a row carries before them. */}
          {!!el.labels?.length && <span className="hidden @[26rem]:flex max-w-[35%] shrink-0 items-center justify-end gap-1 overflow-hidden" title={el.labels.join(', ')}>
            {el.labels.map(label => <LabelChip key={label} label={label} />)}
          </span>}
        </div>
      </td>
      {visibleColumns.map((col) => (
        <ElementCell
          key={col.id}
          column={col}
          el={el}
          elementTypes={elementTypes}
          canUpdate={canUpdate}
          isOverdue={overdue}
          onElementUpdate={onElementUpdate}
          onRefresh={onRefresh}
          onAddType={canAddType ? onAddType : undefined}
          onRemoveType={canRemoveType ? onRemoveType : undefined}
          onCustomColumnValueChange={onCustomColumnValueChange}
        />
      ))}
      {hasTrailingCol && (
        <td className="table-cell w-8 px-1 py-2" />
      )}
    </tr>
      </ContextMenuTrigger>
      {canUpdate && (
      <ContextMenuContent className="min-w-[200px]">
        <ContextMenuSub {...subProps('status')}>
          <ContextMenuSubTrigger className="gap-2" onPointerEnter={() => setOpenSub('status')}>
            {BUILTIN_COLUMN_ICONS.status}
            {t('Status')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[170px]">
            {STATUS_OPTIONS.map((o) => (
              <ContextMenuItem
                key={o.value ?? 'none'}
                className="gap-2"
                onClick={() => onElementUpdate(el.id, { status: o.value })}
              >
                <ElementProgressMark status={o.value} size={14} />
                <span className="flex-1">{t(o.label)}</span>
                {el.status === o.value && <Check className="size-3.5" />}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub {...subProps('priority')}>
          <ContextMenuSubTrigger className="gap-2" onPointerEnter={() => setOpenSub('priority')}>
            {BUILTIN_COLUMN_ICONS.priority}
            {t('Priority')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[150px]">
            {PRIORITY_OPTIONS.map((o) => (
              <ContextMenuItem
                key={o.value}
                className="gap-2"
                onClick={() => onElementUpdate(el.id, { priority: o.value as ElementWithDetails['priority'] })}
              >
                <PriorityMark priority={o.value} />
                <span className="flex-1">{t(o.label)}</span>
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
            {t('Due date')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-[160px]">
            {dueDatePresets(locale).map((p) => (
              <ContextMenuItem
                key={p.label}
                className="gap-2"
                onClick={() => onElementUpdate(el.id, { due_date: p.value })}
              >
                <span className="flex-1">{t(p.label)}</span>
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
                  {t('Clear')}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        {elementScopedColumns(allCustomColumns).length > 0 && (
          <ContextMenuSub {...subProps('more')}>
            <ContextMenuSubTrigger className="gap-2" onPointerEnter={() => setOpenSub('more')}>
              <Grip className="size-4" />
              {t('More properties')}
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
          className="gap-2 text-[var(--status-danger)] focus:text-[var(--status-danger)]"
          onPointerEnter={() => setOpenSub(null)}
          onClick={() => { void deleteElement(el.id); }}
        >
          <Trash2 className="size-3.5" /> {t('Delete')}
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
function dueDatePresets(locale: string): { label: string; hint: string; value: string }[] {
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const short = (d: Date) => d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
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
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<Worker[]>([]);
  const load = () => {
    if (candidates.length === 0) {
      fetchAssignableWorkers({ elementId: el.id }).then(setCandidates).catch((e) => console.error('Failed to load workers', e));
    }
  };
  const assignees = el.assignees ?? [];
  // Who is already on it stays listed (and removable) even when outside the
  // Workers this Element can be assigned to.
  const workers = candidates.length === 0
    ? candidates
    : withCurrentWorkers(candidates, assignees.map((a) => a.worker ?? null));
  const toggle = async (workerId: string) => {
    const existing = assignees.find((a) => a.worker_id === workerId);
    try {
      if (existing) await removeElementAssignee(existing.id);
      else await addElementAssignee({ element_id: el.id, worker_id: workerId, role: 'assignee', worker: workers.find((w) => w.id === workerId) });
      await onRefresh();
    } catch (e) { noticeAssignmentFailed(e); }
  };
  return (
    <ContextMenuSub open={open} onOpenChange={onOpenChange}>
      <ContextMenuSubTrigger
        className="gap-2"
        onPointerEnter={() => { load(); onTriggerEnter(); }}
        onFocus={load}
      >
        {BUILTIN_COLUMN_ICONS.assignees}
        {t('Assignee')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-[190px] max-h-72 overflow-auto">
        {workers.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">{t('Loading…')}</div>
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
  const { t } = useI18n();
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
              {t('Clear')}
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
    ? t('Empty')
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
