'use client';

import { useState, useEffect, useRef } from 'react';
import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import { moveObject, updateObject } from '@/hooks/useSupabase';

// Object icon (3D box)
const ObjectIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M12 4 L20 8 L12 12 L4 8 Z" />
    <path d="M4 8 L4 15 L12 19 L12 12" />
    <path d="M20 8 L20 15 L12 19 L12 12" />
  </svg>
);

// Chevron icon for tree toggle
const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

// Search icon
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8"/>
    <path d="M21 21l-4.35-4.35"/>
  </svg>
);

// ============================================
// Navigation State Type
// ============================================
export interface NavigationState {
  objectId: string | null;
}

interface SidebarProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  objects: AlconObjectWithChildren[];
  onRefresh?: () => void;
  width?: number;
}

export function Sidebar({ activeActivity, navigation, onNavigate, objects, onRefresh, width = 240 }: SidebarProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // Expand all nodes by default
  useEffect(() => {
    if (objects) {
      const collectAllIds = (objs: AlconObjectWithChildren[]): string[] => {
        let ids: string[] = [];
        for (const obj of objs) {
          ids.push(obj.id);
          if (obj.children && obj.children.length > 0) {
            ids = ids.concat(collectAllIds(obj.children));
          }
        }
        return ids;
      };
      const allIds = collectAllIds(objects);
      setExpandedNodes(new Set(allIds));
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

  return (
    <div className="h-full bg-white border-r border-[#e8e8e8] flex flex-col" style={{ width }}>
      {/* Search Bar */}
      <div className="px-3 pt-3 pb-3">
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9a9a]">
            <SearchIcon />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full h-8 bg-[#f5f5f5] border border-transparent rounded-lg pl-9 pr-3 text-[13px] text-[#1a1a1a] placeholder-[#9a9a9a] focus:outline-none focus:border-[#22c55e] focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-3">
        {/* Objects Section */}
        <SectionLabel>Objects</SectionLabel>
        <ObjectsSidebar
          objects={objects}
          navigation={navigation}
          onNavigate={onNavigate}
          expandedNodes={expandedNodes}
          toggleNode={toggleNode}
          onRefresh={onRefresh}
          searchQuery={searchQuery}
        />
      </div>
    </div>
  );
}

// ============================================
// Section Label
// ============================================
function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`h-4 flex items-center px-2 mb-1 ${className}`}>
      <span className="text-[11px] uppercase tracking-wider text-[#9a9a9a] font-medium">
        {children}
      </span>
    </div>
  );
}

// ============================================
// Objects Sidebar
// ============================================
interface ObjectsSidebarProps {
  objects: AlconObjectWithChildren[];
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  expandedNodes: Set<string>;
  toggleNode: (nodeId: string) => void;
  onRefresh?: () => void;
  searchQuery?: string;
}

function ObjectsSidebar({
  objects,
  navigation,
  onNavigate,
  expandedNodes,
  toggleNode,
  onRefresh,
  searchQuery = '',
}: ObjectsSidebarProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Filter objects based on search
  const filterObjects = (objs: AlconObjectWithChildren[]): AlconObjectWithChildren[] => {
    if (!searchQuery) return objs;
    return objs.filter(obj => {
      const matchesName = obj.name.toLowerCase().includes(searchQuery.toLowerCase());
      const hasMatchingChildren = obj.children && filterObjects(obj.children).length > 0;
      return matchesName || hasMatchingChildren;
    });
  };

  const filteredObjects = filterObjects(objects);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDraggedId(id);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedId !== targetId) {
      setDropTargetId(targetId);
    }
  };

  const handleDragLeave = () => {
    setDropTargetId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetParentId: string | null) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    setDraggedId(null);
    setDropTargetId(null);

    if (id && id !== targetParentId) {
      try {
        await moveObject(id, targetParentId);
        onRefresh?.();
      } catch (err) {
        console.error('Failed to move object:', err);
        alert((err as Error).message);
      }
    }
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDropTargetId(null);
  };

  return (
    <div onDragOver={(e) => handleDragOver(e, null)} onDrop={(e) => handleDrop(e, null)}>
      {/* Drop zone for root level */}
      {dropTargetId === null && draggedId && (
        <div className="h-1 bg-[#22c55e] rounded mx-2 mb-1" />
      )}

      {filteredObjects.map((obj) => (
        <ObjectItem
          key={obj.id}
          object={obj}
          navigation={navigation}
          onNavigate={onNavigate}
          expandedNodes={expandedNodes}
          toggleNode={toggleNode}
          depth={0}
          draggedId={draggedId}
          dropTargetId={dropTargetId}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onRefresh={onRefresh}
        />
      ))}

      {filteredObjects.length === 0 && (
        <div className="px-2 py-4 text-center text-[13px] text-[#9a9a9a]">
          {searchQuery ? 'No matching objects' : 'No objects yet'}
        </div>
      )}
    </div>
  );
}

// ============================================
// Object Item (Recursive) - 40px height
// ============================================
interface ObjectItemProps {
  object: AlconObjectWithChildren;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  expandedNodes: Set<string>;
  toggleNode: (nodeId: string) => void;
  depth: number;
  draggedId: string | null;
  dropTargetId: string | null;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, targetId: string | null) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, targetParentId: string | null) => void;
  onDragEnd: () => void;
  onRefresh?: () => void;
}

function ObjectItem({
  object,
  navigation,
  onNavigate,
  expandedNodes,
  toggleNode,
  depth,
  draggedId,
  dropTargetId,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onRefresh,
}: ObjectItemProps) {
  const isExpanded = expandedNodes.has(object.id);
  const isDragging = draggedId === object.id;
  const isDropTarget = dropTargetId === object.id;
  const isSelected = navigation.objectId === object.id;
  const hasChildren = object.children && object.children.length > 0;

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(object.name);
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

  // Count for display
  const count = (object.children?.length || 0) + (object.elements?.length || 0);

  return (
    <div className={`${isDragging ? 'opacity-50' : ''}`}>
      {/* Drop indicator */}
      {isDropTarget && <div className="h-1 bg-[#22c55e] rounded mx-2 mb-0.5" />}

      <div
        draggable
        onDragStart={(e) => onDragStart(e, object.id)}
        onDragOver={(e) => {
          e.stopPropagation();
          onDragOver(e, object.id);
        }}
        onDragLeave={onDragLeave}
        onDrop={(e) => {
          e.stopPropagation();
          onDrop(e, object.id);
        }}
        onDragEnd={onDragEnd}
        className={`flex items-center gap-2 py-1.5 px-3 cursor-pointer transition-colors duration-100 ${
          isDropTarget ? 'bg-[#22c55e]/10' : ''
        } ${isSelected ? 'bg-black/[0.04]' : 'hover:bg-black/[0.04]'}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        onClick={() => onNavigate({ objectId: object.id })}
        onContextMenu={handleContextMenu}
      >
        {/* Expand/Collapse Arrow */}
        <button
          type="button"
          className={`w-5 h-5 flex items-center justify-center flex-shrink-0 text-[#9a9a9a] transition-transform duration-200 ${
            hasChildren ? '' : 'invisible'
          } ${isExpanded ? 'rotate-90' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) {
              toggleNode(object.id);
            }
          }}
        >
          <ChevronIcon />
        </button>

        {/* Icon */}
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-[#9a9a9a]">
          <ObjectIcon size={16} />
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
            className="text-[13px] text-[#1a1a1a] flex-1 bg-white border border-[#e8e8e8] rounded px-2 py-1 focus:outline-none focus:border-[#22c55e]"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="text-[13px] flex-1 truncate text-[#1a1a1a]">
            {object.name}
          </span>
        )}

        {/* Count badge */}
        {count > 0 && (
          <span className="text-[11px] text-[#9a9a9a] bg-[#f0f0f0] px-1.5 py-0.5 rounded">
            {count}
          </span>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-white border border-[#e8e8e8] rounded-lg shadow-lg py-1 z-50 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-[13px] text-left text-[#1a1a1a] hover:bg-black/[0.04] cursor-pointer transition-colors duration-100"
            onClick={() => {
              setIsRenaming(true);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
        </div>
      )}

      {/* Expanded Content */}
      {isExpanded && hasChildren && (
        <div>
          {object.children!.map((child) => (
            <ObjectItem
              key={child.id}
              object={child}
              navigation={navigation}
              onNavigate={onNavigate}
              expandedNodes={expandedNodes}
              toggleNode={toggleNode}
              depth={depth + 1}
              draggedId={draggedId}
              dropTargetId={dropTargetId}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
