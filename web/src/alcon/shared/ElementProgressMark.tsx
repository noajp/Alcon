'use client';

import { Check } from 'lucide-react';
import type { CustomColumnWithValues, ElementWithDetails } from '@/hooks/useSupabase';

function clampProgress(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace('%', '').trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(parsed)));
  }
  return null;
}

function getCustomProgress(elementId: string, customColumns?: CustomColumnWithValues[]): number | null {
  const progressColumn = customColumns?.find((column) => {
    const name = column.name.trim().toLowerCase();
    return column.column_type === 'progress' || name === 'progress' || name === '進捗' || name === '進捗率';
  });
  if (!progressColumn) return null;
  return clampProgress(progressColumn.values?.[elementId]?.value);
}

export function getElementProgress(
  element: ElementWithDetails,
  customColumns?: CustomColumnWithValues[],
): number {
  const customProgress = getCustomProgress(element.id, customColumns);
  if (customProgress !== null) return customProgress;

  const subelements = element.subelements ?? [];
  if (subelements.length > 0) {
    const completed = subelements.filter((sub) => !!sub.is_completed).length;
    return Math.round((completed / subelements.length) * 100);
  }

  return element.status === 'done' ? 100 : 0;
}

export function ElementProgressMark({
  progress,
  size = 16,
}: {
  progress: number;
  size?: number;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const isComplete = pct >= 100;
  const color = isComplete ? '#10b981' : '#8b949e';
  const center = size / 2;
  const radius = size / 4;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/35 transition-colors group-hover:text-muted-foreground/60"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <circle
          cx={center}
          cy={center}
          r={(size - 1.5) / 2}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        {pct > 0 && (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={size / 2}
            strokeLinecap="butt"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${center} ${center})`}
            style={{ transition: 'stroke-dashoffset 260ms ease' }}
          />
        )}
      </svg>
      {isComplete && <Check size={Math.max(10, size - 5)} strokeWidth={3} className="relative text-white" />}
    </span>
  );
}
