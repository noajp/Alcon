'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// A right-rail island — and, through WidgetFrame, the frame every rail widget
// wears. The rail is the concept's facts beside its document (Properties,
// Labels, Activity), so each group is a card of its own: a raised surface with
// a quiet heading, rows inside it, and room around them. No tinted header band
// — the heading is plain text on the card. The chevron shows on hover and
// while collapsed.
export function RailCard({
  title, children, padded = false, icon, action,
}: {
  title: string;
  children: React.ReactNode;
  padded?: boolean;
  icon?: React.ReactNode;
  /** Optional control pinned to the right of the heading (e.g. an "+ add"
   *  button). Rendered outside the collapse toggle so pressing it doesn't
   *  collapse the card. */
  action?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="group/rail rounded-lg border border-border/30 bg-[var(--surface-rail)] shadow-[var(--shadow-island)]">
      {/* Height is declared, not left to padding, so the heading is the same
          40px whether the card is open or shut. */}
      <div className="flex h-10 items-center pl-2.5 pr-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex h-full min-w-0 items-center gap-1 rounded-md px-1.5 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {icon}
          <span className="truncate">{title}</span>
          <ChevronDown
            size={12}
            className={`shrink-0 transition-[transform,opacity] ${
              collapsed ? '-rotate-90 opacity-100' : 'opacity-0 group-hover/rail:opacity-100'
            }`}
          />
        </button>
        <div className="flex-1" />
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {!collapsed && (
        <div className={padded ? 'px-4 pb-4' : 'px-2 pb-2'}>
          {children}
        </div>
      )}
    </section>
  );
}
