'use client';

import { useState } from 'react';


import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { getLayer, type LayerId } from '@/shell/layers';

interface LayerAppLauncherProps {
  layer: LayerId;
  activeView: string;
  onSelect: (view: string) => void;
}

/**
 * The 6-dot launcher that sits beside the Space name at the top of the
 * sidebar. Opens a grid of the apps available in the current layer (Chat /
 * Talk for Action, Note / Strategy / Diagram for Materialization, …) and
 * switches the active view to the chosen app.
 */
export function LayerAppLauncher({ layer, activeView, onSelect }: LayerAppLauncherProps) {
  const [open, setOpen] = useState(false);
  const meta = getLayer(layer);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
          title={`${meta.label} apps`}
          aria-label={`${meta.label} apps`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="5" r="2.5"/><circle cx="12" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/>
              <circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/>
              <circle cx="5" cy="19" r="2.5"/><circle cx="12" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/>
            </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        {/* Single-surface layers (Execution) have no apps to list — the
            launcher button stays for alignment but the panel is empty. */}
        {meta.apps.length === 0 ? null : (
        <>
        <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {meta.label}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {meta.apps.map((a) => {
            const Icon = a.icon;
            const isActive = activeView === a.view;
            return (
              <button
                key={a.view}
                type="button"
                onClick={() => { onSelect(a.view); setOpen(false); }}
                className={`flex flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 transition-colors ${
                  isActive
                    ? 'bg-sidebar-accent text-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                }`}
              >
                <Icon size={20} />
                <span className="text-[11px] font-medium leading-none">{a.label}</span>
              </button>
            );
          })}
        </div>
        </>
        )}
      </PopoverContent>
    </Popover>
  );
}
