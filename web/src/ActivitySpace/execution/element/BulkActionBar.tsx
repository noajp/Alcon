'use client';

import { STATUS_OPTIONS, PRIORITY_OPTIONS } from '@/shared/designTokens';
import { useEffect, useRef, useState } from 'react';
import { Trash2, Copy, CornerUpRight, Link2, X, CalendarIcon, CircleDashed, UserRound } from '@/ui/icons';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import type { ElementStatus, ElementPriority } from '@/types/database';
import { ObjectIcon } from '@/shell/icons';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/ui/tooltip';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { Calendar } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { PriorityMark } from '@/Function/shared/PriorityMark';
import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';


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
  /** Hand the selection to one person: they become each Element's assignee.
   *  Resolves to how many Elements could not be handed over. */
  onSetAssignee?: (workerId: string) => Promise<number>;
  /** Who the selection can be handed to. */
  assigneeOptions?: readonly { id: string; name: string; hint?: string | null }[];
  onClear: () => void;
}

type PickerMode = 'move' | 'add';

/** The bar shows at most one thing above itself, and this is why: the picker
 *  and the delete confirmation were two independent states kept apart only by
 *  every opener remembering to close the other. One value, so two cannot be
 *  open at once — not by discipline, but because there is nowhere to put the
 *  second one. */
type Overlay = { kind: 'picker'; mode: PickerMode } | { kind: 'confirmDelete' } | null;

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
              ? 'text-[var(--status-danger)] hover:text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10'
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
  onSetAssignee,
  assigneeOptions = [],
  onClear,
}: BulkActionBarProps) {
  const { t } = useI18n();
  const [assigneeQuery, setAssigneeQuery] = useState('');
  // A notice belongs to the selection it was about: shown while that many
  // Elements are selected, gone once the selection changes.
  const [noticeState, setNoticeState] = useState<{ text: string; count: number } | null>(null);
  if (count === 0 && noticeState) setNoticeState(null);
  const notice = noticeState && noticeState.count === count ? noticeState.text : null;
  const [overlay, setOverlay] = useState<Overlay>(null);
  const picker = overlay?.kind === 'picker' ? overlay.mode : null;
  const confirmDelete = overlay?.kind === 'confirmDelete';
  const [busy, setBusy] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  // Hoisted above the `count === 0` early return below — hooks can't follow
  // a conditional return.
  const weekStartsOn = usePreference(getCachedWeekStartsOn);

  // Close any open popover on Esc (one level: the popover, not the selection
  // under it) or outside click.
  useEscapeLayer(overlay !== null, () => setOverlay(null));
  useEffect(() => {
    if (!overlay) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      const open = overlay.kind === 'picker' ? popoverRef.current : confirmRef.current;
      if (open && !open.contains(t)) setOverlay(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [overlay]);

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
      setOverlay(null);
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (busy) return;
    setBusy(true);
    try { await onDelete(); setOverlay(null); }
    finally { setBusy(false); }
  };

  const visibleObjects = pickerObjects.filter(o => o.id !== excludeObjectId);

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto relative">
        {notice && (
          <p role="status" className="absolute bottom-full left-1/2 mb-2 w-max max-w-[min(90vw,420px)] -translate-x-1/2 rounded-md bg-popover px-3 py-1.5 text-[12px] text-[var(--status-warning)] shadow-lg ring-1 ring-border">
            {notice}
          </p>
        )}
        <div className="flex items-center gap-0.5 rounded-full bg-popover/95 backdrop-blur-md shadow-2xl ring-1 ring-border px-2 py-1.5">
          <span className="pl-2 pr-2 text-[12px] font-medium text-foreground tabular-nums whitespace-nowrap">
            {t(count === 1 ? '{n} Element selected' : '{n} Elements selected', { n: count })}
          </span>

          {/* Bulk field edits (status / priority / due date) — Asana's
              "edit fields" cluster. Each only renders when the host wires it. */}
          {(onSetStatus || onSetPriority || onSetDueDate || onSetAssignee) && (
            <span className="w-px h-5 bg-border/60 mx-0.5" />
          )}

          {onSetStatus && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  title={t('Set status')}
                  aria-label={t('Set status')}
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
                    <span>{t(o.label)}</span>
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
                  title={t('Set priority')}
                  aria-label={t('Set priority')}
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
                    <span>{t(o.label)}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onSelect={() => onSetPriority(null)} className="gap-2 text-[13px]">
                  <span className="flex w-5 items-center justify-center"><PriorityMark priority={null} /></span>
                  <span className="text-muted-foreground">{t('No priority')}</span>
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
                  title={t('Set due date')}
                  aria-label={t('Set due date')}
                  className="flex items-center justify-center size-8 rounded-full text-foreground/80 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
                >
                  <CalendarIcon size={15} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="top" sideOffset={8} className="w-auto p-0 rounded-lg">
                <Calendar
                  mode="single"
                  onSelect={(d) => onSetDueDate(d ? toDateOnlyString(d) : null)}
                  autoFocus
                  weekStartsOn={weekStartsOn}
                />
                <button
                  type="button"
                  onClick={() => onSetDueDate(null)}
                  className="w-full px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 border-t border-border/60 transition-colors"
                >
                  {t('Clear due date')}
                </button>
              </PopoverContent>
            </Popover>
          )}

          {onSetAssignee && (
            <DropdownMenu onOpenChange={(open) => { if (!open) setAssigneeQuery(''); }}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  title={t('Set assignee')}
                  aria-label={t('Set assignee')}
                  className="flex items-center justify-center size-8 rounded-full text-foreground/80 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
                >
                  <UserRound size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-[240px]">
                <input
                  autoFocus
                  aria-label={t('Find a person')}
                  placeholder={t('Find a person')}
                  value={assigneeQuery}
                  onChange={(e) => setAssigneeQuery(e.target.value)}
                  // Typing stays in the field; ArrowDown moves into the list of people.
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      (e.currentTarget.parentElement?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
                      return;
                    }
                    if (e.key !== 'Escape') e.stopPropagation();
                  }}
                  className="mb-1 h-7 w-full rounded-sm bg-muted/30 px-2 text-[13px] outline-none hover:bg-muted/40 focus:bg-muted/60"
                />
                <div className="max-h-64 overflow-y-auto">
                  {assigneeOptions
                    .filter((o) => !assigneeQuery.trim() || o.name.toLowerCase().includes(assigneeQuery.trim().toLowerCase()))
                    .map((o) => (
                      <DropdownMenuItem
                        key={o.id}
                        onSelect={() => void wrap(async () => {
                          try {
                            const failed = await onSetAssignee(o.id);
                            setNoticeState(failed ? { text: t('{n} not fully handed to {name} — still selected. They may not be assignable there, or the change needs the Domain’s owner or admin.', { n: failed, name: o.name }), count: failed } : null);
                          } catch (e) {
                            setNoticeState({ text: e instanceof Error ? e.message : t('Could not set the assignee.'), count });
                          }
                        })()}
                        className="gap-2 text-[13px]"
                      >
                        <span className="min-w-0 flex-1 truncate">{o.name}</span>
                        {o.hint && <span className="text-[11px] text-muted-foreground">{o.hint}</span>}
                      </DropdownMenuItem>
                    ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <span className="w-px h-5 bg-border/60 mx-0.5" />

          <BarButton
            icon={<Copy size={15} />}
            label={t('Duplicate')}
            onClick={wrap(onDuplicate)}
            disabled={busy}
          />

          {onMove && (
            <BarButton
              icon={<CornerUpRight size={15} />}
              label={t('Move to another Object')}
              onClick={() => setOverlay(picker === 'move' ? null : { kind: 'picker', mode: 'move' })}
              disabled={busy}
              active={picker === 'move'}
            />
          )}

          {onAddToObject && (
            <BarButton
              icon={<Link2 size={15} />}
              label={t('Add to another Object (multi-home)')}
              onClick={() => setOverlay(picker === 'add' ? null : { kind: 'picker', mode: 'add' })}
              disabled={busy}
              active={picker === 'add'}
            />
          )}

          <BarButton
            icon={<Trash2 size={15} />}
            label={t('Delete')}
            onClick={() => setOverlay(confirmDelete ? null : { kind: 'confirmDelete' })}
            disabled={busy}
            danger
            active={confirmDelete}
          />

          <span className="w-px h-5 bg-border/60 mx-0.5" />

          {/* Borderless ✕ at the far right — same "deselect all" intent as Esc. */}
          <BarButton
            icon={<X size={15} />}
            label={t('Clear selection (Esc)')}
            onClick={onClear}
          />
        </div>

        {/* Object picker popover — opens above the bar */}
        {picker && (
          <div
            ref={popoverRef}
            className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-[280px] max-h-[320px] overflow-y-auto rounded-lg bg-popover shadow-2xl ring-1 ring-border/40 py-1"
          >
            <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
              {picker === 'move' ? t('Move to Object') : t('Add to Object (multi-home)')}
            </div>
            {visibleObjects.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-muted-foreground/70">
                {t('No other Objects in this Domain')}
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
            className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-[260px] rounded-lg bg-popover shadow-2xl ring-1 ring-border/40 p-3"
          >
            <div className="text-[13px] font-semibold text-foreground mb-1">
              {t(count === 1 ? 'Delete {n} Element?' : 'Delete {n} Elements?', { n: count })}
            </div>
            <div className="text-[12px] text-muted-foreground mb-3">
              {count === 1 ? t('This permanently removes it and can’t be undone.') : t('This permanently removes them and can’t be undone.')}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOverlay(null)}
                disabled={busy}
                className="px-3 py-1.5 text-[12px] rounded-md text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                {t('Cancel')}
              </button>
              <button
                type="button"
                onClick={runDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md bg-[var(--status-danger)] text-white hover:bg-[var(--status-danger)] transition-colors disabled:opacity-50"
              >
                <Trash2 size={12} /> {t('Delete')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
