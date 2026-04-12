'use client';

import { useState, useEffect, useRef } from 'react';
import type { AlconObjectWithChildren, ExplorerData, ElementWithDetails, DocumentWithChildren } from '@/hooks/useSupabase';
import { updateObject, createObject, deleteObject, moveObject, createElement, useDocuments, createDocument, updateDocument, deleteDocument, moveDocument } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Circle, PanelLeftClose, PanelLeft, Plus, LogOut } from 'lucide-react';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { DocumentExplorer } from '@/components/documents/DocumentExplorer';
import { ThemeToggle } from '@/components/ui/theme-toggle';
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

// ============================================
// Navigation State Type
// ============================================
export interface NavigationState {
  objectId: string | null;
  noteId?: string | null;
  documentId?: string | null;
  canvasId?: string | null;
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

// Chevron icon for tree toggle
const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

// ============================================
// Rounded stroke nav icons (black lines, rounded corners/caps)
// ============================================
const NavHomeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5L12 4l9 6.5"/>
    <path d="M5 9.5V19a1 1 0 001 1h4v-5a1 1 0 011-1h2a1 1 0 011 1v5h4a1 1 0 001-1V9.5"/>
  </svg>
);

const NavActionsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="8" y1="13" x2="16" y2="13"/>
    <line x1="8" y1="17" x2="13" y2="17"/>
  </svg>
);

const NavObjectsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);

const NavSettingsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);

const NavMyTasksIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4"/>
    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
  </svg>
);

// ============================================
// Icon bar nav - layered by Alcon's 3-tier philosophy
// Action(WHY) → Object(HOW) → Elements(DO)
// ============================================

// --- Home layer (Personal) ---
const NavInboxIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
  </svg>
);

const NavCalendarIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

// --- Action layer (Intelligence / CxO) ---
// BluePrint: 思考のカードボード (Card Board on dotted canvas)
const NavBlueprintIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="8" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="16" cy="8" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="8" cy="12" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="16" cy="12" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="8" cy="16" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="16" cy="16" r="0.8" fill="currentColor" stroke="none"/>
    <rect x="10.5" y="10.5" width="3" height="3" rx="0.5" fill="currentColor" stroke="none"/>
  </svg>
);

const NavDashboardIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
    <rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>
  </svg>
);

const NavAnalysisIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

// --- Object layer (PMO) ---
const NavTeamsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
  </svg>
);

const NavGraphIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
);

// --- Elements layer (Execution) ---
const NavSearchIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

// Layer definitions
type NavItem = { id: string; icon: React.ComponentType<{ size?: number }>; label: string; disabled?: boolean };

const ICON_BAR_LAYERS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Home',
    items: [
      { id: 'home', icon: NavHomeIcon, label: 'Home' },
      { id: 'inbox', icon: NavInboxIcon, label: 'Inbox', disabled: true },
      { id: 'calendar', icon: NavCalendarIcon, label: 'Calendar', disabled: true },
    ],
  },
  {
    label: 'Action',
    items: [
      { id: 'blueprint', icon: NavBlueprintIcon, label: 'BluePrint' },
      { id: 'dashboard', icon: NavDashboardIcon, label: 'Dashboard', disabled: true },
      { id: 'actions', icon: NavActionsIcon, label: 'Notes' },
      { id: 'analysis', icon: NavAnalysisIcon, label: 'Analysis', disabled: true },
    ],
  },
  {
    label: 'Object',
    items: [
      { id: 'projects', icon: NavObjectsIcon, label: 'Objects' },
      { id: 'teams', icon: NavTeamsIcon, label: 'Teams', disabled: true },
      { id: 'graph', icon: NavGraphIcon, label: 'Graph', disabled: true },
    ],
  },
  {
    label: 'Elements',
    items: [
      { id: 'mytasks', icon: NavMyTasksIcon, label: 'My Tasks' },
      { id: 'search', icon: NavSearchIcon, label: 'Search', disabled: true },
    ],
  },
];

// ============================================
// AppSidebar Props
// ============================================
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
  const { signOut, profile } = useAuthContext();

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showCreateElementDialog, setShowCreateElementDialog] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newElementTitle, setNewElementTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetInfo>(null);
  const { objects, rootElements } = explorerData;

  // Documents state
  const { documentTree, loading: docsLoading, refetch: refetchDocs } = useDocuments();

  // Document handlers
  const handleCreateDoc = async (parentId: string | null, type: 'folder' | 'page') => {
    try {
      const newDoc = await createDocument({ parent_id: parentId, type, title: '' });
      refetchDocs();
      onNavigate({ documentId: newDoc.id });
    } catch (err) {
      console.error('Failed to create document:', err);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      await deleteDocument(docId);
      if (navigation.documentId === docId) onNavigate({ documentId: null });
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

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // Expand all object nodes by default
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
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // Create handlers
  const handleCreateObject = async () => {
    if (!newItemName.trim()) return;
    setIsCreating(true);
    try {
      await createObject({ name: newItemName.trim(), parent_object_id: navigation.objectId });
      setShowCreateDialog(false);
      setNewItemName('');
      onRefresh?.();
    } catch (err) {
      console.error('Failed to create object:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateElement = async () => {
    if (!newElementTitle.trim()) return;
    setIsCreating(true);
    try {
      await createElement({ title: newElementTitle.trim(), object_id: navigation.objectId || null });
      setShowCreateElementDialog(false);
      setNewElementTitle('');
      onRefresh?.();
    } catch (err) {
      console.error('Failed to create element:', err);
    } finally {
      setIsCreating(false);
    }
  };

  // DnD handlers
  const isDescendant = (objects: AlconObjectWithChildren[], parentId: string, targetId: string): boolean => {
    const findObject = (objs: AlconObjectWithChildren[], id: string): AlconObjectWithChildren | null => {
      for (const obj of objs) {
        if (obj.id === id) return obj;
        if (obj.children) { const found = findObject(obj.children, id); if (found) return found; }
      }
      return null;
    };
    const parent = findObject(objects, parentId);
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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveItem(event.active.data.current as DragItem);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    if (!over || !active.rect.current.translated) { setDropTarget(null); return; }
    const overId = over.id as string;
    const dragData = active.data.current as DragItem;
    if (overId === 'drop-root') { setDropTarget({ id: overId, position: 'inside' }); return; }
    if (overId.startsWith('drop-object-')) {
      const targetObjectId = overId.replace('drop-object-', '');
      if (dragData.id === targetObjectId || isDescendant(objects, dragData.id, targetObjectId)) {
        setDropTarget(null); return;
      }
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
      {/* ====== Icon Bar Only ====== */}
      <div className="h-full flex flex-col items-center w-12 bg-sidebar border-r border-sidebar-border py-2 flex-shrink-0">
          {/* Logo */}
          <div className="w-8 h-8 flex items-center justify-center mb-3">
            <img src="/logo.png" alt="Alcon" className="w-7 h-7 rounded object-cover" />
          </div>

          {/* Layered nav icons */}
          {ICON_BAR_LAYERS.map((layer, layerIdx) => (
            <div key={layer.label}>
              {/* Layer separator (not before first) */}
              {layerIdx > 0 && (
                <div className="w-6 border-t border-sidebar-border my-1.5 mx-auto" />
              )}
              {layer.items.map(item => {
                const Icon = item.icon;
                const isActive = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.disabled) return;
                      onViewChange(item.id);
                    }}
                    className={`group relative w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 mb-0.5 ${
                      item.disabled
                        ? 'text-muted-foreground/30 cursor-not-allowed'
                        : isActive
                          ? 'bg-sidebar-accent text-foreground'
                          : 'text-foreground/90 hover:text-foreground hover:bg-sidebar-accent/50'
                    }`}
                    title={item.disabled ? `${item.label} (Coming soon)` : item.label}
                  >
                    <Icon size={18} />
                    <span className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 shadow-lg pointer-events-none border border-border">
                      {item.label}{item.disabled ? ' (Soon)' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          <div className="flex-1" />

          {/* Bottom icons */}
          <button
            onClick={() => onViewChange('settings')}
            className={`w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 mb-0.5 ${
              activeView === 'settings'
                ? 'bg-sidebar-accent text-foreground'
                : 'text-foreground/90 hover:text-foreground hover:bg-sidebar-accent/50'
            }`}
            title="Settings"
          >
            <NavSettingsIcon size={18} />
          </button>
          <div className="mb-1">
            <ThemeToggle />
          </div>
          <button
            onClick={() => signOut()}
            className="w-9 h-9 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>

      {/* Dialogs */}
        <Dialog open={showCreateDialog} onOpenChange={(open) => { if (!open) { setShowCreateDialog(false); setNewItemName(''); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>New Object</DialogTitle></DialogHeader>
            <div className="py-4">
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newItemName.trim()) handleCreateObject(); }}
                placeholder="Object name"
                disabled={isCreating}
                autoFocus
              />
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
              <Input
                value={newElementTitle}
                onChange={(e) => setNewElementTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newElementTitle.trim()) handleCreateElement(); }}
                placeholder="Element title"
                disabled={isCreating}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowCreateElementDialog(false); setNewElementTitle(''); }} disabled={isCreating}>Cancel</Button>
              <Button onClick={handleCreateElement} disabled={!newElementTitle.trim() || isCreating}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
  const { setNodeRef } = useDroppable({ id: 'drop-root' });
  return <div ref={setNodeRef} className={`h-1 transition-colors ${isOver ? 'bg-primary/20' : ''}`} />;
}

// ============================================
// Element Item (root-level personal tasks)
// ============================================
function ElementItem({ element }: { element: ElementWithDetails }) {
  const statusColors: Record<string, string> = {
    backlog: '#D4D4D4', todo: '#A3A3A3', in_progress: '#F59E0B', review: '#3B82F6', done: '#10B981', blocked: '#EF4444', cancelled: '#D4D4D4',
  };
  const statusColor = statusColors[element.status || 'todo'] || '#A3A3A3';

  return (
    <div className="flex items-center h-[28px] hover:bg-sidebar-accent/50 cursor-pointer rounded-md mx-1 px-2" title={element.title}>
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

// ============================================
// Object Item (recursive for nested objects)
// ============================================
function ObjectItem({
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

  const handleContextMenu = (e: React.MouseEvent) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); };

  const handleRename = async () => {
    if (newName.trim() && newName !== object.name) {
      try { await updateObject(object.id, { name: newName.trim() }); onRefresh?.(); } catch (err) { console.error('Failed to rename:', err); }
    }
    setIsRenaming(false); setContextMenu(null);
  };

  const handleAddChildObject = async () => {
    try { await createObject({ name: 'New Object', parent_object_id: object.id }); if (!isExpanded) toggleNode(nodeId); onRefresh?.(); } catch (err) { console.error('Failed:', err); }
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
        className={`flex items-center h-[28px] cursor-pointer transition-colors duration-75 rounded-md mx-1 ${
          isSelected ? 'bg-sidebar-accent text-foreground' : 'hover:bg-sidebar-accent/50'
        } ${isDragging ? 'opacity-50' : ''} ${isDropInside ? 'bg-primary/30' : ''}`}
        style={{ paddingLeft: `${6 + depth * 12}px`, paddingRight: '6px' }}
        onClick={() => onNavigate({ objectId: object.id })}
        onContextMenu={handleContextMenu}
      >
        <button
          type="button"
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground transition-transform duration-100 ${
            hasChildren ? '' : 'invisible'
          } ${isExpanded ? 'rotate-90' : ''}`}
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

      {/* Context Menu */}
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

      {/* Delete Dialog */}
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

      {/* Children */}
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
