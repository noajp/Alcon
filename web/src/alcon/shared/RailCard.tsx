'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// Right-rail island card: a raised --surface-rail panel with the title as a
// collapsible header inside the card. Shared so the Element detail rail and the
// Object overview rail render identical islands.
export function RailCard({
  title, children, padded = false, icon, action,
}: {
  title: string;
  children: React.ReactNode;
  padded?: boolean;
  icon?: React.ReactNode;
  /** Optional control pinned to the top-right of the header (e.g. an "+ add"
   *  button). Rendered outside the collapse toggle so clicking it doesn't
   *  collapse the card. */
  action?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-lg bg-[var(--surface-rail)] border border-border/30 shadow-[var(--shadow-island)] overflow-hidden">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          // Expanded: tight to the body below (pt-2.5 pb-1). Collapsed: the
          // header IS the whole card, so balance the padding to vertically
          // centre the title.
          className={`flex-1 min-w-0 flex items-center gap-1 px-3 text-[12px] font-semibold text-muted-foreground text-left hover:bg-muted/30 transition-colors ${
            collapsed ? 'py-2' : 'pt-2.5 pb-1'
          }`}
        >
          {icon}
          <span className="truncate">{title}</span>
          <ChevronDown
            size={11}
            className={`text-muted-foreground/70 transition-transform shrink-0 ${collapsed ? '-rotate-90' : ''}`}
          />
        </button>
        {action && <div className={`shrink-0 pr-2 ${collapsed ? '' : 'pt-1.5'}`}>{action}</div>}
      </div>
      {!collapsed && (
        <div className={padded ? 'p-2' : 'p-1.5'}>
          {children}
        </div>
      )}
    </div>
  );
}
