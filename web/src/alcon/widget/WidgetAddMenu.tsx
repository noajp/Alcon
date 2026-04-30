'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';
import type { WidgetDefinition } from './types';

interface WidgetAddMenuProps {
  available: WidgetDefinition[];
  onAdd: (type: string) => void;
}

export function WidgetAddMenu({ available, onAdd }: WidgetAddMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={available.length === 0}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
      >
        <Plus size={12} />
        Add widget
      </button>

      {open && available.length > 0 && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-popover border border-border/60 rounded-xl shadow-lg z-50 py-1 max-h-80 overflow-y-auto">
          <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Available Widgets
          </div>
          {available.map((def) => (
            <button
              key={def.type}
              onClick={() => {
                onAdd(def.type);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-accent transition-colors"
            >
              <div className="text-[13px] font-medium text-foreground">{def.label}</div>
              {def.description && (
                <div className="text-[11px] text-muted-foreground mt-0.5">{def.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
