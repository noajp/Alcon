'use client';

import { useState } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';

// A right-rail island — and, through WidgetFrame, the frame every rail widget
// wears. The rail is the concept's facts beside its document (Properties,
// Labels, Activity), so each group is an island of its own: a surface a notch
// off the page, with a quiet heading, rows inside it, and room around them.
// The tone alone sets it apart — no outline, no shadow — so a page with three
// islands does not read as three boxes. The chevron shows on hover and while
// collapsed.
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
    <section className="group/rail rounded-lg bg-[var(--surface-rail)]">
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
          <DisclosureTriangle
            open={!collapsed}
            className={collapsed ? 'opacity-100' : 'opacity-0 group-hover/rail:opacity-100'}
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
