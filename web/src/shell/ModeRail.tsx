'use client';

import {
  NavHomeIcon,
  NavNoteIcon,
  NavTableIcon,
  NavTeamsIcon,
} from '@/shell/sidebar/NavIcons';
import type { ViewId } from '@/shell/viewRegistry';

// The ModeRail is the thin, always-visible column at the far left. It groups
// every activity view into a handful of top-level modes; picking one swaps the
// AppSidebar's contents to that mode's surfaces. Unlike the sidebar it never
// collapses — it's the app's primary spine.
export type RailMode = 'home' | 'layers' | 'notebook' | 'tables' | 'team';

// Which mode a given activity view belongs to — the single source of truth for
// the rail highlight and for the AppSidebar's mode branch. Views not listed
// (settings / account) belong to no mode, so the rail shows nothing active.
const VIEW_TO_MODE: Record<string, RailMode> = {
  inbox: 'home',
  calendar: 'home',
  'my-elements': 'home',
  home: 'home',
  strategy: 'layers',
  approach: 'layers',
  planning: 'layers',
  phase: 'layers',
  projects: 'layers',
  mytasks: 'layers',
  domains: 'layers',
  room: 'layers',
  chat: 'layers',
  note: 'notebook',
  notes: 'notebook',
  brief: 'notebook',
  tables: 'tables',
  team: 'team',
};

export function railModeOf(view: string): RailMode | null {
  return VIEW_TO_MODE[view] ?? null;
}

// The view each rail button lands on. Home opens the notifications feed; the
// layers triangle opens Strategy; the rest map 1:1.
const RAIL_DEFAULT_VIEW: Record<RailMode, ViewId> = {
  home: 'inbox',
  layers: 'strategy',
  notebook: 'note',
  tables: 'tables',
  team: 'team',
};

// A 3-layer pyramid for the "layers" mode — a triangle sliced by horizontal
// lines into the Strategy / Execution layers it reveals.
const LayersIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3 2 21h20L12 3Z" />
    <path d="M8.7 9h6.6" />
    <path d="M5.3 15h13.4" />
  </svg>
);

const RAIL_ITEMS: { mode: RailMode; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { mode: 'home',     label: 'Home',     icon: NavHomeIcon },
  { mode: 'layers',   label: 'Activity', icon: LayersIcon },
  { mode: 'notebook', label: 'Notebook', icon: NavNoteIcon },
  { mode: 'tables',   label: 'Table',    icon: NavTableIcon },
  { mode: 'team',     label: 'Team',     icon: NavTeamsIcon },
];

export function ModeRail({
  activeView,
  onViewChange,
}: {
  activeView: string;
  onViewChange: (view: string) => void;
}) {
  const activeMode = railModeOf(activeView);
  return (
    <div className="flex w-[46px] shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2">
      {RAIL_ITEMS.map(({ mode, label, icon: Icon }) => {
        const active = mode === activeMode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => {
              // Re-clicking the active mode keeps whatever sub-view is open;
              // switching modes lands on that mode's default surface.
              if (activeMode !== mode) onViewChange(RAIL_DEFAULT_VIEW[mode]);
            }}
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
      })}
    </div>
  );
}
