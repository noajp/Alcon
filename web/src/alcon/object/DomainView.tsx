'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronRight, Sparkles, Plus, LayoutGrid, ClipboardList, List, Kanban, GanttChart, BarChart3, Calendar, Users } from 'lucide-react';
import { TabBar } from '@/shell/TabBar';
import type { ObjectTab, ObjectTabType, Json } from '@/types/database';
import type { ExplorerData, AlconObjectWithChildren } from '@/hooks/useSupabase';
import type { NavigationState } from '@/types/navigation';
import { ObjectDetailView } from './ObjectDetailView';
import { MyObjectsList, findObjectInExplorerData, collectAllElements } from './ObjectsView';
import { HomeView } from '@/alcon/widget/home';
import { GanttView } from '@/alcon/element/gantt';
import { CalendarView } from '@/alcon/element/calendar/CalendarView';
import { ElementBoardView } from '@/alcon/element/board/ElementBoardView';
import { ObjectIcon } from '@/shell/icons';
import { useDomains } from '@/hooks/useSupabase';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/ui/dropdown-menu';

const DOMAIN_TAB_KEY = 'domain:activeTabType';
const DOMAIN_VISIBLE_TABS_KEY = 'domain:visibleTabs';
const OBJECT_VISIBLE_TABS_PREFIX = 'domain:objectVisibleTabs:';
const DEFAULT_DOMAIN_TAB: ObjectTabType = 'elements';
const DEFAULT_DOMAIN_TAB_TYPES: ObjectTabType[] = ['elements'];
const DEFAULT_OBJECT_TAB_TYPES: ObjectTabType[] = ['overview', 'elements'];
const VIEW_META: Record<ObjectTabType, { domainTitle: string; objectTitle: string }> = {
  summary: { domainTitle: 'Dashboard', objectTitle: 'Dashboard' },
  elements: { domainTitle: 'All', objectTitle: 'Elements' },
  overview: { domainTitle: 'Overview', objectTitle: 'Overview' },
  gantt: { domainTitle: 'Gantt', objectTitle: 'Gantt' },
  calendar: { domainTitle: 'Calendar', objectTitle: 'Calendar' },
  workers: { domainTitle: 'Workers', objectTitle: 'Workers' },
  board: { domainTitle: 'Board', objectTitle: 'Board' },
};
const ALL_TAB_TYPES: ObjectTabType[] = ['overview', 'elements', 'board', 'gantt', 'summary', 'calendar', 'workers'];

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

  const visibleTabTypes = selectedObject
    ? objectVisibleTypesById[selectedObject.id] ?? DEFAULT_OBJECT_TAB_TYPES
    : domainVisibleTypes;

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* Persistent data hierarchy header: Domain > Object.
          View names such as All / Overview / Gantt are tabs, not hierarchy. */}
      {!elementDetailOpen && (
        <HierarchyHeader
          domainName={activeDomain?.name ?? 'Objects'}
          objectName={selectedObject?.name ?? null}
          onDomainClick={() => onNavigate({ objectId: null })}
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
        />
      ) : (
        <>
          {/* Domain root action bar — mirrors the per-Object action bar
              (レポート + + + LayoutGrid) so the Domain Object list has the
              same affordances. Hidden when there are zero Objects so the
              empty state owns the pane. */}
          {!isEmptyDomain && (
          <div className="px-5 py-2 bg-card flex items-center gap-2 flex-shrink-0">
            <div className="flex-1" />
            <button
              type="button"
              disabled
              title="Domain-wide report (coming soon)"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/50 border border-border/40 px-2.5 py-1 rounded-md cursor-not-allowed"
            >
              <Sparkles size={13} />
              レポート
            </button>

            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('alcon:create-object'))}
              className="inline-flex items-center justify-center w-7 h-7 text-foreground/70 hover:text-foreground border border-border/60 hover:bg-muted rounded-md transition-colors"
              title="Add Object"
            >
              <Plus size={14} />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex items-center justify-center w-7 h-7 text-foreground/70 hover:text-foreground border border-border/60 hover:bg-muted rounded-md transition-colors data-[state=open]:bg-muted data-[state=open]:text-foreground"
                  title="Switch view"
                >
                  <LayoutGrid size={13} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  View
                </DropdownMenuLabel>
                {([
                  { type: 'elements' as const, label: 'All', icon: <List size={14} strokeWidth={1.75} /> },
                  { type: 'overview' as const, label: 'Overview', icon: <ClipboardList size={14} strokeWidth={1.75} /> },
                  { type: 'board' as const, label: 'Board', icon: <Kanban size={14} strokeWidth={1.75} /> },
                  { type: 'gantt' as const, label: 'Gantt', icon: <GanttChart size={14} strokeWidth={1.75} /> },
                  { type: 'summary' as const, label: 'Dashboard', icon: <BarChart3 size={14} strokeWidth={1.75} /> },
                  { type: 'calendar' as const, label: 'Calendar', icon: <Calendar size={14} strokeWidth={1.75} /> },
                  { type: 'workers' as const, label: 'Workers', icon: <Users size={14} strokeWidth={1.75} /> },
                ]).map((v) => {
                  const isActive = effectiveActiveType === v.type;
                  return (
                    <DropdownMenuItem
                      key={v.type}
                      onClick={() => ensureVisibleTab(v.type)}
                      className={`gap-2.5 items-center py-1.5 text-[13px] ${isActive ? 'bg-blue-500/10 text-foreground font-medium focus:bg-blue-500/15' : ''}`}
                    >
                      <span className={`w-4 h-4 flex items-center justify-center shrink-0 ${isActive ? 'text-blue-500' : 'text-muted-foreground'}`}>
                        {v.icon}
                      </span>
                      <span>{v.label}</span>
                      {isActive && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500" />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          )}

          <DomainTabContent
            activeType={effectiveActiveType}
            explorerData={explorerData}
            allElements={allDomainElements}
            onSelectObject={(id) => onNavigate({ objectId: id })}
            onRefresh={onRefresh}
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
}: {
  domainName: string;
  objectName?: string | null;
  onDomainClick: () => void;
}) {
  return (
    <div className="h-10 flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
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
    </div>
  );
}

interface DomainTabContentProps {
  activeType: ObjectTabType;
  explorerData: ExplorerData;
  allElements: ReturnType<typeof collectAllElements>;
  onSelectObject: (id: string) => void;
  onRefresh?: () => void;
}

function DomainTabContent({ activeType, explorerData, allElements, onSelectObject, onRefresh }: DomainTabContentProps) {
  if (activeType === 'elements') {
    // List = Linear-style Domain table (top-level Objects). Drilling into
    // an Object swaps in per-Object content via ObjectDetailView above.
    return (
      <div className="flex-1 overflow-hidden">
        <MyObjectsList
          explorerData={explorerData}
          onSelect={onSelectObject}
          onRefresh={onRefresh}
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
    return (
      <div className="flex-1 overflow-hidden">
        <GanttView elements={allElements} onRefresh={onRefresh} />
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
