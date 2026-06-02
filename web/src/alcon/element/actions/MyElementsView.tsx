'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import {
  addElementAssignee,
  createElement,
  updateElement,
  deleteElement,
} from '@/hooks/useSupabase';
import { useElementSelection } from '@/alcon/element/useElementSelection';
import { BulkActionBar } from '@/alcon/element/BulkActionBar';
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
import { pushUndo } from '@/alcon/element/bulkUndo';
import {
  ListControls,
  applyFilter,
  effectiveGroupBy,
  groupAndOrder,
  orderElements,
  loadState,
  saveState,
  DEFAULT_STATE,
  type ListControlsState,
} from '@/alcon/shared/listControls';

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
  const [controls, setControls] = useState<ListControlsState>(() => loadState('my-elements'));
  useEffect(() => { saveState('my-elements', controls); }, [controls]);

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

  // Distinct option sets for the Filter panel — derived from what's
  // actually in the dataset so the panel only offers values that match
  // something.
  const typeOptions = useMemo<string[]>(() => {
    const s = new Set<string>();
    for (const e of elements) if (e.type) s.add(e.type);
    return Array.from(s).sort();
  }, [elements]);
  const labelOptions = useMemo<string[]>(() => {
    const s = new Set<string>();
    for (const e of elements) for (const l of e.labels ?? []) s.add(l);
    return Array.from(s).sort();
  }, [elements]);
  const workerOptions = useMemo<Worker[]>(() => {
    const map = new Map<string, Worker>();
    for (const w of myWorkers) map.set(w.id, w);
    for (const e of elements) {
      for (const a of e.assignees ?? []) {
        if (a.worker && !map.has(a.worker.id)) map.set(a.worker.id, a.worker);
      }
    }
    return Array.from(map.values());
  }, [myWorkers, elements]);

  // Filter then group + order. Default (groupBy='none' with no filter)
  // collapses to a single anonymous section. When the user narrows the
  // filter to a single facet (e.g. Status=Todo), auto-switch the band
  // to that facet so the result reads as "Todo (N)".
  const effGroupBy = effectiveGroupBy(controls.filter, controls.display.groupBy);
  // Personal Elements are intentionally Object-less, so the default 'object'
  // grouping has no partition to honour — collapse it (and 'none') to a single
  // flat list, mirroring ElementsList's no-partition fallback. Only genuine
  // field groupings (status / priority / …) bucket via groupAndOrder. Without
  // this, groupAndOrder('object') buckets nothing and the list renders empty.
  const isFlat = effGroupBy === 'none' || effGroupBy === 'object';
  const sections = useMemo<ListSection[]>(() => {
    const filtered = applyFilter(elements, controls.filter, { currentUserId: userId });
    if (filtered.length === 0) return [];
    if (isFlat) {
      return [{ id: '_all', name: '', objects: [], elements: orderElements(filtered, controls.display) }];
    }
    return groupAndOrder(filtered, { ...controls.display, groupBy: effGroupBy });
  }, [elements, controls, effGroupBy, isFlat, userId]);
  const hideSectionHeaders = isFlat;

  const handleElementUpdate = useCallback(async (
    elementId: string,
    updates: Parameters<typeof updateElement>[1],
  ) => {
    // Optimistic patch of the local list — instant, no `fetchMine()` reload
    // (which flips `loading` and flashes the whole list on every status
    // change). Reconcile from the saved row (incl. status→progress
    // normalisation) without a reload; only fall back to a full refetch on
    // error. This view owns its own state, so updateElement's explorer-cache
    // patch doesn't reach it — we patch here instead.
    setElements((prev) => prev.map((e) => (e.id === elementId ? { ...e, ...updates } : e)));
    try {
      const saved = await updateElement(elementId, updates);
      setElements((prev) => prev.map((e) => (e.id === elementId ? { ...e, ...saved } : e)));
    } catch (e) {
      console.error('Failed to update element', e);
      await fetchMine();
    }
  }, [fetchMine]);

  // Multi-select + bulk ops. Personal Elements aren't Object-homed, so the
  // bulk bar offers Delete + Duplicate only (no Move / Add-to-Object).
  const { selectedRowIds, handleRowSelect, clearSelection } = useElementSelection();
  const bulkDelete = useCallback(async () => {
    for (const id of selectedRowIds) {
      try { await deleteElement(id); } catch (e) { console.error('Delete failed', id, e); }
    }
    clearSelection();
    await fetchMine();
    await onRefresh?.();
  }, [selectedRowIds, clearSelection, fetchMine, onRefresh]);
  const bulkDuplicate = useCallback(async () => {
    if (!userId) return;
    const created: string[] = [];
    for (const id of selectedRowIds) {
      const src = elements.find((e) => e.id === id);
      if (!src) continue;
      try {
        const dup = await createElement({
          title: `${src.title} (copy)`,
          owner_id: userId,
          object_id: null,
          description: src.description ?? null,
          status: src.status ?? undefined,
          priority: src.priority ?? undefined,
          due_date: src.due_date ?? null,
        });
        if (dup?.id) created.push(dup.id);
      } catch (e) { console.error('Duplicate failed', id, e); }
    }
    clearSelection();
    await fetchMine();
    await onRefresh?.();
    if (created.length > 0) {
      pushUndo({
        label: `Duplicate ${created.length} Elements`,
        undo: async () => {
          for (const id of created) { try { await deleteElement(id); } catch (e) { console.error(e); } }
          await fetchMine();
          await onRefresh?.();
        },
      });
    }
  }, [userId, selectedRowIds, elements, clearSelection, fetchMine, onRefresh]);
  const bulkSetField = useCallback(async (
    field: 'status' | 'priority' | 'due_date',
    value: unknown,
    label: string,
  ) => {
    const prev = new Map<string, unknown>();
    for (const id of selectedRowIds) prev.set(id, (elements.find((e) => e.id === id) as Record<string, unknown> | undefined)?.[field] ?? null);
    for (const id of selectedRowIds) {
      try { await updateElement(id, { [field]: value }); } catch (e) { console.error('Bulk edit failed', id, e); }
    }
    clearSelection();
    await fetchMine();
    await onRefresh?.();
    pushUndo({
      label,
      undo: async () => {
        for (const [id, original] of prev) { try { await updateElement(id, { [field]: original }); } catch (e) { console.error(e); } }
        await fetchMine();
        await onRefresh?.();
      },
    });
  }, [selectedRowIds, elements, clearSelection, fetchMine, onRefresh]);

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
        <ListControls
          state={controls}
          onChange={setControls}
          typeOptions={typeOptions}
          labelOptions={labelOptions}
          workerOptions={workerOptions}
          showOwnerFilter={false}
          onReset={() => setControls(DEFAULT_STATE)}
          sortColumnsStorageKey="my-elements"
        />
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
            hideSectionHeaders={hideSectionHeaders}
            colStorageKey="my-elements"
            selectedElementIds={selectedRowIds}
            onElementRowSelect={handleRowSelect}
          />
        </div>
      )}

      <QuickAddElementPopup
        open={quickAddOpen}
        contextLabel="My Elements"
        onClose={() => setQuickAddOpen(false)}
        onSubmit={handleQuickAddSubmit}
      />

      <BulkActionBar
        count={selectedRowIds.size}
        pickerObjects={[]}
        onDelete={bulkDelete}
        onDuplicate={bulkDuplicate}
        onSetStatus={(s) => bulkSetField('status', s, `Set status of ${selectedRowIds.size} Elements`)}
        onSetPriority={(p) => bulkSetField('priority', p, `Set priority of ${selectedRowIds.size} Elements`)}
        onSetDueDate={(d) => bulkSetField('due_date', d, `Set due date of ${selectedRowIds.size} Elements`)}
        onClear={clearSelection}
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
