'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/providers/AuthProvider';
import { CalendarView } from '@/alcon/element/calendar/CalendarView';
import { CalendarScopePicker, type CalendarSelection } from '@/alcon/element/calendar/CalendarScopePicker';
import { selectCalendarScope } from '@/alcon/element/calendar/schedule';
import { ElementDetailView } from '@/alcon/element/ElementDetailView';
import { NavCalendarIcon } from '@/shell/sidebar/NavIcons';
import { fetchElementWithDetails, useDomains } from '@/hooks/useSupabase';
import { fetchExplorerData } from '@/alcon/sync/explorerData';
import { fetchMyElements } from '@/alcon/element/myElementsData';
import { setActiveDomainId } from '@/alcon/domain/domainsStore';
import { Button } from '@/ui/button';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { NavigationState } from '@/types/navigation';

interface MyCalendarViewProps {
  activeDomainId?: string | null;
  activeObjectId?: string | null;
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

export function MyCalendarView({ onNavigate, onViewChange, activeDomainId, activeObjectId }: MyCalendarViewProps) {
  const { user } = useAuthContext();
  const userId = user?.id ?? null;

  const qc = useQueryClient();
  const domainQuery = useDomains();
  const domains = [...new Map([...domainQuery.data, ...domainQuery.guestDomains].map(domain => [domain.id, domain])).values()];
  const [selection, setSelection] = useState<CalendarSelection>(() => ({
    mine: !activeDomainId, domainIds: activeDomainId ? [activeDomainId] : [],
    objectIds: activeObjectId && activeDomainId ? [activeObjectId] : [],
  }));
  // Discard inaccessible / previous-Space scopes before fetching or rendering.
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

  // Clicking an event opens the Element here, in Home — same pattern
  // InboxView uses to open a notification's Element without leaving the
  // Home surface. `loaded` is stamped with the id it was fetched for, so
  // "still loading" is a comparison rather than a state the effect writes
  // on the way in, and a slow fetch landing after the user picked a
  // different event needs no cancellation flag.
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ elementId: string; element: ElementWithDetails | null } | null>(null);

  const loadDetail = useCallback(async (elementId: string) => {
    const element = await fetchElementWithDetails(elementId).catch((e) => {
      console.error('Failed to open the Element this event is about:', e);
      return null;
    });
    setLoaded({ elementId, element });
  }, []);

  useEffect(() => {
    if (!openId) return;
    const elementId = openId;
    void (async () => {
      const element = await fetchElementWithDetails(elementId).catch((e) => {
        console.error('Failed to open the Element this event is about:', e);
        return null;
      });
      setLoaded({ elementId, element });
    })();
  }, [openId]);

  const detail = openId && loaded?.elementId === openId ? loaded : null;

  const detailView = openId ? (detail?.element ? (
      <ElementDetailView
        element={detail.element}
        domainName={null}
        objectPath={detail.element.objects ?? []}
        onBack={() => setOpenId(null)}
        onRefresh={async () => { await loadDetail(openId); await fetchMine(); }}
        onNavigateRoot={() => setOpenId(null)}
        onNavigateObject={(objectId) => {
          setOpenId(null);
          onViewChange?.('objects');
          onNavigate?.({ objectId });
        }}
      />
    ) : (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground">
        {!detail ? (
          <p className="text-[13px]">Opening…</p>
        ) : (
          <>
            <p className="text-[13px]">This Element is no longer available.</p>
            <Button
              onClick={() => setOpenId(null)}
              className="text-[12px] px-2 h-6 rounded-md bg-muted/40 text-foreground hover:bg-muted/60 transition-colors"
            >
              Back to Calendar
            </Button>
          </>
        )}
      </div>
    )) : null;

  return (
    <div className="flex flex-col h-full bg-card">
      {detailView}
      <div className={openId ? "hidden" : "flex flex-col h-full min-h-0"}>
      <div className="h-12 flex items-center gap-2 px-4 border-b border-[var(--border-subtle)] bg-card flex-shrink-0">
        <NavCalendarIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Calendar</span>
        <div className="flex-1" />
        <CalendarScopePicker domains={domains} objects={scoped.availableObjects} selection={selection} onChange={setSelection} />
      </div>
      {error && <div role="alert" className="px-4 py-2 text-sm text-destructive">Could not load the calendar. <Button size="xs" variant="ghost" onClick={() => { void domainQuery.refetch(); void fetchMine(); }}>Retry</Button></div>}
      {loading && <div role="status" className="px-4 py-2 text-sm text-muted-foreground">Loading schedules…</div>}
      <div className="flex-1 min-h-0 overflow-hidden" aria-busy={loading}>
        <CalendarView objects={selection.mine ? [] : scoped.objects} onObjectClick={object => {
          const domainId = domainIds.find(id => explorers[domainIds.indexOf(id)]?.data?.objects.some(item => item.id === object.id));
          if (domainId) setActiveDomainId(domainId);
          onNavigate?.({ objectId: object.id });
          onViewChange?.('objects');
        }} elements={elements} onRefresh={fetchMine} onElementClick={(el) => setOpenId(el.id)} />
      </div>
      </div>
    </div>
  );
}
