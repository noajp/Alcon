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
import { formatElementDate, toDateOnlyString, parseDateOnly } from '@/Function/shared/dateUtils';
import { CardAgentControl } from '../agent';
import { ActivitySignal } from '@/Function/shared/element/ActivitySignal';
import { isCancelKey, isCommitEnter, isSubmitChord } from '@/Function/shared/keyboard';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { PRIORITY, PRIORITY_ORDER } from '@/shared/designTokens';

// The Element card: the Board's columns and a Strategy's Execution tab draw
// the same one. Title, due date, priority and assignee are edited on the
// card; the card drags with the Element's id ('text/id'), and the host
// decides what a drop means (a status on the Board, an Object on the
// Execution tab).

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
  /** Beside the title, at the right — where the Execution tab says how the
   *  work stands. */
  badge?: React.ReactNode;
  /** Lines between the title and the footer, for what the host adds. */
  extra?: React.ReactNode;
}

export function ElementCard({ element, onRefresh, onOpen, badge, extra }: ElementCardProps) {
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
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
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
            className="w-full text-[13px] font-medium text-foreground leading-5 bg-transparent border-none resize-none overflow-y-auto"
          />
        ) : (
          <p
            className="text-[13px] font-medium text-foreground leading-5 -mx-1 px-1 rounded cursor-text line-clamp-3 break-words"
            title={t('Click to rename')}
            onPointerDown={stop}
            onClick={(e) => { stop(e); setEditingTitle(true); }}
          >
            {element.title}
          </p>
        )}
        </div>
        {badge}
        </div>
        {extra}

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            {/* Due date — click to pick / change. Unset, it appears only while
                the card is hovered or has keyboard focus inside it: a column
                of "Date · Priority" placeholders is chrome on every card. */}
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
                >
                  <Calendar className="h-3 w-3" />
                  {dueDate ? formatElementDate(dueDate) : t('Date')}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 rounded-lg" align="start" onPointerDown={stop}>
                <CalendarPicker
                  mode="single"
                  selected={dueDate ?? undefined}
                  onSelect={(d) => saveDate(d ?? undefined)}
                  autoFocus
                  weekStartsOn={weekStartsOn}
                />
              </PopoverContent>
            </Popover>
            {/* Priority — click to change. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onPointerDown={stop}
                  onClick={stop}
                  className={cn(
                    'items-center gap-1 -mx-1 px-1 rounded hover:bg-muted/40 hover:text-foreground transition-colors',
                    priority ? 'inline-flex' : 'hidden opacity-60 group-hover/card:inline-flex group-focus-within/card:inline-flex data-[state=open]:inline-flex',
                  )}
                >
                  {priority ? (
                    <>
                      <PriorityMark priority={priority} />
                      <span>{t(PRIORITY[priority]?.label ?? priority)}</span>
                    </>
                  ) : (
                    <span>{t('Priority')}</span>
                  )}
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
          </div>
          <div className="flex items-center gap-1">
            {/* Same signal the list rows and the Activity column show. */}
            <ActivitySignal activity={element.activity} className="mr-1" />
            {/* A closed Element has nothing left for an AI to do. */}
            {element.status !== 'done' && element.status !== 'cancelled' && (
              <CardAgentControl elementId={element.id} onFinished={onRefresh} />
            )}
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
                align="end"
                className="min-w-[180px]"
                onPointerDown={stop}
                assignees={element.assignees}
                workers={workers}
                element={element}
                onAdd={addAssignee}
                onRemove={removeAssignee}
              />
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

