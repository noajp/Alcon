'use client';

import { useState } from 'react';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { cn } from '@/lib/utils';

export type DraggableBarItem = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status?: string | null;
  progress?: number;
};

export type DraggableBarVariant = 'object' | 'element';

interface DraggableBarProps {
  item: DraggableBarItem;
  variant: DraggableBarVariant;
  viewStartDate: Date;
  cellWidth: number;
  onUpdateStart: (id: string, newStart: Date) => void;
  onUpdateDuration?: (id: string, newStart: Date, newEnd: Date) => void;
  onDoubleClick?: () => void;
}

function statusBarColor(status: string | null | undefined): string {
  switch (status) {
    case 'done': return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300';
    case 'in_progress': return 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300';
    case 'review': return 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300';
    case 'blocked': return 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300';
    default: return 'bg-primary/10 border-primary/30 text-primary';
  }
}

export function DraggableBar({
  item, variant, viewStartDate, cellWidth,
  onUpdateStart, onUpdateDuration, onDoubleClick,
}: DraggableBarProps) {
  const durationDays = differenceInCalendarDays(item.endDate, item.startDate) + 1;
  const offsetDays = differenceInCalendarDays(item.startDate, viewStartDate);
  const left = offsetDays * cellWidth;
  const width = durationDays * cellWidth;

  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragType, setDragType] = useState<'move' | 'resize-left' | 'resize-right' | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const kind = offsetX < 10 ? 'resize-left' : offsetX > rect.width - 10 ? 'resize-right' : 'move';
    setIsDragging(true);
    setDragType(kind);
    document.body.style.cursor = kind === 'move' ? 'grabbing' : 'col-resize';

    const startX = e.clientX;

    const onMove = (ev: PointerEvent) => setDragOffset(ev.clientX - startX);

    const onUp = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const days = Math.round(delta / cellWidth);
      if (days !== 0) {
        if (kind === 'move') {
          onUpdateStart(item.id, addDays(item.startDate, days));
        } else if (kind === 'resize-left' && onUpdateDuration) {
          const newStart = addDays(item.startDate, days);
          if (newStart < item.endDate) onUpdateDuration(item.id, newStart, item.endDate);
        } else if (kind === 'resize-right' && onUpdateDuration) {
          const newEnd = addDays(item.endDate, days);
          if (newEnd > item.startDate) onUpdateDuration(item.id, item.startDate, newEnd);
        }
      }
      setIsDragging(false);
      setDragOffset(0);
      setDragType(null);
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  let visualLeft = left;
  let visualWidth = width;
  if (isDragging && dragType) {
    if (dragType === 'move') visualLeft = left + dragOffset;
    else if (dragType === 'resize-right') visualWidth = Math.max(cellWidth, width + dragOffset);
    else if (dragType === 'resize-left') { visualLeft = left + dragOffset; visualWidth = Math.max(cellWidth, width - dragOffset); }
  }

  const dateLabel = `${format(item.startDate, 'd/M')} – ${format(item.endDate, 'd/M')}`;

  return (
    <div
      onPointerDown={handlePointerDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        'absolute h-[28px] top-[10px] rounded-md border flex items-center px-2 gap-1.5 select-none overflow-hidden group',
        variant === 'object'
          ? 'bg-muted border-border text-foreground cursor-grab active:cursor-grabbing'
          : cn(statusBarColor(item.status), 'cursor-grab active:cursor-grabbing'),
        isDragging && 'shadow-md z-30 opacity-90',
      )}
      style={{
        left: `${visualLeft}px`,
        width: `${Math.max(visualWidth, 40)}px`,
        transition: isDragging ? 'none' : 'left 0.25s cubic-bezier(0.25,1,0.5,1)',
      }}
    >
      {/* Resize handles */}
      <div className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize opacity-0 group-hover:opacity-100 bg-white/20 rounded-l-md" />
      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize opacity-0 group-hover:opacity-100 bg-white/20 rounded-r-md" />
      <span className="text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0">
        {dateLabel}: {item.name}
      </span>
    </div>
  );
}
