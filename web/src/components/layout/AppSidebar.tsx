'use client';

import { useState, useEffect } from 'react';
import type { ExplorerData } from '@/hooks/useSupabase';
import { moveObject, createElement, createObject, useDocuments, createDocument, updateDocument, deleteDocument, moveDocument } from '@/hooks/useSupabase';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { LogOut } from 'lucide-react';
import { useAuthContext } from '@/providers/AuthProvider';
import { DocumentExplorer } from '@/views/documents/DocumentExplorer';
import { ThemeToggle } from '@/ui/theme-toggle';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
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
}: AppSidebarProps) {
  const { signOut } = useAuthContext();

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showCreateElementDialog, setShowCreateElementDialog] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newElementTitle, setNewElementTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
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

  const handleCreateObject = async () => {
    if (!newItemName.trim()) return;
    setIsCreating(true);
    try {
      await createObject({ name: newItemName.trim(), parent_object_id: navigation.objectId });
      setShowCreateDialog(false);
      setNewItemName('');
      onRefresh?.();
    } catch (err) { console.error('Failed to create object:', err); }
    finally { setIsCreating(false); }
  };

  const handleCreateElement = async () => {
    if (!newElementTitle.trim()) return;
    setIsCreating(true);
    try {
      await createElement({ title: newElementTitle.trim(), object_id: navigation.objectId || null });
      setShowCreateElementDialog(false);
      setNewElementTitle('');
      onRefresh?.();
    } catch (err) { console.error('Failed to create element:', err); }
    finally { setIsCreating(false); }
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
      <div className="h-full flex flex-col items-center w-10 bg-[var(--content-bg)] py-2 flex-shrink-0">
        <div className="mb-2 flex items-center justify-center" title="Alcon">
          <svg width="24" height="24" viewBox="10 10 50 50" fill="none" shapeRendering="geometricPrecision">
            <path d="M 28 12 L 14 12 L 14 52 L 28 52" fill="none" className="stroke-foreground" strokeWidth="5" strokeLinecap="square" strokeLinejoin="miter" />
            <path d="M 36 12 L 50 12 L 50 52 L 36 52" fill="none" className="stroke-foreground" strokeWidth="5" strokeLinecap="square" strokeLinejoin="miter" />
            <circle cx="32" cy="32" r="4.5" fill="#d8452a" />
          </svg>
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

      <Dialog open={showCreateDialog} onOpenChange={(open) => { if (!open) { setShowCreateDialog(false); setNewItemName(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Object</DialogTitle></DialogHeader>
          <div className="py-4">
            <Input value={newItemName} onChange={(e) => setNewItemName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newItemName.trim()) handleCreateObject(); }} placeholder="Object name" disabled={isCreating} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setNewItemName(''); }} disabled={isCreating}>Cancel</Button>
            <Button onClick={handleCreateObject} disabled={!newItemName.trim() || isCreating}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateElementDialog} onOpenChange={(open) => { if (!open) { setShowCreateElementDialog(false); setNewElementTitle(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Element</DialogTitle></DialogHeader>
          <div className="py-4">
            <Input value={newElementTitle} onChange={(e) => setNewElementTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newElementTitle.trim()) handleCreateElement(); }} placeholder="Element title" disabled={isCreating} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateElementDialog(false); setNewElementTitle(''); }} disabled={isCreating}>Cancel</Button>
            <Button onClick={handleCreateElement} disabled={!newElementTitle.trim() || isCreating}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
