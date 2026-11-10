'use client';

import { SidebarReveal } from '@/Function/shared/SidebarReveal';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/providers/AuthProvider';
import { CalendarView } from '@/ActivitySpace/calendar/CalendarView';
import { CalendarScopePicker, type CalendarSelection } from '@/ActivitySpace/calendar/CalendarScopePicker';
import { filterByWorkers, selectCalendarScope } from '@/ActivitySpace/calendar/schedule';
import { setCalendarDay, setCalendarWorkerIds, useCalendarDay, useHiddenCalendarWorkers } from '@/ActivitySpace/calendar/calendarStore';
import { parseDateOnly, toDateOnlyString } from '@/Function/shared/dateUtils';
import { ElementDrilldown } from '@/ActivitySpace/execution/element/ElementDrilldown';
import { NavCalendarIcon } from '@/Frame/sidebar/NavIcons';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { fetchExplorerData } from '@/Function/sync/explorerData';
import { fetchMyElements } from '@/hooks/myElementsData';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { Button } from '@/ui/button';
import type { NavigationState } from '@/types/navigation';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { CalendarEventPopup } from '@/ActivitySpace/calendar/CalendarEventPopup';
import { draftFromEvent, draftFromSlot, inputFromDraft, type EventDraft } from '@/ActivitySpace/calendar/eventDraft';
import {
  createCalendarEvent, deleteCalendarEvent, updateCalendarEvent, useCalendarEvents, useInvalidateCalendarEvents,
  type CalendarEvent,
} from '@/hooks/calendarEventData';

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
  const { t } = useI18n();
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
  const hiddenWorkers = useHiddenCalendarWorkers();
  const scopedElements = useMemo(() => selection.mine ? mine.data?.elements ?? [] : scoped.elements, [selection.mine, mine.data, scoped.elements]);
  const elements = filterByWorkers(scopedElements, hiddenWorkers);
  // Tell the sidebar who is on this calendar, hidden or not, so its People
  // list is the assignees in scope rather than every Worker in the Space.
  useEffect(() => {
    setCalendarWorkerIds([...new Set(scopedElements.flatMap(element => (element.assignees ?? []).map(assignee => assignee.worker_id)))].sort());
  }, [scopedElements]);
  const day = useCalendarDay();
  const date = useMemo(() => parseDateOnly(day) ?? new Date(), [day]);
  const loading = domainQuery.loading || (selection.mine ? mine.isPending : explorers.some(query => query.isPending));
  const error = domainQuery.error || (selection.mine ? mine.error : explorers.find(query => query.error)?.error);
  // The Space's events — everyone in it sees them, whatever the scope.
  const { events } = useCalendarEvents(spaceId);
  const invalidateEvents = useInvalidateCalendarEvents();
  const [eventPopup, setEventPopup] = useState<{ draft: EventDraft; event?: CalendarEvent } | null>(null);
  const saveEvent = async (draft: EventDraft) => {
    const input = inputFromDraft(draft);
    if (eventPopup?.event) await updateCalendarEvent(eventPopup.event, input);
    else if (spaceId) await createCalendarEvent(spaceId, input);
    await invalidateEvents();
  };

  const fetchMine = useCallback(async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['my-elements', userId] }), qc.invalidateQueries({ queryKey: ['explorer'] })]);
  }, [qc, userId]);

  return (
    <ElementDrilldown label="Calendar" onNavigate={onNavigate} onViewChange={onViewChange}>
      {openElement => <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <SidebarReveal />
        <NavCalendarIcon size={14} />
        <span className="text-[13px] font-medium text-foreground">{t('Calendar')}</span>
        <div className="flex-1" />
        <CalendarScopePicker domains={domains} objects={scoped.availableObjects} selection={{ ...selection, domainIds }} onChange={setSelection} />
      </div>
      {error && <div role="alert" className="px-4 py-2 text-sm text-destructive">{t('Could not load the calendar.')} <Button size="xs" variant="ghost" onClick={() => { void domainQuery.refetch(); void fetchMine(); }}>{t('Retry')}</Button></div>}
      {loading && <div role="status" className="px-4 py-2 text-sm text-muted-foreground">{t('Loading schedules…')}</div>}
      <div className="flex-1 min-h-0 overflow-hidden" aria-busy={loading}>
        <CalendarView objects={selection.mine ? [] : scoped.objects} onObjectClick={object => {
          const domainId = domainIds.find(id => explorers[domainIds.indexOf(id)]?.data?.objects.some(item => item.id === object.id));
          onNavigate?.({ objectId: object.id, objectDomainId: domainId ?? null });
          onViewChange?.('objects');
        }} elements={elements} date={date} onDateChange={next => setCalendarDay(toDateOnlyString(next))} onRefresh={fetchMine} onElementClick={(el) => openElement(el.id)}
          events={events}
          onEventClick={event => setEventPopup({ draft: draftFromEvent(event), event })}
          onCreateEvent={spaceId ? slot => setEventPopup({ draft: draftFromSlot(slot.date, slot.startMinutes, slot.endMinutes) }) : undefined} />
      </div>
      {eventPopup && (
        <CalendarEventPopup key={eventPopup.event?.id ?? 'new'} initial={eventPopup.draft} event={eventPopup.event}
          elements={scopedElements}
          onSave={saveEvent}
          onDelete={eventPopup.event ? async () => { await deleteCalendarEvent(eventPopup.event!.id); await invalidateEvents(); } : undefined}
          onClose={() => setEventPopup(null)}
          onOpenElement={id => { setEventPopup(null); openElement(id); }} />
      )}
      </div>}
    </ElementDrilldown>
  );
}
