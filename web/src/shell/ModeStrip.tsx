'use client';

import { Hash, Search } from 'lucide-react';
import { NavHomeIcon, NavChatIcon, NavNoteIcon } from '@/shell/sidebar/NavIcons';

export type StripMode = 'home' | 'room' | 'chat' | 'note';

interface ModeStripProps {
  activeMode: StripMode;
  onChange: (mode: StripMode) => void;
  /** Optional search-entry action — renders a 🔍 icon button trailing the
   *  mode pills. Click opens the Discover modal (find Domains / Objects
   *  created by others and join them). Hidden when no handler is provided
   *  so the strip stays unchanged in surfaces that don't need it. */
  onSearch?: () => void;
}

// Optional per-button `iconSize` overrides the default 16px (kept so a
// future icon that's a touch tall can shrink without changing the others).
const BUTTONS: { id: StripMode; icon: React.ComponentType<{ size?: number }>; label: string; iconSize?: number }[] = [
  { id: 'home',   icon: NavHomeIcon,  label: 'Home' },
  { id: 'room',   icon: Hash,         label: 'Room' },
  { id: 'chat',   icon: NavChatIcon,  label: 'Chat' },
  { id: 'note',   icon: NavNoteIcon,  label: 'Note' },
];

// Top strip rendered inside the AppSidebar, above Action Space. Active
// button reads as a filled pill ("端子っぽい") with icon + label; inactive
// buttons collapse to a small icon-only chip. Animated: the label fades
// in / out and the pill expands / contracts when the active mode swaps,
// instead of snapping. The label max-width is conservative enough that
// 5 pills + active label fit comfortably in the 240 px sidebar, so no
// overflow handling is needed at the strip level.
export function ModeStrip({ activeMode, onChange, onSearch }: ModeStripProps) {
  // When the active label is longer than 4 chars the row tightens
  // uniformly: the parent gap shrinks and each inactive button drops its
  // horizontal padding by 2 px. All pills slide left together, giving the
  // active pill the extra room without clipping its label.
  const activeLabel = BUTTONS.find((b) => b.id === activeMode)?.label ?? '';
  const compact = activeLabel.length > 4;
  return (
    <div
      className={`flex items-center py-1.5 transition-[gap] duration-200 ease-out ${
        compact ? 'gap-0' : 'gap-0.5'
      }`}
    >
      {BUTTONS.map((b) => {
        const Icon = b.icon;
        const isActive = activeMode === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            // Border is always present (`border-transparent` when inactive)
            // so the box model doesn't jump 1 px as the active state
            // adds / removes its outline.
            className={`inline-flex items-center h-7 rounded-full text-xs font-bold flex-shrink-0 border transition-[background-color,color,border-color,padding,gap] duration-200 ease-out ${
              isActive
                ? 'bg-muted text-foreground border-border gap-1.5 pl-[11px] pr-3'
                : `text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/40 gap-0 ${
                    compact ? 'px-1' : 'px-1.5'
                  }`
            }`}
            title={b.label}
            aria-label={b.label}
          >
            {/* Wrap the icon so we can animate a small leftward nudge
                when becoming active — combined with the label expanding
                on the right, it reads as "icon slides left to make room
                for the label". */}
            <span
              className={`inline-flex shrink-0 transition-transform duration-200 ease-out ${
                isActive ? '-translate-x-[2px]' : 'translate-x-0'
              }`}
            >
              <Icon size={b.iconSize ?? 16} />
            </span>
            {/* Label is always in the DOM — collapsing it via max-width +
                opacity gives the smooth pill-expansion effect. */}
            <span
              className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-out ${
                isActive ? 'max-w-[120px] opacity-100' : 'max-w-0 opacity-0'
              }`}
            >
              {b.label}
            </span>
          </button>
        );
      })}
      {onSearch && (
        // Trailing 🔍 — pushed to the right edge of the strip so it reads
        // as a separate action, not another mode. Always icon-only since
        // it has no active state.
        <button
          type="button"
          onClick={onSearch}
          className="ml-auto inline-flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0"
          title="Discover Domains and Objects"
          aria-label="Discover"
        >
          <Search size={15} />
        </button>
      )}
    </div>
  );
}
