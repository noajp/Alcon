'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CalendarIcon, Check } from 'lucide-react';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import { useWorkers } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/alcon/settings/preferencesStore';
import { clampProgress } from '@/alcon/shared/ElementProgressMark';
import { WorkerAvatar } from '@/alcon/shared/WorkerAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

interface CustomColumnCellProps {
  column: CustomColumnWithValues;
  elementId: string;
  value: Json;
  onChange: (value: Json) => void;
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
  'inline-flex items-center max-w-full text-[11px] font-semibold leading-5 text-foreground/70 hover:bg-muted/40 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer truncate';
export const CELL_TRIGGER_EMPTY = 'text-muted-foreground/50';
export const CELL_POPOVER_RADIUS = 'rounded-xl';

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

const TRIGGER_BASE = CELL_TRIGGER_BASE;
const TRIGGER_EMPTY = CELL_TRIGGER_EMPTY;

const STATUS_DOT: Record<string, string> = {
  Todo: 'bg-neutral-400',
  'In progress': 'bg-amber-500',
  Done: 'bg-emerald-500',
  Blocked: 'bg-rose-500',
};

function formatDate(value: string | null): string {
  if (!value) return '';
  const d = parseDateOnly(value);
  if (!d) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function parseDateOnly(value: string | null): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function CustomColumnCell({
  column,
  value,
  onChange,
  displayMode = 'table',
}: CustomColumnCellProps) {
  // Hoisted above every column_type branch below (several return early) —
  // hooks can't follow a conditional return.
  const weekStartsOn = usePreference(getCachedWeekStartsOn);
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
            <CalendarIcon size={11} className="opacity-60" />
            {dateString ? formatDate(dateString) : 'Empty'}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 rounded-xl" align="start">
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

  // ── Select / Status ──────────────────────────────────────────────────
  if (column.column_type === 'select' || column.column_type === 'status') {
    const options = column.options?.options ?? [];
    const current = typeof value === 'string' ? value : '';
    const dotClass = STATUS_DOT[current];
    return renderWithLabel(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`${TRIGGER_BASE} gap-1.5 ${current ? '' : TRIGGER_EMPTY}`}
          >
            {column.column_type === 'status' && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${dotClass ?? 'bg-muted-foreground/30'}`}
              />
            )}
            <CellText>{current || 'Empty'}</CellText>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="rounded-xl min-w-[160px]">
          {options.map((opt) => {
            const sel = opt.value === current;
            const dot = STATUS_DOT[opt.value];
            return (
              <DropdownMenuItem
                key={opt.value}
                onSelect={() => onChange(opt.value)}
                className="text-[13px] gap-2 rounded-md"
              >
                {column.column_type === 'status' && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${dot ?? 'bg-muted-foreground/30'}`}
                  />
                )}
                <span className="flex-1">{opt.value}</span>
                {sel && <Check size={12} className="text-muted-foreground" />}
              </DropdownMenuItem>
            );
          })}
          {current && (
            <DropdownMenuItem
              onSelect={() => onChange(null)}
              className="text-[12px] text-muted-foreground rounded-md"
            >
              Clear
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>,
    );
  }

  // ── Person (Assignee) ────────────────────────────────────────────────
  if (column.column_type === 'person') {
    return <PersonCell value={value} onChange={onChange} renderWithLabel={renderWithLabel} />;
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
      <NumberCell value={value} onChange={onChange} renderWithLabel={renderWithLabel} />
    );
  }

  // ── Text (default) ───────────────────────────────────────────────────
  return <TextCell value={value} onChange={onChange} renderWithLabel={renderWithLabel} />;
}

// ─────────────────────────────────────────────────────────────────────
// Person picker: fetches workers once, lets user pick by name. Stores
// the worker_id as the cell value.
// ─────────────────────────────────────────────────────────────────────
function PersonCell({
  value,
  onChange,
  renderWithLabel,
}: {
  value: Json;
  onChange: (v: Json) => void;
  renderWithLabel: (c: React.ReactNode) => React.ReactNode;
}) {
  const { data: workers } = useWorkers();
  const currentId = typeof value === 'string' ? value : '';
  const current = workers.find((w) => w.id === currentId) || null;

  return renderWithLabel(
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${TRIGGER_BASE} gap-1.5 ${current ? '' : TRIGGER_EMPTY}`}
        >
          {current ? <WorkerAvatar worker={current} size={16} /> : null}
          <CellText>{current ? current.name : 'Empty'}</CellText>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1 rounded-xl">
        <div className="max-h-64 overflow-auto">
          {workers.length === 0 && (
            <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
              No workers yet
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
                {sel && <Check size={12} className="text-muted-foreground" />}
              </button>
            );
          })}
          {current && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="w-full px-2 py-1.5 mt-1 rounded-md hover:bg-muted text-left text-[12px] text-muted-foreground"
            >
              Clear
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
          <CellText>{display || 'Empty'}</CellText>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2 rounded-xl">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
            if (e.key === 'Escape') setOpen(false);
          }}
          rows={4}
          autoFocus
          placeholder="Add note…"
          className="w-full text-[13px] bg-transparent resize-none p-1 leading-snug"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[12px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            className="text-[12px] bg-foreground text-background px-2 py-1 rounded-md hover:opacity-90"
          >
            Save
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
  value,
  onChange,
  renderWithLabel,
}: {
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
    onChange(trimmed.length ? Number(trimmed) : null);
    setEditing(false);
  };

  if (editing) {
    return renderWithLabel(
      <input
        ref={inputRef}
        type="number"
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

  const display = value == null ? '' : String(value);
  return renderWithLabel(
    <button
      type="button"
      onClick={() => {
        setDraft(display);
        setEditing(true);
      }}
      className={`${TRIGGER_BASE} ${display ? '' : TRIGGER_EMPTY}`}
    >
      <CellText>{display || '0'}</CellText>
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
      <PopoverContent align="start" className="w-56 p-3 rounded-xl">
        <div className="flex items-center justify-between pb-2">
          <span className="text-[12px] font-medium text-muted-foreground">Progress</span>
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
