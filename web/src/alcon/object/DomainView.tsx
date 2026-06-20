'use client';

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { TabBar } from '@/shell/TabBar';
import type { ObjectTab, ObjectTabType, Json } from '@/types/database';
import type { ExplorerData, AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { updateObject } from '@/hooks/useSupabase';
import type { NavigationState } from '@/types/navigation';
import { ObjectDetailView } from './ObjectDetailView';
import { ObjListView, findObjectInExplorerData, collectAllElements } from './ObjectsView';
import {
  ListControls,
  loadState,
  saveState,
  DEFAULT_STATE,
  type ListControlsState,
} from '@/alcon/shared/listControls';
import { HomeView } from '@/alcon/widget/home';
import { GanttView } from '@/alcon/element/gantt';
import { CalendarView } from '@/alcon/element/calendar/CalendarView';
import { ElementBoardView } from '@/alcon/element/board/ElementBoardView';
import { ResourceView } from '@/alcon/element/actions/ResourceView';
import { CustomView } from '@/alcon/element/custom';
import { ObjectIcon } from '@/shell/icons';
import { useDomains } from '@/hooks/useSupabase';

const DOMAIN_TAB_KEY = 'domain:activeTabType';
const DOMAIN_VISIBLE_TABS_KEY = 'domain:visibleTabs';
const OBJECT_VISIBLE_TABS_PREFIX = 'domain:objectVisibleTabs:';
const DEFAULT_DOMAIN_TAB: ObjectTabType = 'elements';
const DEFAULT_DOMAIN_TAB_TYPES: ObjectTabType[] = ['elements'];
const DEFAULT_OBJECT_TAB_TYPES: ObjectTabType[] = ['overview', 'elements'];
const VIEW_META: Record<ObjectTabType, { domainTitle: string; objectTitle: string }> = {
  summary: { domainTitle: 'Dashboard', objectTitle: 'Dashboard' },
  elements: { domainTitle: 'All Objects', objectTitle: 'All Elements' },
  overview: { domainTitle: 'Overview', objectTitle: 'Overview' },
  gantt: { domainTitle: 'Gantt', objectTitle: 'Gantt' },
  calendar: { domainTitle: 'Calendar', objectTitle: 'Calendar' },
  workers: { domainTitle: 'Workers', objectTitle: 'Workers' },
  resource: { domainTitle: 'Resource', objectTitle: 'Resource' },
  custom_view: { domainTitle: 'CustomView', objectTitle: 'CustomView' },
  board: { domainTitle: 'Board', objectTitle: 'Board' },
  note: { domainTitle: 'Note', objectTitle: 'Note' },
};
const ALL_TAB_TYPES: ObjectTabType[] = ['overview', 'elements', 'board', 'gantt', 'calendar', 'resource', 'workers', 'custom_view'];

function titleForTab(type: ObjectTabType, objectScoped: boolean): string {
  const meta = VIEW_META[type];
  return objectScoped ? meta.objectTitle : meta.domainTitle;
}

function loadVisibleTabs(key: string, fallback: ObjectTabType[]): ObjectTabType[] {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) as ObjectTabType[] : null;
    const valid = Array.isArray(parsed)
      ? parsed.filter((t): t is ObjectTabType => ALL_TAB_TYPES.includes(t))
      : [];
    return valid.length > 0 ? Array.from(new Set(valid)) : fallback;
  } catch {
    return fallback;
  }
}

function saveVisibleTabs(key: string, tabs: ObjectTabType[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(tabs));
}

interface DomainViewProps {
  explorerData: ExplorerData;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
  activeDomainId?: string | null;
}

/**
 * Domain-level shell for the Domain activity. Renders a single TabBar at
 * the top whose choice persists across Object navigations — Overview, List,
 * Calendar, etc. are now Domain-scoped views, with the same tab choice
 * carrying through when the user drills into a specific Object.
 */
export function DomainView({ explorerData, navigation, onNavigate, onRefresh, activeDomainId }: DomainViewProps) {
  const { data: domains } = useDomains();
  const activeDomain = useMemo(
    () => (activeDomainId ? domains.find(d => d.id === activeDomainId) ?? null : null),
    [domains, activeDomainId],
  );
  // Domain tab choice persists in localStorage. Object tab choice is per
  // Object and resets to Overview whenever the user drills into a different
  // Object — Overview is the canonical landing view for an Object.
  const [domainActiveType, setDomainActiveType] = useState<ObjectTabType>(() => {
    if (typeof window === 'undefined') return DEFAULT_DOMAIN_TAB;
    const saved = window.localStorage.getItem(DOMAIN_TAB_KEY);
    if (saved && ALL_TAB_TYPES.includes(saved as ObjectTabType)) {
      return saved as ObjectTabType;
    }
    return DEFAULT_DOMAIN_TAB;
  });
  const [objectActiveType, setObjectActiveType] = useState<ObjectTabType>('overview');
  const [domainVisibleTypes, setDomainVisibleTypes] = useState<ObjectTabType[]>(() =>
    loadVisibleTabs(DOMAIN_VISIBLE_TABS_KEY, DEFAULT_DOMAIN_TAB_TYPES)
  );
  const [objectVisibleTypesById, setObjectVisibleTypesById] = useState<Record<string, ObjectTabType[]>>({});

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DOMAIN_TAB_KEY, domainActiveType);
    }
  }, [domainActiveType]);

  useEffect(() => {
    setObjectActiveType('overview');
  }, [navigation.objectId]);

  const selectedObject = navigation.objectId
    ? findObjectInExplorerData(explorerData, navigation.objectId)
    : null;

  const activeType = selectedObject ? objectActiveType : domainActiveType;
  const setActiveTypeOnly = (t: ObjectTabType) => {
    if (selectedObject) setObjectActiveType(t);
    else setDomainActiveType(t);
  };

  const rawVisibleTabTypes = selectedObject
    ? objectVisibleTypesById[selectedObject.id] ?? DEFAULT_OBJECT_TAB_TYPES
    : domainVisibleTypes;
  const sanitizedVisibleTabTypes = rawVisibleTabTypes.filter((type) => ALL_TAB_TYPES.includes(type));
  const visibleTabTypes = sanitizedVisibleTabTypes.length > 0
    ? sanitizedVisibleTabTypes
    : (selectedObject ? DEFAULT_OBJECT_TAB_TYPES : DEFAULT_DOMAIN_TAB_TYPES);

  useEffect(() => {
    if (!selectedObject || objectVisibleTypesById[selectedObject.id]) return;
    const key = `${OBJECT_VISIBLE_TABS_PREFIX}${selectedObject.id}`;
    setObjectVisibleTypesById((prev) => ({
      ...prev,
      [selectedObject.id]: loadVisibleTabs(key, DEFAULT_OBJECT_TAB_TYPES),
    }));
  }, [selectedObject, objectVisibleTypesById]);

  const setVisibleTabTypes = (updater: (prev: ObjectTabType[]) => ObjectTabType[]) => {
    if (selectedObject) {
      const key = `${OBJECT_VISIBLE_TABS_PREFIX}${selectedObject.id}`;
      setObjectVisibleTypesById((prev) => {
        const nextTypes = updater(prev[selectedObject.id] ?? DEFAULT_OBJECT_TAB_TYPES);
        saveVisibleTabs(key, nextTypes);
        return { ...prev, [selectedObject.id]: nextTypes };
      });
      return;
    }
    setDomainVisibleTypes((prev) => {
      const nextTypes = updater(prev);
      saveVisibleTabs(DOMAIN_VISIBLE_TABS_KEY, nextTypes);
      return nextTypes;
    });
  };

  const ensureVisibleTab = (type: ObjectTabType) => {
    setVisibleTabTypes((prev) => (prev.includes(type) ? prev : [...prev, type]));
    setActiveTypeOnly(type);
  };

  const removeVisibleTab = (type: ObjectTabType) => {
    setVisibleTabTypes((prev) => {
      const next = prev.filter((t) => t !== type);
      const safe = next.length > 0 ? next : ['elements' as ObjectTabType];
      if (activeType === type) setActiveTypeOnly(safe[0]);
      return safe;
    });
  };

  // True when ObjectDetailView has an Element detail panel open. We hide the
  // Domain-level breadcrumb + TabBar in that mode so the Element detail owns
  // the whole pane (its own back-arrow breadcrumb is enough). The key={...}
  // on ObjectDetailView below ensures the inner detail state resets when
  // the user navigates between Objects, so this flag tracks correctly.
  const [elementDetailOpen, setElementDetailOpen] = useState(false);

  const tabs: ObjectTab[] = useMemo(
    () =>
      visibleTabTypes.map((type, i) => ({
        id: `${selectedObject ? 'obj' : 'domain'}-${type}`,
        object_id: selectedObject ? selectedObject.id : 'domain',
        tab_type: type,
        title: titleForTab(type, !!selectedObject),
        content: null as unknown as Json,
        note_id: null,
        order_index: i,
        is_pinned: false,
        created_at: null,
        updated_at: null,
      })),
    [visibleTabTypes, selectedObject],
  );

  const effectiveActiveType: ObjectTabType = useMemo(() => {
    if (visibleTabTypes.includes(activeType)) return activeType;
    return visibleTabTypes[0] ?? 'elements';
  }, [visibleTabTypes, activeType]);

  const activeTabId = tabs.find(t => t.tab_type === effectiveActiveType)?.id ?? tabs[0].id;

  // Stale objectId guard — clear if the Object no longer exists in the active Domain
  useEffect(() => {
    if (navigation.objectId && !selectedObject) {
      onNavigate({ objectId: null });
    }
  }, [navigation.objectId, selectedObject, onNavigate]);

  const allDomainElements = useMemo(
    () => [...collectAllElements(explorerData.objects), ...(explorerData.rootElements ?? [])],
    [explorerData],
  );

  // time. `objListControls` filters the Object table at the Domain root;
  // `objectElementsControls` filters Elements inside a selected Object
  // so the Filter / Display buttons also surface in the Object-detail
  // Elements tab, matching the sidebar Elements view.
  const [objListControls, setObjListControls] = useState<ListControlsState>(() => loadState('domain-objects'));
  useEffect(() => { saveState('domain-objects', objListControls); }, [objListControls]);
  const [objectElementsControls, setObjectElementsControls] = useState<ListControlsState>(() => loadState('object-elements'));
  useEffect(() => { saveState('object-elements', objectElementsControls); }, [objectElementsControls]);

  const objListControlsNode = effectiveActiveType === 'elements'
    ? selectedObject
      ? (
          <ListControls
            state={objectElementsControls}
            onChange={setObjectElementsControls}
            typeOptions={activeDomain?.element_types ?? []}
            showOwnerFilter={false}
            onReset={() => setObjectElementsControls(DEFAULT_STATE)}
            // Same storageKey ObjectDetailView passes down to ListTable
            // — keeps the toolbar Sort menu in sync with the column arrow.
            sortColumnsStorageKey={`object:${selectedObject.id}`}
            // Inside one Object, grouping by Object is redundant.
            hideObjectGrouping
          />
        )
      : (
          <ListControls
            state={objListControls}
            onChange={setObjListControls}
            typeOptions={activeDomain?.element_types ?? []}
            showOwnerFilter={false}
            onReset={() => setObjListControls(DEFAULT_STATE)}
            sortColumnsStorageKey="domain"
          />
        )
    : null;

  // Empty-state suppression. Two distinct cases, both centred-empty-state:
  //  - Domain has no Objects → hide TabBar + action bar (the Domain root has
  //    nothing to navigate to anyway).
  //  - Object has no Elements on the Elements tab → hide ObjectDetailView's
  //    action bar so the create CTA owns that area, but KEEP the TabBar
  //    visible so the user can still flip back to Overview.
  const isEmptyDomain = !selectedObject && explorerData.objects.length === 0;
  const isEmptyObjectElements =
    !!selectedObject && effectiveActiveType === 'elements' && (selectedObject.elements ?? []).length === 0;
  const hideTabBarChrome = isEmptyDomain;
  const headerActions = selectedObject ? (
    <div className="ml-auto flex items-center gap-2">
      {!isEmptyObjectElements && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('alcon:quick-add-element'))}
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          title="Add Element"
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  ) : !isEmptyDomain ? (
    <div className="ml-auto flex items-center gap-2">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('alcon:create-object'))}
        className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        title="Add Object"
      >
        <Plus size={14} />
      </button>
    </div>
  ) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* Persistent data hierarchy header: Domain > Object.
          View names such as All / Overview / Gantt are tabs, not hierarchy. */}
      {!elementDetailOpen && (
        <HierarchyHeader
          domainName={activeDomain?.name ?? 'Objects'}
          objectName={selectedObject?.name ?? null}
          onDomainClick={() => onNavigate({ objectId: null })}
          actions={headerActions}
        />
      )}

      {!elementDetailOpen && !hideTabBarChrome && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSelect={(id) => {
            const t = tabs.find(x => x.id === id);
            if (t) setActiveTypeOnly(t.tab_type);
          }}
          onTabClose={(id) => {
            const t = tabs.find(x => x.id === id);
            if (t && t.tab_type !== 'elements') removeVisibleTab(t.tab_type);
          }}
          onTabCreate={(type) => ensureVisibleTab(type)}
          rightSlot={objListControlsNode}
        />
      )}

      {selectedObject ? (
        <ObjectDetailView
          key={selectedObject.id}
          object={selectedObject}
          onNavigate={onNavigate}
          onRefresh={onRefresh}
          explorerData={explorerData}
          tabTypeOverride={effectiveActiveType}
          domainName={activeDomain?.name ?? null}
          hideTabBar
          hideActionBar={isEmptyObjectElements}
          onElementDetailChange={setElementDetailOpen}
          onViewTypeChange={ensureVisibleTab}
          elementsControls={objectElementsControls}
        />
      ) : (
        <>
          <DomainTabContent
            activeType={effectiveActiveType}
            explorerData={explorerData}
            allElements={allDomainElements}
            onSelectObject={(id) => onNavigate({ objectId: id })}
            onRefresh={onRefresh}
            objListControls={objListControls}
            domainId={activeDomain?.id ?? null}
          />
        </>
      )}

    </div>
  );
}

function HierarchyHeader({
  domainName,
  objectName,
  onDomainClick,
  actions,
}: {
  domainName: string;
  objectName?: string | null;
  onDomainClick: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="h-[50px] flex items-center gap-1 pl-4 pr-1 border-b border-border/60 bg-card flex-shrink-0">
      <button
        type="button"
        onClick={onDomainClick}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[12px] font-semibold truncate max-w-[220px] transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/40"
      >
        <span className="truncate">{domainName}</span>
      </button>
      {objectName && (
        <>
          <ChevronRight size={12} className="text-muted-foreground/50 flex-shrink-0" />
          <span className="flex items-center gap-1 px-1.5 py-0.5 text-[12px] font-semibold truncate max-w-[220px] text-foreground">
            <ObjectIcon size={12} />
            <span className="truncate">{objectName}</span>
          </span>
        </>
      )}
      {actions}
    </div>
  );
}

interface DomainTabContentProps {
  activeType: ObjectTabType;
  explorerData: ExplorerData;
  allElements: ReturnType<typeof collectAllElements>;
  onSelectObject: (id: string) => void;
  onRefresh?: () => void;
  /** ListControls state owned by DomainView; the Filter / Display buttons
   *  themselves live in the TabBar's rightSlot. */
  objListControls?: ListControlsState;
  /** Active Domain id — required for the Workload tab to scope correctly. */
  domainId?: string | null;
}

function DomainTabContent({ activeType, explorerData, allElements, onSelectObject, onRefresh, objListControls, domainId }: DomainTabContentProps) {
  if (activeType === 'elements') {
    // List = Linear-style Domain table (top-level Objects). Drilling into
    // an Object swaps in per-Object content via ObjectDetailView above.
    return (
      <div className="flex-1 overflow-hidden">
        <ObjListView
          explorerData={explorerData}
          onSelect={onSelectObject}
          onRefresh={onRefresh}
          controls={objListControls}
        />
      </div>
    );
  }

  if (activeType === 'overview') {
    // Overview = Domain dashboard (KPI / Milestones / Members / Activity
    // widgets). Distinct from List, distinct from Dashboard (which surfaces
    // the same widgets but lives behind a separate tab for now).
    return (
      <div className="flex-1 overflow-auto">
        <HomeView explorerData={explorerData} />
      </div>
    );
  }

  if (activeType === 'gantt') {
    // The Objects tab's Gantt shows ONE BAR PER OBJECT (not its descendant
    // Elements grouped under "ELEMENTS" — that's the Elements tab's job).
    // Adapt each Object into the Element-shaped row the Gantt expects, with
    // object_id = null so they render as a flat list (no sub-grouping), and
    // route persistence through updateObject.
    const objectsAsBars: ElementWithDetails[] = explorerData.objects.map((o) => objectToGanttBar(o));
    return (
      <div className="flex-1 overflow-hidden">
        <GanttView
          elements={objectsAsBars}
          leftHeaderLabel="Objects"
          onItemUpdate={(id, u) => updateObject(id, { start_date: u.start_date, due_date: u.due_date })}
          onRefresh={onRefresh}
        />
      </div>
    );
  }

  if (activeType === 'calendar') {
    return (
      <div className="flex-1 overflow-hidden">
        <CalendarView elements={allElements} onRefresh={onRefresh} />
      </div>
    );
  }

  if (activeType === 'board') {
    return (
      <div className="flex-1 overflow-hidden">
        <ElementBoardView elements={allElements} onRefresh={onRefresh} />
      </div>
    );
  }

  if (activeType === 'summary') {
    return (
      <div className="flex-1 overflow-auto">
        <HomeView explorerData={explorerData} />
      </div>
    );
  }

  if (activeType === 'resource') {
    return (
      <div className="flex-1 overflow-hidden">
        <ResourceView
          scopeOverride={{ domainIds: domainId ? [domainId] : [] }}
          hideHeader
        />
      </div>
    );
  }

  if (activeType === 'custom_view') {
    return (
      <div className="flex-1 overflow-hidden">
        <CustomView
          key={domainId ? `domain:${domainId}` : 'domain'}
          scopeId={domainId ? `domain:${domainId}` : 'domain'}
          scopeLabel="Domain"
          elements={allElements}
        />
      </div>
    );
  }

  // Workers — placeholder for now; per-Object Workers tab still works
  return (
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
  );
}

// Adapter: turn an Object into the Element-shaped row GanttView expects.
// `object_id: null` makes the Gantt skip its parent-Object grouping so the
// Objects render as a flat list (matching "one bar per Object"). Status is
// pinned to 'todo' for a neutral bar colour — Objects don't carry a status of
// their own, and showing them all the same colour is the honest read.
function objectToGanttBar(o: AlconObjectWithChildren): ElementWithDetails {
  return {
    id: o.id,
    object_id: null,
    title: o.name,
    description: o.description,
    type: o.type ?? null,
    labels: [],
    owner_id: null,
    display_id: o.display_id ?? null,
    seq_number: null,
    status: 'todo',
    priority: null,
    start_date: o.start_date,
    start_time: null,
    due_date: o.due_date,
    due_time: null,
    color: o.color ?? null,
    estimated_hours: null,
    actual_hours: null,
    progress: null,
    order_index: o.order_index ?? null,
    is_approval: null,
    approval_state: null,
    note_id: null,
    created_at: o.created_at ?? null,
    updated_at: o.updated_at ?? null,
  };
}
