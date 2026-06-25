'use client';

import { Plus, X, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { ObjectIcon } from '@/shell/icons';
import { viewLabel, viewIcon } from '@/shell/viewRegistry';
import type { NavigationState } from '@/types/navigation';
import type { AlconObjectWithChildren, ExplorerData } from '@/hooks/useSupabase';

export interface AppTab {
  id: string;
  activeView: string;
  navigation: NavigationState;
  /** Last Home-mode view, restored when the Home mode button is pressed so
   *  switching to Room/Chat/Note and back doesn't lose your place. */
  lastHomeView?: string;
}

interface WindowTabBarProps {
  tabs: AppTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
  explorerData?: ExplorerData;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** Open / close the right-side Alcon Copilot pane. */
  copilotOpen?: boolean;
  onToggleCopilot?: () => void;
}


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
  return viewLabel(tab.activeView);
}

function getTabIcon(tab: AppTab): React.ReactNode {
  if (tab.activeView === 'projects' && tab.navigation.objectId) {
    return <ObjectIcon size={13} />;
  }
  const Icon = viewIcon(tab.activeView);
  return Icon ? <Icon size={13} /> : <ObjectIcon size={13} />;
}

export function WindowTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCreate,
  explorerData,
  sidebarCollapsed,
  onToggleSidebar,
  copilotOpen,
  onToggleCopilot,
}: WindowTabBarProps) {
  return (
    <div className="flex items-center gap-1.5 pl-0 pr-2 py-1.5 flex-shrink-0">
      <div className="flex items-center gap-1.5 overflow-x-auto">
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
                group flex items-center gap-1.5 pl-3 pr-2 py-1 cursor-pointer select-none
                rounded-md transition-colors flex-shrink-0 min-w-[200px] max-w-[280px]
                border
                ${isActive
                  // Match the MainIsland wrapper exactly so the active tab
                  // reads as the same surface (`bg-white dark:bg-card` +
                  // `border-border/60` — a thin line, a touch stronger than the
                  // ModeRail's so the island + tabs read clearly). Previously a
                  // punchier `border-foreground/30` outline left the active chip
                  // looking distinct rather than the top of the island below.
                  ? 'bg-white dark:bg-card text-foreground border-border/60'
                  : 'bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-muted/30 hover:border-foreground/20'
                }
              `}
            >
              <span className={isActive ? 'text-foreground/80 shrink-0' : 'text-muted-foreground shrink-0'}>
                {getTabIcon(tab)}
              </span>
              <span className="text-[12px] font-semibold truncate flex-1 min-w-0">
                {label}
              </span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  aria-label="Close tab"
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-opacity shrink-0"
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
        className="flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-full transition-colors flex-shrink-0"
      >
        <Plus size={14} />
      </button>
      <div className="flex-1" />
      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md transition-colors flex-shrink-0"
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      )}
      {/* Right-panel toggle → opens the Alcon Copilot pane. State lives in
          the page so this button + ⌘L + the panel's own close button all
          flip the same boolean. */}
      {onToggleCopilot && (
        <button
          type="button"
          onClick={onToggleCopilot}
          aria-label={copilotOpen ? 'Hide Alcon Copilot' : 'Show Alcon Copilot'}
          title={`Alcon Copilot ( ⌘L )${copilotOpen ? ' — hide' : ''}`}
          className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md transition-colors flex-shrink-0"
        >
          {copilotOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      )}
    </div>
  );
}
