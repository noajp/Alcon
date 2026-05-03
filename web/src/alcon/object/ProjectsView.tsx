'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
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

const DOMAIN_TAB_KEY = 'projects:activeTabType';
const DEFAULT_DOMAIN_TAB: ObjectTabType = 'elements';

const DOMAIN_TABS: { type: ObjectTabType; title: string }[] = [
  { type: 'elements', title: 'All' },
  { type: 'overview', title: 'Overview' },
  { type: 'board', title: 'Board' },
  { type: 'gantt', title: 'Gantt' },
  { type: 'summary', title: 'Dashboard' },
  { type: 'calendar', title: 'Calendar' },
  { type: 'workers', title: 'Workers' },
];

interface ProjectsViewProps {
  explorerData: ExplorerData;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
  activeDomainId?: string | null;
}

// Walk the Object tree to find the path from root to the target Object.
function buildObjectPath(
  objects: AlconObjectWithChildren[],
  targetId: string,
): { id: string; name: string }[] {
  const find = (
    objs: AlconObjectWithChildren[],
    path: { id: string; name: string }[],
  ): { id: string; name: string }[] | null => {
    for (const obj of objs) {
      const next = [...path, { id: obj.id, name: obj.name }];
      if (obj.id === targetId) return next;
      if (obj.children) {
        const found = find(obj.children, next);
        if (found) return found;
      }
    }
    return null;
  };
  return find(objects, []) ?? [];
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
  const [activeType, setActiveType] = useState<ObjectTabType>(() => {
    if (typeof window === 'undefined') return DEFAULT_DOMAIN_TAB;
    const saved = window.localStorage.getItem(DOMAIN_TAB_KEY);
    if (saved && DOMAIN_TABS.some(t => t.type === saved)) {
      return saved as ObjectTabType;
    }
    return DEFAULT_DOMAIN_TAB;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DOMAIN_TAB_KEY, activeType);
    }
  }, [activeType]);

  // Domain tabs are static — no DB row, no close, no create.
  const tabs: ObjectTab[] = useMemo(
    () =>
      DOMAIN_TABS.map((t, i) => ({
        id: `domain-${t.type}`,
        object_id: 'domain',
        tab_type: t.type,
        title: t.title,
        content: null as unknown as Json,
        order_index: i,
        is_pinned: false,
        created_at: null,
        updated_at: null,
      })),
    [],
  );

  const activeTabId = tabs.find(t => t.tab_type === activeType)?.id ?? tabs[0].id;

  const selectedObject = navigation.objectId
    ? findObjectInExplorerData(explorerData, navigation.objectId)
    : null;

  // Stale objectId guard — clear if the Object no longer exists in the active Domain
  useEffect(() => {
    if (navigation.objectId && !selectedObject) {
      onNavigate({ objectId: null });
    }
  }, [navigation.objectId, selectedObject, onNavigate]);

  const allDomainElements = useMemo(
    () => collectAllElements(explorerData.objects),
    [explorerData],
  );

  const objectPath = useMemo(
    () => (selectedObject ? buildObjectPath(explorerData.objects, selectedObject.id) : []),
    [selectedObject, explorerData.objects],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* Linear-style breadcrumb — Domain > parent Objs > current Obj.
          Always rendered (with min-height) so the layout doesn't shift
          when an Object is selected / cleared. */}
      <div className="flex items-center gap-1 px-4 pt-2.5 pb-1 min-h-[28px] flex-shrink-0">
        {activeDomain && (
          <button
            type="button"
            onClick={() => onNavigate({ objectId: null })}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[13px] truncate max-w-[200px] transition-colors ${
              objectPath.length === 0
                ? 'text-foreground font-medium cursor-default'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}
            disabled={objectPath.length === 0}
          >
            <span className="truncate">{activeDomain.name}</span>
          </button>
        )}
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

      {selectedObject ? (
        <ObjectDetailView
          object={selectedObject}
          onNavigate={onNavigate}
          onRefresh={onRefresh}
          explorerData={explorerData}
          tabTypeOverride={activeType}
          hideTabBar
        />
      ) : (
        <DomainTabContent
          activeType={activeType}
          explorerData={explorerData}
          allElements={allDomainElements}
          onSelectObject={(id) => onNavigate({ objectId: id })}
          onRefresh={onRefresh}
        />
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
  if (activeType === 'overview' || activeType === 'elements') {
    // Overview & List both lead with the Linear-style projects table at the
    // Domain level. Drilling into a project switches to per-Object content.
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
