'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { Domain, ExplorerData } from '@/hooks/useSupabase';
import { moveObject, useNotifications } from '@/hooks/useSupabase';
import { Plus, ChevronRight, ChevronDown, FileText, Folder, Library, MoreHorizontal, Settings, Users, X, Check, BookOpen } from 'lucide-react';
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
import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
import { useDomains } from '@/hooks/useSupabase';
import { getActiveDomainId, setActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT } from '@/alcon/domain/domainsStore';

import { NavDomainIcon, NavTableIcon } from '@/shell/sidebar/NavIcons';
import { VIEW_REGISTRY, type ViewId } from '@/shell/viewRegistry';
import { RoomSidebarPanel } from '@/alcon/room/RoomSidebarPanel';
import { ChatSidebarPanel } from '@/alcon/chat/ChatSidebarPanel';
import { SettingsSidebarPanel } from '@/alcon/settings/SettingsSidebarPanel';
import { NotesSidebar } from '@/alcon/brief/NotesSidebar';
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
}

// "My" section (above Action Space) — the user-scoped surfaces that
// replaced the old fixed Individual Domain. My Elements lists Elements
// the signed-in user owns or is assigned to; Inbox is the notifications
// feed.
// Sidebar nav items derive their label + icon from the shared view
// registry so there is one source of truth for activity-view metadata.
// Each id below is guaranteed to have an icon in the registry.
const navItem = (id: ViewId) => ({ id, icon: VIEW_REGISTRY[id].icon!, label: VIEW_REGISTRY[id].label });

const MY_ITEMS = [navItem('my-elements'), navItem('inbox')];
const ACTION_ITEMS = [navItem('strategy'), navItem('diagram')];
const EXECUTION_ITEMS = [navItem('projects'), navItem('mytasks')];

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_WIDTH_KEY = 'alcon:sidebarWidth';
const DOMAIN_COLOR_SWATCHES = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#71717a'];

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
}: AppSidebarProps) {
  const { user } = useAuthContext();
  const { unreadCount } = useNotifications(user?.id ?? null);
  const { data: domains, refetch: refetchDomains } = useDomains();
  const [activeDomainId, setActiveDomainIdState] = useState<string>(
    () => getActiveDomainId() ?? domains[0]?.id ?? ''
  );
  // Each Domain has its own expanded state — opening one no longer collapses the others.
  const [expandedDomainIds, setExpandedDomainIds] = useState<Set<string>>(
    () => new Set(activeDomainId ? [activeDomainId] : [])
  );
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState({ top: 0, left: 0 });
  const [actionSpaceOpen, setActionSpaceOpen] = useState(true);
  const [executionSpaceOpen, setExecutionSpaceOpen] = useState(true);
  const [settingsDomain, setSettingsDomain] = useState<Domain | null>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetInfo>(null);
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
  const activeDomain = domains.find((d) => d.id === activeDomainId) ?? domains[0];

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

  const handleDragStart = (event: DragStartEvent) => setActiveItem(event.active.data.current as DragItem);
  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
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
    const { active } = event;
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
      onDragCancel={() => { setActiveItem(null); setDropTarget(null); }}
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
        <nav className="flex-1 overflow-y-auto pb-3 px-2">

          {/* Mode strip moved to the always-visible ModeRail (left of the sidebar). */}

          {activeView === 'settings' ? (
            <SettingsSidebarPanel />
          ) : activeView === 'room' ? (
            <RoomSidebarPanel
              domainId={activeDomainId || null}
              selectedChannelId={navigation.roomChannelId ?? null}
              onSelectChannel={(id) => onNavigate({ roomChannelId: id })}
            />
          ) : activeView === 'chat' ? (
            <ChatSidebarPanel
              selectedConversationId={navigation.chatConversationId ?? null}
              onSelectConversation={(id) => onNavigate({ chatConversationId: id })}
            />
          ) : activeView === 'note' ? (
            <NoteSidebarPanel
              selectedFolderId={navigation.noteFolderId ?? null}
              onSelectFolder={(id) => onNavigate({ noteFolderId: id })}
            />
          ) : (
          <>
          {/* Activity Space — the sidebar's top title (gray, non-collapsible).
              The personal scope (Elements + inbox) always shows beneath it. */}
          <SidebarTitle label="Activity Space" />
          <div className="mb-3">
            {MY_ITEMS.map((item) => {
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
                  <Icon size={15} />
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

          <SectionToggle
            label="Action Space"
            open={actionSpaceOpen}
            onToggle={() => setActionSpaceOpen((v) => !v)}
            className="mt-1"
          />
          {actionSpaceOpen && (
            <div className="mb-4">
              {ACTION_ITEMS.map((item) => {
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
                  <Icon size={15} />
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
          )}

          {/* ── Execution ── */}
          <div className="px-2.5 mb-1 flex items-center justify-between group/exec">
            <button
              type="button"
              onClick={() => setExecutionSpaceOpen((v) => !v)}
              className="group/sec relative flex min-w-0 items-center text-[11px] font-bold text-muted-foreground/60 hover:text-muted-foreground select-none"
            >
              {/* Chevron overlaid on the left so the label's x doesn't shift. */}
              <span
                aria-hidden
                className="absolute left-0 top-1/2 -translate-y-1/2 -ml-3 w-2.5 flex items-center justify-end"
              >
                {executionSpaceOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </span>
              <span>Execution Space</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onCreateNew?.('domain'); }}
              className="opacity-0 group-hover/exec:opacity-100 w-4 h-4 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-accent transition-all"
              title="Create Domain"
            >
              <Plus size={12} />
            </button>
          </div>

          {/* All domains — each row sets itself active AND toggles its own expansion.
              Opening one does NOT collapse the others (multiple expanded at a time).
              The fixed "Individual Domain" is sorted to the top by useDomains and gets a
              fixed person icon + "Individual Domain" label so it reads as locked / non-editable. */}
          {executionSpaceOpen && domains.map((d) => {
            const isActive = d.id === activeDomain?.id;
            const expanded = expandedDomainIds.has(d.id);
            return (
              <div key={d.id} className="group/domain relative">
                <div
                  className="w-full flex items-center rounded-md transition-colors duration-100 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                >
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
                      }}}
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 h-8 text-[12px] font-semibold"
                    title={d.name}
                  >
                    <DomainMark domain={d} size={15} />
                    <span className="flex-1 text-left truncate">{d.name}</span>
                    <span className="flex-shrink-0 text-muted-foreground/70">
                      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSettingsDomain(d); }}
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
                      // Highlight only when this Domain owns the active view —
                      // otherwise the same item under every expanded Domain
                      // would highlight in sync.
                      const itemActive = isActive && activeView === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            // Clicking an item under a non-active Domain
                            // switches the active Domain to this one.
                            if (!isActive) setActiveDomainId(d.id);
                            onViewChange(item.id);
                          }}
                          className={`w-full flex items-center gap-2.5 pl-[34px] pr-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
                            itemActive
                              ? 'bg-sidebar-accent text-foreground'
                              : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                          }`}
                        >
                          <Icon size={15} />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Data ── */}
          {/* User-managed data tables (Notion DB / Airtable style), independent
              of D/O/E. First entry is a single "Table" row; future tables (one
              per user-defined DB) will list under this section header. */}
          <div className="px-2 mb-1 mt-4">
            <span className="text-[11px] font-medium text-muted-foreground/60 select-none">
              Data
            </span>
          </div>
          <button
            onClick={() => onViewChange('tables')}
            className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
              activeView === 'tables'
                ? 'bg-sidebar-accent text-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
            }`}
          >
            <NavTableIcon size={15} />
            <span className="flex-1 text-left">Table</span>
          </button>

          {/* ── Reference ── */}
          {/* Placeholder section — future home for completed Elements
              and archived Domains. Single Reference row for now; the
              actual surface lives under alcon/reference/. */}
          <div className="px-2 mb-1 mt-4">
            <span className="text-[11px] font-medium text-muted-foreground/60 select-none">
              Reference
            </span>
          </div>
          <button
            onClick={() => onViewChange('reference')}
            className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors duration-100 ${
              activeView === 'reference'
                ? 'bg-sidebar-accent text-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
            }`}
          >
            <Library size={15} />
            <span className="flex-1 text-left">Reference</span>
          </button>
          </>
          )}
        </nav>

        {/* Bottom actions */}
        <div className="px-2 pb-2 pt-1 flex-shrink-0">
          <button
            ref={createBtnRef}
            onClick={() => {
              const rect = createBtnRef.current?.getBoundingClientRect();
              if (rect) setCreateMenuPos({ top: rect.top - 130, left: rect.right + 8 });
              setCreateMenuOpen((v) => !v);
            }}
            className="w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors mb-0.5"
          >
            <Plus size={15} />
            <span>Create new</span>
          </button>
        </div>

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
                  icon={<NavDomainIcon size={17} />}
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

      <DragOverlay>
        {activeItem && (
          <div className="flex items-center h-[22px] px-2 bg-card border border-primary rounded shadow-lg opacity-90">
            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-1">
              <ObjectIcon size={14} />
            </div>
            <span className="text-[12px] text-foreground/80">{activeItem.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function SectionToggle({
  label,
  open,
  onToggle,
  className = '',
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group/sec relative w-full flex items-center px-2.5 mb-1 text-[11px] font-bold text-muted-foreground/60 hover:text-muted-foreground select-none ${className}`}
    >
      {/* Chevron is absolutely placed so it doesn't push the label right —
          always visible; the label's x stays aligned with the row icons. */}
      <span
        aria-hidden
        className="absolute left-0 top-1/2 -translate-y-1/2 w-2.5 flex items-center justify-end"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </span>
      <span>{label}</span>
    </button>
  );
}

// Top-of-sidebar title — a big, gray, non-collapsible label (no chevron).
// Fixed h-10 (≈ the WindowTabBar height) and vertically centred so the title
// lines up with the window tab, and the sidebar's first item starts at the
// same Y as the main island. Shared look with NoteSpace / ChatSpace /
// TalkSpace (all use `h-10 flex items-center px-3`).
function SidebarTitle({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div className={`flex items-center h-10 px-3 text-[16px] font-bold text-muted-foreground select-none ${className}`}>
      {label}
    </div>
  );
}

function DomainMark({ domain, size = 17 }: { domain: Domain; size?: number }) {
  if (!domain.color) return <NavDomainIcon size={size} />;
  return (
    <span
      className="rounded flex items-center justify-center text-white flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: domain.color }}
    >
      <NavDomainIcon size={Math.max(14, size - 2)} />
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6">
      <div className="w-full max-w-3xl max-h-[86vh] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
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

        <div className="flex min-h-[480px] overflow-hidden">
          <aside className="w-56 shrink-0 border-r border-border p-3">
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
          <main className="flex-1 overflow-y-auto p-6">
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
  const [privacy, setPrivacy] = useState(domain.privacy ?? 'workspace');
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
              <NavDomainIcon size={17} />
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
          <div className="grid grid-cols-3 gap-2">
            {[
              ['workspace', 'Workspace'],
              ['team', 'Team'],
              ['members', 'Members'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPrivacy(value)}
                className={`rounded-md border px-3 py-2 text-[12px] font-semibold transition-colors ${
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
// a file selects it via the navigation noteId, and creating a folder
// just lets the tree expand. Lives outside NoteSidebarPanel so AppSidebar
// can render it even while the panel itself isn't mounted (the menu has
// a 130px offset from the trigger and can momentarily render over an
// unrelated mode).
function CreateNoteMenuItems({
  onClose,
  onSelectFile,
}: {
  onClose: () => void;
  onSelectFile: (id: string) => void;
}) {
  const { createNode } = useNotes();
  const create = async (type: 'notebook' | 'folder' | 'file') => {
    try {
      const defaultName =
        type === 'notebook' ? 'Untitled notebook'
        : type === 'folder' ? 'New Folder'
        : 'Untitled';
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
        icon={<BookOpen size={14} />}
        label="New Notebook"
        desc="Top-level Notebook"
        onClick={() => create('notebook')}
      />
      <CreateMenuItem
        icon={<FileText size={14} />}
        label="New Note"
        desc="A note inside the current notebook"
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

// Note mode → render the NotesSidebar tree inline (replaces main nav).
// Pulls `useNotes()` here so the AppSidebar owns the create/delete/move
// handlers; selectedFileId is threaded through navigation.noteId so the
// matching PageView in MainContent stays in sync.
function NoteSidebarPanel({
  selectedFolderId,
  onSelectFolder,
}: {
  selectedFolderId: string | null;
  onSelectFolder: (id: string) => void;
}) {
  const { nodes, createNode, deleteNode, renameNode, setLinkedDomain } = useNotes();
  const { data: domains } = useDomains();
  // Sidebar only creates Cabinets + Folders now; file creation lives in the
  // middle pane (FilesPane in MainContent). Selecting the new folder focuses
  // it so the middle pane immediately shows its (empty) file list.
  const handleCreate = async (type: 'notebook' | 'folder' | 'file', parentId: string | null) => {
    try {
      const defaultName = type === 'notebook' ? 'Untitled notebook' : 'New Folder';
      const node = await createNode(type, defaultName, parentId);
      if (type === 'folder') onSelectFolder(node.id);
    } catch (e) { console.error('Failed to create note node', e); }
  };
  const handleDelete = async (id: string) => {
    try {
      await deleteNode(id);
    } catch (e) { console.error('Failed to delete note node', e); }
  };
  const handleRename = async (id: string, name: string) => {
    try {
      await renameNode(id, name);
    } catch (e) { console.error('Failed to rename note node', e); }
  };
  return (
    <NotesSidebar
      nodes={nodes}
      selectedFolderId={selectedFolderId}
      onSelectFolder={onSelectFolder}
      onCreateNode={handleCreate}
      onDeleteNode={handleDelete}
      onRenameNode={handleRename}
      domains={domains}
      onSetLinkedDomain={setLinkedDomain}
    />
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
