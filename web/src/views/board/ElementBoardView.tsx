'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement } from '@/hooks/useSupabase';
import { Skeleton } from '@/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { PriorityBadge } from '@/alcon/shared/PriorityBadge';
import type { PriorityLevel } from '@/alcon/shared/PriorityBadge';
import {
  Layers, Loader, RefreshCw, CheckCircle, AlertCircle,
  Plus, MoreVertical, Calendar, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

type ElementStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';

const COLUMNS: { status: ElementStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
  { status: 'blocked', label: 'Blocked' },
];

function columnIcon(status: ElementStatus) {
  switch (status) {
    case 'todo': return <Layers className="h-4 w-4 text-muted-foreground" />;
    case 'in_progress': return <Loader className="h-4 w-4 text-blue-500" />;
    case 'review': return <RefreshCw className="h-4 w-4 text-amber-500" />;
    case 'done': return <CheckCircle className="h-4 w-4 text-emerald-500" />;
    case 'blocked': return <AlertCircle className="h-4 w-4 text-rose-500" />;
  }
}

function columnAccent(status: ElementStatus): string {
  switch (status) {
    case 'in_progress': return 'border-t-blue-500/60';
    case 'review': return 'border-t-amber-500/60';
    case 'done': return 'border-t-emerald-500/60';
    case 'blocked': return 'border-t-rose-500/60';
    default: return 'border-t-border/40';
  }
}

interface ElementCardProps {
  element: ElementWithDetails;
  onMoveToStatus: (status: ElementStatus) => void;
}

function ElementCard({ element, onMoveToStatus }: ElementCardProps) {
  const draggingRef = React.useRef(false);
  const startPosRef = React.useRef<{ x: number; y: number } | null>(null);

  const assignee = element.assignees?.[0]?.worker;
  const dueDate = element.due_date ? new Date(element.due_date) : null;
  const priority = element.priority as PriorityLevel | null;

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
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-medium text-foreground leading-5 flex-1">
            {element.title}
          </p>
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md hover:bg-accent text-muted-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-36 p-1.5" align="end">
              {COLUMNS.map((col) => (
                <button
                  key={col.status}
                  className="w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
                  onClick={() => onMoveToStatus(col.status)}
                >
                  Move to {col.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>

        {element.section && (
          <p className="mt-1 text-[11px] text-muted-foreground truncate">{element.section}</p>
        )}

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {dueDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {format(dueDate, 'MMM d')}
              </span>
            )}
            {priority && (
              <PriorityBadge level={priority} appearance="inline" size="sm" withIcon={true} />
            )}
          </div>
          {assignee ? (
            <div className="flex items-center justify-center h-5 w-5 rounded-full bg-muted border border-border text-[10px] font-medium text-muted-foreground">
              {assignee.name?.charAt(0).toUpperCase() ?? <User className="h-3 w-3" />}
            </div>
          ) : null}
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
          <div key={col.status} className="w-64 flex-shrink-0 rounded-xl bg-muted border-t-2 border-t-border/40">
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
            className={cn(
              'w-60 flex-shrink-0 flex flex-col rounded-xl bg-muted border-t-2',
              columnAccent(col.status),
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop(col.status)}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2">
                {columnIcon(col.status)}
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
                    onMoveToStatus={async (status) => {
                      setItems((prev) => prev.map((x) => x.id === el.id ? { ...x, status } : x));
                      try {
                        await updateElement(el.id, { status });
                        onRefresh?.();
                      } catch (err) {
                        console.error('Failed to move element', err);
                      }
                    }}
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
