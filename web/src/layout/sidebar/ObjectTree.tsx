'use client';

import { useState, useEffect, useRef } from 'react';
import type { AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { updateObject, createObject, deleteObject } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/components/icons';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { NavigationState } from '@/types/navigation';

export type DragItem = {
  type: 'object';
  id: string;
  name: string;
  parentObjectId: string | null;
};

export type DropPosition = 'inside' | 'sibling';

export type DropTargetInfo = {
  id: string;
  position: DropPosition;
} | null;

export const SIDEBAR_ROW_H = 24;

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

export function RootDropZone({ isOver }: { isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: 'drop-root' });
  return <div ref={setNodeRef} className={`h-1 transition-colors ${isOver ? 'bg-primary/20' : ''}`} />;
}

export function ElementItem({ element }: { element: ElementWithDetails }) {
  const statusColors: Record<string, string> = {
    backlog: '#D4D4D4', todo: '#A3A3A3', in_progress: '#F59E0B', review: '#3B82F6', done: '#10B981', blocked: '#EF4444', cancelled: '#D4D4D4',
  };
  const statusColor = statusColors[element.status || 'todo'] || '#A3A3A3';

  return (
    <div className="flex items-center hover:bg-sidebar-accent/50 cursor-pointer rounded-md mx-1 px-2" style={{ height: SIDEBAR_ROW_H }} title={element.title}>
      <div className="w-4 h-4 flex-shrink-0" />
      <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mr-1.5">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
      </div>
      <span className="text-[13px] text-foreground/80 truncate flex-1">{element.title}</span>
      {element.subelements && element.subelements.length > 0 && (
        <span className="text-[10px] text-muted-foreground/50 mr-1">
          {element.subelements.filter(s => s.is_completed).length}/{element.subelements.length}
        </span>
      )}
    </div>
  );
}

export function ObjectItem({
  object, navigation, onNavigate, expandedNodes, toggleNode, onRefresh, depth, dropTarget,
}: {
  object: AlconObjectWithChildren;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  expandedNodes: Set<string>;
  toggleNode: (nodeId: string) => void;
  onRefresh?: () => void;
  depth: number;
  dropTarget: DropTargetInfo;
}) {
  const nodeId = `object-${object.id}`;
  const dropId = `drop-object-${object.id}`;
  const isExpanded = expandedNodes.has(nodeId);
  const isSelected = navigation.objectId === object.id;
  const hasChildren = object.children && object.children.length > 0;
  const isDropInside = dropTarget?.id === dropId && dropTarget?.position === 'inside';

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `drag-object-${object.id}`,
    data: { type: 'object', id: object.id, name: object.name, parentObjectId: object.parent_object_id || null } as DragItem,
  });

  const { setNodeRef: setDropRef } = useDroppable({ id: dropId });
  const setNodeRef = (node: HTMLElement | null) => { setDragRef(node); setDropRef(node); };

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(object.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleRename = async () => {
    if (newName.trim() && newName !== object.name) {
      try { await updateObject(object.id, { name: newName.trim() }); onRefresh?.(); } catch (err) { console.error('Failed to rename:', err); }
    }
    setIsRenaming(false); setContextMenu(null);
  };

  const handleAddChildObject = async () => {
    try { await createObject({ name: 'New Object', parent_object_id: object.id, system_id: object.system_id ?? null }); if (!isExpanded) toggleNode(nodeId); onRefresh?.(); } catch (err) { console.error('Failed:', err); }
    setContextMenu(null);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try { await deleteObject(object.id); onRefresh?.(); } catch (err) { console.error('Failed:', err); }
    finally { setIsDeleting(false); setShowDeleteDialog(false); }
  };

  useEffect(() => { if (isRenaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [isRenaming]);
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) { document.addEventListener('click', handleClickOutside); return () => document.removeEventListener('click', handleClickOutside); }
  }, [contextMenu]);

  return (
    <div>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        style={{ height: SIDEBAR_ROW_H, paddingLeft: `${6 + depth * 12}px`, paddingRight: '6px' }}
        className={`flex items-center cursor-pointer transition-colors duration-75 rounded-md mx-1 ${
          isSelected ? 'bg-sidebar-accent text-foreground' : 'hover:bg-sidebar-accent/50'
        } ${isDragging ? 'opacity-50' : ''} ${isDropInside ? 'bg-primary/30' : ''}`}
        onClick={() => onNavigate({ objectId: object.id })}
        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <button
          type="button"
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground transition-transform duration-100 ${hasChildren ? '' : 'invisible'} ${isExpanded ? 'rotate-90' : ''}`}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleNode(nodeId); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ChevronIcon />
        </button>
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-1.5">
          <ObjectIcon size={14} />
        </div>
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') { setNewName(object.name); setIsRenaming(false); }
            }}
            className="text-[13px] text-foreground flex-1 bg-input border border-border px-1 py-0 rounded focus:outline-none"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-[13px] flex-1 truncate text-sidebar-foreground/80">{object.name}</span>
        )}
      </div>

      {contextMenu && (
        <div
          className="fixed bg-popover border border-border rounded-lg shadow-lg py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="w-full px-3 py-1.5 text-[13px] text-left text-foreground hover:bg-accent cursor-pointer" onClick={handleAddChildObject}>New Child Object</button>
          <div className="h-px bg-border my-1" />
          <button type="button" className="w-full px-3 py-1.5 text-[13px] text-left text-foreground hover:bg-accent cursor-pointer" onClick={() => { setIsRenaming(true); setContextMenu(null); }}>Rename</button>
          <button type="button" className="w-full px-3 py-1.5 text-[13px] text-left text-destructive hover:bg-accent cursor-pointer" onClick={() => { setContextMenu(null); setShowDeleteDialog(true); }}>Delete</button>
        </div>
      )}

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-[340px] p-6" showCloseButton={false}>
          <div className="text-center">
            <DialogTitle className="text-[15px] font-semibold mb-1">Delete &apos;{object.name}&apos;?</DialogTitle>
            <p className="text-[13px] text-muted-foreground mb-5">This action cannot be undone.</p>
            <div className="flex flex-col gap-2">
              <Button onClick={handleDeleteConfirm} disabled={isDeleting} className="w-full bg-destructive hover:bg-destructive/90 text-white">{isDeleting ? 'Deleting...' : 'Delete'}</Button>
              <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={isDeleting} className="w-full">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isExpanded && object.children && (
        <div>
          {object.children.map(childObj => (
            <ObjectItem
              key={childObj.id}
              object={childObj}
              navigation={navigation}
              onNavigate={onNavigate}
              expandedNodes={expandedNodes}
              toggleNode={toggleNode}
              onRefresh={onRefresh}
              depth={depth + 1}
              dropTarget={dropTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}
