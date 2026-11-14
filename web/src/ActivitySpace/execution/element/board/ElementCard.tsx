'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ElementWithDetails, Worker } from '@/hooks/useSupabase';
import type { ElementPriority } from '@/types/database';
import { updateElement, useAssignableWorkers, addElementAssignee, removeElementAssignee, noticeAssignmentFailed } from '@/hooks/useSupabase';
import { withCurrentWorkers } from '@/Function/shared/assignableWorkers';
import { PriorityMark } from '@/Function/shared/PriorityMark';
import { WorkerAvatarStack } from '@/Function/shared/WorkerAvatar';
import { workerTriggerLabel } from '@/Function/shared/workerReach';
import { AssigneeMenuContent } from '@/Function/shared/AssigneeMenu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, MenuCheck } from '@/ui/dropdown-menu';
import { Calendar, User } from '@/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar as CalendarPicker } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import { cn } from '@/lib/utils';
import { daysOverdue, formatElementDate, toDateOnlyString, parseDateOnly } from '@/Function/shared/dateUtils';
import { CardAgentControl } from '../agent';
import { ActivitySignal } from '@/Function/shared/element/ActivitySignal';
import { isCancelKey, isCommitEnter, isSubmitChord } from '@/Function/shared/keyboard';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { PRIORITY, PRIORITY_ORDER } from '@/shared/designTokens';
import { ActionTag } from '@/Function/shared/elementAction';
import { isElementAction } from '@/Function/shared/elementActionKinds';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { BOARD_CARD, CardDescription, Chip } from './BoardColumn';

// The Element card: every Execution Chain draws the same one.
// Top to bottom: the headline — the title on one line, and the priority
// mark at the right; the Object it belongs to as a chip under the title,
// when the host names it; the chips — the verb it asks for,
// what the Status cannot say (waiting on a person, an AI run), and its days
// past due when it is overdue; then, under a rule, the assignee and AI
// control at the left and the due date and comments at the right — one date
// only: when the work last moved is the Activity signal's tooltip, not a
// second date on the card.
// Title, due date, priority and assignee are edited on the card; the card
// drags with the Element's id ('text/id'), and the host decides what a drop
// means.

// A card title reads on one line — beyond that it ellipsises (the whole
// title lives on the Element's own view, and in the title's tooltip), and
// the inline rename box is the same one line. The number is the
// `leading-[22px]` line box, so the box never jumps on click.
const TITLE_MAX_LINES = 1;
const TITLE_LINE_HEIGHT = 22;

// The execute rail's geometry (card hover-execute design, D7): one
// number family — a 112px rail (w-28), armed from the card's right 28px
// edge zone, and peeked as a 28px tab where there is no hover.
const EXECUTE_RAIL_EDGE_PX = 28;

/** Pure. Whether a pointer x sits inside the card's right edge zone. */
export function isExecuteEdgeZone(clientX: number, cardRight: number): boolean {
  return clientX >= cardRight - EXECUTE_RAIL_EDGE_PX;
}

/** The rail's arrow, thick on purpose (owner addendum, 2026-11-10): a
 *  heavy stroke, not the hairline action glyph. Exported so every
 *  execute affordance — the rail, the Object chip segments on the
 *  Chain and in the Cascade — carries the same glyph, never a redraw. */
function ThickArrowRight({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 12h16M13.5 5.5 20 12l-6.5 6.5" />
    </svg>
  );
}

interface ElementCardProps {
  element: ElementWithDetails;
  onRefresh?: () => void;
  /** A plain click on the card (not a drag, not one of its inline controls)
   *  opens the Element — the same gesture every other list surface has. */
  onOpen?: (element: ElementWithDetails) => void;
  /** In the chips row under the headline, after the verb chip — what the
   *  status cannot say (an AI run). */
  badge?: React.ReactNode;
  /** The Object the Element belongs to, shown as a chip under the title. */
  object?: { id?: string; name: string; icon?: string | null; color?: string | null; isNew?: boolean; via?: string } | null;
  /** Lines between the title and the footer, for what the host adds. */
  extra?: React.ReactNode;
  /** The hover-execute rail's press (card hover-execute, PR1): the host
   *  opens its ExecutePlanDialog for this Element. A host that passes
   *  nothing renders the card exactly as before — no rail, no tab. */
  onExecute?: (element: ElementWithDetails) => void;
  /** The Object chip's execute segment press (card hover-execute, PR2):
   *  the host opens its ExecutePlanDialog for the Object the chip
   *  names. Rendered only when the chip's Object carries an id and the
   *  host passes this — a pill cannot slide, so the affordance is a
   *  trailing segment on the chip (§3.5), never a second meaning for
   *  the chip's body. */
  onExecuteObject?: (objectId: string) => void;
}

export function ElementCard({ element, onRefresh, onOpen, badge, object, extra, onExecute, onExecuteObject }: ElementCardProps) {
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
  // The due-date calendar is a controlled popover: picking a day settles
  // the date, so the calendar closes with the pick.
  const [dateOpen, setDateOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(element.title);
  // A title changed elsewhere replaces the draft, during render.
  const [titleFor, setTitleFor] = useState(element.title);
  if (titleFor !== element.title) { setTitleFor(element.title); setTitleDraft(element.title); }
  // The rename box is a textarea sized to its own content, capped at the
  // title's one line: a fixed rows={1} alone would let it grow past the
  // line box the resting title reads in.
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

  // The execute rail (card hover-execute, PR1): armed when the pointer
  // reaches the card's right edge zone, then held while the pointer
  // stays on the card, so pushing to the edge and clicking the rail
  // that slides in under the cursor is one gesture. A drag collapses
  // and suppresses it — the drag image is always the resting card.
  // Touch has no hover: a 28px tab peeks instead, its first tap reveals
  // the full rail without activating, its second activates. A closed
  // Element has nothing left for an AI to do (the footer's own rule),
  // so it grows no rail.
  const canExecute = !!onExecute && element.status !== 'done' && element.status !== 'cancelled';
  const [armed, setArmed] = useState(false);
  const [touchRevealed, setTouchRevealed] = useState(false);
  const [draggingCard, setDraggingCard] = useState(false);
  const railRevealed = canExecute && !draggingCard && (armed || touchRevealed);

  return (
    <div
      draggable={!editingTitle}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/id', element.id);
        draggingRef.current = false;
        setArmed(false);
        setTouchRevealed(false);
        setDraggingCard(true);
      }}
      onDragEnd={() => setDraggingCard(false)}
      onPointerMove={(e) => {
        if (!canExecute || e.pointerType === 'touch') return;
        if (isExecuteEdgeZone(e.clientX, e.currentTarget.getBoundingClientRect().right)) setArmed(true);
      }}
      onPointerLeave={() => { setArmed(false); setTouchRevealed(false); }}
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
      className={`group/card relative cursor-grab overflow-hidden active:cursor-grabbing ${BOARD_CARD}`}
    >
      {/* The track: the card's content in a full-width cell, the execute
          rail in a 112px cell after it, clipped by the root. Revealed,
          the track slides left by exactly the rail's width and the rail
          lands flush at the card's right edge, full height — the card's
          box never resizes. Keyboard: the track also slides on
          focus-within, so tabbing to the rail reveals it first. */}
      <div className={cn(
        'flex motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
        railRevealed ? '-translate-x-28' : 'translate-x-0',
        canExecute && 'group-focus-within/card:-translate-x-28',
      )}>
      <div className="w-full shrink-0 p-3">
        {/* The headline: the title on one line, and the priority at the
            row's right end. No Status on the card — the column it stands
            in says where the work stands. */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {editingTitle ? (
                <textarea
                  autoFocus
                  aria-label={t('Element title')}
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
                  className="min-w-0 flex-1 text-[14px] font-medium text-foreground leading-[22px] bg-transparent border-none resize-none overflow-y-auto"
                />
              ) : (
                <button
                  type="button"
                  aria-label={t('Rename {title}', { title: element.title })}
                  className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium text-foreground leading-[22px] -mx-1 px-1 rounded cursor-text"
                  title={element.title}
                  onPointerDown={stop}
                  onClick={(e) => { stop(e); setEditingTitle(true); }}
                >
                  {element.title}
                </button>
              )}
              {/* The priority: the mark alone, always on the card — the slot
                  never appears or vanishes, and unset reads as the muted
                  mark. The menu keeps the words. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" onPointerDown={stop} onClick={stop}
                    title={priority ? t(PRIORITY[priority]?.label ?? priority) : t('Priority')}
                    aria-label={priority ? t(PRIORITY[priority]?.label ?? priority) : t('Priority')}
                    className="inline-flex shrink-0 items-center justify-center rounded-md p-0.5 transition-colors hover:bg-muted">
                    <PriorityMark priority={priority} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[140px]" onPointerDown={stop}>
                  {PRIORITY_ORDER.map((p) => (
                    <DropdownMenuItem key={p} onClick={() => savePriority(p)} className="gap-2 text-[13px]">
                      <PriorityMark priority={p} />
                      <span className="flex-1">{t(PRIORITY[p as keyof typeof PRIORITY]?.label ?? p)}</span>
                      {priority === p && <MenuCheck />}
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
            </div>
            <CardDescription html={element.description} />
            {/* Where it belongs: a chip in the Label chips' own form —
                the Object's icon and name inside the pill, never a bare
                text line. */}
            {(object || element.type) && (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
                {element.type && <Chip className="max-w-full"><span className="truncate">{element.type}</span></Chip>}
                {/* On a board that spans a Strategy's subtree: the
                    Strategy under it that this work came by. */}
                {object?.via && (
                  <Chip title={object.via} className="max-w-full">
                    <NavStrategyIcon size={11} className="shrink-0" />
                    <span className="truncate">{object.via}</span>
                  </Chip>
                )}
                {object && <Chip title={object.name} className="max-w-full">
                  <ItemIcon icon={object.icon ?? null} color={object.color ?? null} size={11} fallback={<ObjectIcon size={11} />} />
                  <span className="truncate">{object.name}</span>
                  {object.isNew && <span className="shrink-0 text-muted-foreground/70">· {t('new')}</span>}
                  {/* The Object's execute segment (PR2, §3.5): a trailing
                      segment on the chip, apart from its body — the chip
                      still only names the Object. It follows the rail's
                      reveal discipline without the slide: shown while
                      the card is armed, hovered or focused within, and
                      always where there is no hover. */}
                  {object.id && onExecuteObject && (
                    <button type="button" aria-label={t('Execute Object')} title={t('Execute Object')}
                      onPointerDown={stop}
                      onClick={(e) => { stop(e); onExecuteObject(object.id!); }}
                      className={cn(
                        '-mr-0.5 ml-0.5 flex shrink-0 items-center border-l border-border/60 pl-1 transition-opacity hover:text-foreground',
                        railRevealed ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:opacity-100',
                      )}>
                      <ThickArrowRight size={11} />
                    </button>
                  )}
                </Chip>}
              </div>
            )}
          </div>
        </div>
        {/* The chips: past due first when it is, then what it asks for and
            what the Status cannot say (waiting on a person, an AI run).
            The row renders only when it has something to say. */}
        {(overdueDays > 0 || isElementAction(element.action) || badge) && (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {overdueDays > 0 && (
              <Chip className="border-transparent"
                style={{ color: 'var(--status-danger)', background: 'color-mix(in srgb, var(--status-danger) 14%, transparent)' }}>
                {t('{n} days past due', { n: overdueDays })}
              </Chip>
            )}
            {isElementAction(element.action) && <Chip><ActionTag action={element.action} /></Chip>}
            {badge}
          </div>
        )}
        {extra}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
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
                    // Everyone it is assigned to, overlapping; past three, a count.
                    <WorkerAvatarStack workers={(element.assignees ?? []).map((a) => a.worker)} size={20} />
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
            {/* Due date — click to pick / change. Unset, it appears only while
                the card is hovered or has keyboard focus inside it. */}
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onPointerDown={stop}
                  onClick={stop}
                  className={cn(
                    'items-center gap-1 px-1 rounded text-[12px] text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors',
                    dueDate ? 'flex' : 'hidden opacity-60 group-hover/card:flex group-focus-within/card:flex data-[state=open]:flex',
                  )}
                  style={overdueDays > 0 ? { color: 'var(--status-danger)' } : undefined}
                >
                  <Calendar className="h-3 w-3" />
                  {dueDate ? formatElementDate(dueDate) : t('Date')}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 rounded-lg" align="start" onPointerDown={stop}>
                <CalendarPicker
                  mode="single"
                  selected={dueDate ?? undefined}
                  onSelect={(d) => { void saveDate(d ?? undefined); setDateOpen(false); }}
                  autoFocus
                  weekStartsOn={weekStartsOn}
                />
              </PopoverContent>
            </Popover>
            {/* A closed Element has nothing left for an AI to do. */}
            {element.status !== 'done' && element.status !== 'cancelled' && (
              <CardAgentControl elementId={element.id} onFinished={onRefresh} />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2.5 text-[12px] text-muted-foreground">
            {/* Same signal the list rows and the Activity column show. */}
            <ActivitySignal activity={element.activity} />
          </div>
        </div>
      </div>
      {canExecute && (
        <button
          type="button"
          aria-label={t('Execute Element')}
          onPointerDown={stop}
          onClick={(e) => { stop(e); onExecute?.(element); }}
          className="flex w-28 shrink-0 flex-col items-center justify-center gap-1.5 bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <ThickArrowRight size={26} />
          <span className="text-center text-[11px] font-medium leading-tight">{t('Execute Element')}</span>
        </button>
      )}
      </div>
      {/* Touch (no hover): the rail's first 28px as an always-visible
          tab at the right edge. The first tap reveals the full rail
          without activating; the second tap activates. */}
      {canExecute && (
        <button
          type="button"
          aria-label={t('Execute Element')}
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            if (!touchRevealed) setTouchRevealed(true);
            else onExecute?.(element);
          }}
          className="absolute right-0 top-0 z-10 hidden h-full w-7 items-center justify-center bg-primary text-primary-foreground [@media(hover:none)]:flex"
        >
          <ThickArrowRight size={17} />
        </button>
      )}
    </div>
  );
}

