'use client';

import { useMemo, useState } from 'react';
import { Check } from '@/ui/icons';
import { NavSustainmentModeIcon } from '@/shell/sidebar/NavIcons';
import {
  APP_GROUPS,
  MODE_META,
  isAppMode,
  railModeOf,
  useRailApps,
  type RailMode,
} from '@/shell/railApps';
import { useAuthContext } from '@/providers/AuthProvider';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { MenuShell, MenuSectionLabel } from '@/Function/shared/menu';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { viewInScope, type SpaceScope } from '@/Function/space/spaceScope';
import { SpaceMark } from '@/Function/space/SpaceSwitcher';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useActivitySpaces } from '@/hooks/useSupabase';

export type { RailMode };

const AUDIT_RAIL_APPS: RailMode[] = ['team', 'audit'];

// The ModeRail is the thin, always-visible column at the far left. It groups
// every activity view into a handful of top-level modes; picking one swaps the
// AppSidebar's contents to that mode's surfaces. Unlike the sidebar it never
// collapses — it's the app's primary spine.
//
// At the top sits the Space's logo, which opens the Workspace: Strategy (the
// Strategies, which nest without limit) and Execution (the Domains, with their
// Objects and Elements) in one sidebar, one section each. An Initiative shows
// its member Objects and an Object the Initiatives it serves, so moving
// between intent and action never leaves the mode.
//
// Below it sits the launcher: the apps a person has added, then the
// Sustainment launcher that adds them.

export { railModeOf } from '@/shell/railApps';

function RailButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-sidebar-accent text-foreground'
          : 'text-muted-foreground/70 hover:bg-sidebar-accent/50 hover:text-foreground'
      }`}
    >
      <Icon size={18} />
    </button>
  );
}

// The Space's logo — the Workspace's entry, the way a company's mark heads
// its own tools.
function WorkspaceRailButton({ active, onClick }: { active: boolean; onClick?: () => void }) {
  const { t } = useI18n();
  const { data: spaces } = useActivitySpaces();
  const activeId = useActiveSpaceId();
  const space = spaces.find((s) => s.id === activeId) ?? spaces[0];
  const label = space?.name ?? t('Workspace');
  if (!onClick) return <span className="flex h-8 w-8 items-center justify-center" title={label}><SpaceMark space={space} size={24} /></span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'
      }`}
    >
      <SpaceMark space={space} size={24} />
    </button>
  );
}

// The avatar opens the Profile page, which carries the personal surfaces
// (Now, My Elements, My Notes, AI) as its own tabs.
function ProfileRailButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  const name = profile?.display_name || user?.email?.split('@')[0] || null;
  const avatarUrl = profile?.avatar_url;
  // ModeRail is mounted on every page, so a stable `worker` reference lets
  // WorkerAvatar bail out on re-renders that don't actually change these two
  // fields (useAuthContext's own value is a fresh object each time).
  const worker = useMemo(() => ({ name, avatar_url: avatarUrl }), [name, avatarUrl]);
  return (
    <button
      type="button"
      onClick={onClick}
      title={name ?? t('Profile')}
      aria-label={t('Profile')}
      aria-pressed={active}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'
      }`}
    >
      <WorkerAvatar worker={worker} size={26} />
    </button>
  );
}

export function ModeRail({
  scope,
  activeView,
  onViewChange,
}: {
  scope: SpaceScope;
  activeView: string;
  onViewChange: (view: string) => void;
}) {
  const { t } = useI18n();
  const activeMode = railModeOf(activeView);
  const [apps, setApp] = useRailApps();
  const [launcherOpen, setLauncherOpen] = useState(false);

  // An app opened without being added still shows while you're inside it, so
  // the rail never leaves you without a marker for where you are.
  // An audit Space (ADR 0048) keeps People and Audit on the rail and offers
  // nothing else to add.
  const audit = scope === 'audit';
  const workspace = viewInScope(MODE_META.workspace.defaultView, scope);
  const railApps = audit
    ? AUDIT_RAIL_APPS
    : activeMode && isAppMode(activeMode) && !apps.includes(activeMode)
      ? [...apps, activeMode]
      : apps;

  const open = (mode: RailMode) => {
    // Re-clicking the active mode keeps whatever sub-view is open; switching
    // modes lands on that mode's default surface.
    if (activeMode !== mode) onViewChange(MODE_META[mode].defaultView);
  };

  return (
    <ButtonAppearanceProvider appearance="navigation"><Popover open={launcherOpen} onOpenChange={setLauncherOpen}>
    <div className="flex w-10 shrink-0 flex-col items-center gap-1 bg-background py-2">
      {/* An audit Space shows its mark but has no Workspace to open. */}
      <WorkspaceRailButton active={activeMode === 'workspace'} onClick={workspace ? () => open('workspace') : undefined} />

      {/* Below the line is the part each person builds: the apps they added,
          then the Sustainment launcher that adds them. */}
      <div className="my-1 h-px w-5 bg-border" />

      {railApps.map((mode) => (
        <RailButton
          key={mode}
          label={t(MODE_META[mode].label)}
          icon={MODE_META[mode].icon}
          active={mode === activeMode}
          onClick={() => open(mode)}
        />
      ))}

      {!audit && <PopoverTrigger asChild>
      <Button
        variant="ghost"
        size="icon-md"
        title={t('Sustainment')}
        aria-label={t('Sustainment')}
        aria-expanded={launcherOpen}
        className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
          launcherOpen
            ? 'bg-sidebar-accent text-foreground'
            : 'text-muted-foreground/70 hover:bg-sidebar-accent/50 hover:text-foreground'
        }`}
      >
        <NavSustainmentModeIcon size={18} />
      </Button>
      </PopoverTrigger>}

      {/* Pinned to the foot of the spine regardless of how many modes/apps
          sit above — the one personal entry point on an otherwise all-work
          rail. */}
      <div className="mt-auto flex flex-col items-center gap-1">
        <ProfileRailButton active={activeMode === 'personal'} onClick={() => onViewChange('profile')} />
      </div>

      <MenuShell className="border-transparent" width="wide" side="right" align="start" sideOffset={8} aria-label={t('Sustainment apps')}>
            {APP_GROUPS.map((group) => (
              <div key={group.title} className="mb-2 last:mb-0">
                <MenuSectionLabel>{t(group.title)}</MenuSectionLabel>
                <div className="grid grid-cols-3 gap-1">
                  {group.apps.map((mode) => {
                    const { label, icon: Icon } = MODE_META[mode];
                    const added = apps.includes(mode);
                    return (
                      <div key={mode} className="group/app relative">
                        {/* Picking an app puts it on the rail and opens it —
                            one press, no separate add step. The check on an
                            app you already keep is how it goes back to being
                            just a catalog entry. */}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setApp(mode, true);
                            onViewChange(MODE_META[mode].defaultView);
                            setLauncherOpen(false);
                          }}
                          className="h-20 w-full flex-col gap-2"
                        >
                          <Icon size={20} />
                          <span className="text-[11px] font-semibold">{t(label)}</span>
                        </Button>
                        {added && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setApp(mode, false)}
                            title={t('Remove {label} from the rail', { label: t(label) })}
                            aria-label={t('Remove {label} from the rail', { label: t(label) })}
                            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md text-foreground transition-colors hover:bg-sidebar-accent"
                          >
                            <Check size={12} />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
      </MenuShell>
    </div>
    </Popover></ButtonAppearanceProvider>
  );
}
