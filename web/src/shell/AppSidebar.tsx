'use client';


import { DomainAgentSettings } from '@/ActivitySpace/execution/domain/DomainAgentSettings';
import { StrategyNavigation } from './sidebar/StrategyNavigation';
import { DomainNavigationRow } from './sidebar/DomainNavigationRow';
import { useWorkspaceActions } from '@/shell/WorkspaceActionsContext';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { Domain, DomainPrivacy } from '@/hooks/useSupabase';
import { useNotifications } from '@/hooks/useSupabase';
import { Plus, ChevronRight, FileText, Bot, Settings, Users, X, Search } from 'lucide-react';
import { useAuthContext } from '@/providers/AuthProvider';
import { updateDomain } from '@/hooks/useSupabase';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ObjectIcon } from '@/shell/icons';
import { DomainIcon } from '@/Function/shared/conceptIcons';
import { useDomains, reorderDomains } from '@/hooks/useSupabase';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { getActiveDomainId, setActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT } from '@/ActivitySpace/execution/domain/domainsStore';
import { SpaceSwitcher } from '@/Function/space/SpaceSwitcher';

import { NavNoteIcon, NavTableIcon } from '@/shell/sidebar/NavIcons';
import { useDataTables } from '@/hooks/useSupabase';
import { VIEW_REGISTRY, type ViewId } from '@/shell/viewRegistry';
import { railModeOf } from '@/shell/ModeRail';
import { seedNotebook } from '@/ActivitySpace/sustainment/notebook/notebookActions';
import { SettingsSidebarPanel } from '@/Function/settings/SettingsSidebarPanel';
import { useNotes } from '@/hooks/useNotesDb';
import { TeamSettings } from '@/Function/settings/TeamSettings';
import { OperationsNavigation } from '@/ActivitySpace/sustainment/operations/OperationsNavigation';
import { operationsQueue, operationsQueueRoute } from '@/ActivitySpace/sustainment/operations/operationsQueues';
import type { NavigationState } from '@/types/navigation';

export type { NavigationState };

interface AppSidebarProps {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  activeView: string;
  onViewChange: (view: string) => void;
  /** Settings opens in its own tab rather than overwriting the active
   *  tab's view — see the rationale on page.tsx's handleOpenSettings. */
  onOpenSettings: () => void;
  onRefresh?: () => void;
  width: number;
  collapsed: boolean;
  overlay: boolean;
  onCreateNew?: (type: 'domain' | 'object' | 'note') => void;
  onSearch?: () => void;
}

// Sidebar nav items derive their label + icon from the shared view registry
// so there is one source of truth for activity-view metadata. Each id below
// is guaranteed to have an icon in the registry. The ModeRail picks a top-level
// mode; the sidebar then renders only that mode's surfaces.
const navItem = (id: ViewId) => ({ id, icon: VIEW_REGISTRY[id].icon!, label: VIEW_REGISTRY[id].label });

// Home — the user-scoped surfaces. Inbox is the notifications feed; Calendar
// and My Elements show the signed-in user's Elements.
const HOME_ITEMS = [navItem('home'), navItem('inbox'), navItem('calendar'), navItem('my-elements'), navItem('profile')];
// Strategy — what we're trying to achieve and how we intend to win. Initiative
// (view id 'strategy', display label "Initiatives") is the unit, and Initiatives
// bundle into a strategy; Phase stages the effort; Timeline sequences the set.
// Execution — the fighting: the Domain tree, whose rows carry the D/O/E
// surfaces below.

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_WIDTH_KEY = 'alcon:sidebarWidth';

function isEmojiIcon(s: string) {
  return /^\p{Emoji}/u.test(s) && s.length <= 4;
}

// Names the mode the sidebar is currently showing — one quiet label at the top
// of every mode, no affordance of its own.
function SidebarModeLabel({ label }: { label: string }) {
  return (
    <div className="px-2 h-6 mt-3 flex items-center text-[11px] font-semibold tracking-wide text-muted-foreground/60">
      {label}
    </div>
  );
}

// Notebook mode's sidebar — the list of notebooks (root Folders). Picking one
// opens it in the main pane (Section drawer + file list + editor); the "+"
// seeds a fresh notebook (Folder → Section → page) and opens it. The main
// pane shows just a placeholder until a notebook is chosen here.
function NotebookSidebar({
  activeFolderId,
  onNavigate,
  onViewChange,
}: {
  activeFolderId: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
}) {
  const { nodes, createNode, deleteNode } = useNotes();
  const folders = useMemo(
    () => nodes.filter((n) => n.type === 'folder').sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );

  const addNotebook = async () => {
    try {
      const { folder, page } = await seedNotebook(createNode, deleteNode);
      onViewChange('note');
      onNavigate({ noteFolderId: folder.id, noteId: page.id });
    } catch (e) {
      console.error('Failed to create notebook', e);
    }
  };

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1 px-2 h-6 mt-3">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground/60">Notebook</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={addNotebook}
          title="Add Notebook"
          aria-label="Add Notebook"
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="mt-1 flex flex-col">
        {folders.map((f) => {
          const active = f.id === activeFolderId;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => { onViewChange('note'); onNavigate({ noteFolderId: f.id, noteId: null }); }}
              title={f.name}
              className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
                active
                  ? 'bg-sidebar-accent text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
              }`}
            >
              <NavNoteIcon size={16} />
              <span className="min-w-0 flex-1 text-left truncate">{f.name}</span>
            </button>
          );
        })}
        {folders.length === 0 && (
          <div className="px-2.5 py-6 text-[11px] text-muted-foreground/60 leading-relaxed">
            No notebooks yet — click + to add one.
          </div>
        )}
      </div>
    </div>
  );
}

// Table mode's sidebar — the list of the user's Tables. Picking one opens it
// in the main pane (columns + rows); the "+" fires an event the TableView
// listens for to open its New Table dialog. The main pane shows a placeholder
// until a table is chosen here.
function TableSidebar({
  activeTableId,
  onNavigate,
  onViewChange,
}: {
  activeTableId: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
}) {
  const { openCreate } = useWorkspaceActions();
  const { data: tables, refetch } = useDataTables();
  // The New Table dialog lives in TableView; when it creates a table it
  // dispatches this so our separate list instance refreshes.
  useEffect(() => {
    const h = () => void refetch();
    window.addEventListener('alcon:tables-changed', h);
    return () => window.removeEventListener('alcon:tables-changed', h);
  }, [refetch]);

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1 px-2 h-6 mt-3">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground/60">Table</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => openCreate('table')}
          title="Add Table"
          aria-label="Add Table"
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="mt-1 flex flex-col">
        {tables.map((t) => {
          const active = t.id === activeTableId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => { onViewChange('tables'); onNavigate({ tableId: t.id }); }}
              title={t.name}
              className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
                active
                  ? 'bg-sidebar-accent text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
              }`}
            >
              <NavTableIcon size={16} />
              <span className="min-w-0 flex-1 text-left truncate">{t.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">{t.rowCount}</span>
            </button>
          );
        })}
        {tables.length === 0 && (
          <div className="px-2.5 py-6 text-[11px] text-muted-foreground/60 leading-relaxed">
            No tables yet — click + to add one.
          </div>
        )}
      </div>
    </div>
  );
}

export function AppSidebar({
  navigation,
  onNavigate,
  activeView,
  onViewChange,
  onOpenSettings,
  collapsed,
  overlay,
  onCreateNew,
  onSearch,
}: AppSidebarProps) {
  const { user } = useAuthContext();
  const { unreadCount } = useNotifications(user?.id ?? null);
  const { guestDomains, refetch: refetchMemberDomains } = useDomains();
  const { data: visibleDomains, refetch: refetchVisibleDomains } = useSustainmentDomains();
  const domains = useMemo(() => [...visibleDomains].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)), [visibleDomains]);
  const refetchDomains = useCallback(async () => {
    await Promise.all([refetchMemberDomains(), refetchVisibleDomains()]);
  }, [refetchMemberDomains, refetchVisibleDomains]);
  // Locally-mirrored Domain order so a drag-reorder applies instantly on drop.
  // Without this the list would snap back to the server order for the frame
  // between releasing and refetchDomains() resolving — a visible flicker.
  // Kept in sync with the hook's data whenever it changes.
  const [orderedDomains, setOrderedDomains] = useState<Domain[]>(domains);
  // Synced while rendering rather than in an effect: the mirror and the list
  // it mirrors then reach the screen in the same commit, instead of the list
  // painting once with the old order and again with the new one.
  const [syncedDomains, setSyncedDomains] = useState<Domain[]>(domains);
  if (syncedDomains !== domains) {
    setSyncedDomains(domains);
    setOrderedDomains(domains);
  }
  const [activeDomainId, setActiveDomainIdState] = useState<string>(
    () => getActiveDomainId() ?? domains[0]?.id ?? ''
  );
  // Each Domain has its own expanded state — opening one no longer collapses the others.
  const [expandedDomainIds, setExpandedDomainIds] = useState<Set<string>>(
    () => new Set(activeDomainId ? [activeDomainId] : [])
  );
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState({ top: 0, left: 0 });
  const [settingsDomain, setSettingsDomain] = useState<Domain | null>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const railMode = railModeOf(activeView);
  const [draggingDomain, setDraggingDomain] = useState<Domain | null>(null);
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return SIDEBAR_MIN_WIDTH;
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH
      ? saved
      : SIDEBAR_MIN_WIDTH;
  });
  const [resizing, setResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }, [width]);

  // "+ Create new" trigger — anchors the menu off its own button rect (no
  // ModeRail to dispatch this from anymore, so it's a direct click handler).
  const openCreateMenu = () => {
    const rect = createBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setCreateMenuPos({ top: rect.bottom + 4, left: rect.left });
    } else {
      setCreateMenuPos({ top: window.innerHeight - 250, left: 46 });
    }
    setCreateMenuOpen(true);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setResizing(true);
    // Resize by writing the width straight to the DOM during the drag.
    // Driving it through React state re-rendered the whole sidebar tree
    // on every pointermove, which made the drag stutter — commit to state
    // just once on release (that re-sync also persists to localStorage).
    let next = startW;
    const onMove = (ev: PointerEvent) => {
      next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startW + (ev.clientX - startX)));
      const el = sidebarRef.current;
      if (el) el.style.width = `${next}px`;
    };
    const onUp = () => {
      setResizing(false);
      setWidth(next);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const activeDomain = [...domains, ...guestDomains].find((d) => d.id === activeDomainId) ?? domains[0];

  // Same reason as the order mirror above: the open dialog picks up the row
  // it is editing as it is rendered, not a frame later.
  if (settingsDomain) {
    const fresh = domains.find((d) => d.id === settingsDomain.id);
    if (fresh && fresh !== settingsDomain) setSettingsDomain(fresh);
  }

  // The handler is declared outside the effect so the state it sets belongs to
  // an event, which is what it is — a Domain chosen on another surface.
  const onActiveDomainChanged = useCallback((e: Event) => {
    const id = (e as CustomEvent<string>).detail;
    if (id) setActiveDomainIdState(id);
  }, []);
  useEffect(() => {
    window.addEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, onActiveDomainChanged as EventListener);
    return () => window.removeEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, onActiveDomainChanged as EventListener);
  }, [onActiveDomainChanged]);

  // First-time / signed-in-fresh users start on the Individual Domain
  // (it's sorted to the top of `domains` by useDomains).
  // First-time / signed-in-fresh users start on the Individual Domain (it is
  // sorted to the top of `domains` by useDomains). The choice is made while
  // rendering so the list never paints with nothing selected.
  if (!activeDomainId && domains[0]) {
    const first = domains[0].id;
    setActiveDomainIdState(first);
    setExpandedDomainIds((prev) => (prev.has(first) ? prev : new Set(prev).add(first)));
  }
  // The choice also has to reach the shared store, which every other surface
  // reads. It cannot ride the render above: React throws away a render that
  // sets state during it, and effects are only queued from the render that
  // commits — so an effect keyed on that transient value would never run at
  // all. Keyed on the settled Domain instead, and silent when the store
  // already agrees, which is the case whenever the user picked it themselves.
  useEffect(() => {
    if (activeDomainId && getActiveDomainId() !== activeDomainId) setActiveDomainId(activeDomainId);
  }, [activeDomainId]);

  // When the active Domain changes (e.g. via DomainsView or another tab),
  // expand it additively — never collapse the rows the user already opened.
  const [expandedFor, setExpandedFor] = useState(activeDomainId);
  if (activeDomainId && expandedFor !== activeDomainId) {
    setExpandedFor(activeDomainId);
    setExpandedDomainIds((prev) => (prev.has(activeDomainId) ? prev : new Set(prev).add(activeDomainId)));
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { type?: string } | undefined;
    if (data?.type === 'domain') {
      setDraggingDomain(orderedDomains.find((d) => d.id === event.active.id) ?? null);
      return;
    }
  };
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    // ── Domain reorder branch ──
    if ((active.data.current as { type?: string } | undefined)?.type === 'domain') {
      setDraggingDomain(null);
      if (over && active.id !== over.id) {
        const oldIndex = orderedDomains.findIndex((d) => d.id === active.id);
        const newIndex = orderedDomains.findIndex((d) => d.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          const reordered = arrayMove(orderedDomains, oldIndex, newIndex);
          setOrderedDomains(reordered); // optimistic — instant, no flicker
          try {
            await reorderDomains(reordered.map((d, i) => ({ id: d.id, order_index: i })));
            void refetchDomains();
          } catch (err) {
            console.error('Failed to reorder domains:', err);
            void refetchDomains(); // roll back to server order on failure
          }
        }
      }
      return;
    }

  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingDomain(null)}
    >
      <div
        ref={sidebarRef}
        style={{
          width,
          transform: collapsed && !overlay ? 'translateX(-100%)' : 'translateX(0)',
        }}
        className={`app-sidebar h-full flex flex-col flex-shrink-0 overflow-hidden ${
          collapsed
            ? 'absolute inset-y-0 left-0 z-50 bg-background border-r border-border shadow-xl'
            : 'relative'
        } ${resizing ? '' : 'transition-transform duration-200 ease-out'}`}
      >
        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto pb-3 pl-1 pr-2">

          {activeView === 'settings' ? (
            <SettingsSidebarPanel />
          ) : (
          <>
          {/* Top row: the active Space + quick actions (search + create-new).
              The ModeRail to the left picks which mode's surfaces show below. */}
          <div className="flex items-center gap-1 py-1.5">
            <div className="min-w-0 flex-1">
              <SpaceSwitcher onSettings={onOpenSettings} />
            </div>
            {onSearch && (
              <button
                type="button"
                onClick={onSearch}
                title="Discover Domains and Objects"
                aria-label="Discover"
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
              >
                <Search size={15} />
              </button>
            )}
            <button
              ref={createBtnRef}
              type="button"
              onClick={openCreateMenu}
              title="Create new"
              aria-label="Create new"
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
            >
              <Plus size={16} />
            </button>
          </div>

          {/* ── Home mode ── Inbox / Calendar / My Elements */}
          {railMode === 'home' && (
          <>
          <SidebarModeLabel label="Home" />
          <div className="mb-1 mt-1">
            {HOME_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              const showBadge = item.id === 'inbox' && unreadCount > 0;
              return (
                <button
                  key={item.id}
                  onClick={() => onViewChange(item.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
                    isActive
                      ? 'bg-sidebar-accent text-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                  }`}
                >
                  <Icon size={16} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {showBadge && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          </>
          )}

          {/* ── Strategy mode ── The Initiative portfolio plus the
              surfaces that carry its reasoning and sequencing. Deliberately
              holds nothing about who is executing: that lives one rail button
              down, reachable from any Initiative's member Objects. */}
          {railMode === 'strategy' && (
          <>
          <SidebarModeLabel label="Strategy" />
          <StrategyNavigation activeView={activeView} onSelect={(id) => {
            if (id === 'strategy') onNavigate({ strategyId: null });
            onViewChange(id);
          }} />
          </>
          )}

          {/* ── Execution mode ── the fighting: the Domain tree,
              each Domain opening onto its Objects and Elements. */}
          {railMode === 'execution' && (
          <>
          <SidebarModeLabel label="Execution" />
          <div className="mt-1" />

          {/* All domains — the name opens the overview; the chevron expands the tree.
              Opening one does NOT collapse the others (multiple expanded at a time).
              The fixed "Individual Domain" is sorted to the top by useDomains and gets a
              fixed person icon + "Individual Domain" label so it reads as locked / non-editable. */}
          <SortableContext items={orderedDomains.map((d) => d.id)} strategy={verticalListSortingStrategy}>
              {orderedDomains.map((d) => (
                <SortableDomainRow
                  key={d.id}
                  domain={d}
                  isActive={d.id === activeDomain?.id}
                  expanded={expandedDomainIds.has(d.id)}
                  activeView={activeView}
                  onOpen={() => {
                    setActiveDomainId(d.id);
                    onNavigate({ objectId: null });
                    onViewChange('domain-overview');
                  }}
                  onToggle={() => setExpandedDomainIds(prev => {
                    const next = new Set(prev);
                    if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                    return next;
                  })}
                  onOpenSettings={() => setSettingsDomain(d)}
                  onSelectExecItem={(viewId) => {
                    if (d.id !== activeDomain?.id) setActiveDomainId(d.id);
                    onNavigate({ objectId: null });
                    onViewChange(viewId);
                  }}
                />
              ))}
            </SortableContext>

          {/* Guest Domains — ones you were invited to individually (a domain
              member but NOT a member of their ActivitySpace). Listed inline with
              the active Space's Domains; a Domain invite never exposes the rest
              of a Space. */}
          {guestDomains.map(d => <DomainNavigationRow key={d.id} name={d.name} mark={<DomainMark domain={d} size={16} />}
            active={d.id === activeDomain?.id} expanded={expandedDomainIds.has(d.id)} activeView={activeView}
            onOpen={() => { setActiveDomainId(d.id); onNavigate({ objectId: null }); onViewChange('domain-overview'); }}
            onToggle={() => setExpandedDomainIds(prev => {
              const next = new Set(prev);
              if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
              return next;
            })}
            onSelect={view => { setActiveDomainId(d.id); onNavigate({ objectId: null }); onViewChange(view); }}
          />)}

          </>
          )}

          {/* ── Notebook mode ── the notebook list lives here; the main pane
              opens the chosen notebook. */}
          {railMode === 'notebook' && (
            <NotebookSidebar
              activeFolderId={navigation.noteFolderId ?? null}
              onNavigate={onNavigate}
              onViewChange={onViewChange}
            />
          )}
          {/* ── Table mode ── the table list lives here; the main pane opens
              the chosen table. */}
          {railMode === 'tables' && (
            <TableSidebar
              activeTableId={navigation.tableId ?? null}
              onNavigate={onNavigate}
              onViewChange={onViewChange}
            />
          )}
          {/* ── Workload / Team modes ── each a single full surface in the
              main pane, so the sidebar just names the mode. */}
          {railMode === 'workload' && <SidebarModeLabel label="Workload" />}
          {railMode === 'calendar' && <SidebarModeLabel label="Calendar" />}
          {railMode === 'team' && <SidebarModeLabel label="Team" />}
          {(railMode === 'crm' || railMode === 'scm') && <OperationsNavigation sidebar kind={railMode}
            queue={operationsQueue(navigation, railMode)} onSelect={queue => onNavigate(operationsQueueRoute(railMode, queue))} />}
          </>
          )}
        </nav>

        {!collapsed && (
          <div
            onPointerDown={startResize}
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-border/40 active:bg-border/60"
            title="Drag to resize"
          />
        )}
      </div>

      {/* Create menu popup — context-aware. Note mode lists File / Folder
          (driven through useNotes here); everything else keeps
          the original Domain / Object / Note menu. */}
      {createMenuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCreateMenuOpen(false)} />
          <div
            ref={createMenuRef}
            className="fixed w-52 bg-popover border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden"
            style={{ top: createMenuPos.top, left: createMenuPos.left }}
          >
            {activeView === 'note' ? (
              <CreateNoteMenuItems
                onClose={() => setCreateMenuOpen(false)}
                onNavigate={onNavigate}
              />
            ) : (
              <>
                <CreateMenuItem
                  icon={<DomainIcon size={16} />}
                  label="Domain"
                  desc="Top-level container"
                  onClick={() => { setCreateMenuOpen(false); onCreateNew?.('domain'); }}
                />
                <CreateMenuItem
                  icon={<ObjectIcon size={14} />}
                  label="Object"
                  desc="Mid-level structural unit"
                  onClick={() => { setCreateMenuOpen(false); onCreateNew?.('object'); }}
                />
                <CreateMenuItem
                  icon={<FileText size={14} />}
                  label="Note"
                  desc="A new note"
                  onClick={() => { setCreateMenuOpen(false); onCreateNew?.('note'); }}
                />
              </>
            )}
          </div>
        </>
      )}

      {settingsDomain && (
        <DomainSettingsModal
          domain={settingsDomain}
          onClose={() => setSettingsDomain(null)}
          onUpdated={(domain) => {
            setSettingsDomain(domain);
            void refetchDomains();
          }}
        />
      )}

      <DragOverlay dropAnimation={null}>
        {draggingDomain && (
          <div className="flex items-center gap-2.5 h-8 px-2.5 bg-sidebar-accent rounded-md shadow-xl shadow-black/30 scale-[1.03] cursor-grabbing">
            <DomainMark domain={draggingDomain} size={16} />
            <span className="text-[12px] font-semibold text-foreground">{draggingDomain.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// A draggable Domain row in the Execution section. Whole row is the drag
// handle (PointerSensor's 4px activation distance keeps a plain click as a
// click). Reordering is persisted on drag end by the parent's handleDragEnd.
function SortableDomainRow({
  domain: d,
  isActive,
  expanded,
  activeView,
  onOpen,
  onToggle,
  onOpenSettings,
  onSelectExecItem,
}: {
  domain: Domain;
  isActive: boolean;
  expanded: boolean;
  activeView: string;
  onOpen: () => void;
  onToggle: () => void;
  onOpenSettings: () => void;
  onSelectExecItem: (viewId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: d.id,
    data: { type: 'domain' },
    // Snappier-but-smooth slide as neighbours shift out of the way.
    transition: { duration: 180, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // The lifted copy lives in the DragOverlay; collapse the source to a clean
    // gap so neighbours have a clear slot to slide into.
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group/domain relative"
    >
      <DomainNavigationRow name={d.name} mark={<DomainMark domain={d} size={16} />}
        active={isActive} expanded={expanded} activeView={activeView}
        onOpen={onOpen} onToggle={onToggle} onSelect={onSelectExecItem} onSettings={onOpenSettings}
        dragProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

function DomainMark({ domain, size = 15 }: { domain: Domain; size?: number }) {
  // Domain is the size reference; the other sidebar glyphs are sized up to
  // match this concept icon. An uploaded image replaces the chip entirely
  // (it's already a complete mark); an emoji or the bare 3-layer glyph sits
  // inside a color chip when the Domain has a color, or shows bare otherwise.
  if (domain.icon && !isEmojiIcon(domain.icon)) {
    return (
      // A Domain icon is whatever file its owner uploaded. Routing it through
      // next/image would put every one of them through the deployment's image
      // optimizer, which is a billed service and a decision that is not this
      // component's to make. Same call as the avatar in Profile settings.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={domain.icon}
        alt=""
        className="rounded object-cover flex-shrink-0"
        style={{ width: size + 2, height: size + 2 }}
      />
    );
  }
  const inner = domain.icon ? (
    <span style={{ fontSize: Math.max(10, size - 4), lineHeight: 1 }}>{domain.icon}</span>
  ) : (
    <DomainIcon size={Math.max(12, size - 2)} />
  );
  if (!domain.color) return domain.icon ? inner : <DomainIcon size={size} />;
  return (
    <span
      className="rounded flex items-center justify-center text-white flex-shrink-0"
      style={{ width: size + 2, height: size + 2, backgroundColor: domain.color }}
    >
      {inner}
    </span>
  );
}

function DomainSettingsModal({
  domain,
  onClose,
  onUpdated,
}: {
  domain: Domain;
  onClose: () => void;
  onUpdated: (domain: Domain) => void;
}) {
  const [tab, setTab] = useState<'general' | 'members' | 'agent'>('general');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6">
      <div className="flex flex-col w-full max-w-3xl max-h-[90vh] sm:max-h-[86vh] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <DomainMark domain={domain} size={38} />
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold text-foreground">
                {domain.name}
              </h2>
              <p className="text-[12px] text-muted-foreground">Domain settings</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Fixed height (not min-height) on the desktop two-column layout —
            General and Members carry very different amounts of content, and
            a min-height let the whole modal resize under the viewer's cursor
            when switching tabs. Each pane scrolls its own overflow instead. */}
        <div className="flex min-h-0 flex-col sm:flex-row sm:h-[480px] overflow-hidden">
          <aside className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r border-border p-3 flex flex-wrap sm:block gap-2">
            <SettingsTabButton
              active={tab === 'general'}
              icon={<Settings size={15} />}
              title="General"
              description="Name and privacy"
              onClick={() => setTab('general')}
            />
            <SettingsTabButton
              active={tab === 'members'}
              icon={<Users size={15} />}
              title="Members"
              description="Manage team members"
              onClick={() => setTab('members')}
            />
            <SettingsTabButton
              active={tab === 'agent'}
              icon={<Bot size={15} />}
              title="AI agent"
              description="Execution settings"
              onClick={() => setTab('agent')}
            />
          </aside>
          <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
            {tab === 'general' ? (
              <DomainGeneralSettings domain={domain} onUpdated={onUpdated} />
            ) : tab === 'agent' ? (
              <DomainAgentSettings key={domain.id} domain={domain} />
            ) : (
              <TeamSettings domainId={domain.id} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function SettingsTabButton({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/80 text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{description}</span>
      </span>
      <ChevronRight size={13} className="shrink-0 text-muted-foreground/70" />
    </button>
  );
}

function DomainGeneralSettings({
  domain,
  onUpdated,
}: {
  domain: Domain;
  onUpdated: (domain: Domain) => void;
}) {
  const [name, setName] = useState(domain.name);
  const [identifier, setIdentifier] = useState(domain.identifier ?? '');
  const [privacy, setPrivacy] = useState<DomainPrivacy>(domain.privacy ?? 'workspace');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyed on domain.id, not the domain object itself: onUpdated hands a new
  // `domain` object back down as this same prop after every save, and
  // resyncing on object identity would discard edits still in the fields.
  const [seededFor, setSeededFor] = useState(domain.id);
  if (seededFor !== domain.id) {
    setSeededFor(domain.id);
    setName(domain.name);
    setIdentifier(domain.identifier ?? '');
    setPrivacy(domain.privacy ?? 'workspace');
  }

  const canSave =
    name.trim() !== domain.name ||
    identifier.trim() !== (domain.identifier ?? '') ||
    privacy !== (domain.privacy ?? 'workspace');

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateDomain(domain.id, {
        name: name.trim() || domain.name,
        identifier: identifier.trim() || null,
        privacy,
      });
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update Domain');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="mb-5">
        <h3 className="text-[15px] font-semibold text-foreground">General</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Configure this Domain&apos;s name, identifier, and access mode.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-foreground">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md bg-muted/40 px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:bg-[var(--accent-subtle)]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-foreground">Identifier</label>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="e.g. ALCON"
            className="w-full rounded-md bg-muted/40 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:bg-[var(--accent-subtle)]"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-foreground">Privacy</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['workspace', 'Workspace'],
              ['private', 'Private'],
            ] as [DomainPrivacy, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPrivacy(value)}
                className={`min-w-0 truncate rounded-md px-2 py-2 text-[12px] font-semibold transition-colors sm:px-3 ${
                  privacy === value
                    ? 'bg-foreground text-background'
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
            {error}
          </div>
        )}

        <div className="flex justify-end border-t border-border pt-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Two menu items for the bottom "+ Create new" popover when in Notebook mode.
// Pulls `useNotes()` here (same shared hook). "New Notebook" seeds a full
// notebook (Folder → Section → page) via seedNotebook — identical to the
// Notebook sidebar's "+"; "New Note" drops a loose page (ensureNoteHome files
// it under a Section).
function CreateNoteMenuItems({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (nav: Partial<NavigationState>) => void;
}) {
  const { createNode, deleteNode } = useNotes();
  const createNote = async () => {
    try {
      const node = await createNode('file', 'Untitled', null);
      onNavigate({ noteId: node.id });
    } catch (e) {
      console.error('Failed to create note', e);
    } finally {
      onClose();
    }
  };
  const createNotebook = async () => {
    try {
      const { folder, page } = await seedNotebook(createNode, deleteNode);
      onNavigate({ noteFolderId: folder.id, noteId: page.id });
    } catch (e) {
      console.error('Failed to create notebook', e);
    } finally {
      onClose();
    }
  };
  return (
    <>
      <CreateMenuItem
        icon={<NavNoteIcon size={14} />}
        label="New Notebook"
        desc="A section + page, ready to write"
        onClick={createNotebook}
      />
      <CreateMenuItem
        icon={<FileText size={14} />}
        label="New Note"
        desc="A single page"
        onClick={createNote}
      />
    </>
  );
}


function CreateMenuItem({ icon, label, desc, onClick }: {
  icon: React.ReactNode; label: string; desc: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors text-left"
    >
      <span className="mt-0.5 w-4 flex items-center justify-center text-muted-foreground">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        <span className="block text-[11px] text-muted-foreground truncate">{desc}</span>
      </span>
    </button>
  );
}
