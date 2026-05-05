'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
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

const DOMAIN_TAB_KEY = 'projects:activeTabType';
const DEFAULT_DOMAIN_TAB: ObjectTabType = 'elements';

// Domain root tabs — kept intentionally minimal: only the flat "All" view
// (Object list). Other Domain-wide views (Overview / Board / Gantt /
// Dashboard / Calendar / Workers) are reachable from the View switcher
// dropdown but no longer ship as default tabs.
const DOMAIN_TABS: { type: ObjectTabType; title: string }[] = [
  { type: 'elements', title: 'All' },
];

// Per-Object tabs — the Domain shell uses these instead of DOMAIN_TABS when
// drilled into a specific Object. Kept intentionally minimal: Overview is the
// landing view, "All" is the flat Element list. Other views (Board / Gantt /
// Calendar / Workers) are still reachable from the View switcher dropdown if
// a user wants them, but they no longer ship as default tabs.
const OBJECT_TABS: { type: ObjectTabType; title: string }[] = [
  { type: 'overview', title: 'Overview' },
  { type: 'elements', title: 'All' },
];

interface ProjectsViewProps {
  explorerData: ExplorerData;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
  activeDomainId?: string | null;
}

// Build the breadcrumb path to an Object. Hierarchy is flat (Domain >
// Object > Element), so the path is at most one segment.
function buildObjectPath(
  objects: AlconObjectWithChildren[],
  targetId: string,
): { id: string; name: string }[] {
  const found = objects.find(o => o.id === targetId);
  return found ? [{ id: found.id, name: found.name }] : [];
}

/**
 * Domain-level shell for the `projects` activity. Renders a single TabBar at
 * the top whose choice persists across Object navigations — Overview, List,
 * Calendar, etc. are now Domain-scoped views, with the same tab choice
 * carrying through when the user drills into a specific Object.
 */
export function ProjectsView({ explorerData, navigation, onNavigate, onRefresh, activeDomainId }: ProjectsViewProps) {
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
    if (saved && DOMAIN_TABS.some(t => t.type === saved)) {
      return saved as ObjectTabType;
    }
    return DEFAULT_DOMAIN_TAB;
  });
  const [objectActiveType, setObjectActiveType] = useState<ObjectTabType>('overview');

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
  const setActiveType = (t: ObjectTabType) => {
    if (selectedObject) setObjectActiveType(t);
    else setDomainActiveType(t);
  };

  // True when ObjectDetailView has an Element detail panel open. We hide the
  // Domain-level breadcrumb + TabBar in that mode so the Element detail owns
  // the whole pane (its own back-arrow breadcrumb is enough). The key={...}
  // on ObjectDetailView below ensures the inner detail state resets when
  // the user navigates between Objects, so this flag tracks correctly.
  const [elementDetailOpen, setElementDetailOpen] = useState(false);

  // Tabs differ between Domain root (full set incl. All / Dashboard) and
  // per-Object (Overview / Elements / Board / Gantt / Calendar / Workers).
  // Both lists are static — no DB row, no close, no create.
  const tabSpec = selectedObject ? OBJECT_TABS : DOMAIN_TABS;
  const tabs: ObjectTab[] = useMemo(
    () =>
      tabSpec.map((t, i) => ({
        id: `${selectedObject ? 'obj' : 'domain'}-${t.type}`,
        object_id: selectedObject ? selectedObject.id : 'domain',
        tab_type: t.type,
        title: t.title,
        content: null as unknown as Json,
        order_index: i,
        is_pinned: false,
        created_at: null,
        updated_at: null,
      })),
    [tabSpec, selectedObject],
  );

  // If the active Domain tab type isn't available at the per-Object level
  // (e.g. Domain 'elements' which means All, or 'summary' which is the
  // Domain Dashboard), fall back to a sensible per-Object default for
  // routing + highlight.
  const effectiveActiveType: ObjectTabType = useMemo(() => {
    if (tabSpec.some(t => t.type === activeType)) return activeType;
    return 'overview';
  }, [tabSpec, activeType]);

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

  const objectPath = useMemo(
    () => (selectedObject ? buildObjectPath(explorerData.objects, selectedObject.id) : []),
    [selectedObject, explorerData.objects],
  );

  // Empty-state suppression: when the Domain has no Objects, or when the
  // selected Object has no Elements on the Elements tab, the centered empty
  // state owns the pane — hide tabs / action bar / レポート / +/ grid so the
  // user only sees the create CTA.
  const isEmptyDomain = !selectedObject && explorerData.objects.length === 0;
  const isEmptyObjectElements =
    !!selectedObject && effectiveActiveType === 'elements' && (selectedObject.elements ?? []).length === 0;
  const hideChrome = isEmptyDomain || isEmptyObjectElements;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* Linear-style breadcrumb — Domain > parent Objs > current Obj.
          Hidden at the Domain root (no Object drilled into) since the tab
          chip already labels the active Domain — rendering it again as a
          breadcrumb segment is redundant. Also hidden while an Element
          detail is open — the detail panel has its own back-arrow. */}
      {!elementDetailOpen && objectPath.length > 0 && (
      <div className="flex items-center gap-1 px-4 pt-2.5 pb-1 min-h-[28px] flex-shrink-0">
        <button
          type="button"
          onClick={() => onNavigate({ objectId: null })}
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[13px] truncate max-w-[200px] transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/40"
        >
          <span className="truncate">{activeDomain?.name ?? 'Objects'}</span>
        </button>
        {objectPath.map((seg, i) => {
          const isLast = i === objectPath.length - 1;
          return (
            <Fragment key={seg.id}>
              <ChevronRight size={12} className="text-muted-foreground/50 flex-shrink-0" />
              <button
                type="button"
                onClick={() => !isLast && onNavigate({ objectId: seg.id })}
                disabled={isLast}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[13px] truncate max-w-[200px] transition-colors ${
                  isLast
                    ? 'text-foreground font-medium cursor-default'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
              >
                <ObjectIcon size={12} />
                <span className="truncate">{seg.name}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
      )}

      {!elementDetailOpen && !hideChrome && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSelect={(id) => {
            const t = tabs.find(x => x.id === id);
            if (t) setActiveType(t.tab_type);
          }}
          onTabClose={() => { /* Domain tabs are not closable */ }}
          onTabCreate={() => { /* Domain tabs are not creatable */ }}
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
                  const isActive = activeType === v.type;
                  return (
                    <DropdownMenuItem
                      key={v.type}
                      onClick={() => setActiveType(v.type)}
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
            activeType={activeType}
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

interface DomainTabContentProps {
  activeType: ObjectTabType;
  explorerData: ExplorerData;
  allElements: ReturnType<typeof collectAllElements>;
  onSelectObject: (id: string) => void;
  onRefresh?: () => void;
}

function DomainTabContent({ activeType, explorerData, allElements, onSelectObject, onRefresh }: DomainTabContentProps) {
  if (activeType === 'elements') {
    // List = Linear-style projects table (top-level Objects). Drilling into
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
