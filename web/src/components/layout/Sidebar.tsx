'use client';

import { useState, useEffect, useRef } from 'react';
import type { AlconObjectWithChildren, ExplorerData, ElementWithDetails, DocumentWithChildren } from '@/hooks/useSupabase';
import { updateObject, createObject, deleteObject, moveObject, createElement, useDocuments, createDocument, updateDocument, deleteDocument, moveDocument } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Circle } from 'lucide-react';
import { DocumentExplorer } from '@/components/documents/DocumentExplorer';

// Template icon (4 rounded squares)
const TemplateIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="1" width="6" height="6" rx="1.5" />
    <rect x="9" y="1" width="6" height="6" rx="1.5" />
    <rect x="1" y="9" width="6" height="6" rx="1.5" />
    <rect x="9" y="9" width="6" height="6" rx="1.5" />
  </svg>
);
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';

// Chevron icon for tree toggle
const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

// ============================================
// Navigation State Type
// ============================================
export interface NavigationState {
  objectId: string | null;
  noteId?: string | null;
  documentId?: string | null;
  canvasId?: string | null;
}

interface SidebarProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  explorerData: ExplorerData;
  onRefresh?: () => void;
  width?: number;
}

// Drag item type
type DragItem = {
  type: 'object';
  id: string;
  name: string;
  parentObjectId: string | null;
};

// Drop position type
type DropPosition = 'inside' | 'sibling';

// Drop target info
type DropTargetInfo = {
  id: string;
  position: DropPosition;
} | null;

export function Sidebar({ activeActivity, navigation, onNavigate, explorerData, onRefresh, width = 240 }: SidebarProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showCreateElementDialog, setShowCreateElementDialog] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newElementTitle, setNewElementTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetInfo>(null);
  const { objects, rootElements } = explorerData;

  // Documents state (for notes/documents activity - Notion-like)
  const { documentTree, loading: docsLoading, refetch: refetchDocs } = useDocuments();

  // Document handlers
  const handleCreateDoc = async (parentId: string | null, type: 'folder' | 'page') => {
    try {
      const newDoc = await createDocument({
        parent_id: parentId,
        type,
        title: '',
      });
      refetchDocs();
      // Auto-select the new document
      onNavigate({ documentId: newDoc.id });
    } catch (err) {
      console.error('Failed to create document:', err);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      await deleteDocument(docId);
      if (navigation.documentId === docId) {
        onNavigate({ documentId: null });
      }
      refetchDocs();
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  const handleRenameDoc = async (docId: string, newTitle: string) => {
    try {
      await updateDocument(docId, { title: newTitle });
      refetchDocs();
    } catch (err) {
      console.error('Failed to rename document:', err);
    }
  };

  const handleToggleFavorite = async (docId: string, isFavorite: boolean) => {
    try {
      await updateDocument(docId, { is_favorite: isFavorite });
      refetchDocs();
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  const handleMoveDoc = async (docId: string, newParentId: string | null) => {
    try {
      await moveDocument(docId, newParentId);
      refetchDocs();
    } catch (err) {
      console.error('Failed to move document:', err);
    }
  };

  // DnD sensors - shorter distance for easier activation
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    })
  );

  // Expand all root object nodes by default
  useEffect(() => {
    if (objects) {
      const objectIds = objects.map(obj => `object-${obj.id}`);
      setExpandedNodes(prev => {
        const next = new Set(prev);
        objectIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [objects]);

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  // Handle creating new object (at root level or in selected object)
  const handleCreateObject = async () => {
    if (!newItemName.trim()) return;
    setIsCreating(true);
    try {
      await createObject({
        name: newItemName.trim(),
        parent_object_id: navigation.objectId
      });
      setShowCreateDialog(false);
      setNewItemName('');
      onRefresh?.();
    } catch (err) {
      console.error('Failed to create object:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const closeDialog = () => {
    setShowCreateDialog(false);
    setNewItemName('');
  };

  // Handle creating new element (object_id is optional - null means user's personal task)
  const handleCreateElement = async () => {
    if (!newElementTitle.trim()) return;
    setIsCreating(true);
    try {
      await createElement({
        title: newElementTitle.trim(),
        object_id: navigation.objectId || null,  // null = ユーザー直下
      });
      setShowCreateElementDialog(false);
      setNewElementTitle('');
      onRefresh?.();
    } catch (err) {
      console.error('Failed to create element:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const closeElementDialog = () => {
    setShowCreateElementDialog(false);
    setNewElementTitle('');
  };

  // DnD handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current as DragItem;
    setActiveItem(data);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    if (!over || !active.rect.current.translated) {
      setDropTarget(null);
      return;
    }

    const overId = over.id as string;
    const dragData = active.data.current as DragItem;

    let position: DropPosition;
    if (overId === 'drop-root') {
      // Root area - move to root level
      position = 'inside';
    } else if (overId.startsWith('drop-object-')) {
      const targetObjectId = overId.replace('drop-object-', '');

      // Don't allow dropping object onto itself
      if (dragData.id === targetObjectId) {
        setDropTarget(null);
        return;
      }

      // Check if trying to drop onto a descendant (would create cycle)
      if (isDescendant(objects, dragData.id, targetObjectId)) {
        setDropTarget(null);
        return;
      }

      // VS Code style: dropping on a folder = goes INSIDE
      position = 'inside';
    } else {
      position = 'inside';
    }

    setDropTarget({ id: overId, position });
  };

  // Check if targetId is a descendant of parentId
  const isDescendant = (objects: AlconObjectWithChildren[], parentId: string, targetId: string): boolean => {
    const findObject = (objs: AlconObjectWithChildren[], id: string): AlconObjectWithChildren | null => {
      for (const obj of objs) {
        if (obj.id === id) return obj;
        if (obj.children) {
          const found = findObject(obj.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    const parent = findObject(objects, parentId);
    if (!parent || !parent.children) return false;

    const checkChildren = (children: AlconObjectWithChildren[]): boolean => {
      for (const child of children) {
        if (child.id === targetId) return true;
        if (child.children && checkChildren(child.children)) return true;
      }
      return false;
    };

    return checkChildren(parent.children);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active } = event;
    const currentDropTarget = dropTarget;
    setActiveItem(null);
    setDropTarget(null);

    if (!currentDropTarget) return;

    const dragData = active.data.current as DragItem;
    const { id: dropId } = currentDropTarget;

    // Parse drop target
    const isDropOnObject = dropId.startsWith('drop-object-');
    const isDropOnRoot = dropId === 'drop-root';
    const targetObjectId = isDropOnObject ? dropId.replace('drop-object-', '') : null;

    let newParentId: string | null;

    if (isDropOnRoot) {
      // Drop on root → move to root level
      newParentId = null;
    } else if (isDropOnObject) {
      // VS Code style: Drop on Object → goes INSIDE that Object
      newParentId = targetObjectId;
    } else {
      newParentId = null;
    }

    if (newParentId !== dragData.parentObjectId) {
      try {
        await moveObject(dragData.id, newParentId, 0);
        onRefresh?.();
      } catch (err) {
        console.error('Failed to move object:', err);
      }
    }
  };

  const handleDragCancel = () => {
    setActiveItem(null);
    setDropTarget(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="h-full bg-sidebar flex flex-col border-r border-sidebar-border" style={{ width }}>
        {/* Header with action buttons - varies by activity */}
        <div className="h-9 flex items-center justify-between px-2">
          {activeActivity === 'projects' && (
            <>
              {/* Left: Template button */}
              <div className="flex items-center gap-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {/* TODO: Template creation */}}
                  className="h-7 px-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="Create from Template"
                >
                  <TemplateIcon size={14} />
                </Button>
              </div>
              {/* Right: Object & Element buttons */}
              <div className="flex items-center gap-1 mr-1">
                {/* New Object */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateDialog(true)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="New Object"
                >
                  <ObjectIcon size={14} />
                </Button>
                {/* New Element */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateElementDialog(true)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent"
                  title={navigation.objectId ? "New Element in selected Object" : "New personal Element"}
                >
                  <Circle size={10} fill="currentColor" />
                </Button>
              </div>
            </>
          )}
          {activeActivity === 'notes' && (
            <>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</span>
              <div />
            </>
          )}
          {activeActivity !== 'projects' && activeActivity !== 'notes' && (
            <>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Explorer</span>
              <div />
            </>
          )}
        </div>

        {/* Create Object Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={(open) => !open && closeDialog()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New Object</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newItemName.trim()) handleCreateObject();
                }}
                placeholder="Object name"
                disabled={isCreating}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={closeDialog}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateObject}
                disabled={!newItemName.trim() || isCreating}
                className="bg-[#1e3a5f] hover:bg-[#152a45]"
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Element Dialog */}
        <Dialog open={showCreateElementDialog} onOpenChange={(open) => !open && closeElementDialog()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New Element</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                value={newElementTitle}
                onChange={(e) => setNewElementTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newElementTitle.trim()) handleCreateElement();
                }}
                placeholder="Element title"
                disabled={isCreating}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={closeElementDialog}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateElement}
                disabled={!newElementTitle.trim() || isCreating}
                className="bg-[#1e3a5f] hover:bg-[#152a45]"
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Main Navigation - content varies by activity */}
        <div className="flex-1 overflow-y-auto">
          {/* Objects View (for projects activity) */}
          {activeActivity === 'projects' && (
            <>
              {/* Root drop zone */}
              <RootDropZone isOver={dropTarget?.id === 'drop-root'} />

              {/* Objects (hierarchical) - at top */}
              {objects.map((obj) => (
                <ObjectItem
                  key={obj.id}
                  object={obj}
                  navigation={navigation}
                  onNavigate={onNavigate}
                  expandedNodes={expandedNodes}
                  toggleNode={toggleNode}
                  onRefresh={onRefresh}
                  depth={0}
                  dropTarget={dropTarget}
                />
              ))}

              {/* Root Elements (unassigned) - at bottom */}
              {rootElements.map((element) => (
                <ElementItem
                  key={element.id}
                  element={element}
                  onRefresh={onRefresh}
                />
              ))}

              {objects.length === 0 && rootElements.length === 0 && (
                <div className="px-4 py-4 text-center text-[12px] text-muted-foreground/50">
                  No items yet
                </div>
              )}
            </>
          )}

          {/* Documents View (for notes activity - Notion-like) */}
          {activeActivity === 'notes' && (
            <>
              {docsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-border border-t-[#888] rounded-full animate-spin" />
                </div>
              ) : (
                <DocumentExplorer
                  documents={documentTree}
                  selectedDocId={navigation.documentId || null}
                  onSelectDoc={(docId) => onNavigate({ documentId: docId })}
                  onCreateDoc={handleCreateDoc}
                  onDeleteDoc={handleDeleteDoc}
                  onRenameDoc={handleRenameDoc}
                  onToggleFavorite={handleToggleFavorite}
                  onMoveDoc={handleMoveDoc}
                />
              )}
            </>
          )}

          {/* Home/Other activities - show objects list */}
          {activeActivity !== 'projects' && activeActivity !== 'notes' && (
            <>
              {objects.map((obj) => (
                <ObjectItem
                  key={obj.id}
                  object={obj}
                  navigation={navigation}
                  onNavigate={onNavigate}
                  expandedNodes={expandedNodes}
                  toggleNode={toggleNode}
                  onRefresh={onRefresh}
                  depth={0}
                  dropTarget={dropTarget}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Drag Overlay */}
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

// ============================================
// Root Drop Zone
// ============================================
function RootDropZone({ isOver }: { isOver: boolean }) {
  const { setNodeRef } = useDroppable({
    id: 'drop-root',
  });

  return (
    <div
      ref={setNodeRef}
      className={`h-2 transition-colors ${isOver ? 'bg-primary/20' : ''}`}
    />
  );
}

// ============================================
// Element Item (for root-level personal tasks)
// ============================================
interface ElementItemProps {
  element: ElementWithDetails;
  onRefresh?: () => void;
}

function ElementItem({ element, onRefresh }: ElementItemProps) {
  const statusColors: Record<string, string> = {
    todo: '#9a9a9a',
    in_progress: '#f59e0b',
    review: '#8b5cf6',
    done: '#22c55e',
    blocked: '#ef4444',
  };

  const statusColor = statusColors[element.status || 'todo'] || '#9a9a9a';

  return (
    <div
      className="flex items-center h-[22px] hover:bg-accent cursor-pointer"
      style={{ paddingLeft: '8px' }}
      title={element.title}
    >
      {/* Spacer for chevron alignment */}
      <div className="w-4 h-4 flex-shrink-0" />
      {/* Status indicator (aligned with Object icon) */}
      <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mr-1">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: statusColor }}
        />
      </div>
      {/* Element title */}
      <span className="text-[13px] text-foreground/80 truncate flex-1">
        {element.title}
      </span>
      {/* Subelements count */}
      {element.subelements && element.subelements.length > 0 && (
        <span className="text-[10px] text-muted-foreground/50 mr-2">
          {element.subelements.filter(s => s.is_completed).length}/{element.subelements.length}
        </span>
      )}
    </div>
  );
}

// ============================================
// Object Item (recursive for nested objects)
// ============================================
interface ObjectItemProps {
  object: AlconObjectWithChildren;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  expandedNodes: Set<string>;
  toggleNode: (nodeId: string) => void;
  onRefresh?: () => void;
  depth: number;
  dropTarget: DropTargetInfo;
}

function ObjectItem({
  object,
  navigation,
  onNavigate,
  expandedNodes,
  toggleNode,
  onRefresh,
  depth,
  dropTarget,
}: ObjectItemProps) {
  const nodeId = `object-${object.id}`;
  const dropId = `drop-object-${object.id}`;
  const isExpanded = expandedNodes.has(nodeId);
  const isSelected = navigation.objectId === object.id;
  const hasChildren = object.children && object.children.length > 0;

  // Drop indicator state - VS Code style: highlight when dropping inside
  const isDropInside = dropTarget?.id === dropId && dropTarget?.position === 'inside';

  // Draggable
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `drag-object-${object.id}`,
    data: {
      type: 'object',
      id: object.id,
      name: object.name,
      parentObjectId: object.parent_object_id || null,
    } as DragItem,
  });

  // Droppable
  const { setNodeRef: setDropRef } = useDroppable({
    id: dropId,
  });

  // Combine refs
  const setNodeRef = (node: HTMLElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(object.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleRename = async () => {
    if (newName.trim() && newName !== object.name) {
      try {
        await updateObject(object.id, { name: newName.trim() });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to rename object:', err);
      }
    }
    setIsRenaming(false);
    setContextMenu(null);
  };

  const handleAddChildObject = async () => {
    try {
      await createObject({ name: 'New Object', parent_object_id: object.id });
      if (!isExpanded) {
        toggleNode(nodeId);
      }
      onRefresh?.();
    } catch (err) {
      console.error('Failed to create child object:', err);
    }
    setContextMenu(null);
  };

  const handleDeleteClick = () => {
    setContextMenu(null);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      await deleteObject(object.id);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to delete object:', err);
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  return (
    <div>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={`flex items-center h-[22px] cursor-pointer transition-colors duration-75 ${
          isSelected ? 'bg-accent' : 'hover:bg-accent'
        } ${isDragging ? 'opacity-50' : ''} ${isDropInside ? 'bg-primary/30' : ''}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => onNavigate({ objectId: object.id })}
        onContextMenu={handleContextMenu}
      >
        {/* Expand/Collapse Arrow */}
        <button
          type="button"
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground transition-transform duration-100 ${
            hasChildren ? '' : 'invisible'
          } ${isExpanded ? 'rotate-90' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) {
              toggleNode(nodeId);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ChevronIcon />
        </button>

        {/* Object Icon */}
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-1">
          <ObjectIcon size={14} />
        </div>

        {/* Name */}
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') {
                setNewName(object.name);
                setIsRenaming(false);
              }
            }}
            className="text-[13px] text-foreground flex-1 bg-muted border border-primary px-1 py-0 focus:outline-none"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-[13px] flex-1 truncate text-foreground/80">
            {object.name}
          </span>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-card border border-border rounded shadow-lg py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full px-3 py-1 text-[13px] text-left text-foreground hover:bg-accent cursor-pointer"
            onClick={handleAddChildObject}
          >
            New Child Object
          </button>
          <div className="h-px bg-[#444] my-1" />
          <button
            type="button"
            className="w-full px-3 py-1 text-[13px] text-left text-foreground hover:bg-accent cursor-pointer"
            onClick={() => {
              setIsRenaming(true);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="w-full px-3 py-1 text-[13px] text-left text-destructive hover:bg-accent cursor-pointer"
            onClick={handleDeleteClick}
          >
            Delete
          </button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-[340px] p-6" showCloseButton={false}>
          <div className="text-center">
            <DialogTitle className="text-[15px] font-semibold mb-1">
              Are you sure you want to delete &apos;{object.name}&apos;?
            </DialogTitle>
            <p className="text-[13px] text-[#6b6b6b] mb-5">
              This action cannot be undone.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="w-full bg-[#ff3b30] hover:bg-[#ff3b30]/90 text-white"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Child objects */}
      {isExpanded && object.children && (
        <div>
          {object.children.map((childObj) => (
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
