'use client';

import { Flag, Calendar, Circle } from 'lucide-react';
import type { ActionCardData, Priority } from '../types';

// ============================================
// Priority styling
// ============================================
const PRIORITY_STYLES: Record<Priority, { bg: string; text: string; label: string }> = {
  urgent: { bg: 'bg-red-50',    text: 'text-red-600',    label: 'Urgent' },
  high:   { bg: 'bg-orange-50', text: 'text-orange-600', label: 'High' },
  medium: { bg: 'bg-amber-50',  text: 'text-amber-700',  label: 'Medium' },
  low:    { bg: 'bg-sky-50',    text: 'text-sky-700',    label: 'Low' },
};

// ============================================
// Utilities
// ============================================
function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const h12 = hours % 12 || 12;
  return `${day} ${month} at ${h12}:${minutes}${ampm}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
}

// ============================================
// ActionCard
// ============================================
interface ActionCardProps {
  card: ActionCardData;
  isSelected?: boolean;
  isDragging?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
}

export function ActionCard({ card, isSelected, isDragging, onMouseDown }: ActionCardProps) {
  const priority = PRIORITY_STYLES[card.priority];

  return (
    <div
      className={`
        w-[280px] rounded-2xl bg-white border border-border/60
        transition-all duration-150 select-none
        ${isSelected
          ? 'shadow-[0_4px_16px_rgba(0,0,0,0.10)] ring-1 ring-foreground/20'
          : 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]'}
        ${isDragging ? 'opacity-95' : ''}
      `}
      onMouseDown={onMouseDown}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      {/* ====== Top row: Priority + Due date ====== */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${priority.bg} ${priority.text}`}>
          <Flag size={10} className="fill-current" strokeWidth={2.5} />
          <span>{priority.label}</span>
        </div>
        {card.dueDate && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar size={11} strokeWidth={2} />
            <span>{formatDate(card.dueDate)}</span>
          </div>
        )}
      </div>

      {/* ====== Title ====== */}
      <div className="px-4">
        <h3 className="text-[15px] font-semibold text-foreground leading-tight mb-1.5">
          {card.title}
        </h3>
      </div>

      {/* ====== Description ====== */}
      {card.description && (
        <div className="px-4 pb-3">
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            {card.description}
          </p>
        </div>
      )}

      {/* ====== Tags ====== */}
      {card.tags.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {card.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-2 py-0.5 rounded-md border border-border/60 text-[11px] text-muted-foreground/90"
            >
              <span className="opacity-60 mr-0.5">#</span>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ====== Dashed divider ====== */}
      <div className="mx-4 border-t border-dashed border-border/80" />

      {/* ====== Footer: Assignee + Progress ====== */}
      <div className="flex items-center justify-between px-4 py-3">
        {card.assignee ? (
          <div className="flex items-center gap-2">
            {card.assignee.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.assignee.avatarUrl}
                alt={card.assignee.name}
                className="w-5 h-5 rounded-full object-cover"
              />
            ) : (
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white ${
                  card.assignee.kind === 'ai_agent'
                    ? 'bg-gradient-to-br from-purple-500 to-indigo-600'
                    : card.assignee.kind === 'robot'
                      ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                      : 'bg-gradient-to-br from-neutral-700 to-neutral-900'
                }`}
              >
                {initials(card.assignee.name)}
              </div>
            )}
            <span className="text-[12px] font-medium text-foreground/80">
              {card.assignee.name}
            </span>
          </div>
        ) : (
          <div className="text-[12px] text-muted-foreground/60">Unassigned</div>
        )}

        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Circle size={11} strokeWidth={2} />
          <span className="tabular-nums">{card.progress}%</span>
        </div>
      </div>
    </div>
  );
}
