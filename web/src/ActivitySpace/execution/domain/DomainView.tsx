'use client';

import { Button } from '@/ui/button';

import { useExplorerData } from '@/Function/shared/ExplorerDataContext';

import { useQuery } from '@tanstack/react-query';
import { fetchCustomColumnsWithValues } from '@/hooks/useSupabase';

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { Plus } from '@/ui/icons';
import { TabBar } from '@/Frame/TabBar';
import type { ObjectTab, ObjectTabType, Json } from '@/types/database';
import type { AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { updateObject, usePhases, useObjectMilestones } from '@/hooks/useSupabase';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useWorkspaceActions } from '@/Frame/WorkspaceActionsContext';
import type { NavigationState } from '@/types/navigation';
import { ObjectDetailView } from '@/ActivitySpace/execution/object/ObjectDetailView';
import { ObjectActionsMenu } from '@/ActivitySpace/execution/object/ObjectActionsMenu';
import { ArchivedObjectBanner } from '@/ActivitySpace/execution/object/ArchivedObjects';
import { isArchivedObject } from '@/Function/shared/objectArchive';
import { useObjectById } from '@/hooks/useObjectArchive';
import { ObjListView, findObjectInExplorerData, collectAllElements } from '@/ActivitySpace/execution/object/ObjectsView';
import {
  ListControls,
  loadState,
  saveState,
  DEFAULT_STATE,
  type ListControlsState,
} from '@/Function/shared/listControls';
import { DomainOverview } from './DomainOverview';
import { HomeView } from '@/ActivitySpace/home/HomeView';
import { WidgetActionSlotProvider, WidgetActionSlotTarget } from '@/Function/widget';
import { ObjectBoard, type BoardObject } from '@/ActivitySpace/execution/chain/ObjectBoard';
import { BoardOrientationToggle, useBoardOrientation } from '@/Function/shared/boardOrientation';
import { ElementDrilldown } from '@/ActivitySpace/execution/element/ElementDrilldown';
import { ObjectIcon } from '@/Frame/icons';
import { IslandHeader } from '@/Function/shared/MainIsland';
import { FollowButton } from '@/Function/shared/FollowButton';
import { useDomains } from '@/hooks/useSupabase';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { useCurrentUserId } from '@/providers/authContext';
import { useDomainRole } from '@/hooks/domainData';
import { useMyObjectMemberships } from '@/hooks/useMyMemberships';
import { isViewOnly } from '@/ActivitySpace/execution/object/objectAccess';
import { ViewOnlyBadge } from '@/Function/shared/ViewOnlyBadge';
import dynamic from 'next/dynamic';

// The Gantt / Calendar / Resource / Custom tabs are split out of this view's
// chunk and fetched only when one of those tabs is opened.
function TabLoading() {
  const { t } = useI18n();
  return <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">{t('Loading…')}</div>;
}
const GanttView = dynamic(() => import('@/ActivitySpace/execution/element/gantt').then((m) => m.GanttView), { ssr: false, loading: () => <TabLoading /> });
const CalendarView = dynamic(() => import('@/ActivitySpace/calendar/CalendarView').then((m) => m.CalendarView), { ssr: false, loading: () => <TabLoading /> });
const ResourceView = dynamic(() => import('@/ActivitySpace/people/workload/ResourceView').then((m) => m.ResourceView), { ssr: false, loading: () => <TabLoading /> });
const CustomView = dynamic(() => import('@/ActivitySpace/execution/element/custom').then((m) => m.CustomView), { ssr: false, loading: () => <TabLoading /> });


// Per-Domain — each Domain remembers its own active tab + visible tabs (keyed
// by Domain id). Previously these were single global keys, which made every
// Domain share one view choice (switch one to Timeline → all show Timeline).
const DOMAIN_TAB_PREFIX = 'domain:activeTabType:';
const DOMAIN_VISIBLE_TABS_PREFIX = 'domain:visibleTabs:';
const OBJECT_TAB_PREFIX = 'domain:objectActiveTabType:';
const OBJECT_VISIBLE_TABS_PREFIX = 'domain:objectVisibleTabs:';
const DEFAULT_DOMAIN_TAB: ObjectTabType = 'overview';
// A Domain always has its Overview, its Flow and its People; other views are added.
const DEFAULT_DOMAIN_TAB_TYPES: ObjectTabType[] = ['overview', 'elements', 'flow', 'gantt', 'workers'];
const DEFAULT_OBJECT_TAB_TYPES: ObjectTabType[] = ['overview', 'elements', 'flow'];
const VIEW_META: Record<ObjectTabType, { domainTitle: string; objectTitle: string }> = {
  summary: { domainTitle: 'Dashboard', objectTitle: 'Dashboard' },
  elements: { domainTitle: 'Objects', objectTitle: 'Elements' },
  overview: { domainTitle: 'Overview', objectTitle: 'Overview' },
  gantt: { domainTitle: 'Gantt', objectTitle: 'Gantt' },
  calendar: { domainTitle: 'Calendar', objectTitle: 'Calendar' },
  // Resource and Workers are one view: People.
  workers: { domainTitle: 'People', objectTitle: 'People' },
  resource: { domainTitle: 'People', objectTitle: 'People' },
  custom_view: { domainTitle: 'Custom view', objectTitle: 'Custom view' },
  note: { domainTitle: 'Note', objectTitle: 'Note' },
  flow: { domainTitle: 'Board', objectTitle: 'Board' },
};
const ALL_TAB_TYPES: ObjectTabType[] = ['overview', 'elements', 'flow', 'gantt', 'calendar', 'resource', 'workers', 'custom_view'];
const OBJECT_CREATE_TAB_TYPES: ObjectTabType[] = ALL_TAB_TYPES;
// Object tabs that show its Elements through the Elements tab's Filter / Display.
const OBJECT_FILTERED_TABS: ObjectTabType[] = ['elements', 'gantt', 'calendar'];

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

/** An Object's tabs saved before Objects had a Board gain it once, after
 *  Elements; closed after that, it stays closed. */
const OBJECT_BOARD_ADDED_PREFIX = 'domain:objectBoardAdded:';
function withObjectBoardOnce(objectId: string, types: ObjectTabType[]): ObjectTabType[] {
  if (typeof window === 'undefined') return types;
  try {
    const flag = `${OBJECT_BOARD_ADDED_PREFIX}${objectId}`;
    if (window.localStorage.getItem(flag)) return types;
    window.localStorage.setItem(flag, '1');
    if (types.includes('flow')) return types;
    const at = types.indexOf('elements');
    const next = at < 0 ? [...types, 'flow' as ObjectTabType] : [...types.slice(0, at + 1), 'flow' as ObjectTabType, ...types.slice(at + 1)];
    saveVisibleTabs(`${OBJECT_VISIBLE_TABS_PREFIX}${objectId}`, next);
    return next;
  } catch {
    return types;
  }
}

/** The Domain's own tabs lead — Overview, the Objects list, Board, Gantt,
 *  People — whatever else was added. */
function withDomainTabs(types: ObjectTabType[]): ObjectTabType[] {
  // Resource is People now.
  return [...DEFAULT_DOMAIN_TAB_TYPES, ...types.filter((t) => !DEFAULT_DOMAIN_TAB_TYPES.includes(t) && t !== 'resource')];
}

function saveVisibleTabs(key: string, tabs: ObjectTabType[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(tabs));
}

interface DomainViewProps {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
  activeDomainId?: string | null;
  /** Switch the active top-level activity — e.g. the Object Overview's
   *  "Strategy" property row jumps out to the Strategy surface. */
  onViewChange?: (view: string) => void;
}

/**
 * Domain-level shell for the Domain activity. Renders a single TabBar at
 * the top whose choice persists across Object navigations — Overview, List,
 * Calendar, etc. are now Domain-scoped views, with the same tab choice
 * carrying through when the user drills into a specific Object.
 */
export function DomainView({ navigation, onNavigate, onRefresh, activeDomainId, onViewChange }: DomainViewProps) {
  const explorerData = useExplorerData();
  const { t } = useI18n();
  const { openCreate } = useWorkspaceActions();
  const userId = useCurrentUserId();
  const domainRole = useDomainRole(activeDomainId ?? null);
  const { data: myObjectMemberships } = useMyObjectMemberships(userId);
  const { guestDomains } = useDomains();
  const { data: domains } = useSustainmentDomains();
  const activeDomain = useMemo(
    () => (activeDomainId ? [...domains, ...guestDomains].find(d => d.id === activeDomainId) ?? null : null),
    [domains, guestDomains, activeDomainId],
  );
  // Domain tab choice persists in localStorage; Object tab choice is per
  // Object and remembered the same way — a return to an Object lands on
  // the tab last used there (Overview is only a first visit's default).
  const domainKey = activeDomainId ?? 'none';
  const [domainActiveType, setDomainActiveType] = useState<ObjectTabType>(() => {
    if (typeof window === 'undefined') return DEFAULT_DOMAIN_TAB;
    const saved = window.localStorage.getItem(`${DOMAIN_TAB_PREFIX}${activeDomainId ?? 'none'}`);
    return saved && ALL_TAB_TYPES.includes(saved as ObjectTabType) ? (saved as ObjectTabType) : DEFAULT_DOMAIN_TAB;
  });
  const [objectActiveType, setObjectActiveType] = useState<ObjectTabType>('overview');
  const [domainVisibleTypes, setDomainVisibleTypes] = useState<ObjectTabType[]>(() =>
    withDomainTabs(loadVisibleTabs(`${DOMAIN_VISIBLE_TABS_PREFIX}${activeDomainId ?? 'none'}`, DEFAULT_DOMAIN_TAB_TYPES))
  );
  const [objectVisibleTypesById, setObjectVisibleTypesById] = useState<Record<string, ObjectTabType[]>>({});

  // Reload this Domain's tab state when the active Domain changes — each Domain
  // keeps its own active tab + visible tabs (no shared global view choice).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(`${DOMAIN_TAB_PREFIX}${domainKey}`);
    setDomainActiveType(saved && ALL_TAB_TYPES.includes(saved as ObjectTabType) ? (saved as ObjectTabType) : DEFAULT_DOMAIN_TAB);
    setDomainVisibleTypes(withDomainTabs(loadVisibleTabs(`${DOMAIN_VISIBLE_TABS_PREFIX}${domainKey}`, DEFAULT_DOMAIN_TAB_TYPES)));
  }, [domainKey]);

  // An entry point that promised a landing (the sidebar's Domain / Objects
  // rows) rides in on the navigation as landOnTab. Apply it to this Domain
  // once — it becomes the remembered tab, like a tab click — then clear
  // the request so later mounts show the remembered tab, not the promise.
  // Applied during render (the shell's own adjust-during-render pattern);
  // the effect below only clears the request through the parent.
  const landOnTab = navigation.landOnTab ?? null;
  const [landedTab, setLandedTab] = useState<ObjectTabType | null>(null);
  if (!landOnTab && landedTab) setLandedTab(null);
  if (landOnTab && !landedTab) {
    setLandedTab(landOnTab);
    setDomainActiveType(landOnTab);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`${DOMAIN_TAB_PREFIX}${domainKey}`, landOnTab);
    }
  }
  useEffect(() => {
    if (landOnTab) onNavigate({ landOnTab: null });
  }, [landOnTab, onNavigate]);

  useEffect(() => {
    if (!navigation.objectId || typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(`${OBJECT_TAB_PREFIX}${navigation.objectId}`);
    setObjectActiveType(saved && ALL_TAB_TYPES.includes(saved as ObjectTabType) ? (saved as ObjectTabType) : 'overview');
  }, [navigation.objectId]);

  const listedObject = navigation.objectId
    ? findObjectInExplorerData(explorerData, navigation.objectId)
    : null;
  // Lists leave archived Objects out; an Object opened by id (a link, search,
  // the Archived list) is read on its own.
  const byId = useObjectById(navigation.objectId && !listedObject ? navigation.objectId : null);
  const selectedObject = listedObject ?? byId.object;

  const fieldQuery = useQuery({
    queryKey: ['custom-columns', 'object', selectedObject?.id ?? ''],
    queryFn: () => fetchCustomColumnsWithValues(selectedObject!.id),
    enabled: !!selectedObject,
  });
  const objectFields = fieldQuery.data?.filter((field) => field.object_id === selectedObject?.id);

  const activeType = selectedObject ? objectActiveType : domainActiveType;
  const setActiveTypeOnly = (t: ObjectTabType) => {
    if (selectedObject) {
      setObjectActiveType(t);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`${OBJECT_TAB_PREFIX}${selectedObject.id}`, t);
      }
      return;
    }
    setDomainActiveType(t);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`${DOMAIN_TAB_PREFIX}${domainKey}`, t);
    }
  };

  const rawVisibleTabTypes = selectedObject
    ? (objectVisibleTypesById[selectedObject.id] ?? DEFAULT_OBJECT_TAB_TYPES).map((t) => (t === 'resource' ? 'workers' : t))
      .filter((t, i, all) => all.indexOf(t) === i)
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
      [selectedObject.id]: withObjectBoardOnce(selectedObject.id, loadVisibleTabs(key, DEFAULT_OBJECT_TAB_TYPES)),
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
      saveVisibleTabs(`${DOMAIN_VISIBLE_TABS_PREFIX}${domainKey}`, nextTypes);
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

  // Stale objectId guard — clear once neither the list nor a read by id finds the Object
  useEffect(() => {
    if (navigation.objectId && !selectedObject && byId.settled) {
      onNavigate({ objectId: null });
    }
  }, [navigation.objectId, selectedObject, byId.settled, onNavigate]);

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

  // Inside an Object, Calendar / Gantt narrow by the same Element
  // controls as the Elements tab, so the buttons follow them there.
  const showsElementControls = selectedObject
    ? OBJECT_FILTERED_TABS.includes(effectiveActiveType)
    : effectiveActiveType === 'elements';
  const objListControlsNode = showsElementControls
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
            sortColumnsCustom={objectFields}
            // Inside one Object, grouping by Object is redundant.
            hideObjectGrouping
            showClosedWindow
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
  // A Domain viewer reads; the add controls would only be refused.
  const viewOnly = isViewOnly(domainRole.data, myObjectMemberships, selectedObject?.id);
  const isEmptyObjectElements =
    !!selectedObject && effectiveActiveType === 'elements' && (selectedObject.elements ?? []).length === 0;
  const hideTabBarChrome = isEmptyDomain;
  const headerActions = viewOnly ? (
    <div className="ml-auto flex items-center gap-2 pr-2"><ViewOnlyBadge /></div>
  ) : selectedObject ? (
    <div className="ml-auto flex items-center gap-2">
      {!isEmptyObjectElements && (
        <Button variant="ghost" size="sm" type="button" className="text-muted-foreground"
          onClick={() => window.dispatchEvent(new CustomEvent('alcon:quick-add-element'))}>
          <Plus size={14} />{t('Add Element')}
        </Button>
      )}
    </div>
  ) : !isEmptyDomain ? (
    <div className="ml-auto flex items-center gap-2">
      <Button variant="ghost" size="sm" type="button" className="text-muted-foreground" onClick={() => openCreate('object')}>
        <Plus size={14} />{t('Add Object')}
      </Button>
    </div>
  ) : null;

  return (
    // This shell owns the TabBar when an Object is open (ObjectDetailView is
    // given `hideTabBar`), so the widget + belongs to this tab bar's right end.
    <WidgetActionSlotProvider>
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* Persistent data hierarchy header: Domain > Object.
          View names such as All / Overview / Gantt are tabs, not hierarchy. */}
      {!elementDetailOpen && (
        <HierarchyHeader
          domainName={activeDomain?.name ?? 'Objects'}
          objectName={selectedObject?.name ?? null}
          // One step back: from an Object to the Domain's Objects; from the
          // list, on to the Domain's own page.
          onDomainClick={() => { onNavigate({ objectId: null }); if (!selectedObject) onViewChange?.('domain-overview'); }}
          objectSlot={selectedObject ? (<>
            <ObjectActionsMenu
              object={selectedObject}
              onRefresh={onRefresh}
              onDeleted={() => onNavigate({ objectId: null })}
            />
            <FollowButton kind="object" id={selectedObject.id} />
          </>) : undefined}
          actions={headerActions}
        />
      )}

      {!elementDetailOpen && !hideTabBarChrome && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabReorder={ids => setVisibleTabTypes(() => ids.map(id => tabs.find(t => t.id === id)!.tab_type))}
          onTabSelect={(id) => {
            const t = tabs.find(x => x.id === id);
            if (t) setActiveTypeOnly(t.tab_type);
          }}
          onTabClose={(id) => {
            const t = tabs.find(x => x.id === id);
            if (!t || t.tab_type === 'elements') return;
            // The Domain's Overview stays; an Object's can be closed.
            if (!selectedObject && t.tab_type === 'overview') return;
            removeVisibleTab(t.tab_type);
          }}
          onTabCreate={(type) => ensureVisibleTab(type)}
          createOptions={selectedObject ? OBJECT_CREATE_TAB_TYPES : undefined}
          createTitle={(type) => titleForTab(type, !!selectedObject)}
          rightSlot={
            <>
              {objListControlsNode}
              {/* The widget + for whichever surface is in the tab below. */}
              <WidgetActionSlotTarget className="pr-1" />
            </>
          }
        />
      )}

      {selectedObject && isArchivedObject(selectedObject) && !elementDetailOpen && (
        <ArchivedObjectBanner object={selectedObject} />
      )}

      {selectedObject ? (
        <ObjectDetailView
          key={selectedObject.id}
          object={selectedObject}
          onNavigate={onNavigate}
          onRefresh={onRefresh}
          tabTypeOverride={effectiveActiveType}
          domainName={activeDomain?.name ?? null}
          hideTabBar
          hideActionBar={isEmptyObjectElements}
          onElementDetailChange={setElementDetailOpen}
          onViewTypeChange={ensureVisibleTab}
          onViewChange={onViewChange}
          elementsControls={objectElementsControls}
        />
      ) : (
        <>
          <DomainTabContent
            activeType={effectiveActiveType}
            allElements={allDomainElements}
            objects={explorerData.objects}
            onSelectObject={(id) => onNavigate({ objectId: id })}
            onRefresh={onRefresh}
            objListControls={objListControls}
            domainId={activeDomainId ?? null}
            domainName={activeDomain?.name ?? null}
            onNavigate={onNavigate}
            onViewChange={onViewChange}
            onElementDetailChange={setElementDetailOpen}
          />
        </>
      )}

    </div>
    </WidgetActionSlotProvider>
  );
}

function HierarchyHeader({
  domainName,
  objectName,
  onDomainClick,
  objectSlot,
  actions,
}: {
  domainName: string;
  objectName?: string | null;
  onDomainClick: () => void;
  /** Rendered immediately after the Object name (the lowest breadcrumb item) —
   *  e.g. the Object "⋯" actions menu. */
  objectSlot?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <IslandHeader
      crumbs={[
        { id: 'domain', label: domainName, onClick: onDomainClick },
        ...(objectName ? [{ id: 'object', label: objectName, icon: <ObjectIcon size={12} /> }] : []),
      ]}
      after={objectName ? objectSlot : undefined}
      actions={actions}
    />
  );
}

interface DomainTabContentProps {
  activeType: ObjectTabType;
  allElements: ReturnType<typeof collectAllElements>;
  /** The Domain's Objects, for the cards that name theirs. */
  objects?: { id: string; name: string; icon?: string | null; color?: string | null }[];
  onSelectObject: (id: string) => void;
  onRefresh?: () => void;
  /** ListControls state owned by DomainView; the Filter / Display buttons
   *  themselves live in the TabBar's rightSlot. */
  objListControls?: ListControlsState;
  /** Active Domain id — required for the Workload tab to scope correctly. */
  domainId?: string | null;
  /** Named on the breadcrumb of an Element opened from the Execution
   *  Chain / Calendar / Workload. */
  domainName?: string | null;
  /** The tools' Element detail borrows these to reach an Object or an
   *  Strategy — the one-click round trip the List tab already has. */
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
  /** A tab drilldown's Element detail reports its open state, so the
   *  Domain chrome above hides and the detail owns the pane — the same
   *  takeover ObjectDetailView's own detail already gets. */
  onElementDetailChange: (open: boolean) => void;
}

function DomainTabContent({ activeType, allElements, objects, onSelectObject, onRefresh, objListControls, domainId, domainName, onNavigate, onViewChange, onElementDetailChange }: DomainTabContentProps) {
  const explorerData = useExplorerData();
  const { data: domainPhases } = usePhases(domainId ?? null);
  const { data: objectMilestones } = useObjectMilestones(explorerData.objects.map((o) => o.id));

  if (activeType === 'elements') {
    // List = Linear-style Domain table (top-level Objects). Drilling into
    // an Object swaps in per-Object content via ObjectDetailView above.
    return (
      <div className="flex-1 overflow-hidden">
        <ObjListView
          onSelect={onSelectObject}
          onRefresh={onRefresh}
          controls={objListControls}
        />
      </div>
    );
  }

  if (activeType === 'overview') {
    return <DomainOverview key={domainId} domainId={domainId ?? null} onNavigate={onNavigate} onViewChange={onViewChange} />;
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
          phases={domainPhases}
          milestones={objectMilestones}
        />
      </div>
    );
  }

  // The Execution Chain and Calendar render Elements but own no detail of
  // their own; the List tab does. ElementDrilldown lends them one — the tab
  // stays mounted (filters, scroll) while the Element is edited on top,
  // keyed by Domain so a switch drops it, and closed by any tab switch
  // since the branch changes.
  if (activeType === 'calendar') {
    return (
      <div className="flex-1 overflow-hidden">
        <ElementDrilldown key={domainId} label="Calendar" onNavigate={onNavigate} onViewChange={onViewChange} domainName={domainName} onDetailChange={onElementDetailChange}>
          {openElement => <CalendarView elements={allElements} onRefresh={onRefresh} onElementClick={(el) => openElement(el.id)} />}
        </ElementDrilldown>
      </div>
    );
  }

  // Board: the Domain's Objects, each in the column its Elements put it in.
  // An Object's own Board, one level down, shows its Elements.
  if (activeType === 'flow') {
    return <DomainObjectBoard objects={objects ?? []} elements={allElements} onOpenObject={onSelectObject}
      domain={domainId ? { id: domainId, name: domainName ?? '' } : null} />;
  }

  if (activeType === 'summary') {
    return (
      <div className="flex-1 overflow-auto">
        <HomeView />
      </div>
    );
  }

  // People: everyone working in the Domain, with their load.
  if (activeType === 'resource' || activeType === 'workers') {
    return (
      <div className="flex-1 overflow-hidden">
        <ElementDrilldown key={domainId} label="People" onNavigate={onNavigate} onViewChange={onViewChange} domainName={domainName} onDetailChange={onElementDetailChange}>
          {openElement => <ResourceView
            scopeOverride={{ domainIds: domainId ? [domainId] : [] }}
            onElementClick={element => openElement(element.id)}
            hideHeader
          />}
        </ElementDrilldown>
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

  return null;
}

// Adapter: turn an Object into the Element-shaped row GanttView expects.
// `object_id: null` makes the Gantt skip its parent-Object grouping so the
// Objects render as a flat list (matching "one bar per Object"). Status is
// pinned to 'todo' for a neutral bar colour — Objects don't carry a status of
// their own, and showing them all the same colour is the honest read.
export function objectToGanttBar(o: AlconObjectWithChildren): ElementWithDetails {
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
    direction: null,
    order_index: o.order_index ?? null,
    is_approval: false,
    approval_state: null,
    note_id: null,
    phase_id: o.phase_id ?? null,
    // An Object is not carried between Phases; the bar borrows the Element
    // shape and this field has no meaning here.
    carried_over_count: 0,
    claimed_by: null, claim_expires_at: null, branch: null,
    created_at: o.created_at ?? null,
    updated_at: o.updated_at ?? null,
  };
}

function DomainObjectBoard({ objects, elements, onOpenObject, domain }: {
  objects: BoardObject[];
  elements: readonly { object_id?: string | null; status?: string | null }[];
  onOpenObject: (objectId: string) => void;
  /** The Domain a new Object goes into; null: no "+". */
  domain: { id: string; name: string } | null;
}) {
  const [orientation, setOrientation] = useBoardOrientation();
  const { openCreate } = useWorkspaceActions();
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 pt-3">
      <div className="flex items-start gap-2">
        <BoardOrientationToggle orientation={orientation} onChange={setOrientation} className="ml-auto" />
      </div>
      <ObjectBoard objects={objects} elements={elements} orientation={orientation} onOpenObject={onOpenObject}
        onAdd={domain ? () => openCreate('object', { domainId: domain.id }) : undefined}
        className={orientation === 'horizontal' ? 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2' : 'flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2'} />
    </div>
  );
}
