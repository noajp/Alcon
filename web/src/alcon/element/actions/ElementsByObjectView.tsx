'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { ExplorerData, AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement, createElement, useDomains } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
import { NavDomainIcon, NavMyTasksIcon } from '@/shell/sidebar/NavIcons';
import { ElementDetailView } from '@/alcon/element/ElementDetailView';
import { ElementBoardView } from '@/alcon/element/board/ElementBoardView';
import { GanttView } from '@/alcon/element/gantt';
import { CalendarView } from '@/alcon/element/calendar/CalendarView';
import { QuickAddElementPopup } from '@/alcon/element/QuickAddElementPopup';
import { ObjectListView, type ListSection } from '@/alcon/object/ObjectListView';
import { TabBar } from '@/shell/TabBar';
import type { NavigationState } from '@/types/navigation';
import type { Worker, ObjectTab, ObjectTabType, Json } from '@/types/database';
import {
  ListControls,
  applyFilter,
  effectiveGroupBy,
  groupAndOrder,
  loadState,
  saveState,
  DEFAULT_STATE,
  type ListControlsState,
} from '@/alcon/shared/listControls';

// View modes for the Domain-wide Elements view. We reuse the same
// `ObjectTabType` union as Object detail tabs so this view can share
// the shell `TabBar` and look identical to the Object-level Elements
// tab. The 'elements' mode renders the flat "All Elements" list; the
// rest pivot the same data into Board / Gantt / Calendar / Workers.
const VIEW_MODES: ObjectTabType[] = ['elements', 'board', 'gantt', 'calendar', 'workers'];
const VIEW_MODE_TITLES: Partial<Record<ObjectTabType, string>> = {
  elements: 'All Elements',
  board: 'Board',
  gantt: 'Gantt',
  calendar: 'Calendar',
  workers: 'Workers',
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

interface ElementsByObjectViewProps {
  explorerData?: ExplorerData;
  onRefresh?: () => void;
  activeDomainId?: string | null;
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

/**
 * Domain-wide Elements view. Renders every Object's Elements as
 * collapsible sections via the shared `ObjectListView` so the row
 * markup, hover styles, and column toggles stay in lockstep with the
 * Domain Object list and Object-detail Elements tab.
 *
 * The page only owns the toolbar, the empty-state, the Element-detail
 * drill-in, and the Domain-direct quick-add popup.
 */
export function ElementsByObjectView({ explorerData, onRefresh, activeDomainId, onNavigate, onViewChange }: ElementsByObjectViewProps) {
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
  const { data: domains } = useDomains();
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
        icon: <NavDomainIcon size={16} />,
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

  // Sections fed to the list.
  // - Default (groupBy='none', no narrowing filter): per-Object partition
  //   preserved, filter applied per section.
  // - groupBy='none' but filter focuses on a single facet (e.g. Status=Todo):
  //   auto-switch the band to that facet so it reads as "Todo (4)" rather
  //   than the parent partition.
  // - Any explicit groupBy: flatten and regroup by it.
  const effGroupBy = effectiveGroupBy(controls.filter, controls.display.groupBy);
  const filteredSections = useMemo<ListSection[]>(() => {
    if (effGroupBy === 'none') {
      const out: ListSection[] = [];
      for (const sec of objectSections) {
        const els = applyFilter(sec.elements ?? [], controls.filter);
        if (els.length === 0) continue;
        out.push({ ...sec, elements: els });
      }
      return out;
    }
    const filtered = applyFilter(allElementsFlat, controls.filter);
    return groupAndOrder(filtered, { ...controls.display, groupBy: effGroupBy });
  }, [controls, effGroupBy, objectSections, allElementsFlat]);
  const hideSectionHeaders = effGroupBy === 'none' && filteredSections.length <= 1;

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
        onNavigateObject={(id) => {
          setDetailId(null);
          onViewChange?.('projects');
          onNavigate?.({ objectId: id });
        }}
      />
    );
  }

  // Each section header has its own + button now. The Domain section's +
  // (and the header's + / empty-state CTA) creates Domain-direct Elements;
  // an Object section's + creates Elements under that Object. The popup
  // accepts multiple titles per submit (paste-many) regardless of target.
  const openQuickAddDomain = () => {
    setQuickAddTargetObjectId(null);
    setQuickAddLabel(activeDomainName ?? 'Domain');
    setQuickAddOpen(true);
  };
  const openQuickAddForSection = (section?: ListSection) => {
    if (!section || section.id === '__domain__') {
      openQuickAddDomain();
      return;
    }
    setQuickAddTargetObjectId(section.id);
    setQuickAddLabel(section.name);
    setQuickAddOpen(true);
  };

  const handleQuickAddSubmit = async (titles: string[]) => {
    const targetObjectId = quickAddTargetObjectId;
    for (const title of titles) {
      try {
        await createElement({ title, object_id: targetObjectId });
      } catch (e) { console.error('Failed to create Element', e); }
    }
    await onRefresh?.();
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
          />
        }
      />

      {effectiveViewMode === 'elements' && (
        <div className="flex-1 overflow-auto">
          <ObjectListView
            sections={filteredSections}
            onSelectObject={() => { /* sections never carry Objects here */ }}
            onSelectElement={(id) => setDetailId(id)}
            onElementUpdate={handleElementUpdate}
            colStorageKey="domain-elements"
            elementTypes={elementTypes}
            hideSectionHeaders={hideSectionHeaders}
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
          <GanttView elements={allElementsFlat} onRefresh={onRefresh} />
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
    <div className="h-10 flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
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
      <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-2">
        Elements are the smallest unit you track — anything actionable or worth recording.
      </p>
      <p className="text-[12px] text-muted-foreground/60 text-center max-w-xs mb-6">
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
