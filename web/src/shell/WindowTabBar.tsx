'use client';
import { Button } from '@/ui/button';

import { CONTROL } from '@/shared/designTokens';
import { useExplorerData } from '@/Function/shared/ExplorerDataContext';

import { Plus, X, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { ObjectIcon } from '@/shell/icons';
import { viewLabel, viewIcon } from '@/shell/viewRegistry';
import type { NavigationState } from '@/types/navigation';
import type { AlconObjectWithChildren, ExplorerData } from '@/hooks/useSupabase';
import { useI18n } from '@/Function/i18n/I18nProvider';

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
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** Open / close the right-side Alcon Copilot pane. */
  copilotOpen?: boolean;
  onToggleCopilot?: () => void;
}


function findObjectName(objects: AlconObjectWithChildren[] | undefined, id: string): string | null {
  return objects?.find((o) => o.id === id)?.name ?? null;
}

function getObjectTabLabel(tab: AppTab, explorerData?: ExplorerData): string | null {
  if (tab.activeView === 'objects' && tab.navigation.objectId) {
    const name = findObjectName(explorerData?.objects, tab.navigation.objectId);
    if (name) return name;
  }
  return null;
}

function getTabIcon(tab: AppTab): React.ReactNode {
  if (tab.activeView === 'objects' && tab.navigation.objectId) {
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
  sidebarCollapsed,
  onToggleSidebar,
  copilotOpen,
  onToggleCopilot,
}: WindowTabBarProps) {
  const { t } = useI18n();
  const explorerData = useExplorerData();
  return (
    <div className="flex items-center gap-1.5 pl-0 pr-2 py-1.5 flex-shrink-0">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          // User-authored Object names are content, never translation keys.
          const label = getObjectTabLabel(tab, explorerData) ?? t(viewLabel(tab.activeView));
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
                ${CONTROL.tabRadius} ${CONTROL.border} transition-colors flex-shrink-0 min-w-[200px] max-w-[280px]
                ${isActive
                  ? 'bg-white dark:bg-card text-foreground border-[var(--border-strong)]'
                  : 'bg-transparent text-foreground hover:bg-muted/30 hover:border-[var(--border-strong)]'
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
                <Button size="icon-sm" variant="ghost"
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  aria-label={t('Close tab')}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 w-4 h-4 flex items-center justify-center rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-opacity shrink-0"
                >
                  <X size={11} />
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <Button size="icon-sm" variant="ghost"
        type="button"
        onClick={onCreate}
        aria-label={t('New tab')}
        className="flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-full transition-colors flex-shrink-0"
      >
        <Plus size={14} />
      </Button>
      <div className="flex-1" />
      {onToggleSidebar && (
        <Button size="icon-sm" variant="ghost"
          type="button"
          onClick={onToggleSidebar}
          aria-label={t(sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar')}
          title={t(sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar')}
          className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex-shrink-0"
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </Button>
      )}
      {/* Right-panel toggle → opens the AI pane. State lives in the page so
          this button + ⌘L + the panel's own close button all flip the same
          boolean. Closed shows ">" (open it); open shows "<" (collapse). */}
      {onToggleCopilot && (
        <Button size="icon-sm" variant="ghost"
          type="button"
          onClick={onToggleCopilot}
          aria-label={t(copilotOpen ? 'Hide AI' : 'Show AI')}
          title={`AI ( ⌘L )${copilotOpen ? ' — hide' : ''}`}
          className="flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex-shrink-0"
        >
          {copilotOpen ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </Button>
      )}
    </div>
  );
}
