'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { CalendarView } from '@/alcon/element/calendar/CalendarView';
import { ElementDetailView } from '@/alcon/element/ElementDetailView';
import { NavCalendarIcon } from '@/shell/sidebar/NavIcons';
import { fetchElementWithDetails } from '@/hooks/useSupabase';
import type { Element, Worker } from '@/types/database';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { NavigationState } from '@/types/navigation';

// =============================================================
// MyCalendarView — the Home "Calendar" surface. The signed-in user's
// Elements (owned or assigned, same scope as My Elements) laid out on the
// shared CalendarView. Rows are hydrated only as far as the calendar
// needs — no subelement / assignee / Objects-column joins.
// =============================================================

interface MyCalendarViewProps {
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

export function MyCalendarView({ onNavigate, onViewChange }: MyCalendarViewProps) {
  const { user } = useAuthContext();
  const userId = user?.id ?? null;

  const [elements, setElements] = useState<ElementWithDetails[]>([]);

  const fetchMine = useCallback(async () => {
    if (!userId) {
      setElements([]);
      return;
    }
    try {
      // My worker rows → Element ids I'm assigned to (mirrors My Elements).
      const { data: workersData } = await supabase
        .from('workers')
        .select('id')
        .eq('user_id', userId);
      const myWorkerIds = ((workersData || []) as Pick<Worker, 'id'>[]).map((w) => w.id);

      let assignedIds: string[] = [];
      if (myWorkerIds.length > 0) {
        const { data: assigned } = await supabase
          .from('element_assignees')
          .select('element_id')
          .in('worker_id', myWorkerIds);
        assignedIds = Array.from(new Set((assigned || []).map((r) => r.element_id)));
      }

      const ownedRes = await supabase.from('elements').select('*').eq('owner_id', userId);
      const chunks: Element[][] = [(ownedRes.data || []) as Element[]];
      if (assignedIds.length > 0) {
        const assignedRes = await supabase.from('elements').select('*').in('id', assignedIds);
        chunks.push((assignedRes.data || []) as Element[]);
      }
      const seen = new Set<string>();
      const merged: ElementWithDetails[] = [];
      for (const chunk of chunks) {
        for (const e of chunk) {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            merged.push(e);
          }
        }
      }
      setElements(merged);
    } catch (err) {
      console.error('Failed to load Calendar elements:', err);
    }
  }, [userId]);

  useEffect(() => { void fetchMine(); }, [fetchMine]);

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

  if (openId) {
    return detail?.element ? (
      <ElementDetailView
        element={detail.element}
        domainName={null}
        objectPath={detail.element.objects ?? []}
        onBack={() => setOpenId(null)}
        onRefresh={() => loadDetail(openId)}
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
            <button
              onClick={() => setOpenId(null)}
              className="text-[12px] px-2 h-6 rounded-md bg-muted/40 text-foreground hover:bg-muted/60 transition-colors"
            >
              Back to Calendar
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavCalendarIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Calendar</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <CalendarView elements={elements} onRefresh={fetchMine} onElementClick={(el) => setOpenId(el.id)} />
      </div>
    </div>
  );
}
