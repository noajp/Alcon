'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement } from '@/hooks/useSupabase';
import { Skeleton } from '@/ui/skeleton';
import { PriorityMark } from '@/alcon/shared/PriorityMark';
import { WorkerAvatar } from '@/alcon/shared/WorkerAvatar';
import { Plus, Calendar, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { CardAgentControl } from '../agent';
import { ElementProgressMark } from '@/alcon/shared/ElementProgressMark';

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
  onRefresh?: () => void;
}

function ElementCard({ element, onRefresh }: ElementCardProps) {
  const draggingRef = React.useRef(false);
  const startPosRef = React.useRef<{ x: number; y: number } | null>(null);

  const assignee = element.assignees?.[0]?.worker;
  const dueDate = element.due_date ? new Date(element.due_date) : null;
  const priority = element.priority;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/id', element.id);
        draggingRef.current = false;
      }}
      onMouseDown={(e) => { startPosRef.current = { x: e.clientX, y: e.clientY }; }}
      onMouseMove={(e) => {
        if (!startPosRef.current) return;
        if (Math.abs(e.clientX - startPosRef.current.x) > 5 || Math.abs(e.clientY - startPosRef.current.y) > 5) {
          draggingRef.current = true;
        }
      }}
      onMouseUp={() => { startPosRef.current = null; }}
      className="rounded-xl border border-border bg-card hover:shadow-sm transition-shadow cursor-grab active:cursor-grabbing"
    >
      <div className="p-4">
        <p className="text-[13px] font-medium text-foreground leading-5">
          {element.title}
        </p>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            {dueDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {format(dueDate, 'MMM d')}
              </span>
            )}
            {priority && (
              <span className="inline-flex items-center gap-1">
                <PriorityMark priority={priority} />
                <span>{priority.charAt(0).toUpperCase() + priority.slice(1)}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <CardAgentControl elementId={element.id} onFinished={onRefresh} />
            {assignee ? (
              <WorkerAvatar worker={assignee} size={20} />
            ) : null}
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
}

export function ElementBoardView({ elements, loading = false, onRefresh }: ElementBoardViewProps) {
  const [items, setItems] = useState<ElementWithDetails[]>(elements);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => { setItems(elements); }, [elements]);

  const groups = useMemo(() => {
    const m = new Map<ElementStatus, ElementWithDetails[]>();
    for (const col of COLUMNS) m.set(col.status, []);
    for (const el of items) {
      const status = (el.status ?? 'todo') as ElementStatus;
      const bucket = m.get(status) ?? m.get('todo')!;
      bucket.push(el);
    }
    return m;
  }, [items]);

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
              <button className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-accent text-muted-foreground">
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
                    onRefresh={onRefresh}
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
