'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { ExplorerData } from '@/hooks/useSupabase';
import { moveObject } from '@/hooks/useSupabase';
import { LogOut, Plus, ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { useAuthContext } from '@/providers/AuthProvider';
import { ThemeToggle } from '@/ui/theme-toggle';
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
import { ObjectIcon } from '@/components/icons';
import { DomainSwitcher } from '@/alcon/domain/DomainSwitcher';
import { useDomains } from '@/hooks/useSupabase';
import { getActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT } from '@/alcon/domain/domainsStore';

import {
  NavNoteIcon,
  NavBriefIcon,
  NavRoomIcon,
  NavObjectsIcon,
  NavMyTasksIcon,
  NavSettingsIcon,
  NavSystemIcon,
} from '@/layout/sidebar/NavIcons';
import type { DragItem, DropTargetInfo } from '@/layout/sidebar/ObjectTree';
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
  onToggleCollapse: () => void;
  onCreateNew?: (type: 'domain' | 'object' | 'note') => void;
}

const ACTION_ITEMS = [
  { id: 'note', icon: NavNoteIcon, label: 'Note' },
  { id: 'brief', icon: NavBriefIcon, label: 'Brief' },
  { id: 'room', icon: NavRoomIcon, label: 'Room' },
];

const EXECUTION_ITEMS = [
  { id: 'projects', icon: NavObjectsIcon, label: 'Objects' },
  { id: 'mytasks', icon: NavMyTasksIcon, label: 'Elements' },
];

export function AppSidebar({
  activeView,
  onViewChange,
  explorerData,
  onRefresh,
  collapsed,
  onCreateNew,
}: AppSidebarProps) {
  const { signOut } = useAuthContext();
  const { data: domains } = useDomains();
  const [activeDomainId, setActiveDomainIdState] = useState<string>(
    () => getActiveDomainId() ?? domains[0]?.id ?? ''
  );
  const [domainExpanded, setDomainExpanded] = useState(true);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState({ top: 0, left: 0 });
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetInfo>(null);

  const { objects } = explorerData;
  const activeDomain = domains.find((d) => d.id === activeDomainId) ?? domains[0];

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setActiveDomainIdState(id);
    };
    window.addEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
  }, []);

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
        className={`h-full flex flex-col flex-shrink-0 overflow-hidden transition-all duration-150 ease-out ${
          collapsed ? 'w-0' : 'w-[220px]'
        }`}
      >
        {/* Workspace header */}
        <div className="flex items-center justify-between h-11 px-3 border-b border-sidebar-border flex-shrink-0">
          <DomainSwitcher />
          <button
            onClick={onToggleCollapse}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors flex-shrink-0"
            title="Collapse sidebar"
          >
            <ChevronRight size={13} className="rotate-180" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">

          {/* ── Action Space ── */}
          <div className="px-2 mb-1">
            <span className="text-[11px] font-medium text-muted-foreground/60 select-none">
              Action Space
            </span>
          </div>
          <div className="mb-4">
            {ACTION_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onViewChange(item.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] transition-colors duration-100 ${
                    isActive
                      ? 'bg-sidebar-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                  }`}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* ── Execution ── */}
          <div className="px-2 mb-1 flex items-center justify-between group/exec">
            <span className="text-[11px] font-medium text-muted-foreground/60 select-none">
              Execution
            </span>
            <button
              onClick={() => onCreateNew?.('domain')}
              className="opacity-0 group-hover/exec:opacity-100 w-4 h-4 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-accent transition-all"
              title="Create Domain"
            >
              <Plus size={12} />
            </button>
          </div>

          {/* Domain row (active domain with nested nav items) */}
          {activeDomain && (
            <div>
              <button
                onClick={() => setDomainExpanded((v) => !v)}
                className={`w-full flex items-center gap-1.5 px-2 h-8 rounded-md text-[13px] transition-colors duration-100 ${
                  activeView === 'domains'
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {domainExpanded
                  ? <ChevronDown size={12} className="flex-shrink-0 text-muted-foreground/70" />
                  : <ChevronRight size={12} className="flex-shrink-0 text-muted-foreground/70" />
                }
                <div
                  className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-semibold flex-shrink-0"
                  style={{ backgroundColor: activeDomain.color ?? undefined }}
                >
                  {activeDomain.color
                    ? <span className="text-white">{activeDomain.name.charAt(0)}</span>
                    : <span className="bg-sidebar-accent w-full h-full rounded flex items-center justify-center text-muted-foreground">{activeDomain.name.charAt(0)}</span>
                  }
                </div>
                <span className="flex-1 text-left truncate font-medium">{activeDomain.name}</span>
              </button>

              {/* Nested items under domain */}
              {domainExpanded && (
                <div className="mt-0.5">
                  {EXECUTION_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeView === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onViewChange(item.id)}
                        className={`w-full flex items-center gap-2.5 pl-8 pr-2.5 h-8 rounded-md text-[13px] transition-colors duration-100 ${
                          isActive
                            ? 'bg-sidebar-accent text-foreground font-medium'
                            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                        }`}
                      >
                        <Icon size={14} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
            className="w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors mb-0.5"
          >
            <Plus size={15} />
            <span>Create new</span>
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onViewChange('settings')}
              className={`flex-1 flex items-center gap-2 px-2.5 h-8 rounded-md text-[13px] transition-colors ${
                activeView === 'settings'
                  ? 'bg-sidebar-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
              }`}
            >
              <NavSettingsIcon size={15} />
              <span>Settings</span>
            </button>
            <ThemeToggle />
            <button
              onClick={() => signOut()}
              className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
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
              icon={<DomainBlocksIcon />}
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

      <DragOverlay>
        {activeItem && (
          <div className="flex items-center h-[22px] px-2 bg-card border border-primary rounded shadow-lg opacity-90">
            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-1">
              <ObjectIcon size={14} />
            </div>
            <span className="text-[13px] text-foreground/80">{activeItem.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function DomainBlocksIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
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
