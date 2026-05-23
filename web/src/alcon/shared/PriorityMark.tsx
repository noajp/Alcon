'use client';

import { TriangleAlert } from 'lucide-react';

const PRIORITY_LEVEL: Record<string, number> = { low: 1, medium: 2, high: 3 };

// Priority mark — Urgent shows a warning triangle, Low / Medium / High
// show 1/2/3 stacked up-chevrons, unset renders "---". Shared between the
// list cell and the Element-detail Properties row so the two surfaces
// stay visually in sync.
export function PriorityMark({ priority }: { priority: string | null }) {
  if (priority === 'urgent') {
    // size-[13px] in the class keeps the dropdown's `[&_svg]:size-4` rule
    // from inflating this icon.
    return <TriangleAlert className="size-[13px] text-orange-500" />;
  }
  const level = priority ? (PRIORITY_LEVEL[priority] ?? 0) : 0;
  if (level === 0) {
    return <span className="text-[11px] leading-none text-muted-foreground">---</span>;
  }
  return (
    <span className="flex flex-col items-center text-muted-foreground">
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
