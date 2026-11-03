'use client';

import { useState, type ReactNode } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { FONT } from '@/shared/designTokens';

/** A section of a detail page whose heading folds it (▶), with a quiet count
 *  on the heading's line — the shape of an Element's Sub-elements, shared by
 *  a Portfolio's sub-Portfolios and its Initiatives. Open when it holds
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

/** The grey line under a section's rows that takes a name and Enter. */
export function FoldSectionAddRow({ icon, placeholder, onAdd, trailing }: {
  icon: ReactNode;
  placeholder: string;
  onAdd: (name: string) => Promise<void> | void;
  /** After the field — another way to add (pick an existing one). */
  trailing?: ReactNode;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const name = value.trim();
    if (!name || busy) return;
    setBusy(true);
    try { await onAdd(name); setValue(''); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-[2.125rem] items-center gap-2 px-2">
      <span className="flex text-muted-foreground opacity-50">{icon}</span>
      <input value={value} onChange={(e) => setValue(e.target.value)} disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
          else if (e.key === 'Escape') { e.preventDefault(); setValue(''); e.currentTarget.blur(); }
        }}
        placeholder={placeholder} aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/60" />
      {trailing}
    </div>
  );
}
