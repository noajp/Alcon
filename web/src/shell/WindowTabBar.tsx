'use client';

import { Plus, X } from 'lucide-react';
import {
  NavInboxIcon,
  NavNoteIcon,
  NavBriefIcon,
  NavRoomIcon,
  NavObjectsIcon,
  NavMyTasksIcon,
} from '@/shell/sidebar/NavIcons';
import { ObjectIcon } from '@/shell/icons';
import type { NavigationState } from '@/types/navigation';
import type { AlconObjectWithChildren, ExplorerData } from '@/hooks/useSupabase';

export interface AppTab {
  id: string;
  activeView: string;
  navigation: NavigationState;
}

interface WindowTabBarProps {
  tabs: AppTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
  explorerData?: ExplorerData;
}

// Activity → display label
const VIEW_LABEL: Record<string, string> = {
  home: 'Home',
  inbox: 'Inbox',
  notes: 'Note',
  note: 'Note',
  brief: 'Brief',
  room: 'Room',
  projects: 'Objects',
  mytasks: 'Elements',
  actions: 'Actions',
  domains: 'Domains',
  settings: 'Settings',
  account: 'Account',
};

const VIEW_ICON: Record<string, React.ComponentType<{ size?: number }>> = {
  inbox: NavInboxIcon,
  notes: NavNoteIcon,
  note: NavNoteIcon,
  brief: NavBriefIcon,
  room: NavRoomIcon,
  projects: NavObjectsIcon,
  mytasks: NavMyTasksIcon,
};

function findObjectName(objects: AlconObjectWithChildren[] | undefined, id: string): string | null {
  if (!objects) return null;
  for (const o of objects) {
    if (o.id === id) return o.name;
    if (o.children) {
      const found = findObjectName(o.children, id);
      if (found) return found;
    }
  }
  return null;
}

function getTabLabel(tab: AppTab, explorerData?: ExplorerData): string {
  if (tab.activeView === 'projects' && tab.navigation.objectId) {
    const name = findObjectName(explorerData?.objects, tab.navigation.objectId);
    if (name) return name;
  }
  return VIEW_LABEL[tab.activeView] ?? 'Tab';
}

function getTabIcon(tab: AppTab): React.ReactNode {
  if (tab.activeView === 'projects' && tab.navigation.objectId) {
    return <ObjectIcon size={13} />;
  }
  const Icon = VIEW_ICON[tab.activeView];
  return Icon ? <Icon size={13} /> : <ObjectIcon size={13} />;
}

export function WindowTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCreate,
  explorerData,
}: WindowTabBarProps) {
  return (
    <div className="flex items-center gap-1 px-2 pt-2 pb-1 border-b border-border/30 bg-transparent flex-shrink-0">
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const label = getTabLabel(tab, explorerData);
          return (
            <div
              key={tab.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(tab.id);
                }
              }}
              className={`
                group flex items-center gap-1.5 pl-2.5 pr-1.5 py-0.5 cursor-pointer select-none rounded-md
                transition-colors flex-shrink-0 border min-w-[160px] max-w-[240px]
                ${isActive
                  ? 'bg-muted text-foreground border-border'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/40'
                }
              `}
            >
              <span className={isActive ? 'text-foreground/80 shrink-0' : 'text-muted-foreground shrink-0'}>
                {getTabIcon(tab)}
              </span>
              <span className="text-[12px] font-medium truncate flex-1 min-w-0">
                {label}
              </span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  aria-label="Close tab"
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-opacity shrink-0"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onCreate}
        aria-label="New tab"
        className="flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors flex-shrink-0"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
