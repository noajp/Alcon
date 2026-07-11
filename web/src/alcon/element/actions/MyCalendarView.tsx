'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { CalendarView } from '@/alcon/element/calendar/CalendarView';
import { NavCalendarIcon } from '@/shell/sidebar/NavIcons';
import type { Element, Worker } from '@/types/database';
import type { ElementWithDetails } from '@/hooks/useSupabase';

// =============================================================
// MyCalendarView — the Home "Calendar" surface. The signed-in user's
// Elements (owned or assigned, same scope as My Elements) laid out on the
// shared CalendarView. Rows are hydrated only as far as the calendar
// needs — no subelement / assignee / Objects-column joins.
// =============================================================

export function MyCalendarView() {
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

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavCalendarIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Calendar</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <CalendarView elements={elements} onRefresh={fetchMine} />
      </div>
    </div>
  );
}
