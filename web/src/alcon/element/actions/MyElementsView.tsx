'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import {
  addElementAssignee,
  createElement,
  updateElement,
} from '@/hooks/useSupabase';
import type {
  Element,
  ElementAssignee,
  Subelement,
  Worker,
} from '@/types/database';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { ElementDetailView } from '@/alcon/element/ElementDetailView';
import { QuickAddElementPopup } from '@/alcon/element/QuickAddElementPopup';
import { ObjectListView, type ListSection } from '@/alcon/object/ObjectListView';
import { NavMyTasksIcon } from '@/shell/sidebar/NavIcons';
import type { NavigationState } from '@/types/navigation';

interface MyElementsViewProps {
  onRefresh?: () => void;
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

/**
 * Personal Elements scope — replaces the old fixed "Individual Domain".
 * Shows every Element where the signed-in user is either:
 *   - `elements.owner_id = me` (created in this view), or
 *   - an assignee via element_assignees → workers.user_id = me (assigned
 *     to me in a shared Domain).
 *
 * Quick-add stamps both owner_id and an assignee row so new personal
 * Elements stay personal across both filters.
 */
export function MyElementsView({ onRefresh, onNavigate, onViewChange }: MyElementsViewProps) {
  const { user } = useAuthContext();
  const userId = user?.id ?? null;

  const [elements, setElements] = useState<ElementWithDetails[]>([]);
  const [myWorkers, setMyWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const fetchMine = useCallback(async () => {
    if (!userId) {
      setElements([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 1. Resolve the current user's worker rows (handles seeded "中野貴慶"
      //    style mappings where workers.user_id was backfilled).
      const { data: workersData } = await supabase
        .from('workers')
        .select('*')
        .eq('user_id', userId);
      const myWorkerRows = (workersData || []) as Worker[];
      const myWorkerIds = myWorkerRows.map((w) => w.id);
      setMyWorkers(myWorkerRows);

      // 2. Element ids where I'm an assignee.
      let assignedIds: string[] = [];
      if (myWorkerIds.length > 0) {
        const { data: assigned } = await supabase
          .from('element_assignees')
          .select('element_id')
          .in('worker_id', myWorkerIds);
        assignedIds = Array.from(new Set((assigned || []).map((r) => r.element_id)));
      }

      // 3. Pull the elements (owner_id = me OR id ∈ assignedIds).
      const elementsRaw: Element[] = [];
      const ownedRes = await supabase
        .from('elements')
        .select('*')
        .eq('owner_id', userId);
      const chunks: Element[][] = [(ownedRes.data || []) as Element[]];
      if (assignedIds.length > 0) {
        const assignedRes = await supabase
          .from('elements')
          .select('*')
          .in('id', assignedIds);
        chunks.push((assignedRes.data || []) as Element[]);
      }
      const seen = new Set<string>();
      for (const chunk of chunks) {
        for (const e of chunk) {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            elementsRaw.push(e);
          }
        }
      }
      elementsRaw.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

      // 4. Hydrate subelements + assignees + worker details so the row
      //    renders the same status / progress / assignee chips the rest
      //    of the app expects.
      const elementIds = elementsRaw.map((e) => e.id);
      let subs: Subelement[] = [];
      let allAssignees: ElementAssignee[] = [];
      let allWorkers: Worker[] = [];
      if (elementIds.length > 0) {
        const [{ data: subData }, { data: assigneeData }] = await Promise.all([
          supabase.from('subelements').select('*').in('element_id', elementIds).order('order_index'),
          supabase.from('element_assignees').select('*').in('element_id', elementIds),
        ]);
        subs = (subData || []) as Subelement[];
        allAssignees = (assigneeData || []) as ElementAssignee[];
        const workerIds = Array.from(new Set(allAssignees.map((a) => a.worker_id)));
        if (workerIds.length > 0) {
          const { data: workersFull } = await supabase
            .from('workers')
            .select('*')
            .in('id', workerIds);
          allWorkers = (workersFull || []) as Worker[];
        }
      }

      const hydrated: ElementWithDetails[] = elementsRaw.map((e) => ({
        ...e,
        subelements: subs.filter((s) => s.element_id === e.id),
        assignees: allAssignees
          .filter((a) => a.element_id === e.id)
          .map((a) => ({ ...a, worker: allWorkers.find((w) => w.id === a.worker_id) })),
        objectIds: [],
        isMultiHomed: false,
      }));

      setElements(hydrated);
    } catch (err) {
      console.error('Failed to load My Elements:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void fetchMine(); }, [fetchMine]);

  const elementById = useMemo(() => {
    const m = new Map<string, ElementWithDetails>();
    for (const e of elements) m.set(e.id, e);
    return m;
  }, [elements]);
  const detailElement = detailId ? elementById.get(detailId) ?? null : null;

  const sections = useMemo<ListSection[]>(() => {
    if (elements.length === 0) return [];
    return [{ id: '__mine__', name: 'Mine', objects: [], elements }];
  }, [elements]);

  const handleElementUpdate = useCallback(async (
    elementId: string,
    updates: Parameters<typeof updateElement>[1],
  ) => {
    try {
      await updateElement(elementId, updates);
      await fetchMine();
      await onRefresh?.();
    } catch (e) {
      console.error('Failed to update element', e);
    }
  }, [fetchMine, onRefresh]);

  const handleQuickAddSubmit = useCallback(async (titles: string[]) => {
    if (!userId) return;
    for (const title of titles) {
      try {
        // Personal Element: no object, owner = me. After insert, also push
        // an assignee row so the user shows up in the chip + the row stays
        // visible if owner_id is ever cleared later.
        const created = await createElement({ title, object_id: null, owner_id: userId });
        if (myWorkers[0]) {
          try {
            await addElementAssignee({
              element_id: created.id,
              worker_id: myWorkers[0].id,
              role: 'assignee',
            });
          } catch (assignErr) {
            // Not fatal — owner_id still scopes the Element to the user.
            console.warn('Could not auto-assign personal Element:', assignErr);
          }
        }
      } catch (e) {
        console.error('Failed to create personal Element', e);
      }
    }
    await fetchMine();
    await onRefresh?.();
  }, [userId, myWorkers, fetchMine, onRefresh]);

  if (detailElement) {
    return (
      <ElementDetailView
        element={detailElement}
        domainName={null}
        objectPath={[]}
        onBack={() => setDetailId(null)}
        onRefresh={fetchMine}
        onNavigateRoot={() => {
          setDetailId(null);
          onViewChange?.('my-elements');
          onNavigate?.({ objectId: null });
        }}
        onNavigateObject={() => {
          // Personal Elements have no Object — no-op.
          setDetailId(null);
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Plain header — no Domain breadcrumb because personal Elements are
          intentionally Domain-less. */}
      <div className="h-10 flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <span className="text-[12px] font-semibold text-foreground">My Elements</span>
        <span className="text-[11px] text-muted-foreground">{elements.length}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setQuickAddOpen(true)}
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          title="Add personal Element"
        >
          <Plus size={14} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
          Loading…
        </div>
      ) : elements.length === 0 ? (
        <MyElementsEmptyState onAdd={() => setQuickAddOpen(true)} />
      ) : (
        <div className="flex-1 overflow-auto">
          <ObjectListView
            sections={sections}
            onSelectObject={() => { /* never carries Objects */ }}
            onSelectElement={(id) => setDetailId(id)}
            onElementUpdate={handleElementUpdate}
            hideSectionHeaders
            colStorageKey="my-elements"
          />
        </div>
      )}

      <QuickAddElementPopup
        open={quickAddOpen}
        contextLabel="My Elements"
        onClose={() => setQuickAddOpen(false)}
        onSubmit={handleQuickAddSubmit}
      />
    </div>
  );
}

function MyElementsEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 select-none">
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[0.18, 0.35, 0.55, 1].map((opacity, i) => (
          <div
            key={i}
            className="w-14 h-14 rounded-xl border-2 border-muted-foreground flex items-center justify-center"
            style={{ opacity, borderStyle: i === 0 ? 'dashed' : 'solid' }}
          >
            <NavMyTasksIcon size={22} />
          </div>
        ))}
      </div>
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Your personal Elements</h2>
      <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-2">
        Anything that's yours alone — quick captures, personal todos, ideas — lives here.
      </p>
      <p className="text-[12px] text-muted-foreground/60 text-center max-w-xs mb-6">
        You'll also see Elements from shared Domains where you're assigned.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-[13px] font-semibold hover:bg-foreground/90 transition-colors"
      >
        <Plus size={14} />
        Create Element
      </button>
    </div>
  );
}
