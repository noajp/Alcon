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
  useDomains,
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
import { QuickAddElementPopup, type NewElementInput } from '@/alcon/element/QuickAddElementPopup';
import { ElementsList } from '@/alcon/element/ElementsList';
import type { ColumnId, DataColumn } from '@/alcon/object/useListColumns';
import { ELEMENT_DEFAULT_VISIBLE } from '@/alcon/shared/listConfig';
import { NavMyTasksIcon } from '@/shell/sidebar/NavIcons';
import type { NavigationState } from '@/types/navigation';
import { pushUndo } from '@/alcon/element/bulkUndo';
import {
  ListControls,
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

// My Elements is cross-Object, so unlike the other lists it shows which home
// Object(s) each Element belongs to — Asana My Tasks' "Projects" column. The
// column is injected only here (not a global built-in) and on by default.
// Module-level constants keep the array identities stable across renders.
const MY_EXTRA_COLUMNS: DataColumn[] = [
  { id: 'objects', label: 'Objects', kind: 'builtin', toggleable: true, defaultWidth: 180 },
];
// Element default columns + My Elements' cross-Object "Objects" column on top.
const MY_DEFAULT_VISIBLE: ColumnId[] = [...ELEMENT_DEFAULT_VISIBLE, 'objects'];

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
      // Home Objects per element — the "Objects" column (Asana My Tasks
      // "Projects"). Union of the multi-home junction and the legacy primary
      // object_id, resolved to { id, name }.
      const objectIdsByElement = new Map<string, string[]>();
      let objectNameById = new Map<string, string>();
      if (elementIds.length > 0) {
        const [{ data: subData }, { data: assigneeData }, { data: eoData }] = await Promise.all([
          supabase.from('subelements').select('*').in('element_id', elementIds).order('order_index'),
          supabase.from('element_assignees').select('*').in('element_id', elementIds),
          supabase.from('element_objects').select('element_id, object_id').in('element_id', elementIds),
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

        // Build element → object_ids (junction ∪ primary FK), then fetch names.
        for (const e of elementsRaw) {
          const ids = new Set<string>();
          if (e.object_id) ids.add(e.object_id);
          if (ids.size > 0) objectIdsByElement.set(e.id, Array.from(ids));
        }
        for (const row of (eoData || []) as { element_id: string; object_id: string }[]) {
          const cur = objectIdsByElement.get(row.element_id) ?? [];
          if (!cur.includes(row.object_id)) cur.push(row.object_id);
          objectIdsByElement.set(row.element_id, cur);
        }
        const allObjectIds = Array.from(new Set([...objectIdsByElement.values()].flat()));
        if (allObjectIds.length > 0) {
          const { data: objRows } = await supabase
            .from('objects')
            .select('id, name')
            .in('id', allObjectIds);
          objectNameById = new Map((objRows || []).map((o) => [o.id as string, o.name as string]));
        }
      }

      const hydrated: ElementWithDetails[] = elementsRaw.map((e) => {
        const objIds = objectIdsByElement.get(e.id) ?? [];
        const objects = objIds
          .map((id) => ({ id, name: objectNameById.get(id) ?? '' }))
          .filter((o) => o.name);
        return {
          ...e,
          subelements: subs.filter((s) => s.element_id === e.id),
          assignees: allAssignees
            .filter((a) => a.element_id === e.id)
            .map((a) => ({ ...a, worker: allWorkers.find((w) => w.id === a.worker_id) })),
          objectIds: objIds,
          isMultiHomed: objIds.length > 1,
          objects,
        };
      });

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

  // Domain-shared type catalogue for the editable Type column. Rows here can
  // come from any Domain I'm a member of (or none), so offer the union of
  // every Domain's element_types. No onAddType: a brand-new type would need a
  // target Domain, which this Domain-less view can't pick.
  const { data: domains } = useDomains();
  const elementTypes = useMemo<string[]>(() => {
    const s = new Set<string>();
    for (const d of domains) for (const t of d.element_types ?? []) s.add(t);
    return Array.from(s);
  }, [domains]);

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

  const handleQuickAddSubmit = useCallback(async (inputs: NewElementInput[]) => {
    if (!userId) return;
    for (const input of inputs) {
      try {
        // Personal Element: no object, owner = me. Honor the popup's shared
        // description / status / priority / labels. Assignees come from the
        // pill picker; fall back to my own worker so the row stays in My
        // Elements via the assignee scope even if owner_id is ever cleared.
        const created = await createElement({
          title: input.title,
          object_id: input.objectId ?? null,
          owner_id: userId,
          description: input.description ?? null,
          type: input.type ?? null,
          status: input.status ?? undefined,
          priority: input.priority ?? undefined,
        });
        const assigneeIds = input.assigneeWorkerIds && input.assigneeWorkerIds.length > 0
          ? input.assigneeWorkerIds
          : (myWorkers[0] ? [myWorkers[0].id] : []);
        for (const wid of assigneeIds) {
          try {
            await addElementAssignee({ element_id: created.id, worker_id: wid, role: 'assignee' });
          } catch (assignErr) {
            console.warn('Could not assign personal Element:', assignErr);
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
      <div className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
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
          <ElementsList
            elements={elements}
            controls={controls}
            elementTypes={elementTypes}
            extraColumns={MY_EXTRA_COLUMNS}
            defaultVisibleColumns={MY_DEFAULT_VISIBLE}
            onSelectObject={() => { /* never carries Objects */ }}
            onSelectElement={(id) => setDetailId(id)}
            onElementUpdateOverride={handleElementUpdate}
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
        types={elementTypes}
        workers={workerOptions.map((w) => ({ id: w.id, name: w.name }))}
        availableLabels={labelOptions}
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
