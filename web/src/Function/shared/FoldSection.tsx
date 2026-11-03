'use client';

import { useState, type ReactNode } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { FONT } from '@/shared/designTokens';

/** A section of a detail page whose heading folds it (▶), with a quiet count
 *  on the heading's line — the shape of an Element's Sub-elements, shared by
 *  an Initiative's nested Initiatives and its Objects. Open when it holds
 *  something; folded while empty. */
export function FoldSection({ title, count, children }: {
  title: string;
  /** Shown after the heading ("3", or "2/5"). */
  count?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="w-full" aria-label={title}>
      <div className="mb-1 flex h-8 items-baseline gap-1 pt-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="flex items-center gap-2 rounded-md text-foreground">
          <h2 className={`${FONT.lg} text-foreground`}>{title}</h2>
          <DisclosureTriangle open={open} className="text-muted-foreground" />
        </button>
        {count && <span className="ml-1 text-[12px] tabular-nums text-muted-foreground">{count}</span>}
      </div>
      {open && <div className="-mx-2">{children}</div>}
    </section>
  );
}
