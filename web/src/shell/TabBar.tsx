'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, List, Calendar, Users, BarChart3, GanttChart, ClipboardList, Trash2, Kanban } from 'lucide-react';
import type { ObjectTab, ObjectTabType } from '@/types/database';

interface TabBarProps {
  tabs: ObjectTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabCreate: (type: ObjectTabType, title: string) => void;
}

const TAB_ICONS: Record<ObjectTabType, React.ReactNode> = {
  summary: <BarChart3 size={14} />,
  elements: <List size={14} />,
  overview: <ClipboardList size={14} />,
  gantt: <GanttChart size={14} />,
  calendar: <Calendar size={14} />,
  workers: <Users size={14} />,
  board: <Kanban size={14} />,
};

const TAB_OPTIONS: { type: ObjectTabType; label: string; icon: React.ReactNode }[] = [
  { type: 'overview', label: 'Overview', icon: <ClipboardList size={16} /> },
  { type: 'summary', label: 'Dashboard', icon: <BarChart3 size={16} /> },
  { type: 'board', label: 'Board', icon: <Kanban size={16} /> },
  { type: 'gantt', label: 'Gantt', icon: <GanttChart size={16} /> },
  { type: 'calendar', label: 'Calendar', icon: <Calendar size={16} /> },
  { type: 'workers', label: 'Workers', icon: <Users size={16} /> },
];

interface ContextMenu {
  tabId: string;
  tabType: ObjectTabType;
  x: number;
  y: number;
}

export function TabBar({ tabs, activeTabId, onTabSelect, onTabClose, onTabCreate }: TabBarProps) {
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const handleCreate = (type: ObjectTabType) => {
    const defaultTitles: Record<ObjectTabType, string> = {
      summary: 'Dashboard',
      elements: 'List',
      overview: 'Overview',
      gantt: 'Gantt',
      calendar: 'Calendar',
      workers: 'Workers',
      board: 'Board',
    };
    onTabCreate(type, defaultTitles[type]);
    setShowCreateMenu(false);
  };

  const handleContextMenu = (e: React.MouseEvent, tab: ObjectTab) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ tabId: tab.id, tabType: tab.tab_type, x: e.clientX, y: e.clientY });
  };

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      setContextMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [contextMenu]);

  // Adjust position if context menu overflows viewport
  const getMenuStyle = () => {
    if (!contextMenu) return {};
    const menuWidth = 160;
    const menuHeight = 48;
    const x = contextMenu.x + menuWidth > window.innerWidth ? contextMenu.x - menuWidth : contextMenu.x;
    const y = contextMenu.y + menuHeight > window.innerHeight ? contextMenu.y - menuHeight : contextMenu.y;
    return { left: x, top: y };
  };

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 bg-transparent">
      {/* Tabs — pill / chip buttons */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              className={`
                group flex items-center gap-1.5 px-3 py-1 cursor-pointer select-none rounded-full
                transition-colors flex-shrink-0 border
                ${isActive
                  ? 'bg-muted text-foreground border-border'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/40'
                }
              `}
              onClick={() => onTabSelect(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab)}
            >
              <span className={isActive ? 'text-foreground' : 'text-muted-foreground'}>
                {TAB_ICONS[tab.tab_type]}
              </span>
              <span className="text-xs font-medium">
                {tab.title}
              </span>
            </button>
          );
        })}
      </div>

      {/* Add Tab Button */}
      <div className="relative flex items-center flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowCreateMenu(!showCreateMenu)}
          className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-full transition-colors"
        >
          <Plus size={14} />
        </button>

        {showCreateMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowCreateMenu(false)} />
            <div className="absolute top-full left-0 mt-1 py-1 bg-popover border border-border rounded-lg shadow-xl z-50 min-w-[150px]">
              {TAB_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  onClick={() => handleCreate(option.type)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                >
                  <span className="text-muted-foreground">{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* Right-click context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" />
          <div
            ref={contextMenuRef}
            className="fixed z-50 py-1 bg-popover border border-border rounded-lg shadow-xl min-w-[160px]"
            style={getMenuStyle()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {contextMenu.tabType !== 'elements' ? (
              <button
                onClick={() => { onTabClose(contextMenu.tabId); setContextMenu(null); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 size={14} />
                Delete tab
              </button>
            ) : (
              <div className="px-3 py-2 text-[12px] text-muted-foreground">
                List tab cannot be deleted
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
