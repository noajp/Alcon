'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ElementWithDetails, Worker } from '@/hooks/useSupabase';
import type { ElementPriority } from '@/types/database';
import { updateElement, useAssignableWorkers, addElementAssignee, removeElementAssignee, noticeAssignmentFailed } from '@/hooks/useSupabase';
import { withCurrentWorkers } from '@/Function/shared/assignableWorkers';
import { PriorityMark } from '@/Function/shared/PriorityMark';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { workerTriggerLabel } from '@/Function/shared/workerReach';
import { AssigneeMenuContent } from '@/Function/shared/AssigneeMenu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { Calendar, User, Check } from '@/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar as CalendarPicker } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import { cn } from '@/lib/utils';
import { daysOverdue, formatElementDate, formatRelative, toDateOnlyString, parseDateOnly } from '@/Function/shared/dateUtils';
import { CardAgentControl } from '../agent';
import { ActivitySignal } from '@/Function/shared/element/ActivitySignal';
import { isCancelKey, isCommitEnter, isSubmitChord } from '@/Function/shared/keyboard';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { PRIORITY, PRIORITY_ORDER } from '@/shared/designTokens';
import { StatusPicker } from '@/Function/shared/StatusPicker';
import { ActionTag } from '@/Function/shared/elementAction';
import { isElementAction } from '@/Function/shared/elementActionKinds';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { Chip } from './BoardColumn';

// The Element card: the Board and every Execution Chain draw the same one.
// Top to bottom: past its due date, said first; the chips — the verb it asks
// for, its priority, and what the Status cannot say (waiting on a person, an
// AI run); the Status mark (it opens the status menu) and the title across
// the card's width; "↳" the Object it belongs to, when the host names it;
// then, under a rule, the assignee and AI control at the left and the due
// date, comments and last change at the right.
// Title, due date, priority and assignee are edited on the card; the card
// drags with the Element's id ('text/id'), and the host decides what a drop
// means (a status on the Board).

// A card title reads at most three lines — beyond that it ellipsises, and the
// inline rename box grows to the same three lines before it scrolls. Both
// numbers are the `leading-5` line box, so the box never jumps on click.
const TITLE_MAX_LINES = 3;
const TITLE_LINE_HEIGHT = 20;

interface ElementCardProps {
  element: ElementWithDetails;
  onRefresh?: () => void;
  /** A plain click on the card (not a drag, not one of its inline controls)
   *  opens the Element — the same gesture every other list surface has. */
  onOpen?: (element: ElementWithDetails) => void;
  /** Before the title, at the left. Defaults to the Status mark, which opens
   *  the status menu; a host passes its own to act on a change. */
  lead?: React.ReactNode;
  /** Beside the title, after the verb chip — what the status cannot say (an AI run). */
  badge?: React.ReactNode;
  /** The Object the Element belongs to, shown as a chip under the title. */
  object?: { name: string; icon?: string | null; color?: string | null; isNew?: boolean } | null;
  /** Lines between the title and the footer, for what the host adds. */
  extra?: React.ReactNode;
}

export function ElementCard({ element, onRefresh, onOpen, lead, badge, object, extra }: ElementCardProps) {
  const { t } = useI18n();
  // Who can be assigned to THIS Element, read when the assignee menu opens;
  // the people already on it stay listed so they can be removed.
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const { data: candidates } = useAssignableWorkers({ elementId: element.id }, assigneeMenuOpen);
  const workers = useMemo(
    () => withCurrentWorkers(candidates, (element.assignees ?? []).map((a) => a.worker as Worker | null | undefined)),
    [candidates, element.assignees],
  );
  const draggingRef = React.useRef(false);
  const startPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const weekStartsOn = usePreference(getCachedWeekStartsOn);

  const assignee = element.assignees?.[0]?.worker;
  const dueDate = parseDateOnly(element.due_date, null);
  const priority = element.priority;
  // Days past due for open work (0 when not due, not dated, or closed).
  const overdueDays = element.status === 'done' || element.status === 'cancelled' ? 0 : daysOverdue(element.due_date);

  // Inline editing on the card: title (click to rename) + due date (click to
  // pick). Inner controls stop pointer/click propagation so they don't kick
  // off a card drag, and the card stops being draggable while the title edits.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(element.title);
  // A title changed elsewhere replaces the draft, during render.
  const [titleFor, setTitleFor] = useState(element.title);
  if (titleFor !== element.title) { setTitleFor(element.title); setTitleDraft(element.title); }
  // The rename box is a textarea sized to its own content: a fixed rows={1}
  // collapsed a wrapped title to a single line the moment it was clicked.
  const titleRef = React.useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (!editingTitle || !el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TITLE_MAX_LINES * TITLE_LINE_HEIGHT)}px`;
  }, [editingTitle, titleDraft]);

  const saveTitle = async () => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (!next) { setTitleDraft(element.title); return; }
    if (next !== element.title) {
      try { await updateElement(element.id, { title: next }); onRefresh?.(); }
      catch (e) { console.error('Failed to rename element', e); }
    }
  };
  const saveDate = async (d: Date | undefined) => {
    try { await updateElement(element.id, { due_date: d ? toDateOnlyString(d) : null }); onRefresh?.(); }
    catch (e) { console.error('Failed to set due date', e); }
  };
  const savePriority = async (p: ElementPriority | null) => {
    try { await updateElement(element.id, { priority: p }); onRefresh?.(); }
    catch (e) { console.error('Failed to set priority', e); }
  };
  const addAssignee = async (workerId: string) => {
    const w = workers.find((x) => x.id === workerId);
    if (!w) return;
    try {
      await addElementAssignee({ element_id: element.id, worker_id: w.id, role: 'assignee', worker: w });
      onRefresh?.();
    } catch (e) { noticeAssignmentFailed(e); }
  };
  const removeAssignee = async (assigneeId: string) => {
    try {
      await removeElementAssignee(assigneeId);
      onRefresh?.();
    } catch (e) { noticeAssignmentFailed(e); }
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      draggable={!editingTitle}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/id', element.id);
        draggingRef.current = false;
      }}
      // A new press starts clean: the drag flag used to stick after a
      // text-select in the title (mousemove without a dragstart), swallowing
      // every later click on the card.
      onMouseDown={(e) => { draggingRef.current = false; startPosRef.current = { x: e.clientX, y: e.clientY }; }}
      onMouseMove={(e) => {
        if (!startPosRef.current) return;
        if (Math.abs(e.clientX - startPosRef.current.x) > 5 || Math.abs(e.clientY - startPosRef.current.y) > 5) {
          draggingRef.current = true;
        }
      }}
      onMouseUp={() => { startPosRef.current = null; }}
      // Opens on a plain click on the card itself. Two things are not that:
      // a drag (the heuristic above), and a click inside one of the card's
      // popovers — Radix renders those in a portal, so React still bubbles
      // the event here even though the target is not a DOM descendant.
      // Picking a due date must not also navigate away.
      onClick={(e) => {
        if (draggingRef.current) return;
        if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
        onOpen?.(element);
      }}
      // Hover tints the card as a list row is tinted (the foreground at 6%,
      // laid over the card's own ground as an image so the ground stays).
      className="group/card rounded-lg border border-[var(--border-subtle)] bg-card dark:bg-muted shadow-[var(--shadow-island)] hover:bg-[linear-gradient(color-mix(in_oklab,var(--foreground)_6%,transparent),color-mix(in_oklab,var(--foreground)_6%,transparent))] transition-colors cursor-grab active:cursor-grabbing"
    >
      <div className="px-3.5 py-3">
        {/* Past its due date and still open: said first, across the top. */}
        {overdueDays > 0 && (
          <p className="mb-1.5 text-[11px] font-medium" style={{ color: 'var(--status-danger)' }}>
            {t('{n} days past due', { n: overdueDays })}
          </p>
        )}
        {/* The chips: what it asks for, how urgent, and what the Status
            cannot say (waiting on a person, an AI run). */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {isElementAction(element.action) && <Chip><ActionTag action={element.action} /></Chip>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" onPointerDown={stop} onClick={stop}
                className={cn('rounded-md transition-colors', priority ? 'inline-flex' : 'hidden group-hover/card:inline-flex group-focus-within/card:inline-flex data-[state=open]:inline-flex')}>
                <Chip className="hover:bg-muted">
                  {priority ? <><PriorityMark priority={priority} /><span>{t(PRIORITY[priority]?.label ?? priority)}</span></> : <span>{t('Priority')}</span>}
                </Chip>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[140px]" onPointerDown={stop}>
              {PRIORITY_ORDER.map((p) => (
                <DropdownMenuItem key={p} onClick={() => savePriority(p)} className="gap-2 text-[13px]">
                  <PriorityMark priority={p} />
                  <span className="flex-1">{t(PRIORITY[p as keyof typeof PRIORITY]?.label ?? p)}</span>
                  {priority === p && <Check size={12} className="text-muted-foreground" />}
                </DropdownMenuItem>
              ))}
              {priority && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => savePriority(null)} className="text-[12px] text-muted-foreground">
                    {t('Clear')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {badge}
        </div>

        {/* The Status mark, then the title across the card's width. */}
        <div className="mt-2 flex items-start gap-2">
          <div className="flex h-5 shrink-0 items-center">
            {lead ?? (
              <span onPointerDown={stop} onClick={stop} className="flex">
                <StatusPicker element={element} onChanged={() => onRefresh?.()} />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <textarea
                autoFocus
                ref={titleRef}
                rows={1}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  // Enter (not an IME conversion) and Escape both end the rename
                  // and save, like the detail page's title.
                  if (isCommitEnter(e) || isSubmitChord(e) || isCancelKey(e)) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).blur(); }
                }}
                onPointerDown={stop}
                onClick={stop}
                className="w-full text-[14px] font-semibold text-foreground leading-5 bg-transparent border-none resize-none overflow-y-auto"
              />
            ) : (
              <p
                className="text-[14px] font-semibold text-foreground leading-5 -mx-1 px-1 rounded cursor-text line-clamp-3 break-words"
                title={t('Click to rename')}
                onPointerDown={stop}
                onClick={(e) => { stop(e); setEditingTitle(true); }}
              >
                {element.title}
              </p>
            )}
            {/* Where it belongs. */}
            {object && (
              <p className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground" title={object.name}>
                <span aria-hidden className="shrink-0">↳</span>
                <ItemIcon icon={object.icon ?? null} color={object.color ?? null} size={11} fallback={<ObjectIcon size={11} />} />
                <span className="truncate">{object.name}</span>
                {object.isNew && <span className="shrink-0 text-muted-foreground/70">· {t('new')}</span>}
              </p>
            )}
          </div>
        </div>
        {extra}

        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/50 pt-2">
          <div className="flex min-w-0 items-center gap-1">
            {/* Assignee — click to assign / change. */}
            <DropdownMenu open={assigneeMenuOpen} onOpenChange={setAssigneeMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onPointerDown={stop}
                  onClick={stop}
                  title={t('Assignee')}
                  aria-label={workerTriggerLabel(t('Assignee'), assignee)}
                  className="inline-flex items-center justify-center rounded-full transition-shadow hover:ring-2 hover:ring-border/60"
                >
                  {assignee ? (
                    <WorkerAvatar worker={assignee} size={20} />
                  ) : (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                      <User className="h-3 w-3" />
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <AssigneeMenuContent
                variant="toggle"
                align="start"
                className="min-w-[180px]"
                onPointerDown={stop}
                assignees={element.assignees}
                workers={workers}
                element={element}
                onAdd={addAssignee}
                onRemove={removeAssignee}
              />
            </DropdownMenu>
            {/* A closed Element has nothing left for an AI to do. */}
            {element.status !== 'done' && element.status !== 'cancelled' && (
              <CardAgentControl elementId={element.id} onFinished={onRefresh} />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2.5 text-[12px] text-muted-foreground">
            {/* Due date — click to pick / change. Unset, it appears only while
                the card is hovered or has keyboard focus inside it. */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onPointerDown={stop}
                  onClick={stop}
                  className={cn(
                    'items-center gap-1 -mx-1 px-1 rounded hover:bg-muted/40 hover:text-foreground transition-colors',
                    dueDate ? 'flex' : 'hidden opacity-60 group-hover/card:flex group-focus-within/card:flex data-[state=open]:flex',
                  )}
                  style={overdueDays > 0 ? { color: 'var(--status-danger)' } : undefined}
                >
                  <Calendar className="h-3 w-3" />
                  {dueDate ? formatElementDate(dueDate) : t('Date')}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 rounded-lg" align="end" onPointerDown={stop}>
                <CalendarPicker
                  mode="single"
                  selected={dueDate ?? undefined}
                  onSelect={(d) => saveDate(d ?? undefined)}
                  autoFocus
                  weekStartsOn={weekStartsOn}
                />
              </PopoverContent>
            </Popover>
            {/* Same signal the list rows and the Activity column show. */}
            <ActivitySignal activity={element.activity} />
            {/* When it last changed, as the work's pulse. */}
            <span className="tabular-nums" title={t('Last updated')}>{formatRelative(element.updated_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

