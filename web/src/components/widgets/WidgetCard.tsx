'use client';

import { GripVertical, X, Maximize2, Minimize2 } from 'lucide-react';
import { CARD, CARD_HOVER } from '@/shared/designTokens';
import type { WidgetSpan } from './types';

interface WidgetCardProps {
  title?: string;
  span: WidgetSpan;
  isDragging?: boolean;
  isEditMode?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  onRemove?: () => void;
  onToggleSpan?: () => void;
  children: React.ReactNode;
  /** Set true if the widget renders its own outer card (e.g. KPI grid) */
  bare?: boolean;
}

export function WidgetCard({
  title,
  span,
  isDragging,
  isEditMode,
  dragHandleProps,
  onRemove,
  onToggleSpan,
  children,
  bare = false,
}: WidgetCardProps) {
  const colSpanClass = span === 'full' ? 'lg:col-span-2' : 'lg:col-span-1';

  // For "bare" widgets (like KPI Cards which render their own grid), skip the outer card chrome
  if (bare) {
    return (
      <div className={`${colSpanClass} relative ${isDragging ? 'opacity-50' : ''}`}>
        {isEditMode && (
          <div className="absolute -top-2 -right-2 z-10 flex items-center gap-0.5 bg-popover border border-border/60 rounded-lg shadow-md p-0.5">
            <button
              {...dragHandleProps}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground cursor-grab active:cursor-grabbing"
              aria-label="Drag widget"
            >
              <GripVertical size={12} />
            </button>
            {onToggleSpan && (
              <button
                onClick={onToggleSpan}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                aria-label="Toggle width"
              >
                {span === 'full' ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
            )}
            {onRemove && (
              <button
                onClick={onRemove}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 hover:text-red-600 text-muted-foreground"
                aria-label="Remove widget"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <div
      className={`${CARD} ${CARD_HOVER} ${colSpanClass} flex flex-col overflow-hidden ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      {(title || isEditMode) && (
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          {title && (
            <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
          )}
          {isEditMode && (
            <div className="flex items-center gap-0.5 -mr-1">
              <button
                {...dragHandleProps}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground cursor-grab active:cursor-grabbing"
                aria-label="Drag widget"
              >
                <GripVertical size={12} />
              </button>
              {onToggleSpan && (
                <button
                  onClick={onToggleSpan}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                  aria-label="Toggle width"
                >
                  {span === 'full' ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                </button>
              )}
              {onRemove && (
                <button
                  onClick={onRemove}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 hover:text-red-600 text-muted-foreground"
                  aria-label="Remove widget"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 px-5 pb-5">{children}</div>
    </div>
  );
}
