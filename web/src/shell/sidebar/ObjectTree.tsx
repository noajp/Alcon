'use client';

import type { ElementWithDetails } from '@/hooks/useSupabase';

import { statusColor } from '@/shared/designTokens';

const SIDEBAR_ROW_H = 24;

export function ElementItem({ element }: { element: ElementWithDetails }) {
  return (
    <div className="flex items-center hover:bg-sidebar-accent/50 cursor-pointer rounded-md mx-1 px-2" style={{ height: SIDEBAR_ROW_H }} title={element.title}>
      <div className="w-4 h-4 flex-shrink-0" />
      <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mr-1.5">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor(element.status) }} />
      </div>
      <span className="text-[13px] text-foreground/80 truncate flex-1">{element.title}</span>
      {element.subelements && element.subelements.length > 0 && (
        <span className="text-[10px] text-muted-foreground/50 mr-1">
          {element.subelements.filter(s => s.is_completed).length}/{element.subelements.length}
        </span>
      )}
    </div>
  );
}
