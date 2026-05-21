'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { Domain, ExplorerData } from '@/hooks/useSupabase';
import { moveObject, useNotifications } from '@/hooks/useSupabase';
import { Plus, ChevronRight, ChevronDown, FileText, Library, MoreHorizontal, Settings, Users, X, Check } from 'lucide-react';
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

import {
  NavNoteIcon,
  NavObjectsIcon,
  NavMyTasksIcon,
  NavSettingsIcon,
  NavDomainIcon,
  NavInboxIcon,
  NavStrategyIcon,
} from '@/shell/sidebar/NavIcons';
import { ModeStrip } from '@/shell/ModeStrip';
import { RoomSidebarPanel } from '@/alcon/room/RoomSidebarPanel';
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

const ACTION_ITEMS = [
  { id: 'inbox', icon: NavInboxIcon, label: 'Inbox' },
  { id: 'strategy', icon: NavStrategyIcon, label: 'Strategy' },
  { id: 'note', icon: NavNoteIcon, label: 'Note' },
];

const EXECUTION_ITEMS = [
  { id: 'projects', icon: NavObjectsIcon, label: 'Objects' },
  { id: 'mytasks', icon: NavMyTasksIcon, label: 'Elements' },
];

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

          {/* ── Mode strip — Home / Room / Chat. Selected button is a
              filled pill with icon + label; others are icon-only chips. ── */}
          <ModeStrip
            activeMode={activeView === 'room' ? 'room' : activeView === 'chat' ? 'chat' : 'home'}
            onChange={(m) => onViewChange(m)}
          />

          {activeView === 'room' ? (
            <RoomSidebarPanel
              domainId={activeDomainId || null}
              selectedChannelId={navigation.roomChannelId ?? null}
              onSelectChannel={(id) => onNavigate({ roomChannelId: id })}
            />
          ) : (
          <>
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
          <div className="px-2 mb-1 flex items-center justify-between group/exec">
            <button
              type="button"
              onClick={() => setExecutionSpaceOpen((v) => !v)}
              className="flex min-w-0 items-center gap-1 text-[11px] font-bold text-muted-foreground/60 hover:text-muted-foreground select-none"
            >
              <span>Execution Space</span>
              {executionSpaceOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
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
                    title={d.is_individual ? 'Your Individual Domain' : d.name}
                  >
                    <DomainMark domain={d} size={20} />
                    <span className="flex-1 text-left truncate">{d.is_individual ? 'Individual Domain' : d.name}</span>
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

          <button
            onClick={() => onViewChange('settings')}
            className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[12px] font-semibold transition-colors ${
              activeView === 'settings'
                ? 'bg-sidebar-accent text-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
            }`}
          >
            <NavSettingsIcon size={15} />
            <span>Settings</span>
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

      {/* Create menu popup */}
      {createMenuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCreateMenuOpen(false)} />
          <div
            ref={createMenuRef}
            className="fixed w-52 bg-popover border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden"
            style={{ top: createMenuPos.top, left: createMenuPos.left }}
          >
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Create new</div>
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
      className={`w-full flex items-center gap-1 px-2 mb-1 text-[11px] font-bold text-muted-foreground/60 hover:text-muted-foreground select-none ${className}`}
    >
      <span>{label}</span>
      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
    </button>
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
                {domain.is_individual ? 'Individual Domain' : domain.name}
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
              <TeamSettings />
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
          <label className="mb-1.5 block text-[12px] font-medium text-foreground">Icon</label>
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
          <label className="mb-1.5 block text-[12px] font-medium text-foreground">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-foreground/40"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-foreground">Identifier</label>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="e.g. ALCON"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/40"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-foreground">Privacy</label>
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
                className={`rounded-md border px-3 py-2 text-[12px] font-medium transition-colors ${
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
            className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
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
