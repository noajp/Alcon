'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Domain, DomainPrivacy, ExplorerData } from '@/hooks/useSupabase';
import { moveObject, useNotifications } from '@/hooks/useSupabase';
import { Plus, ChevronRight, ChevronDown, FileText, Folder, FolderClosed, MoreHorizontal, Settings, Users, X, Check, Search, Home } from 'lucide-react';
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
import type { DragStartEvent, DragEndEvent, DragOverEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
import { DomainIcon } from '@/alcon/shared/conceptIcons';
import { useDomains, reorderDomains } from '@/hooks/useSupabase';
import { getActiveDomainId, setActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT } from '@/alcon/domain/domainsStore';
import { SpaceSwitcher } from '@/alcon/space/SpaceSwitcher';

import { NavSettingsIcon } from '@/shell/sidebar/NavIcons';
import { VIEW_REGISTRY, type ViewId } from '@/shell/viewRegistry';
import { RoomSidebarPanel } from '@/alcon/room/RoomSidebarPanel';
import { ChatSidebarPanel } from '@/alcon/chat/ChatSidebarPanel';
import { SettingsSidebarPanel } from '@/alcon/settings/SettingsSidebarPanel';
import { useNotes } from '@/hooks/useNotesDb';
import { TeamSettings } from '@/alcon/settings/TeamSettings';
import type { DragItem, DropTargetInfo } from '@/shell/sidebar/ObjectTree';
import type { NavigationState } from '@/types/navigation';

export type { NavigationState };

interface AppSidebarProps {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  activeView: string;
  onViewChange: (view: string) => void;
  explorerData: ExplorerData;
  onRefresh?: () => void;
  width: number;
  collapsed: boolean;
  overlay: boolean;
  onCreateNew?: (type: 'domain' | 'object' | 'note') => void;
  onSearch?: () => void;
}

// Sidebar nav items derive their label + icon from the shared view registry
// so there is one source of truth for activity-view metadata. Each id below
// is guaranteed to have an icon in the registry. There is no mode-switching
// rail — every section is always visible, stacked top to bottom (Home items
// → Action → Materialization → Execution → Sustainment), Linear-workspace style.
const navItem = (id: ViewId) => ({ id, icon: VIEW_REGISTRY[id].icon!, label: VIEW_REGISTRY[id].label });

// Home — the user-scoped surfaces, pinned above the layer sections (no
// section header of their own). Inbox is the notifications feed; Calendar
// and My Elements show the signed-in user's Elements; Note is the personal
// document tree.
const HOME_ITEMS = [navItem('inbox'), navItem('calendar'), navItem('note'), navItem('my-elements')];
// Action — mid/long-term direction. Chat / Talk are parked for now.
const ACTION_ITEMS = [navItem('strategy')];
// Materialization — turning conversation into durable artifacts.
const MATERIALIZATION_ITEMS = [navItem('approach'), navItem('planning'), navItem('phase')];
// Execution — the per-Domain D/O/E surfaces, shown under each Domain row.
const EXECUTION_ITEMS = [navItem('projects'), navItem('mytasks')];
// Sustainment — standalone utilities, below Execution.
const SUSTAINMENT_ITEMS = [navItem('tables'), navItem('team')];

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_WIDTH_KEY = 'alcon:sidebarWidth';
const DOMAIN_COLOR_SWATCHES = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#71717a'];

// Collapsible header for a permanent layer section (Action / Materialization
// / Execution). Every layer is always mounted — this only toggles whether its
// rows are visible, mirroring Linear's collapsible "Workspace" groups.
function SidebarSectionHeader({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1 px-2 h-6 mt-3 text-[11px] font-semibold tracking-wide text-muted-foreground/60 hover:text-foreground"
    >
      <span>{label}</span>
      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
    </button>
  );
}

export function AppSidebar({
  navigation,
  onNavigate,
  activeView,
  onViewChange,
  explorerData,
  onRefresh,
  collapsed,
  overlay,
  onCreateNew,
  onSearch,
}: AppSidebarProps) {
  const { user } = useAuthContext();
  const { unreadCount } = useNotifications(user?.id ?? null);
  const { data: domains, guestDomains, refetch: refetchDomains } = useDomains();
  // Locally-mirrored Domain order so a drag-reorder applies instantly on drop.
  // Without this the list would snap back to the server order for the frame
  // between releasing and refetchDomains() resolving — a visible flicker.
  // Kept in sync with the hook's data whenever it changes.
  const [orderedDomains, setOrderedDomains] = useState<Domain[]>(domains);
  useEffect(() => { setOrderedDomains(domains); }, [domains]);
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
  // Every section (Action / Materialization / Execution / Sustainment) is always
  // mounted now that there's no ModeRail to switch between them — this only
  // tracks which are expanded, all open by default.
  const [openLayerSections, setOpenLayerSections] = useState<Set<'action' | 'materialization' | 'execution' | 'sustainment'>>(
    () => new Set(['action', 'materialization', 'execution', 'sustainment'])
  );
  const toggleLayerSection = (key: 'action' | 'materialization' | 'execution' | 'sustainment') =>
    setOpenLayerSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetInfo>(null);
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

  const { objects } = explorerData;
  const activeDomain = [...domains, ...guestDomains].find((d) => d.id === activeDomainId) ?? domains[0];

  useEffect(() => {
    if (!settingsDomain) return;
    const fresh = domains.find((d) => d.id === settingsDomain.id);
    if (fresh && fresh !== settingsDomain) setSettingsDomain(fresh);
  }, [domains, settingsDomain]);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setActiveDomainIdState(id);
    };
    window.addEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
  }, []);

  // First-time / signed-in-fresh users start on the Individual Domain
  // (it's sorted to the top of `domains` by useDomains).
  useEffect(() => {
    if (activeDomainId) return;
    const first = domains[0];
    if (!first) return;
    setActiveDomainIdState(first.id);
    setActiveDomainId(first.id);
    setExpandedDomainIds((prev) => {
      if (prev.has(first.id)) return prev;
      const next = new Set(prev);
      next.add(first.id);
      return next;
    });
  }, [domains, activeDomainId]);

  // When the active Domain changes (e.g. via DomainsView or another tab),
  // expand it additively — never collapse the rows the user already opened.
  useEffect(() => {
    if (!activeDomainId) return;
    setExpandedDomainIds((prev) => {
      if (prev.has(activeDomainId)) return prev;
      const next = new Set(prev);
      next.add(activeDomainId);
      return next;
    });
  }, [activeDomainId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const isDescendant = (objs: AlconObjectWithChildren[], parentId: string, targetId: string): boolean => {
    const findObj = (items: AlconObjectWithChildren[], id: string): AlconObjectWithChildren | null => {
      for (const obj of items) {
        if (obj.id === id) return obj;
        if (obj.children) { const f = findObj(obj.children, id); if (f) return f; }
      }
      return null;
    };
    const parent = findObj(objs, parentId);
    if (!parent?.children) return false;
    const check = (children: AlconObjectWithChildren[]): boolean => {
      for (const child of children) {
        if (child.id === targetId) return true;
        if (child.children && check(child.children)) return true;
      }
      return false;
    };
    return check(parent.children);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { type?: string } | undefined;
    if (data?.type === 'domain') {
      setDraggingDomain(orderedDomains.find((d) => d.id === event.active.id) ?? null);
      return;
    }
    setActiveItem(data as DragItem);
  };
  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    // Domain reordering is handled by SortableContext on drag end — skip the
    // object drop-target tracking entirely for domain drags.
    if ((active.data.current as { type?: string } | undefined)?.type === 'domain') return;
    if (!over || !active.rect.current.translated) { setDropTarget(null); return; }
    const overId = over.id as string;
    const dragData = active.data.current as DragItem;
    if (overId === 'drop-root') { setDropTarget({ id: overId, position: 'inside' }); return; }
    if (overId.startsWith('drop-object-')) {
      const targetId = overId.replace('drop-object-', '');
      if (dragData.id === targetId || isDescendant(objects, dragData.id, targetId)) { setDropTarget(null); return; }
      setDropTarget({ id: overId, position: 'inside' });
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
    // ── Object move branch ──
    const cur = dropTarget;
    setActiveItem(null);
    setDropTarget(null);
    if (!cur) return;
    const dragData = active.data.current as DragItem;
    const { id: dropId } = cur;
    const isOnObj = dropId.startsWith('drop-object-');
    const isOnRoot = dropId === 'drop-root';
    const targetObjId = isOnObj ? dropId.replace('drop-object-', '') : null;
    const newParentId = isOnRoot ? null : (isOnObj ? targetObjId : null);
    if (newParentId !== dragData.parentObjectId) {
      try { await moveObject(dragData.id, newParentId, 0); onRefresh?.(); } catch (err) { console.error('Failed to move object:', err); }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveItem(null); setDropTarget(null); setDraggingDomain(null); }}
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
          {/* Top row: the active Space + quick actions. No mode rail anymore —
              every section below is always visible, so the only global
              actions left up here are search (Discover) and create-new. */}
          <div className="flex items-center gap-1 py-1.5">
            <div className="min-w-0 flex-1">
              <SpaceSwitcher onSettings={() => onViewChange('settings')} />
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

          {/* ── Home ── (pinned above the layer sections, no header of its own) */}
          <div className="mb-1 mt-1">
            {HOME_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              const showBadge = item.id === 'inbox' && unreadCount > 0;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onViewChange(item.id);
                    // Note has no sidebar tree — folder browsing happens in
                    // the main surface's Finder-style grid, so every click
                    // lands back there.
                    if (item.id === 'note') onNavigate({ noteFolderId: null, noteId: null });
                  }}
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

          {/* ── Action ── (Strategy leads, then the live channels) */}
          <SidebarSectionHeader
            label="Action"
            open={openLayerSections.has('action')}
            onToggle={() => toggleLayerSection('action')}
          />
          {openLayerSections.has('action') && ACTION_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <div key={item.id}>
                <button
                  onClick={() => onViewChange(item.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
                    isActive
                      ? 'bg-sidebar-accent text-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                  }`}
                >
                  <Icon size={16} />
                  <span className="flex-1 text-left">{item.label}</span>
                </button>
                {item.id === 'chat' && isActive && (
                  <div className="mt-0.5 pl-2">
                    <ChatSidebarPanel
                      selectedConversationId={navigation.chatConversationId ?? null}
                      onSelectConversation={(id) => onNavigate({ chatConversationId: id })}
                    />
                  </div>
                )}
                {item.id === 'room' && isActive && (
                  <div className="mt-0.5 pl-2">
                    <RoomSidebarPanel
                      domainId={activeDomainId || null}
                      selectedChannelId={navigation.roomChannelId ?? null}
                      onSelectChannel={(id) => onNavigate({ roomChannelId: id })}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Materialization ── */}
          <SidebarSectionHeader
            label="Materialization"
            open={openLayerSections.has('materialization')}
            onToggle={() => toggleLayerSection('materialization')}
          />
          {openLayerSections.has('materialization') && MATERIALIZATION_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
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
              </button>
            );
          })}

          {/* ── Execution ── (Domain tree + Data + Reference) */}
          <SidebarSectionHeader
            label="Execution"
            open={openLayerSections.has('execution')}
            onToggle={() => toggleLayerSection('execution')}
          />
          {openLayerSections.has('execution') && (
          <>
          <div className="mt-1" />

          {/* All domains — each row sets itself active AND toggles its own expansion.
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
                  onActivateOrToggle={() => {
                    if (d.id !== activeDomain?.id) {
                      setActiveDomainId(d.id);
                      setExpandedDomainIds((prev) => {
                        if (prev.has(d.id)) return prev;
                        const next = new Set(prev);
                        next.add(d.id);
                        return next;
                      });
                    } else {
                      setExpandedDomainIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        return next;
                      });
                    }
                  }}
                  onOpenSettings={() => setSettingsDomain(d)}
                  onSelectExecItem={(viewId) => {
                    if (d.id !== activeDomain?.id) setActiveDomainId(d.id);
                    onViewChange(viewId);
                  }}
                />
              ))}
            </SortableContext>

          {/* Guest Domains — ones you were invited to individually (a domain
              member but NOT a member of their ActivitySpace). Listed inline with
              the active Space's Domains; a Domain invite never exposes the rest
              of a Space. */}
          {guestDomains.map((d) => {
                const isActive = d.id === activeDomain?.id;
                const expanded = expandedDomainIds.has(d.id);
                return (
                  <div key={d.id} className="group/domain relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (!isActive) {
                          setActiveDomainId(d.id);
                          setExpandedDomainIds((prev) => {
                            if (prev.has(d.id)) return prev;
                            const next = new Set(prev);
                            next.add(d.id);
                            return next;
                          });
                        } else {
                          setExpandedDomainIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(d.id)) next.delete(d.id);
                            else next.add(d.id);
                            return next;
                          });
                        }
                      }}
                      className="w-full flex min-w-0 items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                      title={d.name}
                    >
                      <DomainMark domain={d} size={16} />
                      <span className="min-w-0 text-left truncate">{d.name}</span>
                      <span className="flex-shrink-0 text-muted-foreground/70">
                        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </span>
                      <span className="flex-1" />
                    </button>
                    {expanded && (
                      <div className="mt-0.5">
                        {EXECUTION_ITEMS.map((item) => {
                          const Icon = item.icon;
                          const itemActive = isActive && activeView === item.id;
                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                if (!isActive) setActiveDomainId(d.id);
                                onViewChange(item.id);
                              }}
                              className={`w-full flex items-center gap-2.5 pl-[34px] pr-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
                                itemActive
                                  ? 'bg-sidebar-accent text-foreground'
                                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                              }`}
                            >
                              <Icon size={16} />
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

          </>
          )}

          {/* ── Sustainment ── (Note) */}
          <SidebarSectionHeader
            label="Sustainment"
            open={openLayerSections.has('sustainment')}
            onToggle={() => toggleLayerSection('sustainment')}
          />
          {openLayerSections.has('sustainment') && SUSTAINMENT_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
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
              </button>
            );
          })}
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
          (driven through useNotes here); Chat mode dispatches a window
          event the ChatSidebarPanel listens for; everything else keeps
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
                onSelectFile={(id) => onNavigate({ noteId: id })}
              />
            ) : activeView === 'chat' ? (
              <CreateMenuItem
                icon={<FileText size={14} />}
                label="New conversation"
                desc="Direct or group chat"
                onClick={() => {
                  setCreateMenuOpen(false);
                  window.dispatchEvent(new CustomEvent('alcon:chat-new-conversation'));
                }}
              />
            ) : activeView === 'room' ? (
              <>
                <CreateMenuItem
                  icon={<FileText size={14} />}
                  label="Text channel"
                  desc="Threaded messages"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    window.dispatchEvent(new CustomEvent('alcon:room-new-channel', { detail: { kind: 'text' } }));
                  }}
                />
                <CreateMenuItem
                  icon={<Users size={14} />}
                  label="Voice channel"
                  desc="Drop-in voice room"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    window.dispatchEvent(new CustomEvent('alcon:room-new-channel', { detail: { kind: 'voice' } }));
                  }}
                />
              </>
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
        {activeItem && (
          <div className="flex items-center h-[22px] px-2 bg-card border border-primary rounded shadow-lg opacity-90">
            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-1">
              <ObjectIcon size={14} />
            </div>
            <span className="text-[12px] text-foreground/80">{activeItem.name}</span>
          </div>
        )}
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
  onActivateOrToggle,
  onOpenSettings,
  onSelectExecItem,
}: {
  domain: Domain;
  isActive: boolean;
  expanded: boolean;
  activeView: string;
  onActivateOrToggle: () => void;
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
      <div className="w-full flex items-center rounded-md transition-colors duration-100 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground">
        <button
          type="button"
          onClick={onActivateOrToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 h-8 text-[12px] font-semibold cursor-pointer"
          title={d.name}
          {...attributes}
          {...listeners}
        >
          <DomainMark domain={d} size={16} />
          <span className="min-w-0 text-left truncate">{d.name}</span>
          <span className="flex-shrink-0 text-muted-foreground/70">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="flex-1" />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
          className={`mr-1 w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-opacity ${
            isActive ? 'opacity-100' : 'opacity-0 group-hover/domain:opacity-100'
          }`}
          aria-label={`${d.name} settings`}
          title="Domain settings"
        >
          <MoreHorizontal size={12} />
        </button>
      </div>

      {expanded && (
        <div className="mt-0.5">
          {EXECUTION_ITEMS.map((item) => {
            const Icon = item.icon;
            const itemActive = isActive && activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectExecItem(item.id)}
                className={`w-full flex items-center gap-2.5 pl-[34px] pr-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
                  itemActive
                    ? 'bg-sidebar-accent text-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DomainMark({ domain, size = 15 }: { domain: Domain; size?: number }) {
  // Domain is the size reference; the other sidebar glyphs are sized up to
  // match this concept icon. Uncolored Domains show the bare 3-layer glyph;
  // colored ones tuck it into a rounded color chip.
  if (!domain.color) return <DomainIcon size={size} />;
  return (
    <span
      className="rounded flex items-center justify-center text-white flex-shrink-0"
      style={{ width: size + 2, height: size + 2, backgroundColor: domain.color }}
    >
      <DomainIcon size={Math.max(12, size - 2)} />
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
  const [tab, setTab] = useState<'general' | 'members'>('general');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 sm:p-6">
      <div className="w-full max-w-3xl max-h-[90vh] sm:max-h-[86vh] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
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

        <div className="flex flex-col sm:flex-row sm:min-h-[480px] overflow-hidden">
          <aside className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r border-border p-3 flex sm:block gap-2">
            <SettingsTabButton
              active={tab === 'general'}
              icon={<Settings size={15} />}
              title="General"
              description="Name, icon, and privacy"
              onClick={() => setTab('general')}
            />
            <SettingsTabButton
              active={tab === 'members'}
              icon={<Users size={15} />}
              title="Members"
              description="Manage team members"
              onClick={() => setTab('members')}
            />
          </aside>
          <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
            {tab === 'general' ? (
              <DomainGeneralSettings domain={domain} onUpdated={onUpdated} />
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
  const [color, setColor] = useState(domain.color ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(domain.name);
    setIdentifier(domain.identifier ?? '');
    setPrivacy(domain.privacy ?? 'workspace');
    setColor(domain.color ?? '');
  }, [domain]);

  const canSave =
    name.trim() !== domain.name ||
    identifier.trim() !== (domain.identifier ?? '') ||
    privacy !== (domain.privacy ?? 'workspace') ||
    color !== (domain.color ?? '');

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateDomain(domain.id, {
        name: name.trim() || domain.name,
        identifier: identifier.trim() || null,
        privacy,
        color: color || null,
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
          Configure this Domain's name, icon color, identifier, and access mode.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-foreground">Icon</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setColor('')}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                color === '' ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60'
              }`}
              title="Default"
            >
              <DomainIcon size={16} />
            </button>
            {DOMAIN_COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColor(swatch)}
                className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-transform hover:scale-105 ${
                  color === swatch ? 'border-foreground' : 'border-border/60'
                }`}
                style={{ backgroundColor: swatch }}
                title={swatch}
              >
                {color === swatch && <Check size={14} className="text-white" />}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-foreground">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-foreground/40"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-foreground">Identifier</label>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="e.g. ALCON"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/40"
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
                className={`min-w-0 truncate rounded-md border px-2 py-2 text-[12px] font-semibold transition-colors sm:px-3 ${
                  privacy === value
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground'
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

// Two menu items for the bottom "+ Create new" popover when the user is
// in Note mode. Pulls `useNotes()` here (same shared hook) so creating
// a file selects it via the navigation noteId; a new folder shows up in
// the main surface's folder grid.
function CreateNoteMenuItems({
  onClose,
  onSelectFile,
}: {
  onClose: () => void;
  onSelectFile: (id: string) => void;
}) {
  const { createNode } = useNotes();
  const create = async (type: 'folder' | 'file') => {
    try {
      const defaultName = type === 'folder' ? 'New Folder' : 'Untitled';
      const node = await createNode(type, defaultName, null);
      if (type === 'file') onSelectFile(node.id);
    } catch (e) {
      console.error('Failed to create note', e);
    } finally {
      onClose();
    }
  };
  return (
    <>
      <CreateMenuItem
        icon={<FileText size={14} />}
        label="New Note"
        desc="A note inside a folder"
        onClick={() => create('file')}
      />
      <CreateMenuItem
        icon={<Folder size={14} />}
        label="New Folder"
        desc="Group notes together"
        onClick={() => create('folder')}
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
