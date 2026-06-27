'use client';

import { Search } from 'lucide-react';
import { NavHomeIcon, NavChatIcon, NavNoteIcon, NavSettingsIcon } from '@/shell/sidebar/NavIcons';

export type StripMode = 'home' | 'room' | 'chat' | 'note';

// Room is temporarily hidden from the nav — its view, hooks and DB tables are
// all intact, only the rail entry point is removed. Re-add
// { id: 'room', icon: NavRoomIcon, label: 'Room' } here to bring it back.
const BUTTONS: { id: StripMode; icon: React.ComponentType<{ size?: number }>; label: string }[] = [
  { id: 'home', icon: NavHomeIcon, label: 'Home' },
  { id: 'chat', icon: NavChatIcon, label: 'Chat' },
  { id: 'note', icon: NavNoteIcon, label: 'Note' },
];

interface ModeRailProps {
  activeMode: StripMode;
  onChange: (mode: StripMode) => void;
  onSearch?: () => void;
  onSettings?: () => void;
}

// Always-visible 40px icon rail on the far left — Home / Room / Chat / Note as
// vertical icon buttons, with Discover + Settings pinned to the bottom. Lives
// OUTSIDE the collapsible AppSidebar so the modes stay reachable even when the
// sidebar is hidden or the window is narrow. pt-1 lines the first icon up with
// the sidebar's first nav row.
export function ModeRail({ activeMode, onChange, onSearch, onSettings }: ModeRailProps) {
  const iconBtn = 'inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors';
  return (
    <div className="w-[38px] h-full flex-shrink-0 flex flex-col items-center gap-2 pt-1 pb-2 border-r border-border/60">
      {BUTTONS.map((b) => {
        const Icon = b.icon;
        const isActive = activeMode === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            title={b.label}
            aria-label={b.label}
            className={`${iconBtn} ${
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}
          >
            <Icon size={25} />
          </button>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-2">
        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            title="Discover Domains and Objects"
            aria-label="Discover"
            className={`${iconBtn} text-muted-foreground hover:text-foreground hover:bg-muted/40`}
          >
            <Search size={25} />
          </button>
        )}
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            title="Settings"
            aria-label="Settings"
            className={`${iconBtn} text-muted-foreground hover:text-foreground hover:bg-muted/40`}
          >
            <NavSettingsIcon size={25} />
          </button>
        )}
      </div>
    </div>
  );
}
