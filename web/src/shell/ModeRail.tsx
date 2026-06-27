'use client';

import { Search } from 'lucide-react';
import { NavHomeIcon, NavSettingsIcon } from '@/shell/sidebar/NavIcons';
import { LAYERS, type LayerId } from '@/shell/layers';

interface ModeRailProps {
  activeLayer: LayerId | null;
  onChangeLayer: (layer: LayerId) => void;
  onSearch?: () => void;
  onSettings?: () => void;
}

// Always-visible 38px icon rail on the far left — the product's three-layer
// spine, Home / Activity / Materialization / Execution, as vertical buttons,
// with Discover + Settings pinned to the bottom. Home shows the house icon;
// A / M / E show their letter. Lives OUTSIDE the collapsible AppSidebar so the
// layers stay reachable even when the sidebar is hidden or the window is
// narrow. pt-1 lines the first button up with the sidebar's first row.
export function ModeRail({ activeLayer, onChangeLayer, onSearch, onSettings }: ModeRailProps) {
  const iconBtn = 'inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors';
  return (
    <div className="w-[38px] h-full flex-shrink-0 flex flex-col items-center gap-2 pt-1 pb-2 border-r border-border/60">
      {LAYERS.map((layer) => {
        const isActive = activeLayer === layer.id;
        const tone = isActive
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/40';
        return (
          <button
            key={layer.id}
            type="button"
            onClick={() => onChangeLayer(layer.id)}
            title={layer.label}
            aria-label={layer.label}
            aria-current={isActive ? 'true' : undefined}
            className={`${iconBtn} ${tone}`}
          >
            {layer.id === 'home' ? (
              <NavHomeIcon size={25} />
            ) : (
              <span className="text-[16px] font-bold leading-none tracking-tight">{layer.letter}</span>
            )}
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
