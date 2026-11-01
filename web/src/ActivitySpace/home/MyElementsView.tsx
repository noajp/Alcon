'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, Trash2 } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fetchMyElements, type MyElementsData } from '@/hooks/myElementsData';
import { useAuthContext } from '@/providers/AuthProvider';
import {
  assignWorkersToElement,
  noticeSkippedAssignees,
  createElement,
  updateElement,
  deleteElement,
  useDomains,
  useWorkers,
} from '@/hooks/useSupabase';
import { withCurrentWorkers } from '@/Function/shared/assignableWorkers';
import { useElementSelection } from '@/ActivitySpace/execution/element/useElementSelection';
import { BulkActionBar } from '@/ActivitySpace/execution/element/BulkActionBar';
import { DeletedElementsDialog } from '@/ActivitySpace/execution/object/DeletedElementsDialog';
import { bulkSetAssignee } from '@/hooks/bulkAssign';
import type {
  Worker,
} from '@/types/database';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { ElementDetailView } from '@/ActivitySpace/execution/element/ElementDetailView';
import { QuickAddElementPopup, type NewElementInput } from '@/ActivitySpace/execution/element/QuickAddElementPopup';
import { ElementsList } from '@/ActivitySpace/execution/element/ElementsList';
import type { ColumnId, DataColumn } from '@/Function/shared/listTable/useListColumns';
import { ELEMENT_DEFAULT_VISIBLE } from '@/Function/shared/listConfig';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import type { NavigationState } from '@/types/navigation';
import { pushUndo } from '@/Function/shared/element/bulkUndo';
import {
  ListControls,
  loadState,
  saveState,
  DEFAULT_STATE,
  type ListControlsState,
} from '@/Function/shared/listControls';

interface MyElementsViewProps {
  embedded?: boolean;
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
const EMPTY_ELEMENTS: ElementWithDetails[] = [];
const EMPTY_WORKERS: Worker[] = [];

export function MyElementsView({ onRefresh, onNavigate, onViewChange, embedded = false }: MyElementsViewProps) {
  const { user } = useAuthContext();
  const userId = user?.id ?? null;

  // One RPC (get_my_elements) replaces the old seven-step client waterfall,
  // and the shared query cache means the landing view paints from IndexedDB
  // on a warm start while the refresh runs behind it.
  const qc = useQueryClient();
  const queryKey = useMemo(() => ['my-elements', userId] as const, [userId]);
  const mine = useQuery({
    queryKey,
    queryFn: () => fetchMyElements(userId!),
    enabled: !!userId,
    placeholderData: keepPreviousData,
  });
  const elements = mine.data?.elements ?? EMPTY_ELEMENTS;
  const myWorkers = mine.data?.workers ?? EMPTY_WORKERS;
  const loading = !!userId && mine.isPending;
  const fetchMine = useCallback(async () => {
    await qc.invalidateQueries({ queryKey });
  }, [qc, queryKey]);
  // Local optimistic patch — same shape as before (a setState updater), but
  // written into the cache so every reader sees it.
  const setElements = useCallback((update: (prev: ElementWithDetails[]) => ElementWithDetails[]) => {
    qc.setQueryData<MyElementsData>(queryKey, (prev) => {
      const base = prev ?? { elements: EMPTY_ELEMENTS, workers: EMPTY_WORKERS };
      return { ...base, elements: update(base.elements) };
    });
  }, [qc, queryKey]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const { t } = useI18n();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [controls, setControls] = useState<ListControlsState>(() => loadState('my-elements'));
  useEffect(() => { saveState('my-elements', controls); }, [controls]);

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
  // QuickAdd's Assignee pill: yourself, then the Workers assignable in the
  // active Space.
  const { data: spaceWorkers } = useWorkers();
  const popupWorkers = useMemo(() => withCurrentWorkers(myWorkers, spaceWorkers), [myWorkers, spaceWorkers]);

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
  }, [fetchMine, setElements]);

  // Multi-select + bulk ops. Personal Elements aren't Object-homed, so the
  // bulk bar offers Delete + Duplicate only (no Move / Add-to-Object).
  const { selectedRowIds, handleRowSelect, clearSelection, selectOnly } = useElementSelection();
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
  // Hand the selection to one person (undoable); Elements they cannot take keep their people.
  const assigneeOptions = useMemo(() => (spaceWorkers ?? []).map((w) => ({ id: w.id, name: w.name, hint: w.type === 'ai_agent' ? t('AI') : null })), [spaceWorkers, t]);
  const bulkAssign = useCallback(async (workerId: string) => {
    // What could not be handed over stays selected, with the bar saying why.
    const failed = await bulkSetAssignee([...selectedRowIds], workerId, async () => { await fetchMine(); await onRefresh?.(); });
    selectOnly(failed);
    return failed.length;
  }, [selectedRowIds, selectOnly, fetchMine, onRefresh]);
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
    let skippedAssignees = 0;
    for (const input of inputs) {
      try {
        // Personal Element: no object, owner = me. Honor the popup's shared
        // description / status / priority / labels. Assignees come from the
        // pill picker; fall back to my own worker so the row stays in My
        // Elements via the assignee scope even if owner_id is ever cleared.
        const created = await createElement({
          title: input.title,
          object_id: input.objectId ?? null,
          owner_id: input.objectId ? null : userId,
          description: input.description ?? null,
          type: input.type ?? null,
          labels: input.labels ?? [],
          status: input.status ?? undefined,
          priority: input.priority ?? undefined,
        });
        const assigneeIds = input.assigneeWorkerIds && input.assigneeWorkerIds.length > 0
          ? input.assigneeWorkerIds
          : (myWorkers[0] ? [myWorkers[0].id] : []);
        skippedAssignees += (await assignWorkersToElement(created.id, assigneeIds)).skipped.length;
      } catch (e) {
        console.error('Failed to create personal Element', e);
      }
    }
    noticeSkippedAssignees(skippedAssignees);
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
        {!embedded && <span className="text-[13px] font-medium text-foreground">{t('My Elements')}</span>}
        <span className="text-[11px] text-muted-foreground">{embedded ? t('{n} Elements', { n: elements.length }) : elements.length}</span>
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
        <ButtonAppearanceProvider appearance="navigation">
          {userId && (
            <Button variant="ghost" size="icon-xs" onClick={() => setDeletedOpen(true)} title={t('Deleted Elements')} aria-label={t('Deleted Elements')}>
              <Trash2 size={14} />
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={() => setQuickAddOpen(true)} title={t('Add personal Element')} aria-label={t('Add personal Element')}>
            <Plus size={14} />
          </Button>
        </ButtonAppearanceProvider>
        {deletedOpen && userId && (
          <DeletedElementsDialog mine={userId} onClose={() => setDeletedOpen(false)} onRestored={() => { void fetchMine(); void onRefresh?.(); }} />
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground" role="status">
          {t('Loading…')}
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
            onRefresh={async () => { await mine.refetch(); }}
            colStorageKey="my-elements"
            selectedElementIds={selectedRowIds}
            onElementRowSelect={handleRowSelect}
          />
        </div>
      )}

      <QuickAddElementPopup
        open={quickAddOpen}
        contextLabel={t('My Elements')}
        onClose={() => setQuickAddOpen(false)}
        onSubmit={handleQuickAddSubmit}
        types={elementTypes}
        workers={popupWorkers.map((w) => ({ id: w.id, name: w.name, avatar_url: w.avatar_url }))}
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
        onSetAssignee={(workerId) => bulkAssign(workerId)}
        assigneeOptions={assigneeOptions}
        onClear={clearSelection}
      />
    </div>
  );
}

function MyElementsEmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-[13px] text-muted-foreground">{t("Anything that's yours alone — quick captures, personal todos, ideas — lives here.")}</p>
      <Button variant="primary" size="sm" className="gap-1.5" onClick={onAdd}><Plus size={14} />{t('Create Element')}</Button>
    </div>
  );
}
