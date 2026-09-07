'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { NavSustainmentModeIcon } from '@/shell/sidebar/NavIcons';
import {
  APP_GROUPS,
  CORE_MODES,
  MODE_META,
  isAppMode,
  railModeOf,
  useRailApps,
  type RailMode,
} from '@/shell/railApps';
import { useAuthContext } from '@/providers/AuthProvider';
import { Button } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { MenuShell, MenuSectionLabel } from '@/alcon/shared/menu';
import { WorkerAvatar } from '@/alcon/shared/WorkerAvatar';

export type { RailMode };

// The ModeRail is the thin, always-visible column at the far left. It groups
// every activity view into a handful of top-level modes; picking one swaps the
// AppSidebar's contents to that mode's surfaces. Unlike the sidebar it never
// collapses — it's the app's primary spine.
//
// Strategy and Execution are separate modes on purpose. Strategy is what we're
// trying to achieve and how we intend to win — Initiatives, bundled into a
// strategy. Execution is the fighting itself — Elements bundled into Objects,
// Objects gathered into Domains. Listing both
// in one surface flattens that distinction, so the rail keeps them apart. The
// link between them is never cut, though: a Initiative shows its member Objects
// and an Object shows the Initiatives it contributes to, and because the rail
// highlight follows `activeView`, following either link swaps modes on its
// own. One click each way.
//
// Below those three sits the launcher: the apps a person has added, then the
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
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
        active
          ? 'bg-sidebar-accent text-foreground'
          : 'text-muted-foreground/70 hover:bg-sidebar-accent/50 hover:text-foreground'
      }`}
    >
      <Icon size={18} />
    </button>
  );
}

// The personal surface keeps My Elements and AI behind the signed-in avatar.
function ProfileRailButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
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
      title="Profile"
      aria-label="Profile"
      aria-pressed={active}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'
      }`}
    >
      <WorkerAvatar worker={worker} size={28} />
    </button>
  );
}

export function ModeRail({
  activeView,
  onViewChange,
}: {
  activeView: string;
  onViewChange: (view: string) => void;
  /** Settings opens in its own tab rather than overwriting the active
   *  tab's view — see the rationale on page.tsx's handleOpenSettings. */
  onOpenSettings: () => void;
}) {
  const activeMode = railModeOf(activeView);
  const [apps, setApp] = useRailApps();
  const [launcherOpen, setLauncherOpen] = useState(false);

  // An app opened without being added still shows while you're inside it, so
  // the rail never leaves you without a marker for where you are.
  const railApps =
    activeMode && isAppMode(activeMode) && !apps.includes(activeMode)
      ? [...apps, activeMode]
      : apps;

  const open = (mode: RailMode) => {
    // Re-clicking the active mode keeps whatever sub-view is open; switching
    // modes lands on that mode's default surface.
    if (activeMode !== mode) onViewChange(MODE_META[mode].defaultView);
  };

  return (
    <Popover open={launcherOpen} onOpenChange={setLauncherOpen}>
    <div className="flex w-[46px] shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2">
      {CORE_MODES.map((mode) => (
        <RailButton
          key={mode}
          label={MODE_META[mode].label}
          icon={MODE_META[mode].icon}
          active={mode === activeMode}
          onClick={() => open(mode)}
        />
      ))}

      {/* Below the line is the part each person builds: the apps they added,
          then the Sustainment launcher that adds them. */}
      <div className="my-1 h-px w-5 bg-border" />

      {railApps.map((mode) => (
        <RailButton
          key={mode}
          label={MODE_META[mode].label}
          icon={MODE_META[mode].icon}
          active={mode === activeMode}
          onClick={() => open(mode)}
        />
      ))}

      <PopoverTrigger asChild>
      <Button
        variant="ghost"
        size="icon-md"
        title="Sustainment"
        aria-label="Sustainment"
        aria-expanded={launcherOpen}
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
          launcherOpen
            ? 'bg-sidebar-accent text-foreground'
            : 'text-muted-foreground/70 hover:bg-sidebar-accent/50 hover:text-foreground'
        }`}
      >
        <NavSustainmentModeIcon size={18} />
      </Button>
      </PopoverTrigger>

      {/* Pinned to the foot of the spine regardless of how many modes/apps
          sit above — the one personal entry point on an otherwise all-work
          rail. */}
      <div className="mt-auto flex flex-col items-center gap-1">
        <div className="my-1 h-px w-5 bg-border" />
        <ProfileRailButton active={activeView === 'profile'} onClick={() => onViewChange('profile')} />
      </div>

      <MenuShell width="wide" side="right" align="start" sideOffset={8} aria-label="Sustainment apps">
            {APP_GROUPS.map((group) => (
              <div key={group.title} className="mb-2 last:mb-0">
                <MenuSectionLabel>{group.title}</MenuSectionLabel>
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
                          <span className="text-[11px] font-semibold">{label}</span>
                        </Button>
                        {added && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setApp(mode, false)}
                            title={`Remove ${label} from the rail`}
                            aria-label={`Remove ${label} from the rail`}
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
    </Popover>
  );
}
