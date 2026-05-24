'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  List as ListIcon,
  Kanban as KanbanIcon,
  GanttChart as GanttIcon,
  Calendar as CalendarIcon,
  Users as UsersIcon,
} from 'lucide-react';
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
import type { NavigationState } from '@/types/navigation';

// Tabs at the top of the Domain-wide Elements view. "All Elements" is the
// flat list (default); the rest pivot the same data into Board / Gantt /
// Calendar / Workers. Local state only — visible-set is persisted in
// localStorage but never round-trips to the DB (vs Object tabs).
type ElementsViewMode = 'list' | 'board' | 'gantt' | 'calendar' | 'workers';

const ALL_TAB_DEFS: { id: ElementsViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'list',     label: 'All Elements', icon: <ListIcon size={14} /> },
  { id: 'board',    label: 'Board',        icon: <KanbanIcon size={14} /> },
  { id: 'gantt',    label: 'Gantt',        icon: <GanttIcon size={14} /> },
  { id: 'calendar', label: 'Calendar',     icon: <CalendarIcon size={14} /> },
  { id: 'workers',  label: 'Workers',      icon: <UsersIcon size={14} /> },
];

const DEFAULT_VISIBLE_TABS: ElementsViewMode[] = ['list'];
const VISIBLE_TABS_KEY = 'elements:visibleTabs';
const ACTIVE_TAB_KEY = 'elements:activeTab';

function loadVisibleTabs(): ElementsViewMode[] {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE_TABS;
  try {
    const raw = window.localStorage.getItem(VISIBLE_TABS_KEY);
    if (!raw) return DEFAULT_VISIBLE_TABS;
    const parsed = JSON.parse(raw) as ElementsViewMode[];
    const valid = parsed.filter((t) => ALL_TAB_DEFS.some((d) => d.id === t));
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
  const [visibleTabs, setVisibleTabs] = useState<ElementsViewMode[]>(loadVisibleTabs);
  const [viewMode, setViewMode] = useState<ElementsViewMode>(() => {
    if (typeof window === 'undefined') return 'list';
    const saved = window.localStorage.getItem(ACTIVE_TAB_KEY) as ElementsViewMode | null;
    return saved && ALL_TAB_DEFS.some((d) => d.id === saved) ? saved : 'list';
  });
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Section-aware quick-add: null = Domain-direct, otherwise the target Object.
  const [quickAddTargetObjectId, setQuickAddTargetObjectId] = useState<string | null>(null);
  const [quickAddLabel, setQuickAddLabel] = useState<string | null>(null);

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
  const effectiveViewMode: ElementsViewMode = visibleTabs.includes(viewMode)
    ? viewMode
    : (visibleTabs[0] ?? 'list');

  const addTab = (id: ElementsViewMode) => {
    setVisibleTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setViewMode(id);
  };

  const removeTab = (id: ElementsViewMode) => {
    if (id === 'list') return; // "All Elements" is permanent
    setVisibleTabs((prev) => {
      const next = prev.filter((t) => t !== id);
      return next.length > 0 ? next : DEFAULT_VISIBLE_TABS;
    });
    if (viewMode === id) setViewMode('list');
  };

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

  const sections = useMemo<ListSection[]>(() => {
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

  const allElementsForLookup = useMemo(() => {
    const m = new Map<string, ElementWithDetails>();
    for (const sec of sections) for (const el of sec.elements ?? []) m.set(el.id, el);
    return m;
  }, [sections]);

  // Flattened view of every Element across Domain-direct + per-Object
  // sections. The Board groups by status without caring about the section
  // partition, so we collapse it once here.
  const allElementsFlat = useMemo<ElementWithDetails[]>(
    () => Array.from(allElementsForLookup.values()),
    [allElementsForLookup],
  );

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

  const isEmpty = sections.length === 0;

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
      />

      {/* View-mode tabs — mirrors the Object Detail's tab strip but holds
          local state and a localStorage-backed visible-set. "+" opens an
          add menu (Board / Gantt / Calendar / Workers) for tabs not yet
          present; right-click a non-default tab to remove it. */}
      <ElementsViewTabBar
        visibleIds={visibleTabs}
        activeId={effectiveViewMode}
        onSelect={setViewMode}
        onAdd={addTab}
        onRemove={removeTab}
      />

      {effectiveViewMode === 'list' && (
        <div className="flex-1 overflow-auto">
          <ObjectListView
            sections={sections}
            onSelectObject={() => { /* sections never carry Objects here */ }}
            onSelectElement={(id) => setDetailId(id)}
            onElementUpdate={handleElementUpdate}
            onAddElement={openQuickAddForSection}
            colStorageKey="domain-elements"
            elementTypes={elementTypes}
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

function ElementsViewTabBar({
  visibleIds,
  activeId,
  onSelect,
  onAdd,
  onRemove,
}: {
  visibleIds: ElementsViewMode[];
  activeId: ElementsViewMode;
  onSelect: (id: ElementsViewMode) => void;
  onAdd: (id: ElementsViewMode) => void;
  onRemove: (id: ElementsViewMode) => void;
}) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ id: ElementsViewMode; x: number; y: number } | null>(null);

  // Close context menu on outside click / Escape.
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      setCtxMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [ctxMenu]);

  const visibleSet = new Set(visibleIds);
  const addable = ALL_TAB_DEFS.filter((t) => !visibleSet.has(t.id));
  const visible = visibleIds
    .map((id) => ALL_TAB_DEFS.find((d) => d.id === id))
    .filter((d): d is (typeof ALL_TAB_DEFS)[number] => !!d);

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 bg-transparent flex-shrink-0">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {visible.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              onContextMenu={(e) => {
                if (tab.id === 'list') return; // "All Elements" not removable
                e.preventDefault();
                e.stopPropagation();
                setCtxMenu({ id: tab.id, x: e.clientX, y: e.clientY });
              }}
              className={`flex items-center gap-1.5 px-3 py-1 cursor-pointer select-none rounded-full transition-colors flex-shrink-0 border ${
                isActive
                  ? 'bg-muted text-foreground border-border'
                  : 'text-muted-foreground border-border/50 hover:text-foreground hover:bg-muted/40 hover:border-border'
              }`}
            >
              <span className={isActive ? 'text-foreground' : 'text-muted-foreground'}>
                {tab.icon}
              </span>
              <span className="text-xs font-semibold">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* "+" — add a tab. Disabled (hidden) when every tab is already visible. */}
      {addable.length > 0 && (
        <div className="relative flex items-center flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowAddMenu((v) => !v)}
            className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-full transition-colors"
            title="Add view"
          >
            <Plus size={14} />
          </button>
          {showAddMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
              <div className="absolute top-full left-0 mt-1 py-1 bg-popover border border-border rounded-lg shadow-xl z-50 min-w-[150px]">
                {addable.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { onAdd(opt.id); setShowAddMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    <span className="text-muted-foreground">{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Right-click context menu — remove a non-default tab. */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" />
          <div
            className="fixed z-50 py-1 bg-popover border border-border rounded-lg shadow-xl min-w-[160px]"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 170),
              top: Math.min(ctxMenu.y, window.innerHeight - 60),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => { onRemove(ctxMenu.id); setCtxMenu(null); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              Remove tab
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ElementsHierarchyHeader({
  domainName,
  onDomainClick,
}: {
  domainName: string;
  onDomainClick?: () => void;
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
