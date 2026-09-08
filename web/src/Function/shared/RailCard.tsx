'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// The rail island — and, through WidgetFrame, the frame every rail widget
// wears. Header and body live in one box, and the header is a band: it is
// chrome rather than content, so it carries `--surface-muted` at low alpha and
// a `--border-subtle` hairline, exactly as the main column's section frame
// does. One widget, one box, its name inside it, whichever column it is in.
export function RailCard({
  title, children, padded = false, icon, action,
}: {
  title: string;
  children: React.ReactNode;
  padded?: boolean;
  icon?: React.ReactNode;
  /** Optional control pinned to the right of the header band (e.g. an "+ add"
   *  button). Rendered outside the collapse toggle so pressing it doesn't
   *  collapse the card. */
  action?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-lg bg-[var(--surface-rail)] border border-border/30 shadow-[var(--shadow-island)] overflow-hidden">
      {/* Height is declared, not left to padding (DESIGN.md §3.3), so the band
          is the same 36px whether the card is open or shut — collapsing must
          not resize the header it is collapsing into. */}
      <div
        className={`flex items-center h-9 bg-muted/40 ${
          collapsed ? '' : 'border-b border-[var(--border-subtle)]'
        }`}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex-1 min-w-0 h-full flex items-center gap-1 px-3 text-[12px] font-semibold text-muted-foreground text-left hover:bg-muted/60 transition-colors"
        >
          {icon}
          <span className="truncate">{title}</span>
          <ChevronDown
            size={11}
            className={`text-muted-foreground/70 transition-transform shrink-0 ${collapsed ? '-rotate-90' : ''}`}
          />
        </button>
        {action && <div className="shrink-0 pr-2">{action}</div>}
      </div>
      {!collapsed && (
        <div className={padded ? 'p-2' : 'p-1.5'}>
          {children}
        </div>
      )}
    </div>
  );
}
