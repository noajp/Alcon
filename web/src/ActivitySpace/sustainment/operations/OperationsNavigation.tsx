'use client';

import { createContext } from 'react';
import { LayoutDashboard, List, ListChecks, CircleAlert } from 'lucide-react';
import { Button } from '@/ui/button';
import { OPERATIONS_QUEUES, operationsQueueLabel, type OperationsQueue } from './operationsQueues';

interface OperationsNavigationState {
  queue: OperationsQueue;
  onSelect: (queue: OperationsQueue) => void;
}

// Only App surfaces provide controlled navigation. Embedded planners keep their own views.
export const OperationsNavigationContext = createContext<OperationsNavigationState | null>(null);

const ICONS = { overview: LayoutDashboard, attention: ListChecks, records: List, incomplete: CircleAlert };

export function OperationsNavigation({ queue, onSelect, sidebar = false, counts }: OperationsNavigationState & {
  sidebar?: boolean;
  counts?: Partial<Record<OperationsQueue, number>>;
}) {
  return <div role="group" aria-label="Pipeline views" className={sidebar ? 'mt-3 space-y-1' : 'flex flex-wrap items-center gap-1'}>
    {sidebar && <p className="px-2 py-1 text-xs font-medium text-muted-foreground">CRM</p>}
    {OPERATIONS_QUEUES.map(id => {
      const Icon = ICONS[id];
      return <Button shape="tab" key={id} variant={queue === id ? 'secondary' : 'ghost'} align="start" className={sidebar ? 'w-full' : undefined}
        aria-pressed={queue === id} onClick={() => onSelect(id)}>
        {sidebar && <Icon size={14} />}{operationsQueueLabel(id)}
        {counts?.[id] !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{counts[id]}</span>}
      </Button>;
    })}
  </div>;
}
