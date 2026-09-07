'use client';

import { useCallback, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/providers/AuthProvider';
import { CalendarView } from '@/alcon/element/calendar/CalendarView';
import { CalendarScopePicker, type CalendarSelection } from '@/alcon/element/calendar/CalendarScopePicker';
import { selectCalendarScope } from '@/alcon/element/calendar/schedule';
import { ElementDrilldown } from '@/alcon/element/ElementDrilldown';
import { NavCalendarIcon } from '@/shell/sidebar/NavIcons';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { fetchExplorerData } from '@/alcon/sync/explorerData';
import { fetchMyElements } from '@/alcon/element/myElementsData';
import { useActiveSpaceId } from '@/alcon/space/activeSpaceStore';
import { Button } from '@/ui/button';
import type { NavigationState } from '@/types/navigation';

interface MyCalendarViewProps {
  initialScope?: 'mine' | 'space';
  activeDomainId?: string | null;
  activeObjectId?: string | null;
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

export function MyCalendarView(props: MyCalendarViewProps) {
  const spaceId = useActiveSpaceId();
  return <CalendarSurface key={`${spaceId}:${props.initialScope ?? 'mine'}`} {...props} />;
}

function CalendarSurface({ onNavigate, onViewChange, initialScope = 'mine' }: MyCalendarViewProps) {
  const { user } = useAuthContext();
  const spaceId = useActiveSpaceId();
  const userId = user?.id ?? null;

  const qc = useQueryClient();
  const domainQuery = useSustainmentDomains();
  const domains = domainQuery.data;
  // null means the live default; [] means an intentional empty selection.
  const [chosen, setSelection] = useState<CalendarSelection | null>(null);
  const selection = chosen ?? {
    mine: initialScope === 'mine',
    domainIds: initialScope === 'space' ? domains.filter(domain => !spaceId || domain.activity_space_id === spaceId).map(domain => domain.id) : [],
    objectIds: [],
  };
  const domainIds = selection.domainIds.filter(id => domains.some(domain => domain.id === id));
  const explorers = useQueries({ queries: domainIds.map(id => ({
    queryKey: ['explorer', id], queryFn: () => fetchExplorerData(id),
  })) });
  const mine = useQuery({ queryKey: ['my-elements', userId], queryFn: () => fetchMyElements(userId!), enabled: !!userId && selection.mine });
  const scoped = selectCalendarScope(explorers.flatMap(query => query.data ? [query.data] : []), selection.objectIds);
  const elements = selection.mine ? mine.data?.elements ?? [] : scoped.elements;
  const loading = domainQuery.loading || (selection.mine ? mine.isPending : explorers.some(query => query.isPending));
  const error = domainQuery.error || (selection.mine ? mine.error : explorers.find(query => query.error)?.error);
  const fetchMine = useCallback(async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['my-elements', userId] }), qc.invalidateQueries({ queryKey: ['explorer'] })]);
  }, [qc, userId]);

  return (
    <ElementDrilldown label="Calendar" onNavigate={onNavigate} onViewChange={onViewChange}>
      {openElement => <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="h-12 flex items-center gap-2 px-4 border-b border-[var(--border-subtle)] bg-card flex-shrink-0">
        <NavCalendarIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Calendar</span>
        <div className="flex-1" />
        <CalendarScopePicker domains={domains} objects={scoped.availableObjects} selection={{ ...selection, domainIds }} onChange={setSelection} />
      </div>
      {error && <div role="alert" className="px-4 py-2 text-sm text-destructive">Could not load the calendar. <Button size="xs" variant="ghost" onClick={() => { void domainQuery.refetch(); void fetchMine(); }}>Retry</Button></div>}
      {loading && <div role="status" className="px-4 py-2 text-sm text-muted-foreground">Loading schedules…</div>}
      <div className="flex-1 min-h-0 overflow-hidden" aria-busy={loading}>
        <CalendarView objects={selection.mine ? [] : scoped.objects} onObjectClick={object => {
          const domainId = domainIds.find(id => explorers[domainIds.indexOf(id)]?.data?.objects.some(item => item.id === object.id));
          onNavigate?.({ objectId: object.id, objectDomainId: domainId ?? null });
          onViewChange?.('objects');
        }} elements={elements} onRefresh={fetchMine} onElementClick={(el) => openElement(el.id)} />
      </div>
      </div>}
    </ElementDrilldown>
  );
}
