'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ElementWithDetails, Worker } from '@/hooks/useSupabase';
import type { ElementPriority } from '@/types/database';
import { updateElement, createElement, useWorkers, addElementAssignee, removeElementAssignee, useElementCommentActivity, withCommentActivity } from '@/hooks/useSupabase';
import { Skeleton } from '@/ui/skeleton';
import { PriorityMark } from '@/Function/shared/PriorityMark';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { workerTriggerLabel } from '@/Function/shared/workerReach';
import { AssigneeMenuContent } from '@/Function/shared/AssigneeMenu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { PRIORITY_OPTIONS } from '@/Function/shared/listControls/types';
import { Plus, Calendar, User, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar as CalendarPicker } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import { cn } from '@/lib/utils';
import { formatElementDate, toDateOnlyString } from '@/Function/shared/dateUtils';
import { CardAgentControl } from '../agent';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { ActivitySignal } from '../ActivitySignal';

// A card title reads at most three lines — beyond that it ellipsises, and the
// inline rename box grows to the same three lines before it scrolls. Both
// numbers are the `leading-5` line box, so the box never jumps on click.
const TITLE_MAX_LINES = 3;
const TITLE_LINE_HEIGHT = 20;

type ElementStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled';

const COLUMNS: { status: ElementStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'cancelled', label: 'Cancelled' },
];

interface ElementCardProps {
  element: ElementWithDetails;
  workers: Worker[];
  onRefresh?: () => void;
  /** A plain click on the card (not a drag, not one of its inline controls)
   *  opens the Element — the same gesture every other list surface has. */
  onOpen?: (element: ElementWithDetails) => void;
}

function ElementCard({ element, workers, onRefresh, onOpen }: ElementCardProps) {
  const draggingRef = React.useRef(false);
  const startPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const weekStartsOn = usePreference(getCachedWeekStartsOn);

  const assignee = element.assignees?.[0]?.worker;
  const dueDate = element.due_date ? new Date(element.due_date) : null;
  const priority = element.priority;

  // Inline editing on the card: title (click to rename) + due date (click to
  // pick). Inner controls stop pointer/click propagation so they don't kick
  // off a card drag, and the card stops being draggable while the title edits.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(element.title);
  useEffect(() => { setTitleDraft(element.title); }, [element.title]);
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
    if (next && next !== element.title) {
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
    } catch (e) { console.error('Failed to update assignee', e); }
  };
  const removeAssignee = async (assigneeId: string) => {
    try {
      await removeElementAssignee(assigneeId);
      onRefresh?.();
    } catch (e) { console.error('Failed to update assignee', e); }
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
      className="rounded-xl border border-border bg-card hover:shadow-sm transition-shadow cursor-grab active:cursor-grabbing"
    >
      <div className="p-4">
        {editingTitle ? (
          <textarea
            autoFocus
            ref={titleRef}
            rows={1}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).blur(); }
              else if (e.key === 'Escape') { e.preventDefault(); setTitleDraft(element.title); setEditingTitle(false); }
            }}
            onPointerDown={stop}
            onClick={stop}
            className="w-full text-[13px] font-medium text-foreground leading-5 bg-transparent border-none resize-none overflow-y-auto"
          />
        ) : (
          <p
            className="text-[13px] font-medium text-foreground leading-5 -mx-1 px-1 rounded cursor-text hover:bg-muted/30 transition-colors line-clamp-3 break-words"
            title="Click to rename"
            onPointerDown={stop}
            onClick={(e) => { stop(e); setEditingTitle(true); }}
          >
            {element.title}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            {/* Due date — click to pick / change. Shown even when empty. */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onPointerDown={stop}
                  onClick={stop}
                  className={cn(
                    'flex items-center gap-1 -mx-1 px-1 rounded hover:bg-muted/40 hover:text-foreground transition-colors',
                    !dueDate && 'opacity-60',
                  )}
                >
                  <Calendar className="h-3 w-3" />
                  {dueDate ? formatElementDate(dueDate) : 'Date'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 rounded-xl" align="start" onPointerDown={stop}>
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
                    'inline-flex items-center gap-1 -mx-1 px-1 rounded hover:bg-muted/40 hover:text-foreground transition-colors',
                    !priority && 'opacity-60',
                  )}
                >
                  {priority ? (
                    <>
                      <PriorityMark priority={priority} />
                      <span>{priority.charAt(0).toUpperCase() + priority.slice(1)}</span>
                    </>
                  ) : (
                    <span>Priority</span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[140px]" onPointerDown={stop}>
                {PRIORITY_OPTIONS.map((p) => (
                  <DropdownMenuItem key={p} onClick={() => savePriority(p)} className="gap-2 text-[13px]">
                    <PriorityMark priority={p} />
                    <span className="flex-1">{p.charAt(0).toUpperCase() + p.slice(1)}</span>
                    {priority === p && <Check size={12} className="text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
                {priority && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => savePriority(null)} className="text-[12px] text-muted-foreground">
                      Clear
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-1">
            {/* Same signal the list rows and the Activity column show. The
                relative time is dropped here: the footer is already carrying
                a date, a priority and an assignee, and the count is what
                separates a discussed card from a silent one. */}
            <ActivitySignal activity={element.activity} showRelative={false} className="mr-1" />
            <CardAgentControl elementId={element.id} onFinished={onRefresh} />
            {/* Assignee — click to assign / change. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onPointerDown={stop}
                  onClick={stop}
                  title="Assignee"
                  aria-label={workerTriggerLabel('Assignee', assignee)}
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

interface ElementBoardViewProps {
  elements: ElementWithDetails[];
  loading?: boolean;
  onRefresh?: () => void;
  /** Open an Element's detail. Without it a card is edit-in-place only. */
  onElementClick?: (element: ElementWithDetails) => void;
  /** Object the column "+" should create the new Element under. When
   *  omitted the new Element is Domain-direct (Domain board and the
   *  sidebar Elements view). */
  objectId?: string | null;
}

export function ElementBoardView({ elements, loading = false, onRefresh, objectId, onElementClick }: ElementBoardViewProps) {
  const [items, setItems] = useState<ElementWithDetails[]>(elements);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Fetched once for the whole board (NOT per card) and handed to each card's
  // assignee picker.
  const { data: workers } = useWorkers();

  // One aggregated fetch for the whole board, hung on the Elements the same
  // way the list does it, so a card and a row cannot disagree about what
  // "active" means.
  const elementIds = useMemo(() => elements.map((el) => el.id), [elements]);
  const activity = useElementCommentActivity(elementIds);

  useEffect(() => { setItems(elements); }, [elements]);

  const groups = useMemo(() => {
    const m = new Map<ElementStatus, ElementWithDetails[]>();
    for (const col of COLUMNS) m.set(col.status, []);
    for (const el of withCommentActivity(items, activity)) {
      const status = (el.status ?? 'todo') as ElementStatus;
      const bucket = m.get(status) ?? m.get('todo')!;
      bucket.push(el);
    }
    return m;
  }, [items, activity]);

  const handleDrop = (status: ElementStatus) => async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/id');
    if (!id) return;
    setDraggingId(null);
    setItems((prev) => prev.map((el) => el.id === id ? { ...el, status } : el));
    try {
      await updateElement(id, { status });
      onRefresh?.();
    } catch (err) {
      console.error('Failed to update element status', err);
    }
  };

  if (loading) {
    return (
      <div className="flex gap-3 p-4 h-full">
        {COLUMNS.map((col) => (
          <div key={col.status} className="w-72 flex-shrink-0 rounded-xl bg-muted">
            <div className="px-3 py-2.5 border-b border-border/40">
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="p-2 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3 p-4 h-full overflow-x-auto overflow-y-hidden">
      {COLUMNS.map((col) => {
        const colItems = groups.get(col.status) ?? [];
        return (
          <div
            key={col.status}
            className="w-72 flex-shrink-0 flex flex-col rounded-xl bg-muted"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop(col.status)}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2">
                <ElementProgressMark status={col.status} size={16} />
                <span className="text-sm font-medium">{col.label}</span>
                <span className="text-xs text-muted-foreground">{colItems.length}</span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await createElement({
                      title: 'Untitled',
                      status: col.status,
                      object_id: objectId ?? null,
                    });
                    onRefresh?.();
                  } catch (err) {
                    console.error('Failed to create element', err);
                  }
                }}
                className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-accent text-muted-foreground"
                title={`Add Element to ${col.label}`}
                aria-label={`Add Element to ${col.label}`}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[80px]">
              {colItems.map((el) => (
                <div
                  key={el.id}
                  className={cn(
                    'transition-opacity',
                    draggingId === el.id ? 'opacity-40' : '',
                  )}
                  onDragStart={() => setDraggingId(el.id)}
                  onDragEnd={() => setDraggingId(null)}
                >
                  <ElementCard
                    element={el}
                    workers={workers}
                    onRefresh={onRefresh}
                    onOpen={onElementClick}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
