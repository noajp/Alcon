'use client';

import { ResourceView } from '@/ActivitySpace/sustainment/workload/ResourceView';
import { ElementDrilldown } from '@/ActivitySpace/execution/element/ElementDrilldown';
import { useTeamRoster } from '@/hooks/useTeamRoster';
import { Button } from '@/ui/button';
import type { NavigationState } from '@/types/navigation';

export function WorkloadView({ workerId, onNavigate, onViewChange }: {
  workerId?: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const roster = useTeamRoster();
  const worker = roster.workers.find(item => item.id === workerId);
  return (
    <ElementDrilldown label="Workload" onNavigate={onNavigate} onViewChange={onViewChange}>
      {openElement => <>
        {workerId && <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2 text-sm">
          <span className="flex-1 text-muted-foreground">{worker?.name ?? 'Selected Worker'}</span>
          <Button size="xs" onClick={() => onNavigate({ workerId: null })}>All Workers</Button>
        </div>}
        {roster.error ? <div role="alert" className="flex items-center gap-2 px-4 py-3 text-sm text-destructive">
          Could not load the team. <Button size="xs" onClick={() => void roster.refresh()}>Retry</Button>
        </div> : roster.loading ? <p role="status" className="px-4 py-3 text-sm text-muted-foreground">Loading team…</p> : (
          <ResourceView
            title="Workload"
            roster={roster.workers}
            workerId={workerId ?? undefined}
            onElementClick={element => openElement(element.id)}
          />
        )}
      </>}
    </ElementDrilldown>
  );
}
