'use client';

import React, { useState, useRef } from 'react';
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
import { SystemSwitcher } from '@/alcon/system/SystemSwitcher';

import {
  NavNoteIcon,
  NavBriefIcon,
  NavRoomIcon,
  NavSystemIcon,
  NavObjectsIcon,
  NavMyTasksIcon,
  NavSettingsIcon,
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
  onCreateNew?: (type: 'system' | 'object' | 'note') => void;
}

const NAV_GROUPS = [
  {
    id: 'action',
    label: 'Action',
    items: [
      { id: 'note', icon: NavNoteIcon, label: 'Note' },
      { id: 'brief', icon: NavBriefIcon, label: 'Brief' },
      { id: 'room', icon: NavRoomIcon, label: 'Room' },
    ],
  },
  {
    id: 'execution',
    label: 'Execution',
    items: [
      { id: 'systems', icon: NavSystemIcon, label: 'System' },
      { id: 'projects', icon: NavObjectsIcon, label: 'Objects' },
      { id: 'mytasks', icon: NavMyTasksIcon, label: 'Elements' },
    ],
  },
];

export function AppSidebar({
  activeView,
  onViewChange,
  explorerData,
  onRefresh,
  collapsed,
  onToggleCollapse,
  onCreateNew,
}: AppSidebarProps) {
  const { signOut } = useAuthContext();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState({ top: 0, left: 0 });
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetInfo>(null);

  const { objects } = explorerData;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const isDescendant = (objs: AlconObjectWithChildren[], parentId: string, targetId: string): boolean => {
    const findObject = (items: AlconObjectWithChildren[], id: string): AlconObjectWithChildren | null => {
      for (const obj of items) {
        if (obj.id === id) return obj;
        if (obj.children) { const found = findObject(obj.children, id); if (found) return found; }
      }
      return null;
    };
    const parent = findObject(objs, parentId);
    if (!parent?.children) return false;
    const checkChildren = (children: AlconObjectWithChildren[]): boolean => {
      for (const child of children) {
        if (child.id === targetId) return true;
        if (child.children && checkChildren(child.children)) return true;
      }
      return false;
    };
    return checkChildren(parent.children);
  };

  const handleDragStart = (event: DragStartEvent) => setActiveItem(event.active.data.current as DragItem);

  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    if (!over || !active.rect.current.translated) { setDropTarget(null); return; }
    const overId = over.id as string;
    const dragData = active.data.current as DragItem;
    if (overId === 'drop-root') { setDropTarget({ id: overId, position: 'inside' }); return; }
    if (overId.startsWith('drop-object-')) {
      const targetObjectId = overId.replace('drop-object-', '');
      if (dragData.id === targetObjectId || isDescendant(objects, dragData.id, targetObjectId)) { setDropTarget(null); return; }
      setDropTarget({ id: overId, position: 'inside' });
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active } = event;
    const currentDropTarget = dropTarget;
    setActiveItem(null);
    setDropTarget(null);
    if (!currentDropTarget) return;
    const dragData = active.data.current as DragItem;
    const { id: dropId } = currentDropTarget;
    const isDropOnObject = dropId.startsWith('drop-object-');
    const isDropOnRoot = dropId === 'drop-root';
    const targetObjectId = isDropOnObject ? dropId.replace('drop-object-', '') : null;
    const newParentId = isDropOnRoot ? null : (isDropOnObject ? targetObjectId : null);
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
      {/* Collapsed show-button */}
      {collapsed && (
        <button
          onClick={onToggleCollapse}
          className="fixed left-1 top-3 z-50 w-6 h-6 flex items-center justify-center rounded-md bg-sidebar border border-sidebar-border text-muted-foreground hover:text-foreground transition-colors"
          title="Show sidebar"
        >
          <ChevronRight size={14} />
        </button>
      )}

      <div
        className={`h-full flex flex-col bg-sidebar border-r border-sidebar-border flex-shrink-0 overflow-hidden transition-all duration-150 ease-out ${
          collapsed ? 'w-0' : 'w-[220px]'
        }`}
      >
        {/* Workspace header */}
        <div className="flex items-center justify-between h-11 px-3 border-b border-sidebar-border flex-shrink-0">
          <SystemSwitcher />
          <button
            onClick={onToggleCollapse}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors flex-shrink-0"
            title="Collapse sidebar"
          >
            <ChevronRight size={13} className="rotate-180" />
          </button>
        </div>

        {/* Navigation groups */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {NAV_GROUPS.map((group) => {
            const isGroupCollapsed = collapsedGroups.has(group.id);
            return (
              <div key={group.id}>
                {/* Group label */}
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-muted-foreground hover:text-foreground uppercase tracking-wider transition-colors"
                >
                  {isGroupCollapsed
                    ? <ChevronRight size={10} />
                    : <ChevronDown size={10} />
                  }
                  {group.label}
                </button>

                {/* Group items */}
                {!isGroupCollapsed && (
                  <div className="mt-0.5 mb-2">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeView === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => onViewChange(item.id)}
                          className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] transition-colors duration-100 ${
                            isActive
                              ? 'bg-sidebar-accent text-foreground font-medium'
                              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
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
        </nav>

        {/* Bottom actions */}
        <div className="px-2 pb-2 pt-1 border-t border-sidebar-border flex-shrink-0">
          {/* Create button */}
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

          {/* Settings / Theme / Logout row */}
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
              icon={<SystemBlocksIcon />}
              label="System"
              desc="Top-level container"
              onClick={() => { setCreateMenuOpen(false); onCreateNew?.('system'); }}
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

function SystemBlocksIcon({ size = 14 }: { size?: number }) {
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
