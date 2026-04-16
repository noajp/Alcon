'use client';

import { useEffect, useRef } from 'react';
import type { ThoughtCardData } from '../types';

// ============================================
// ThoughtCard — minimum structure, text-first.
// The earliest stage of a thought's life in the BluePrint.
// ============================================
interface ThoughtCardProps {
  card: ThoughtCardData;
  isSelected?: boolean;
  isDragging?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onChangeText?: (text: string) => void;
}

export function ThoughtCard({
  card,
  isSelected,
  isDragging,
  onMouseDown,
  onChangeText,
}: ThoughtCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize height to content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [card.text]);

  return (
    <div
      className={`
        w-[220px] rounded-xl bg-white border border-border/60
        transition-all duration-150 select-none
        ${isSelected
          ? 'shadow-[0_6px_20px_rgba(0,0,0,0.08)]'
          : 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]'}
        ${isDragging ? 'opacity-95' : ''}
      `}
      onMouseDown={onMouseDown}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      <textarea
        ref={textareaRef}
        value={card.text}
        onChange={(e) => onChangeText?.(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        placeholder="思考を書く…"
        rows={2}
        className="
          w-full no-focus-ring bg-transparent resize-none border-0
          px-4 py-3.5 text-[13px] leading-relaxed
          text-foreground placeholder:text-muted-foreground/50
        "
        style={{ cursor: 'text' }}
      />
    </div>
  );
}
