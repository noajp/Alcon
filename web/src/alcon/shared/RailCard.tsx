'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// Right-rail island card: a raised --surface-rail panel with the title as a
// collapsible header inside the card. Shared so the Element detail rail and the
// Object overview rail render identical islands.
export function RailCard({
  title, children, padded = false, icon,
}: { title: string; children: React.ReactNode; padded?: boolean; icon?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-lg bg-[var(--surface-rail)] border border-border/30 shadow-[var(--shadow-island)] overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-1 px-3 pt-2.5 pb-1 text-[12px] font-semibold text-muted-foreground text-left hover:bg-muted/30 transition-colors"
      >
        {icon}
        <span>{title}</span>
        <ChevronDown
          size={11}
          className={`text-muted-foreground/70 transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>
      {!collapsed && (
        <div className={padded ? 'p-2' : 'p-1.5'}>
          {children}
        </div>
      )}
    </div>
  );
}
