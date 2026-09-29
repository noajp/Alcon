'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// A right-rail section — and, through WidgetFrame, the frame every rail widget
// wears. The rail is metadata beside a document, so it is not boxed: a small
// muted heading and its rows, separated from the next section by space alone.
// Boxes, header bands and shadows made each property group compete with the
// document for attention; the heading is the only chrome it needs. The
// chevron shows on hover and while collapsed, so an open rail reads as text.
export function RailCard({
  title, children, padded = false, icon, action,
}: {
  title: string;
  children: React.ReactNode;
  padded?: boolean;
  icon?: React.ReactNode;
  /** Optional control pinned to the right of the heading (e.g. an "+ add"
   *  button). Rendered outside the collapse toggle so pressing it doesn't
   *  collapse the section. */
  action?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="group/rail">
      {/* Height is declared, not left to padding, so the heading is the same
          28px whether the section is open or shut. */}
      <div className="flex items-center h-7">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="min-w-0 h-full flex items-center gap-1 px-2 rounded-md text-[12px] font-medium text-muted-foreground text-left hover:text-foreground transition-colors"
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
        {action && <div className="shrink-0 pr-1">{action}</div>}
      </div>
      {!collapsed && (
        <div className={padded ? 'px-2 pt-1' : 'pt-0.5'}>
          {children}
        </div>
      )}
    </section>
  );
}
