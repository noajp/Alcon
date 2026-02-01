'use client';

import { useState } from 'react';
import { Plus, X, FileText, List, Calendar, Users, BarChart3, GanttChart, Grid3X3 } from 'lucide-react';
import type { ObjectTab, ObjectTabType } from '@/types/database';

interface TabBarProps {
  tabs: ObjectTab[];
  activeTabId: string | null;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabCreate: (type: ObjectTabType, title: string) => void;
}

// Tab type icons
const TAB_ICONS: Record<ObjectTabType, React.ReactNode> = {
  summary: <BarChart3 size={14} />,
  elements: <List size={14} />,
  note: <FileText size={14} />,
  gantt: <GanttChart size={14} />,
  calendar: <Calendar size={14} />,
  workers: <Users size={14} />,
  matrix: <Grid3X3 size={14} />,
};

// Tab type labels for create menu
const TAB_OPTIONS: { type: ObjectTabType; label: string; icon: React.ReactNode }[] = [
  { type: 'note', label: 'Note', icon: <FileText size={16} /> },
  { type: 'matrix', label: 'Matrix', icon: <Grid3X3 size={16} /> },
  { type: 'summary', label: 'Summary', icon: <BarChart3 size={16} /> },
  { type: 'gantt', label: 'Gantt', icon: <GanttChart size={16} /> },
  { type: 'calendar', label: 'Calendar', icon: <Calendar size={16} /> },
  { type: 'workers', label: 'Workers', icon: <Users size={16} /> },
];

export function TabBar({ tabs, activeTabId, onTabSelect, onTabClose, onTabCreate }: TabBarProps) {
  const [showCreateMenu, setShowCreateMenu] = useState(false);

  const handleCreate = (type: ObjectTabType) => {
    console.log('[TabBar] handleCreate called with type:', type);
    const defaultTitles: Record<ObjectTabType, string> = {
      summary: 'Summary',
      elements: 'Elements',
      note: 'New Note',
      gantt: 'Gantt',
      calendar: 'Calendar',
      workers: 'Workers',
      matrix: 'Matrix',
    };
    onTabCreate(type, defaultTitles[type]);
    setShowCreateMenu(false);
  };

  return (
    <div className="flex items-stretch bg-muted/30 border-b border-border">
      {/* Tabs */}
      <div className="flex items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`
                group flex items-center gap-1.5 px-3 py-2 cursor-pointer
                transition-colors min-w-[100px] max-w-[180px] flex-shrink-0 border-r border-border
                ${isActive
                  ? 'bg-background text-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground/80 hover:bg-muted'
                }
              `}
              onClick={() => onTabSelect(tab.id)}
            >
              <span className={isActive ? 'text-foreground' : 'text-muted-foreground'}>
                {TAB_ICONS[tab.tab_type]}
              </span>
              <span className="flex-1 text-xs font-medium truncate">
                {tab.title}
              </span>
              {/* Close button - don't show for elements tab */}
              {tab.tab_type !== 'elements' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent rounded transition-opacity"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Tab Button - outside overflow container */}
      <div className="relative flex items-center px-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowCreateMenu(!showCreateMenu)}
          className="flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors z-10"
        >
          <Plus size={14} />
        </button>

        {/* Create Menu Dropdown */}
        {showCreateMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowCreateMenu(false)}
            />
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

      {/* Spacer */}
      <div className="flex-1" />
    </div>
  );
}
