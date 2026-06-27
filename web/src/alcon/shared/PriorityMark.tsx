'use client';

import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const PRIORITY_LEVEL: Record<string, number> = { low: 1, medium: 2, high: 3 };

// Priority mark — Urgent shows a warning triangle, Low / Medium / High show
// 1/2/3 stacked up-chevrons, unset shows "---". Every state renders inside the
// SAME fixed-height box so a list row never changes height when priority is
// set or cleared (the text ↔ icon swap used to shift the row). Shared between
// the list cell and the Element-detail Properties row so the two surfaces stay
// visually in sync.
const BOX = 'inline-flex items-center justify-center h-3.5 shrink-0';

export function PriorityMark({ priority }: { priority: string | null }) {
  if (priority === 'urgent') {
    // size-[13px] keeps the dropdown's `[&_svg]:size-4` rule from inflating it.
    return (
      <span className={BOX}>
        <TriangleAlert className="size-[15px] text-[#c24d36]" strokeWidth={2.4} />
      </span>
    );
  }

  const level = priority ? (PRIORITY_LEVEL[priority] ?? 0) : 0;

  if (level === 0) {
    return <span className={cn(BOX, 'text-[11px] leading-none text-muted-foreground')}>---</span>;
  }

  return (
    <span className={cn(BOX, 'flex-col text-muted-foreground')}>
      {Array.from({ length: level }).map((_, i) => (
        <svg
          key={i}
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden="true"
          style={{ width: '10px', height: '6px' }}
          className={i > 0 ? '-mt-[2px]' : ''}
        >
          <path
            d="M1.2 4.8 L5 1 L8.8 4.8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}
