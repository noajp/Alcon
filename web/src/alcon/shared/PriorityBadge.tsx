'use client';

import { OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PriorityLevel = 'urgent' | 'high' | 'medium' | 'low';

function BarsGlyph({ level, className }: { level: Exclude<PriorityLevel, 'urgent'>; className?: string }) {
  const bars = [
    { x: 4, y1: 13.333, color: 'currentColor' },
    { x: 8, y1: 6.667, color: level === 'low' ? 'rgb(161,161,170)' : 'currentColor' },
    { x: 12, y1: level === 'high' ? 2.667 : 6.667, color: level === 'high' ? 'currentColor' : 'rgb(161,161,170)' },
  ];

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      {bars.map((bar, i) => (
        <path
          key={i}
          d={`M${bar.x} 13.333V${bar.y1}`}
          stroke={bar.color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export type PriorityBadgeProps = {
  level: PriorityLevel;
  appearance?: 'badge' | 'inline' | 'dot';
  size?: 'sm' | 'md';
  className?: string;
  withIcon?: boolean;
};

// Mirrors the List view's priority cell so Board cards / other inline hosts
// render the same dot + colored label readout. Keep these in sync with the
// `priorityOpts` map in ElementTableRow.tsx.
const DOT_STYLES: Record<PriorityLevel, { dot: string; text: string; label: string }> = {
  urgent: { dot: 'bg-red-500',     text: 'text-red-600',     label: 'Urgent' },
  high:   { dot: 'bg-amber-500',   text: 'text-amber-600',   label: 'High' },
  medium: { dot: 'bg-neutral-400', text: 'text-neutral-600', label: 'Normal' },
  low:    { dot: 'bg-neutral-300', text: 'text-neutral-400', label: 'Low' },
};

export function PriorityBadge({ level, appearance = 'badge', size = 'md', className, withIcon = true }: PriorityBadgeProps) {
  const isUrgent = level === 'urgent';
  const label = isUrgent ? 'Urgent' : level.charAt(0).toUpperCase() + level.slice(1);
  const baseText = size === 'md' ? 'text-sm' : 'text-xs';
  const iconSize = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  const safeLevel = (level === 'high' || level === 'medium') ? level : 'low' as Exclude<PriorityLevel, 'urgent'>;

  if (appearance === 'dot') {
    const style = DOT_STYLES[level];
    return (
      <span className={cn('inline-flex items-center gap-1.5', baseText, style.text, className)}>
        <span className={cn('w-1.5 h-1.5 rounded-full', style.dot)} />
        <span>{style.label}</span>
      </span>
    );
  }

  if (appearance === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-foreground/80', baseText, className)}>
        {withIcon && (isUrgent
          ? <OctagonAlert className={cn(iconSize, 'text-muted-foreground')} />
          : <BarsGlyph level={safeLevel} className={cn(iconSize, 'text-muted-foreground')} />
        )}
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted px-2 py-0.5',
      baseText,
      className,
    )}>
      {withIcon && (isUrgent
        ? <OctagonAlert className={cn(iconSize, 'text-muted-foreground')} />
        : <BarsGlyph level={safeLevel} className={cn(iconSize, 'text-muted-foreground')} />
      )}
      <span className="text-foreground/80">{label}</span>
    </span>
  );
}
