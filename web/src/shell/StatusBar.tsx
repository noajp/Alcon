'use client';

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The strip along the bottom of the window, the way VS Code keeps its
// status bar: the controls that belong to the whole page rather than to any
// one surface. Right now that is the sidebar toggle and the AI pane toggle;
// the left side is free for status later.
export function StatusBar({
  sidebarCollapsed,
  onToggleSidebar,
  copilotOpen,
  onToggleCopilot,
}: {
  sidebarCollapsed: boolean;
  /** Omitted while the sidebar has nothing to show (Profile). */
  onToggleSidebar?: () => void;
  copilotOpen: boolean;
  onToggleCopilot: () => void;
}) {
  const { t } = useI18n();
  return (
    <ButtonAppearanceProvider appearance="navigation">
      <div className="flex h-7 shrink-0 items-center gap-0.5 border-t border-border/60 bg-[var(--content-bg)] px-2">
        <div className="flex-1" />
        {onToggleSidebar && (
          <Button size="icon-xs" variant="ghost"
            type="button"
            onClick={onToggleSidebar}
            aria-label={t(sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar')}
            title={t(sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar')}
            className="text-muted-foreground hover:text-foreground"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </Button>
        )}
        {/* The AI pane: state lives in the page so this button, ⌘L and the
            pane's own close all flip the same boolean. */}
        <Button size="icon-xs" variant="ghost"
          type="button"
          onClick={onToggleCopilot}
          aria-label={t(copilotOpen ? 'Hide AI' : 'Show AI')}
          title={`AI ( ⌘L )${copilotOpen ? ' — hide' : ''}`}
          className="text-muted-foreground hover:text-foreground"
        >
          {copilotOpen ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
        </Button>
      </div>
    </ButtonAppearanceProvider>
  );
}
