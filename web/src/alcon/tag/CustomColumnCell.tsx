'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CalendarIcon, Check } from 'lucide-react';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import { useWorkers } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar } from '@/ui/calendar';
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
// built-in Element cells (Priority/Status/Due/Assignee in ObjectListView)
// can match the look of custom column cells one-to-one.
export const CELL_TRIGGER_BASE =
  'inline-flex items-center max-w-full text-[12px] text-foreground hover:bg-muted/50 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer truncate';
export const CELL_TRIGGER_EMPTY = 'text-muted-foreground/50';
export const CELL_POPOVER_RADIUS = 'rounded-xl';

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
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function CustomColumnCell({
  column,
  value,
  onChange,
  displayMode = 'table',
}: CustomColumnCellProps) {
  const renderWithLabel = (content: React.ReactNode) => {
    if (displayMode === 'pill') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{column.name}:</span>
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
    const selected = dateString ? new Date(dateString) : undefined;
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
            onSelect={(d) => onChange(d ? d.toISOString().slice(0, 10) : null)}
            autoFocus
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
            {current || 'Empty'}
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

  // ── Number / Progress / Budget ───────────────────────────────────────
  if (
    column.column_type === 'number' ||
    column.column_type === 'progress' ||
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
          {current ? (
            <span className="w-4 h-4 rounded-full bg-muted text-[9px] font-medium text-muted-foreground inline-flex items-center justify-center">
              {current.name.charAt(0)}
            </span>
          ) : null}
          {current ? current.name : 'Empty'}
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
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left text-[13px]"
              >
                <span className="w-5 h-5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground inline-flex items-center justify-center">
                  {w.name.charAt(0)}
                </span>
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
          {display || 'Empty'}
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
          if (e.key === 'Escape') setEditing(false);
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
      {display || '0'}
    </button>,
  );
}
