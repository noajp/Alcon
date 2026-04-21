'use client';

import { useMemo } from 'react';
import type { Ticket as TicketType } from './types';
import { TICKET_COLORS } from './types';

interface TicketProps {
  ticket: TicketType;
  zoom: number;
  isSelected: boolean;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onOpen?: () => void;
}

// Level-of-detail thresholds. Below these zoom levels, we progressively
// strip detail so ~100 tickets stay legible when zoomed way out.
const LOD_TITLE_ONLY = 0.55;  // < this: title only, no body
const LOD_COMPACT    = 0.85;  // < this: title + 2 lines body, no footer

export function Ticket({ ticket, zoom, isSelected, isDragging, onMouseDown, onOpen }: TicketProps) {
  const color = TICKET_COLORS[ticket.color];
  const { title, content, activity, updatedAt, createdBy, width, height } = ticket;

  const lod = useMemo(() => {
    if (zoom < LOD_TITLE_ONLY) return 'far' as const;
    if (zoom < LOD_COMPACT) return 'mid' as const;
    return 'near' as const;
  }, [zoom]);

  const commentCount = activity.filter((a) => a.kind === 'comment' || a.kind === 'ai_action').length;
  const updatedLabel = useMemo(() => formatRelative(updatedAt), [updatedAt]);

  return (
    <div
      role="button"
      tabIndex={0}
      onMouseDown={onMouseDown}
      onDoubleClick={onOpen}
      className={[
        'group absolute select-none',
        'rounded-[14px] bg-white border border-neutral-200/80',
        'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.03)]',
        'transition-[box-shadow,transform] duration-150',
        isSelected
          ? 'ring-2 ring-neutral-400/60 shadow-[0_8px_24px_rgba(0,0,0,0.10)]'
          : 'hover:shadow-[0_4px_14px_rgba(0,0,0,0.07)]',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
      ].join(' ')}
      style={{
        left: ticket.x,
        top: ticket.y,
        width,
        height,
      }}
    >
      {/* Left color bar */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[4px] rounded-l-[14px]"
        style={{ backgroundColor: color.bar }}
      />

      {/* Punch card hole (top-left) */}
      <div
        aria-hidden
        className="absolute left-[14px] top-[14px] w-[10px] h-[10px] rounded-full"
        style={{
          background: 'radial-gradient(circle at 35% 35%, #e5e5e5 0%, #d4d4d4 60%, #c5c5c5 100%)',
          boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.18), inset 0 -1px 0 rgba(255,255,255,0.6)',
        }}
      />

      {/* Content */}
      <div className="absolute inset-0 pl-[36px] pr-4 pt-3 pb-3 flex flex-col overflow-hidden">
        <div className="text-[13px] font-semibold text-neutral-800 truncate tracking-[-0.2px]">
          {title || 'Untitled'}
        </div>

        {lod !== 'far' && (
          <div
            className={[
              'mt-1.5 text-[12px] leading-[1.55] text-neutral-600 flex-1 overflow-hidden',
              lod === 'mid' ? 'line-clamp-2' : 'line-clamp-6',
            ].join(' ')}
          >
            {content || <span className="text-neutral-300">empty</span>}
          </div>
        )}

        {lod === 'near' && (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-400">
            {commentCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <CommentIcon />
                {commentCount}
              </span>
            )}
            <span className="truncate">{updatedLabel}</span>
            <span className="opacity-40">·</span>
            <span className="truncate">{createdBy}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CommentIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
