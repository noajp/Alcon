'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2, Copy, CornerUpRight, Link2, X, CalendarIcon, CircleDashed } from 'lucide-react';
import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import type { ElementStatus, ElementPriority } from '@/types/database';
import { ObjectIcon } from '@/shell/icons';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/ui/tooltip';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { Calendar } from '@/ui/calendar';
import { ElementProgressMark } from '@/alcon/shared/ElementProgressMark';
import { PriorityMark } from '@/alcon/shared/PriorityMark';
import { toDateOnlyString } from '@/alcon/shared/dateUtils';

const STATUS_OPTIONS: { value: ElementStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'cancelled', label: 'Cancelled' },
];
const PRIORITY_OPTIONS: { value: ElementPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

interface BulkActionBarProps {
  count: number;
  /** Objects offered in the move / multi-home picker (current Domain). */
  pickerObjects: AlconObjectWithChildren[];
  /** Optionally exclude an Object from the picker (the current Object). */
  excludeObjectId?: string | null;
  onDelete: () => void | Promise<void>;
  onDuplicate: () => void | Promise<void>;
  /** Move to a different primary Object. Omit to hide the "Move to…" action
   *  (e.g. the My Elements view, where elements aren't Object-homed). */
  onMove?: (targetObjectId: string) => void | Promise<void>;
  /** Multi-home: link selected Elements to an additional Object without
   *  changing their primary home. Omit to hide the "Add to…" action. */
  onAddToObject?: (targetObjectId: string) => void | Promise<void>;
  /** Bulk field edits. Each is optional — only the actions a host wires up
   *  show in the bar. */
  onSetStatus?: (status: ElementStatus) => void | Promise<void>;
  onSetPriority?: (priority: ElementPriority | null) => void | Promise<void>;
  onSetDueDate?: (date: string | null) => void | Promise<void>;
  onClear: () => void;
}

type PickerMode = 'move' | 'add' | null;

// One icon-button in the bar. Icon-only (Asana-style); the label shows as a
// Radix tooltip on hover (instant — TooltipProvider delay is 0) and as the
// aria-label for a11y.
function BarButton({
  icon, label, onClick, disabled, active, danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={`flex items-center justify-center size-8 rounded-full transition-colors disabled:opacity-40 ${
            danger
              ? 'text-red-500 hover:text-red-400 hover:bg-red-500/10'
              : active
              ? 'bg-muted/60 text-foreground'
              : 'text-foreground/80 hover:text-foreground hover:bg-muted/40'
          }`}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Linear-style floating bulk-action bar. Renders fixed at the bottom-
 * center of the viewport whenever count > 0. Actions are icon-only with
 * tooltips. Delete asks for confirmation first (destructive + currently
 * un-undoable).
 */
export function BulkActionBar({
  count,
  pickerObjects,
  excludeObjectId,
  onDelete,
  onDuplicate,
  onMove,
  onAddToObject,
  onSetStatus,
  onSetPriority,
  onSetDueDate,
  onClear,
}: BulkActionBarProps) {
  const [picker, setPicker] = useState<PickerMode>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);

  // Close any open popover on Esc or outside click.
  useEffect(() => {
    if (!picker && !confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPicker(null); setConfirmDelete(false); }
    };
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (picker && popoverRef.current && !popoverRef.current.contains(t)) setPicker(null);
      if (confirmDelete && confirmRef.current && !confirmRef.current.contains(t)) setConfirmDelete(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [picker, confirmDelete]);

  const wrap = (fn: () => void | Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const choose = async (objectId: string) => {
    if (!picker || busy) return;
    setBusy(true);
    try {
      if (picker === 'move') await onMove?.(objectId);
      else await onAddToObject?.(objectId);
      setPicker(null);
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (busy) return;
    setBusy(true);
    try { await onDelete(); setConfirmDelete(false); }
    finally { setBusy(false); }
  };

  const visibleObjects = pickerObjects.filter(o => o.id !== excludeObjectId);
  const noun = count === 1 ? 'Element' : 'Elements';

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto relative">
        <div className="flex items-center gap-0.5 rounded-full bg-popover/95 backdrop-blur-md shadow-2xl ring-1 ring-border px-2 py-1.5">
          <span className="pl-2 pr-2 text-[12px] font-medium text-foreground tabular-nums whitespace-nowrap">
            {count} {noun} selected
          </span>

          {/* Bulk field edits (status / priority / due date) — Asana's
              "edit fields" cluster. Each only renders when the host wires it. */}
          {(onSetStatus || onSetPriority || onSetDueDate) && (
            <span className="w-px h-5 bg-border/60 mx-0.5" />
          )}

          {onSetStatus && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  title="Set status"
                  aria-label="Set status"
                  className="flex items-center justify-center size-8 rounded-full text-foreground/80 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
                >
                  <CircleDashed size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" sideOffset={8} className="min-w-[180px]">
                {STATUS_OPTIONS.map((o) => (
                  <DropdownMenuItem
                    key={o.value}
                    onSelect={() => onSetStatus(o.value)}
                    className="gap-2 text-[13px]"
                  >
                    <ElementProgressMark status={o.value} size={14} />
                    <span>{o.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {onSetPriority && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  title="Set priority"
                  aria-label="Set priority"
                  className="flex items-center justify-center size-8 rounded-full text-foreground/80 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
                >
                  <PriorityMark priority="high" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" sideOffset={8} className="min-w-[160px]">
                {PRIORITY_OPTIONS.map((o) => (
                  <DropdownMenuItem
                    key={o.value}
                    onSelect={() => onSetPriority(o.value)}
                    className="gap-2 text-[13px]"
                  >
                    <span className="flex w-5 items-center justify-center"><PriorityMark priority={o.value} /></span>
                    <span>{o.label}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onSelect={() => onSetPriority(null)} className="gap-2 text-[13px]">
                  <span className="flex w-5 items-center justify-center"><PriorityMark priority={null} /></span>
                  <span className="text-muted-foreground">No priority</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {onSetDueDate && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  title="Set due date"
                  aria-label="Set due date"
                  className="flex items-center justify-center size-8 rounded-full text-foreground/80 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
                >
                  <CalendarIcon size={15} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="top" sideOffset={8} className="w-auto p-0 rounded-xl">
                <Calendar
                  mode="single"
                  onSelect={(d) => onSetDueDate(d ? toDateOnlyString(d) : null)}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => onSetDueDate(null)}
                  className="w-full px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 border-t border-border/60 transition-colors"
                >
                  Clear due date
                </button>
              </PopoverContent>
            </Popover>
          )}

          <span className="w-px h-5 bg-border/60 mx-0.5" />

          <BarButton
            icon={<Copy size={15} />}
            label="Duplicate"
            onClick={wrap(onDuplicate)}
            disabled={busy}
          />

          {onMove && (
            <BarButton
              icon={<CornerUpRight size={15} />}
              label="Move to another Object"
              onClick={() => { setConfirmDelete(false); setPicker(picker === 'move' ? null : 'move'); }}
              disabled={busy}
              active={picker === 'move'}
            />
          )}

          {onAddToObject && (
            <BarButton
              icon={<Link2 size={15} />}
              label="Add to another Object (multi-home)"
              onClick={() => { setConfirmDelete(false); setPicker(picker === 'add' ? null : 'add'); }}
              disabled={busy}
              active={picker === 'add'}
            />
          )}

          <BarButton
            icon={<Trash2 size={15} />}
            label="Delete"
            onClick={() => { setPicker(null); setConfirmDelete((v) => !v); }}
            disabled={busy}
            danger
            active={confirmDelete}
          />

          <span className="w-px h-5 bg-border/60 mx-0.5" />

          {/* Borderless ✕ at the far right — same "deselect all" intent as Esc. */}
          <BarButton
            icon={<X size={15} />}
            label="Clear selection (Esc)"
            onClick={onClear}
          />
        </div>

        {/* Object picker popover — opens above the bar */}
        {picker && (
          <div
            ref={popoverRef}
            className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-[280px] max-h-[320px] overflow-y-auto rounded-xl bg-popover shadow-2xl ring-1 ring-border/40 py-1"
          >
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
              {picker === 'move' ? 'Move to Object' : 'Add to Object (multi-home)'}
            </div>
            {visibleObjects.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-muted-foreground/70">
                No other Objects in this Domain
              </div>
            ) : (
              visibleObjects.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => choose(o.id)}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                >
                  <span className="w-4 h-4 flex items-center justify-center text-muted-foreground/70 shrink-0">
                    <ObjectIcon size={14} />
                  </span>
                  <span className="truncate">{o.name}</span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Delete confirmation — destructive, so we ask first. */}
        {confirmDelete && (
          <div
            ref={confirmRef}
            className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-[260px] rounded-xl bg-popover shadow-2xl ring-1 ring-border/40 p-3"
          >
            <div className="text-[13px] font-semibold text-foreground mb-1">
              Delete {count} {noun}?
            </div>
            <div className="text-[12px] text-muted-foreground mb-3">
              This permanently removes {count === 1 ? 'it' : 'them'} and can’t be undone.
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="px-3 py-1.5 text-[12px] rounded-md text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
