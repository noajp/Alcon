'use client';

import { parseDateOnly, toDateOnlyString as formatDateOnly } from '@/Function/shared/dateUtils';
import React, { useEffect, useRef, useState } from 'react';
import { formatFieldNumber, optionLabel } from './fieldModel';
import type { CustomColumnOptions } from '@/types/database';
import { MenuShell } from '@/Function/shared/menu';
import { CalendarIcon, Check } from '@/ui/icons';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import { useAssignableWorkers, useWorkerById, useWorkers } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import { clampProgress } from '@/Function/shared/ElementProgressMark';
import { ReachHint, WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { workerTriggerLabel } from '@/Function/shared/workerReach';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MenuCheck,
} from '@/ui/dropdown-menu';

interface CustomColumnCellProps {
  column: CustomColumnWithValues;
  elementId: string;
  value: Json;
  onChange: (value: Json) => void | Promise<void>;
  displayMode?: 'table' | 'pill';
}

// Compact, content-width trigger used by every cell variant. The cell
// only takes the space its label needs — the popover/dropdown is what
// holds the editor, keeping the column itself tight. Exported so the
// built-in Element cells (Priority/Status/Due/Assignee in ListTable)
// can match the look of custom column cells one-to-one.
// Cell values are plain text with a subtle hover highlight only — NO always-on
// chip/pill wrapper. The capsule border read as too heavy across a dense grid,
// so every cell value (Type / Status / Due / Assignee / custom Properties) just
// shows its content; the popover/dropdown is the editor.
export const CELL_TRIGGER_BASE =
  // A disabled trigger is a read-only cell: no pointer, no hover, and no hit
  // target of its own, so the wrapper's `title` (the reason it is locked)
  // is what the browser shows on hover in every engine. Values read 13px;
  // a list table raises them to 14px through --cell-text.
  'inline-flex items-center max-w-full [font-size:calc(var(--cell-text,13px)*var(--fs))] font-normal leading-5 text-foreground hover:bg-muted px-2 py-1 rounded-md transition-colors cursor-pointer truncate disabled:cursor-default disabled:pointer-events-none disabled:hover:bg-transparent';
export const CELL_TRIGGER_EMPTY = 'text-muted-foreground';
export const CELL_POPOVER_RADIUS = 'rounded-lg';

/**
 * The single, shared truncating label for any cell value. CELL_TRIGGER_BASE is
 * an inline-flex container, and `truncate` on the trigger itself does NOT
 * ellipsize a direct text child (flex items aren't formatted as inline
 * content). So EVERY text-bearing cell — Text / Note / Status / Select / Type /
 * Person / Date / Number — wraps its label in this one component. Change the
 * overflow behaviour here once and it applies everywhere; long values get a
 * trailing "…" instead of a mid-character clip.
 */
export function CellText({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`min-w-0 truncate ${className}`}>{children}</span>;
}

/**
 * What an unset cell shows: a faint dash, with "Empty" for screen readers.
 * The word "Empty" repeated down a column is noise that outweighs the values
 * around it; the dash keeps the column's rhythm, and the cell's hover ground
 * still shows where to click.
 */
/** An empty cell says nothing until its row is pointed at: a column of
 *  dashes is noise, and the row's hover is when it is worth knowing the
 *  cell can be filled in. */
export function EmptyCellMark() {
  const { t } = useI18n();
  return (
    <>
      <span aria-hidden className="opacity-0 transition-opacity group-hover:opacity-60">–</span>
      <span className="sr-only">{t('Empty')}</span>
    </>
  );
}

const TRIGGER_BASE = CELL_TRIGGER_BASE;
const TRIGGER_EMPTY = CELL_TRIGGER_EMPTY;

function formatDate(value: string | null, locale: string): string {
  if (!value) return '';
  const d = parseDateOnly(value);
  if (!d) return value;
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export function CustomColumnCell(props: CustomColumnCellProps) {
  const [pendingValue, setPendingValue] = useState<{ value: Json } | null>(null);
  const revision = useRef(0);
  const save = (value: Json) => {
    const current = ++revision.current;
    setPendingValue({ value });
    void Promise.resolve().then(() => props.onChange(value)).catch(() => {
      // The controller retains the failed write and offers Retry.
    }).finally(() => { if (current === revision.current) setPendingValue(null); });
  };
  return <span aria-busy={pendingValue !== null}><CustomColumnCellBody {...props} value={pendingValue ? pendingValue.value : props.value} onChange={save} /></span>;
}

function CustomColumnCellBody({
  column,
  elementId,
  value,
  onChange,
  displayMode = 'table',
}: CustomColumnCellProps) {
  // Hoisted above every column_type branch below (several return early) —
  // hooks can't follow a conditional return.
  const weekStartsOn = usePreference(getCachedWeekStartsOn);
  const { t, locale } = useI18n();
  const renderWithLabel = (content: React.ReactNode) => {
    if (displayMode === 'pill') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-[12px] font-normal">{column.name}:</span>
          {content}
        </div>
      );
    }
    return content;
  };

  // ── Checkbox ─────────────────────────────────────────────────────────
  if (column.column_type === 'checkbox') {
    const checked = !!value;
    return renderWithLabel(
      <button
        type="button"
        role="checkbox" aria-checked={checked} aria-label={column.name}
        onClick={() => onChange(!checked)}
        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          checked
            ? 'bg-foreground border-foreground text-background'
            : 'border-muted-foreground/30 hover:border-muted-foreground'
        }`}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </button>,
    );
  }

  // ── Date ─────────────────────────────────────────────────────────────
  if (column.column_type === 'date') {
    const dateString = typeof value === 'string' ? value : null;
    const selected = parseDateOnly(dateString);
    return renderWithLabel(
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`${TRIGGER_BASE} gap-1 ${dateString ? '' : TRIGGER_EMPTY}`}
          >
            {dateString ? <><CalendarIcon size={11} className="opacity-60" />{formatDate(dateString, locale)}</> : <EmptyCellMark />}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 rounded-lg" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => onChange(d ? formatDateOnly(d) : null)}
            autoFocus
            weekStartsOn={weekStartsOn}
          />
        </PopoverContent>
      </Popover>,
    );
  }

  if (['select', 'multi_select', 'status'].includes(column.column_type)) {
    const options = column.options?.options ?? [];
    const multiple = column.column_type === 'multi_select';
    const selected = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : typeof value === 'string' && value ? [value] : [];
    return renderWithLabel(<DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" aria-label={t('Edit {name}', { name: column.name })} className={`${TRIGGER_BASE} gap-1 ${selected.length ? '' : TRIGGER_EMPTY}`}>
        {selected.length ? selected.map((v) => {
          const option = options.find((o) => o.value === v);
          return <span key={v} className="inline-flex items-center gap-1 min-w-0"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: option?.color ?? 'var(--text-secondary)' }} /><CellText>{option ? optionLabel(option) : v}</CellText></span>;
        }) : <EmptyCellMark />}
      </button></DropdownMenuTrigger>
      <MenuShell as="dropdown" align="start">
        {options.filter((opt) => !opt.archived).map((opt) => <DropdownMenuItem key={opt.value} onSelect={(e) => {
          if (multiple) { e.preventDefault(); onChange(selected.includes(opt.value) ? selected.filter((v) => v !== opt.value) : [...selected, opt.value]); }
          else onChange(opt.value);
        }}><span className="size-2 rounded-full" style={{ backgroundColor: opt.color ?? 'var(--text-secondary)' }} /><span className="flex-1">{optionLabel(opt)}</span>{selected.includes(opt.value) && <MenuCheck />}</DropdownMenuItem>)}
        {options.every((opt) => opt.archived) && <p className="p-2 text-sm text-muted-foreground">{t('No active options')}</p>}
        {!!selected.length && <DropdownMenuItem onSelect={() => onChange(multiple ? [] : null)}>{t('Clear')}</DropdownMenuItem>}
      </MenuShell>
    </DropdownMenu>);
  }

  // ── Person (Assignee) ────────────────────────────────────────────────
  if (column.column_type === 'person') {
    // A Domain column tags Objects (`elementId` is then the Object's id); every
    // other column holds an Element value.
    return <PersonCell value={value} onChange={onChange} renderWithLabel={renderWithLabel} columnLabel={column.name}
      elementId={column.domain_id ? null : elementId} />;
  }

  // ── Progress ─────────────────────────────────────────────────────────
  if (column.column_type === 'progress') {
    return <ProgressCell value={value} onChange={onChange} renderWithLabel={renderWithLabel} />;
  }

  // ── Number / Budget ─────────────────────────────────────────────────
  if (
    column.column_type === 'number' ||
    column.column_type === 'budget'
  ) {
    return (
      <NumberCell options={column.options} value={value} onChange={onChange} renderWithLabel={renderWithLabel} />
    );
  }

  // ── Text (default) ───────────────────────────────────────────────────
  return <TextCell value={value} onChange={onChange} renderWithLabel={renderWithLabel} />;
}

// ─────────────────────────────────────────────────────────────────────
// Person picker: offers the Workers the database accepts here — on an
// Element, exactly its assignable Workers (worker_assignable, read when the
// picker opens, as the board's assignee menu does); on an Object, the active
// Space's. Stores the worker_id as the cell value. The current value resolves
// by id, so a Worker outside the list still shows its name.
// ─────────────────────────────────────────────────────────────────────
function PersonCell({
  value,
  onChange,
  renderWithLabel,
  columnLabel,
  elementId,
}: {
  value: Json;
  onChange: (v: Json) => void;
  renderWithLabel: (c: React.ReactNode) => React.ReactNode;
  columnLabel: string;
  elementId: string | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { data: spaceWorkers } = useWorkers();
  const { data: elementWorkers, loading } = useAssignableWorkers({ elementId }, !!elementId && open);
  const workers = elementId ? elementWorkers : spaceWorkers;
  const currentId = typeof value === 'string' ? value : '';
  const current = useWorkerById(currentId || null, spaceWorkers);

  return renderWithLabel(
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={workerTriggerLabel(columnLabel, current)}
          className={`${TRIGGER_BASE} gap-1.5 ${current ? '' : TRIGGER_EMPTY}`}
        >
          {current ? <WorkerAvatar worker={current} size={16} /> : null}
          <CellText>{current ? current.name : <EmptyCellMark />}</CellText>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1 rounded-lg">
        <div className="max-h-64 overflow-auto">
          {workers.length === 0 && !(elementId && loading) && (
            <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
              {t('No Workers yet')}
            </div>
          )}
          {workers.map((w) => {
            const sel = w.id === currentId;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => onChange(w.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left text-[13px] font-normal"
              >
                <WorkerAvatar worker={w} size={20} />
                <span className="flex-1 truncate">{w.name}</span>
                <ReachHint worker={w} />
                {sel && <MenuCheck />}
              </button>
            );
          })}
          {current && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="w-full px-2 py-1.5 mt-1 rounded-md hover:bg-muted text-left text-[12px] text-muted-foreground"
            >
              {t('Clear')}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Text — popover with a textarea so notes can hold longer content without
// stretching the column. Saves on close/Enter.
// ─────────────────────────────────────────────────────────────────────
function TextCell({
  value,
  onChange,
  renderWithLabel,
}: {
  value: Json;
  onChange: (v: Json) => void;
  renderWithLabel: (c: React.ReactNode) => React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(typeof value === 'string' ? value : '');
  useEffect(() => {
    if (open) setDraft(typeof value === 'string' ? value : '');
  }, [open, value]);

  const commit = () => {
    const trimmed = draft.trim();
    onChange(trimmed.length ? trimmed : null);
    setOpen(false);
  };

  const display = typeof value === 'string' && value.length > 0 ? value : '';
  return renderWithLabel(
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${TRIGGER_BASE} ${display ? '' : TRIGGER_EMPTY}`}
        >
          <CellText>{display || <EmptyCellMark />}</CellText>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2 rounded-lg">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
            if (e.key === 'Escape') setOpen(false);
          }}
          rows={4}
          autoFocus
          placeholder={t('Add note…')}
          className="w-full text-[13px] bg-transparent resize-none p-1 leading-snug"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[12px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md"
          >
            {t('Cancel')}
          </button>
          <button
            type="button"
            onClick={commit}
            className="text-[12px] bg-foreground text-background px-2 py-1 rounded-md hover:opacity-90"
          >
            {t('Save')}
          </button>
        </div>
      </PopoverContent>
    </Popover>,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Number — inline edit on click, since there's nothing to pick from a
// list. Kept as an unstyled compact input that matches the trigger size.
// ─────────────────────────────────────────────────────────────────────
function NumberCell({
  options,
  value,
  onChange,
  renderWithLabel,
}: {
  options: CustomColumnOptions;
  value: Json;
  onChange: (v: Json) => void;
  renderWithLabel: (c: React.ReactNode) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && !Number.isFinite(Number(trimmed))) return;
    onChange(trimmed.length ? Number(trimmed) : null);
    setEditing(false);
  };

  if (editing) {
    return renderWithLabel(
      <input
        ref={inputRef}
        type="number"
        step="any"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
        className="w-20 text-[12px] bg-transparent px-1.5 py-0.5 rounded-md"
      />,
    );
  }

  const display = formatFieldNumber(value, options);
  return renderWithLabel(
    <button
      type="button"
      onClick={() => {
        setDraft(value == null ? '' : String(value));
        setEditing(true);
      }}
      className={`${TRIGGER_BASE} ${display ? '' : TRIGGER_EMPTY}`}
    >
      <CellText>{display || <EmptyCellMark />}</CellText>
    </button>,
  );
}

function ProgressCell({
  value,
  onChange,
  renderWithLabel,
}: {
  value: Json;
  onChange: (v: Json) => void;
  renderWithLabel: (c: React.ReactNode) => React.ReactNode;
}) {
  const { t } = useI18n();
  const current = clampProgress(value);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(current ?? 0));

  useEffect(() => {
    if (open) setDraft(String(current ?? 0));
  }, [current, open]);

  const commit = (raw = draft) => {
    const next = clampProgress(raw) ?? 0;
    setDraft(String(next));
    onChange(next);
  };

  return renderWithLabel(
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Persist once when the popover closes — keeps slider drags local
        // until the user is done — and only when the value actually moved.
        if (!next && (clampProgress(draft) ?? 0) !== (current ?? 0)) commit();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${TRIGGER_BASE} gap-1.5 ${current !== null ? '' : TRIGGER_EMPTY}`}
        >
          <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-foreground/70 transition-all"
              style={{ width: `${current ?? 0}%` }}
            />
          </span>
          <span className="tabular-nums">{current ?? 0}%</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3 rounded-lg">
        <div className="flex items-center justify-between pb-2">
          <span className="text-[12px] font-medium text-muted-foreground">{t('Progress')}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={100}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setOpen(false);
              }}
              className="w-14 rounded-md bg-muted/60 px-1.5 py-1 text-right text-[12px] tabular-nums border-none"
            />
            <span className="text-[12px] text-muted-foreground">%</span>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={clampProgress(draft) ?? 0}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full accent-foreground"
        />
      </PopoverContent>
    </Popover>,
  );
}
