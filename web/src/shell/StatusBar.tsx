'use client';

import { PanelLeft } from '@/ui/icons';
import { MODE_META, railModeOf, BAR_TOOLS, type RailMode } from '@/shell/railApps';
import { useNotifications } from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { viewInScope, type SpaceScope } from '@/Function/space/spaceScope';

// The strip along the foot of the window, as in VS Code. The tools for making
// documents sit at the left; the right holds what stays at hand from any
// screen — the sidebar's toggle, the inbox, the AI and the calendar.

const btn = (active: boolean) =>
  `h-5 gap-1 rounded px-1 text-[11px] font-normal ${active ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`;

export function StatusBar({
  scope,
  activeView,
  onViewChange,
  sidebar,
  ai,
}: {
  scope: SpaceScope;
  activeView: string;
  onViewChange: (view: string) => void;
  /** Absent where the screen has no sidebar. */
  sidebar?: { visible: boolean; onToggle: () => void };
  ai: { open: boolean; onToggle: () => void };
}) {
  const { t } = useI18n();
  const { user } = useAuthContext();
  const { unreadCount } = useNotifications(user?.id ?? null);
  const activeMode = railModeOf(activeView);
  const inScope = (mode: RailMode) => viewInScope(MODE_META[mode].defaultView, scope);
  const go = (mode: RailMode) => { if (activeMode !== mode) onViewChange(MODE_META[mode].defaultView); };

  const modeButton = (mode: RailMode, withLabel: boolean, badge = 0) => {
    const { label, icon: Icon } = MODE_META[mode];
    return (
      <Button key={mode} variant="ghost" size="sm" onClick={() => go(mode)} aria-pressed={activeMode === mode}
        title={t(label)} aria-label={t(label)} className={`relative ${btn(activeMode === mode)}`}>
        <Icon size={12} />
        {withLabel && t(label)}
        {badge > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-[var(--status-danger)] px-0.5 text-[8px] font-semibold text-white">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </Button>
    );
  };
  const AiIcon = MODE_META.ai.icon;

  return (
    <ButtonAppearanceProvider appearance="navigation">
    <footer className="flex h-6 shrink-0 items-center gap-0.5 px-1.5">
      {BAR_TOOLS.filter(inScope).map((mode) => modeButton(mode, true))}

      <div className="ml-auto flex items-center gap-0.5">
        {sidebar && (
          <Button variant="ghost" size="sm" onClick={sidebar.onToggle} aria-pressed={sidebar.visible}
            title={t(sidebar.visible ? 'Hide sidebar' : 'Show sidebar')} aria-label={t(sidebar.visible ? 'Hide sidebar' : 'Show sidebar')}
            className={btn(false)}>
            <PanelLeft size={12} />
          </Button>
        )}
        {inScope('inbox') && modeButton('inbox', false, unreadCount)}
        <Button variant="ghost" size="sm" onClick={ai.onToggle} aria-pressed={ai.open}
          title={`${t(ai.open ? 'Hide AI' : 'Show AI')} (⌘L)`} aria-label={t(ai.open ? 'Hide AI' : 'Show AI')}
          className={btn(ai.open)}>
          <AiIcon size={12} />
        </Button>
        {inScope('calendar') && modeButton('calendar', false)}
      </div>
    </footer>
    </ButtonAppearanceProvider>
  );
}
