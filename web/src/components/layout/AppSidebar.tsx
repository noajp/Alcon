'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { ExplorerData } from '@/hooks/useSupabase';
import { moveObject, useDocuments, createDocument, updateDocument, deleteDocument, moveDocument } from '@/hooks/useSupabase';
import { LogOut, Plus, ChevronRight, FileText } from 'lucide-react';
import { useAuthContext } from '@/providers/AuthProvider';
import { DocumentExplorer } from '@/views/documents/DocumentExplorer';
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

import { ICON_BAR_LAYERS, NavSettingsIcon } from '@/layout/sidebar/NavIcons';
import { ObjectItem, RootDropZone, ElementItem } from '@/layout/sidebar/ObjectTree';
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

export function AppSidebar({
  navigation,
  onNavigate,
  activeView,
  onViewChange,
  explorerData,
  onRefresh,
  width,
  collapsed,
  onToggleCollapse,
  onCreateNew,
}: AppSidebarProps) {
  const { signOut } = useAuthContext();

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState({ top: 0, left: 0 });
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetInfo>(null);

  const { objects, rootElements } = explorerData;

  const { documentTree, refetch: refetchDocs } = useDocuments();

  const handleCreateDoc = async (parentId: string | null, type: 'folder' | 'page') => {
    try {
      const newDoc = await createDocument({ parent_id: parentId, type, title: '' });
      refetchDocs();
      onNavigate({ documentId: newDoc.id });
    } catch (err) { console.error('Failed to create document:', err); }
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      await deleteDocument(docId);
      if (navigation.documentId === docId) onNavigate({ documentId: null });
      refetchDocs();
    } catch (err) { console.error('Failed to delete document:', err); }
  };

  const handleRenameDoc = async (docId: string, newTitle: string) => {
    try { await updateDocument(docId, { title: newTitle }); refetchDocs(); }
    catch (err) { console.error('Failed to rename document:', err); }
  };

  const handleToggleFavorite = async (docId: string, isFavorite: boolean) => {
    try { await updateDocument(docId, { is_favorite: isFavorite }); refetchDocs(); }
    catch (err) { console.error('Failed to toggle favorite:', err); }
  };

  const handleMoveDoc = async (docId: string, newParentId: string | null) => {
    try { await moveDocument(docId, newParentId); refetchDocs(); }
    catch (err) { console.error('Failed to move document:', err); }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const collectAllObjectIds = (objs: AlconObjectWithChildren[]): string[] => {
    const ids: string[] = [];
    for (const obj of objs) {
      ids.push(`object-${obj.id}`);
      if (obj.children?.length) ids.push(...collectAllObjectIds(obj.children));
    }
    return ids;
  };

  useEffect(() => {
    if (objects) {
      const allObjectIds = collectAllObjectIds(objects);
      setExpandedNodes(prev => {
        const next = new Set(prev);
        allObjectIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [objects]);

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
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
      {collapsed && (
        <button
          onClick={onToggleCollapse}
          className="fixed left-1 top-3 z-50 w-6 h-6 flex items-center justify-center rounded-md bg-[var(--content-bg)] border border-border/40 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
          title="Show sidebar"
        >
          <ChevronRight size={14} />
        </button>
      )}
      <div className={`h-full flex flex-col items-center bg-[var(--content-bg)] py-2 flex-shrink-0 transition-all duration-200 overflow-hidden ${collapsed ? 'w-0' : 'w-10'}`}>
        <div className="mb-1.5">
          <SystemSwitcher />
        </div>

        {ICON_BAR_LAYERS.map((layer) => (
          <div key={layer.label}>
            {layer.items.map(item => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { if (!item.disabled) onViewChange(item.id); }}
                  className={`group relative w-8 h-8 flex items-center justify-center rounded-md cursor-pointer transition-all duration-150 mb-0.5 ${
                    item.disabled
                      ? 'text-muted-foreground/30 cursor-not-allowed'
                      : isActive
                        ? 'bg-sidebar-accent text-foreground'
                        : 'text-foreground/70 hover:text-foreground hover:bg-sidebar-accent/50'
                  }`}
                  title={item.label}
                >
                  <Icon size={18} />
                  <span className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 shadow-lg pointer-events-none border border-border">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        <div className="flex-1" />

        {/* Create new (System / Object / Note) */}
        <button
          ref={createBtnRef}
          onClick={() => {
            const rect = createBtnRef.current?.getBoundingClientRect();
            if (rect) setCreateMenuPos({ top: rect.bottom - 160, left: rect.right + 8 });
            setCreateMenuOpen((v) => !v);
          }}
          className="w-8 h-8 mb-1 flex items-center justify-center rounded-md border border-border/60 text-foreground/70 hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
          title="Create new"
        >
          <Plus size={16} />
        </button>

        <button
          onClick={() => onViewChange('settings')}
          className={`w-8 h-8 flex items-center justify-center rounded-md cursor-pointer transition-all duration-150 mb-0.5 ${
            activeView === 'settings' ? 'bg-sidebar-accent text-foreground' : 'text-foreground/70 hover:text-foreground hover:bg-sidebar-accent/50'
          }`}
          title="Settings"
        >
          <NavSettingsIcon size={18} />
        </button>
        <div className="mb-1"><ThemeToggle /></div>
        <button
          onClick={() => signOut()}
          className="w-8 h-8 flex items-center justify-center rounded-md cursor-pointer transition-all duration-150 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
          title="Sign out"
        >
          <LogOut size={16} />
        </button>
      </div>

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
              desc="A new document"
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

function CreateMenuItem({
  icon, label, desc, onClick,
}: { icon: React.ReactNode; label: string; desc: string; onClick: () => void }) {
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

function SystemBlocksIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}
