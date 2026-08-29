'use client';

import { useRef, useState } from 'react';
import { Check, Grip } from 'lucide-react';
import {
  APP_GROUPS,
  CORE_MODES,
  MODE_META,
  isAppMode,
  useRailApps,
  type RailMode,
} from '@/shell/railApps';
import type { ViewId } from '@/shell/viewRegistry';

export type { RailMode };

// The ModeRail is the thin, always-visible column at the far left. It groups
// every activity view into a handful of top-level modes; picking one swaps the
// AppSidebar's contents to that mode's surfaces. Unlike the sidebar it never
// collapses — it's the app's primary spine.
//
// Strategy and Execution are separate modes on purpose. Strategy is Ends /
// Ways — what we're trying to achieve and how we intend to win. Execution is
// the employment of means — who and what gets put on which work. Listing both
// in one surface flattens that distinction, so the rail keeps them apart. The
// link between them is never cut, though: a Campaign shows its member Objects
// and an Object shows the Campaigns it contributes to, and because the rail
// highlight follows `activeView`, following either link swaps modes on its
// own. One click each way.
//
// Below those three sits the launcher: the apps a person has added, then the
// grid that adds them.

// Which mode a given activity view belongs to — the single source of truth for
// the rail highlight and for the AppSidebar's mode branch. Views not listed
// (settings / account) belong to no mode, so the rail shows nothing active.
const VIEW_TO_MODE: Record<string, RailMode> = {
  inbox: 'home',
  calendar: 'home',
  'my-elements': 'home',
  home: 'home',
  // ── Strategy: Ends / Ways ──
  // `strategy` is the Campaign portfolio — one artifact inside the layer, not
  // the layer itself, which is why the mode and the view share a name without
  // being the same thing.
  strategy: 'strategy',
  phase: 'strategy',
  timeline: 'strategy',
  // ── Execution: employment of means ──
  projects: 'execution',
  mytasks: 'execution',
  domains: 'execution',
  room: 'execution',
  chat: 'execution',
  // ── Apps ──
  workload: 'workload',
  note: 'notebook',
  notes: 'notebook',
  brief: 'notebook',
  tables: 'tables',
  team: 'team',
};

export function railModeOf(view: string): RailMode | null {
  return VIEW_TO_MODE[view] ?? null;
}

// The view each rail button lands on. Home opens the notifications feed;
// Strategy opens the Campaign portfolio; Execution opens the active Domain's
// Objects; the rest map 1:1.
const RAIL_DEFAULT_VIEW: Record<RailMode, ViewId> = {
  home: 'inbox',
  strategy: 'strategy',
  execution: 'projects',
  workload: 'workload',
  notebook: 'note',
  tables: 'tables',
  team: 'team',
};

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

export function ModeRail({
  activeView,
  onViewChange,
}: {
  activeView: string;
  onViewChange: (view: string) => void;
}) {
  const activeMode = railModeOf(activeView);
  const [apps, setApp] = useRailApps();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [launcherPos, setLauncherPos] = useState({ left: 54, top: 12 });
  const launcherRef = useRef<HTMLButtonElement>(null);

  // An app opened without being added still shows while you're inside it, so
  // the rail never leaves you without a marker for where you are.
  const railApps =
    activeMode && isAppMode(activeMode) && !apps.includes(activeMode)
      ? [...apps, activeMode]
      : apps;

  const openLauncher = () => {
    const rect = launcherRef.current?.getBoundingClientRect();
    if (rect) setLauncherPos({ left: rect.right + 8, top: rect.top });
    setLauncherOpen(true);
  };

  const open = (mode: RailMode) => {
    // Re-clicking the active mode keeps whatever sub-view is open; switching
    // modes lands on that mode's default surface.
    if (activeMode !== mode) onViewChange(RAIL_DEFAULT_VIEW[mode]);
  };

  return (
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
          then the grid that adds them. */}
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

      <button
        ref={launcherRef}
        type="button"
        onClick={openLauncher}
        title="Apps"
        aria-label="Apps"
        aria-expanded={launcherOpen}
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
          launcherOpen
            ? 'bg-sidebar-accent text-foreground'
            : 'text-muted-foreground/70 hover:bg-sidebar-accent/50 hover:text-foreground'
        }`}
      >
        <Grip size={18} />
      </button>

      {launcherOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setLauncherOpen(false)} />
          <div
            className="fixed z-50 w-[288px] overflow-hidden rounded-xl border border-border bg-popover p-2.5 shadow-xl"
            style={{ left: launcherPos.left, top: launcherPos.top }}
          >
            {APP_GROUPS.map((group) => (
              <div key={group.title} className="mb-2.5 last:mb-0">
                <div className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/60">
                  {group.title}
                </div>
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
                        <button
                          type="button"
                          onClick={() => {
                            setApp(mode, true);
                            onViewChange(RAIL_DEFAULT_VIEW[mode]);
                            setLauncherOpen(false);
                          }}
                          className="flex w-full flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Icon size={20} />
                          <span className="text-[11px] font-semibold">{label}</span>
                        </button>
                        {added && (
                          <button
                            type="button"
                            onClick={() => setApp(mode, false)}
                            title={`Remove ${label} from the rail`}
                            aria-label={`Remove ${label} from the rail`}
                            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-md text-foreground transition-colors hover:bg-sidebar-accent"
                          >
                            <Check size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
