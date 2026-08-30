'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { DomainIcon } from '@/alcon/shared/conceptIcons';
import type { ExplorerData, AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement, createElement, deleteElement, addElementToObject, removeElementFromObject, addDomainElementType, removeDomainElementType, useDomains } from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { useElementSelection } from '@/alcon/element/useElementSelection';
import { BulkActionBar } from '@/alcon/element/BulkActionBar';
import { pushUndo } from '@/alcon/element/bulkUndo';
import { ObjectIcon } from '@/shell/icons';
import { NavMyTasksIcon } from '@/shell/sidebar/NavIcons';
import { ElementsList } from '@/alcon/element/ElementsList';
import { ElementDetailView } from '@/alcon/element/ElementDetailView';
import { ElementBoardView } from '@/alcon/element/board/ElementBoardView';
import { GanttView } from '@/alcon/element/gantt';
import { CalendarView } from '@/alcon/element/calendar/CalendarView';
import { CustomView } from '@/alcon/element/custom';
import { QuickAddElementPopup, type NewElementInput } from '@/alcon/element/QuickAddElementPopup';
import { addElementAssignee } from '@/hooks/useSupabase';
import { type ListSection } from '@/alcon/object/ListTable';
import { TabBar } from '@/shell/TabBar';
import type { NavigationState } from '@/types/navigation';
import type { Worker, ObjectTab, ObjectTabType, Json } from '@/types/database';
import {
  ListControls,
  buildSections,
  loadState,
  saveState,
  sectionGroupValues,
  DEFAULT_STATE,
  type ListControlsState,
  type SectionGroup,
} from '@/alcon/shared/listControls';

// View modes for the Domain-wide Elements view. We reuse the same
// `ObjectTabType` union as Object detail tabs so this view can share
// the shell `TabBar` and look identical to the Object-level Elements
// tab. The 'elements' mode renders the flat "All Elements" list; the
// rest pivot the same data into Board / Gantt / Calendar / Workers.
const VIEW_MODES: ObjectTabType[] = ['elements', 'board', 'gantt', 'calendar', 'workers', 'custom_view'];
const VIEW_MODE_TITLES: Partial<Record<ObjectTabType, string>> = {
  elements: 'All Elements',
  board: 'Board',
  gantt: 'Gantt',
  calendar: 'Calendar',
  workers: 'Workers',
  custom_view: 'CustomView',
};

function isViewMode(t: ObjectTabType): boolean {
  return VIEW_MODES.includes(t);
}

const DEFAULT_VISIBLE_TABS: ObjectTabType[] = ['elements'];
const VISIBLE_TABS_KEY = 'elements:visibleTabs';
const ACTIVE_TAB_KEY = 'elements:activeTab';

function loadVisibleTabs(): ObjectTabType[] {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE_TABS;
  try {
    const raw = window.localStorage.getItem(VISIBLE_TABS_KEY);
    if (!raw) return DEFAULT_VISIBLE_TABS;
    // Migrate legacy 'list' keys → 'elements'.
    const parsed = (JSON.parse(raw) as string[]).map((t) => (t === 'list' ? 'elements' : t)) as ObjectTabType[];
    const valid = parsed.filter(isViewMode);
    return valid.length > 0 ? Array.from(new Set(valid)) : DEFAULT_VISIBLE_TABS;
  } catch {
    return DEFAULT_VISIBLE_TABS;
  }
}

interface ElementsListViewProps {
  explorerData?: ExplorerData;
  onRefresh?: () => void;
  activeDomainId?: string | null;
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

/**
 * Domain-wide Elements view. Renders every Object's Elements as
 * collapsible sections via the shared `ListTable` so the row
 * markup, hover styles, and column toggles stay in lockstep with the
 * Domain Object list and Object-detail Elements tab.
 *
 * The page only owns the toolbar, the empty-state, the Element-detail
 * drill-in, and the Domain-direct quick-add popup.
 */
export function ElementsListView({ explorerData, onRefresh, activeDomainId, onNavigate, onViewChange }: ElementsListViewProps) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [visibleTabs, setVisibleTabs] = useState<ObjectTabType[]>(loadVisibleTabs);
  const [viewMode, setViewMode] = useState<ObjectTabType>(() => {
    if (typeof window === 'undefined') return 'elements';
    const saved = window.localStorage.getItem(ACTIVE_TAB_KEY);
    if (!saved) return 'elements';
    const migrated = saved === 'list' ? 'elements' : (saved as ObjectTabType);
    return isViewMode(migrated) ? migrated : 'elements';
  });
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Section-aware quick-add: null = Domain-direct, otherwise the target Object.
  const [quickAddTargetObjectId, setQuickAddTargetObjectId] = useState<string | null>(null);
  const [quickAddLabel, setQuickAddLabel] = useState<string | null>(null);
  // The bucket the popup was opened from, when the list is grouped by a field
  // — it seeds the popup's pills so the header + and the add row directly
  // under it agree on where the new Element belongs.
  const [quickAddGroup, setQuickAddGroup] = useState<SectionGroup | undefined>(undefined);
  const [controls, setControls] = useState<ListControlsState>(() => loadState('domain-elements'));
  useEffect(() => { saveState('domain-elements', controls); }, [controls]);

  // Persist visible tabs + active tab in localStorage so the user's tab
  // shape sticks across page reloads (mirrors DomainView's behaviour).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VISIBLE_TABS_KEY, JSON.stringify(visibleTabs));
  }, [visibleTabs]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACTIVE_TAB_KEY, viewMode);
  }, [viewMode]);

  // If the active tab was hidden, fall back to the first visible one.
  const effectiveViewMode: ObjectTabType = visibleTabs.includes(viewMode)
    ? viewMode
    : (visibleTabs[0] ?? 'elements');

  const addTab = (id: ObjectTabType) => {
    if (!isViewMode(id)) return;
    setVisibleTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setViewMode(id);
  };

  const removeTab = (id: ObjectTabType) => {
    if (id === 'elements') return; // "All Elements" is permanent
    setVisibleTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      return next.length > 0 ? next : DEFAULT_VISIBLE_TABS;
    });
    if (viewMode === id) setViewMode('elements');
  };

  // Synthetic ObjectTab[] for the shared shell `TabBar` — gives this
  // view the exact same pill-shaped tab UI as DomainView so the two
  // "Elements" surfaces are visually identical.
  const tabs: ObjectTab[] = useMemo(
    () =>
      visibleTabs.map((type, i) => ({
        id: `domain-elements-${type}`,
        object_id: 'domain-elements',
        tab_type: type,
        title: VIEW_MODE_TITLES[type] ?? type,
        content: null as unknown as Json,
        note_id: null,
        order_index: i,
        is_pinned: false,
        created_at: null,
        updated_at: null,
      })),
    [visibleTabs],
  );
  const activeTabId = tabs.find((t) => t.tab_type === effectiveViewMode)?.id ?? tabs[0]?.id ?? null;

  // Active Domain — used as the popup's context label so users see which
  // Domain a Domain-direct Element will be created under.
  const { data: domains, refetch: refetchDomains } = useDomains();
  const { user } = useAuthContext();
  const userId = user?.id ?? null;
  const activeDomainName = useMemo(() => {
    const id = activeDomainId ?? null;
    return id ? domains.find((d) => d.id === id)?.name ?? null : null;
  }, [domains, activeDomainId]);

  // Domain-shared Element types — option list for the list table's `type` column.
  const elementTypes = useMemo<string[]>(() => {
    const id = activeDomainId ?? null;
    return id ? domains.find((d) => d.id === id)?.element_types ?? [] : [];
  }, [domains, activeDomainId]);

  const objectsWithElements = useMemo<AlconObjectWithChildren[]>(() => {
    if (!explorerData) return [];
    return explorerData.objects.filter((o) => (o.elements?.length ?? 0) > 0);
  }, [explorerData]);

  const domainElements = explorerData?.rootElements ?? [];

  // Original per-Object sections — used only when groupBy === 'none' so the
  // default view keeps the familiar Domain → Object headers. Any other
  // groupBy regroups across these boundaries.
  const objectSections = useMemo<ListSection[]>(() => {
    const out: ListSection[] = [];
    if (domainElements.length > 0) {
      out.push({
        id: '__domain__',
        name: 'Domain',
        icon: <DomainIcon size={16} />,
        objects: [],
        elements: domainElements,
      });
    }
    for (const obj of objectsWithElements) {
      out.push({
        id: obj.id,
        name: obj.name,
        icon: <ObjectIcon size={14} />,
        objects: [],
        elements: obj.elements ?? [],
      });
    }
    return out;
  }, [domainElements, objectsWithElements]);

  // Flattened view of every Element across Domain-direct + per-Object
  // sections — drives Board / Gantt / Calendar tabs, and the Filter pipeline
  // when groupBy != 'none'.
  const allElementsFlat = useMemo<ElementWithDetails[]>(() => {
    const m = new Map<string, ElementWithDetails>();
    for (const sec of objectSections) for (const el of sec.elements ?? []) m.set(el.id, el);
    return Array.from(m.values());
  }, [objectSections]);

  const allElementsForLookup = useMemo(() => {
    const m = new Map<string, ElementWithDetails>();
    for (const e of allElementsFlat) m.set(e.id, e);
    return m;
  }, [allElementsFlat]);

  // Board / Gantt sections honour the same Group / Sort / Filter controls as
  // the list (default groupBy='object' → per-Object bands). Owner filter is
  // off in this view, so currentUserId isn't needed.
  const groupedSections = useMemo(
    () => buildSections(allElementsFlat, objectSections, controls, null),
    [allElementsFlat, objectSections, controls],
  );

  // Multi-select + bulk operations (shared with the other element lists).
  const { selectedRowIds, handleRowSelect, clearSelection } = useElementSelection();
  const bulkDelete = async () => {
    for (const id of selectedRowIds) {
      try { await deleteElement(id); } catch (e) { console.error('Delete failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
  };
  const bulkDuplicate = async () => {
    const created: string[] = [];
    for (const id of selectedRowIds) {
      const src = allElementsForLookup.get(id);
      if (!src) continue;
      try {
        const dup = await createElement({
          title: `${src.title} (copy)`,
          object_id: src.object_id ?? null,
          description: src.description ?? null,
          status: src.status ?? undefined,
          priority: src.priority ?? undefined,
          start_date: src.start_date ?? null,
          due_date: src.due_date ?? null,
          estimated_hours: src.estimated_hours ?? null,
        });
        if (dup?.id) created.push(dup.id);
      } catch (e) { console.error('Duplicate failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
    // Undo = delete the copies we just made.
    if (created.length > 0) {
      pushUndo({
        label: `Duplicate ${created.length} Elements`,
        undo: async () => {
          for (const id of created) { try { await deleteElement(id); } catch (e) { console.error(e); } }
          await onRefresh?.();
        },
      });
    }
  };
  const bulkMove = async (targetObjectId: string) => {
    // Capture each element's current primary Object so the move is reversible.
    const prev = new Map<string, string | null>();
    for (const id of selectedRowIds) prev.set(id, allElementsForLookup.get(id)?.object_id ?? null);
    for (const id of selectedRowIds) {
      try { await updateElement(id, { object_id: targetObjectId }); } catch (e) { console.error('Move failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
    pushUndo({
      label: `Move ${prev.size} Elements`,
      undo: async () => {
        for (const [id, original] of prev) { try { await updateElement(id, { object_id: original }); } catch (e) { console.error(e); } }
        await onRefresh?.();
      },
    });
  };
  const bulkAddToObject = async (targetObjectId: string) => {
    const linked: string[] = [];
    for (const id of selectedRowIds) {
      try { await addElementToObject(id, targetObjectId); linked.push(id); } catch (e) { console.error('Multi-home failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
    // Undo = unlink from that Object.
    if (linked.length > 0) {
      pushUndo({
        label: `Add ${linked.length} Elements`,
        undo: async () => {
          for (const id of linked) { try { await removeElementFromObject(id, targetObjectId); } catch (e) { console.error(e); } }
          await onRefresh?.();
        },
      });
    }
  };
  // Generic bulk field edit (status / priority / due_date) with undo. Captures
  // each element's prior value so Ctrl+Z restores it exactly.
  const bulkSetField = async (
    field: 'status' | 'priority' | 'due_date',
    value: ElementWithDetails['status'] | ElementWithDetails['priority'] | string | null,
    label: string,
  ) => {
    const prev = new Map<string, unknown>();
    for (const id of selectedRowIds) prev.set(id, (allElementsForLookup.get(id) as Record<string, unknown> | undefined)?.[field] ?? null);
    for (const id of selectedRowIds) {
      try { await updateElement(id, { [field]: value }); } catch (e) { console.error('Bulk edit failed', id, e); }
    }
    clearSelection();
    await onRefresh?.();
    pushUndo({
      label,
      undo: async () => {
        for (const [id, original] of prev) { try { await updateElement(id, { [field]: original }); } catch (e) { console.error(e); } }
        await onRefresh?.();
      },
    });
  };

  // ListControls inputs — distinct values present in the dataset.
  const labelOptions = useMemo<string[]>(() => {
    const s = new Set<string>();
    for (const e of allElementsFlat) for (const l of e.labels ?? []) s.add(l);
    return Array.from(s).sort();
  }, [allElementsFlat]);
  const workerOptions = useMemo<Worker[]>(() => {
    const m = new Map<string, Worker>();
    for (const e of allElementsFlat) for (const a of e.assignees ?? []) {
      if (a.worker && !m.has(a.worker.id)) m.set(a.worker.id, a.worker);
    }
    return Array.from(m.values());
  }, [allElementsFlat]);
  const objectFilterOptions = useMemo<{ id: string; name: string }[]>(
    () => objectsWithElements.map((o) => ({ id: o.id, name: o.name })),
    [objectsWithElements],
  );

  // The filter / grouping pipeline + section assembly now live inside
  // the shared <ElementsList /> component below.

  const detailElement = detailId ? allElementsForLookup.get(detailId) ?? null : null;
  const detailObject = detailElement?.object_id
    ? explorerData?.objects.find((obj) => obj.id === detailElement.object_id) ?? null
    : null;

  if (detailElement) {
    return (
      <ElementDetailView
        element={detailElement}
        domainName={activeDomainName}
        objectPath={detailObject ? [{ id: detailObject.id, name: detailObject.name }] : []}
        onBack={() => setDetailId(null)}
        onRefresh={onRefresh}
        onNavigateRoot={() => {
          setDetailId(null);
          onViewChange?.('projects');
          onNavigate?.({ objectId: null });
        }}
        onNavigateObject={(id: string) => {
          setDetailId(null);
          onViewChange?.('projects');
          onNavigate?.({ objectId: id });
        }}
      />
    );
  }

  // Where a section's new Elements land — shared by the header +, the inline
  // add row, and the empty-state CTA. A section carries an Object id only
  // while the list is grouped by Object; group by status / priority / label
  // and the id is a bucket key instead. Those (and the synthetic Domain band)
  // create Domain-direct Elements rather than pointing object_id at a bucket
  // name, which the database would reject.
  const sectionObjectId = (section: ListSection | undefined): string | null =>
    section && explorerData?.objects.some((o) => o.id === section.id) ? section.id : null;

  // The other half of a section's identity. `section.group` is set whenever
  // the band is a bucket of the grouping field rather than an Object, and
  // adding from inside it means "give me one of these" — so both add paths
  // carry it through and the new Element stays in the band the user pointed
  // at. Object bands and un-grouped lists classify by nothing and leave it
  // unset.
  //
  // Both add paths accept multiple titles per submit (paste-many).
  const openQuickAddDomain = () => {
    setQuickAddTargetObjectId(null);
    setQuickAddGroup(undefined);
    setQuickAddLabel(activeDomainName ?? 'Domain');
    setQuickAddOpen(true);
  };
  const openQuickAddForSection = (section?: ListSection) => {
    const objectId = sectionObjectId(section);
    // Nothing to inherit and nowhere else to put it — the synthetic Domain
    // band, or a list with no grouping at all.
    if (!objectId && !section?.group) {
      openQuickAddDomain();
      return;
    }
    setQuickAddTargetObjectId(objectId);
    setQuickAddGroup(section?.group);
    setQuickAddLabel(section?.name ?? activeDomainName ?? 'Domain');
    setQuickAddOpen(true);
  };

  // The bucket's value, spread across the popup's pills. The "no value"
  // buckets ("No status", "Unassigned", …) come back empty, so the popup
  // simply opens unset — it has no way to say "explicitly none", and the
  // column default is what an unset pill has always meant here.
  const quickAddDefaults = sectionGroupValues(quickAddGroup);

  const handleQuickAddSubmit = async (inputs: NewElementInput[]) => {
    // Three save scopes the popup can produce:
    //   - personal (My Elements): owner_id = me, object_id = null
    //   - Object:                  object_id = input.objectId
    //   - Domain-direct:           object_id = null
    // Fallback for objectId-undefined: the per-section target the user opened
    // the popup from.
    // Per-Element failures stay non-fatal — one bad row in a pasted batch
    // should not discard the rest — but a batch where nothing landed has to
    // reach the caller. The popup reports what it created and clears the
    // title for the next one, and it can only tell the truth about that if a
    // total failure comes back as a rejection instead of a quiet resolve.
    let createdAny = false;
    let lastError: unknown = null;

    for (const input of inputs) {
      try {
        const created = await createElement({
          title: input.title,
          object_id: input.personal
            ? null
            : (input.objectId !== undefined ? input.objectId : quickAddTargetObjectId),
          owner_id: input.personal ? userId : null,
          description: input.description ?? null,
          type: input.type ?? null,
          labels: input.labels ?? [],
          status: input.status ?? undefined,
          priority: input.priority ?? undefined,
        });
        createdAny = true;
        for (const wid of input.assigneeWorkerIds ?? []) {
          try {
            await addElementAssignee({ element_id: created.id, worker_id: wid, role: 'assignee' });
          } catch (e) { console.warn('Could not assign Element:', e); }
        }
      } catch (e) {
        lastError = e;
        console.error('Failed to create Element', e);
      }
    }
    await onRefresh?.();
    if (!createdAny && inputs.length > 0) {
      throw lastError ?? new Error('No Elements were created');
    }
  };

  const handleElementUpdate = async (
    elementId: string,
    updates: Parameters<typeof updateElement>[1],
  ) => {
    try {
      await updateElement(elementId, updates);
      await onRefresh?.();
    } catch (e) { console.error('Failed to update element', e); }
  };

  const isEmpty = objectSections.length === 0;

  if (isEmpty) {
    // Empty state owns the pane — same 4-icon + heading + CTA pattern as the
    // Domain Objects / Object Elements empty states. Toolbar is suppressed so
    // the centered Create Element button is the only affordance.
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <ElementsHierarchyHeader
          domainName={activeDomainName ?? 'Domain'}
          onDomainClick={() => {
            onViewChange?.('projects');
            onNavigate?.({ objectId: null });
          }}
        />
        <ElementsDomainEmptyState onAdd={openQuickAddDomain} />
        <QuickAddElementPopup
          open={quickAddOpen}
          contextLabel={quickAddLabel ?? activeDomainName ?? 'Domain'}
          onClose={() => setQuickAddOpen(false)}
          onSubmit={handleQuickAddSubmit}
          types={elementTypes}
          workers={workerOptions.map((w) => ({ id: w.id, name: w.name, avatar_url: w.avatar_url }))}
          objects={objectFilterOptions}
          availableLabels={labelOptions}
          defaultObjectId={quickAddTargetObjectId}
          canSaveToPersonal
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ElementsHierarchyHeader
        domainName={activeDomainName ?? 'Domain'}
        onDomainClick={() => {
          onViewChange?.('projects');
          onNavigate?.({ objectId: null });
        }}
        onAdd={openQuickAddDomain}
      />

      {/* View-mode tabs — uses the shared shell `TabBar` so the look
          matches Object detail's Elements tab exactly. visible-set +
          active are localStorage-backed; "+" surfaces the same Object /
          Board / Gantt / Calendar / Workers picker as the Object-level
          tab bar. The right slot holds the shared Filter / Display
          controls. */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={(id) => {
          const t = tabs.find((x) => x.id === id);
          if (t) setViewMode(t.tab_type);
        }}
        onTabClose={(id) => {
          const t = tabs.find((x) => x.id === id);
          if (t) removeTab(t.tab_type);
        }}
        onTabCreate={(type) => addTab(type)}
        createOptions={VIEW_MODES.filter((t) => t !== 'elements')}
        rightSlot={
          <ListControls
            state={controls}
            onChange={setControls}
            typeOptions={elementTypes}
            labelOptions={labelOptions}
            workerOptions={workerOptions}
            objectOptions={objectFilterOptions}
            showOwnerFilter={false}
            onReset={() => setControls(DEFAULT_STATE)}
            sortColumnsStorageKey="domain-elements"
          />
        }
      />

      {effectiveViewMode === 'elements' && (
        <div className="flex-1 overflow-auto">
          <ElementsList
            elements={allElementsFlat}
            controls={controls}
            objectSections={objectSections}
            onSelectElement={(id) => setDetailId(id)}
            onSelectObject={() => { /* per-Object sections don't carry Object click here */ }}
            onRefresh={onRefresh}
            colStorageKey="domain-elements"
            elementTypes={elementTypes}
            onAddType={activeDomainId ? async (name) => {
              try { await addDomainElementType(activeDomainId, name); await refetchDomains(); await onRefresh?.(); }
              catch (e) { console.error('Failed to add type:', e); }
            } : undefined}
            onRemoveType={activeDomainId ? async (name) => {
              try { await removeDomainElementType(activeDomainId, name); await refetchDomains(); await onRefresh?.(); }
              catch (e) { console.error('Failed to remove type:', e); }
            } : undefined}
            onAddElement={openQuickAddForSection}
            selectedElementIds={selectedRowIds}
            onElementRowSelect={handleRowSelect}
          />
        </div>
      )}
      {effectiveViewMode === 'board' && (
        <div className="flex-1 overflow-hidden">
          <ElementBoardView elements={allElementsFlat} onRefresh={onRefresh} />
        </div>
      )}
      {effectiveViewMode === 'gantt' && (
        <div className="flex-1 overflow-hidden">
          <GanttView elements={allElementsFlat} sections={groupedSections} onRefresh={onRefresh} />
        </div>
      )}
      {effectiveViewMode === 'calendar' && (
        <div className="flex-1 overflow-hidden">
          <CalendarView
            elements={allElementsFlat}
            onElementClick={(el) => setDetailId(el.id)}
            onRefresh={onRefresh}
          />
        </div>
      )}
      {effectiveViewMode === 'custom_view' && (
        <div className="flex-1 h-full overflow-hidden">
          <CustomView
            key={activeDomainId ? `elements-domain:${activeDomainId}` : 'elements-domain'}
            scopeId={activeDomainId ? `elements-domain:${activeDomainId}` : 'elements-domain'}
            scopeLabel={activeDomainName ?? 'Domain'}
            elements={allElementsFlat}
          />
        </div>
      )}
      {effectiveViewMode === 'workers' && (
        <div className="flex-1 flex items-center justify-center p-12 text-center">
          <div>
            <p className="text-[13px] text-muted-foreground mb-1">
              Domain-level Workers view is coming soon.
            </p>
            <p className="text-[12px] text-muted-foreground/70">
              Open an Object to see its Workers tab.
            </p>
          </div>
        </div>
      )}

      <QuickAddElementPopup
        open={quickAddOpen}
        contextLabel={quickAddLabel ?? activeDomainName ?? 'Domain'}
        onClose={() => setQuickAddOpen(false)}
        onSubmit={handleQuickAddSubmit}
        types={elementTypes}
        workers={workerOptions.map((w) => ({ id: w.id, name: w.name, avatar_url: w.avatar_url }))}
        objects={objectFilterOptions}
        availableLabels={labelOptions}
        defaultObjectId={quickAddTargetObjectId}
        defaultType={quickAddDefaults.type}
        defaultStatus={quickAddDefaults.status}
        defaultPriority={quickAddDefaults.priority}
        defaultAssigneeWorkerIds={quickAddDefaults.assigneeWorkerIds}
        defaultLabels={quickAddDefaults.labels}
        canSaveToPersonal
      />

      <BulkActionBar
        count={selectedRowIds.size}
        pickerObjects={explorerData?.objects ?? []}
        onDelete={bulkDelete}
        onDuplicate={bulkDuplicate}
        onMove={bulkMove}
        onAddToObject={bulkAddToObject}
        onSetStatus={(s) => bulkSetField('status', s, `Set status of ${selectedRowIds.size} Elements`)}
        onSetPriority={(p) => bulkSetField('priority', p, `Set priority of ${selectedRowIds.size} Elements`)}
        onSetDueDate={(d) => bulkSetField('due_date', d, `Set due date of ${selectedRowIds.size} Elements`)}
        onClear={clearSelection}
      />
    </div>
  );
}


function ElementsHierarchyHeader({
  domainName,
  onDomainClick,
  onAdd,
}: {
  domainName: string;
  onDomainClick?: () => void;
  onAdd?: () => void;
}) {
  return (
    <div className="h-[50px] flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
      <button
        type="button"
        onClick={onDomainClick}
        className="px-1.5 py-0.5 rounded text-[12px] font-semibold text-muted-foreground truncate max-w-[220px] transition-colors hover:text-foreground hover:bg-muted/40"
      >
        {domainName}
      </button>
      <div className="flex-1" />
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          title="Add Element"
          aria-label="Add Element"
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

function ElementsDomainEmptyState({ onAdd }: { onAdd: () => void }) {
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
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Add Elements to this Domain</h2>
      <p className="text-[13px] text-muted-foreground text-left max-w-xs mb-2">
        Elements are the smallest unit you track — anything actionable or worth recording.
      </p>
      <p className="text-[12px] text-muted-foreground/60 text-left max-w-xs mb-6">
        Domain-direct Elements live at the top level. Open an Object to add Elements there.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 transition-colors"
      >
        <Plus size={14} />
        Create Element
      </button>
    </div>
  );
}
