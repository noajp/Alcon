'use client';

import type React from 'react';
import { cn } from '@/lib/utils';
import { Hand } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';

// One column of Element cards, as the Board draws it: a mark and a name, the
// count as a chip, then the cards. The Board and a Strategy's Execution Chain
// both use it, so the two read the same.

/** A small rounded label — a count, an Object, a verb — the way every card
 *  and column shows them. */
export function Chip({ children, className, style, title }: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  return (
    <span title={title} style={style}
      className={cn('inline-flex h-5 min-w-0 shrink-0 items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 text-[11px] font-medium leading-none tabular-nums text-muted-foreground', className)}>
      {children}
    </span>
  );
}

const WARNING = 'var(--status-warning)';

/** On a card that waits on a person — their verb, a blocked Element, or an
 *  AI run that stopped to ask — in whatever column it sits. */
export function WaitingChip() {
  const { t } = useI18n();
  return (
    <Chip className="mt-px border-transparent" style={{ color: WARNING, background: `color-mix(in srgb, ${WARNING} 14%, transparent)` }}>
      <Hand size={11} className="shrink-0" />{t('Waiting on you')}
    </Chip>
  );
}

export function BoardColumn({ mark, label, count, action, onDragOver, onDrop, empty, children }: {
  /** Before the name: the column's mark. */
  mark?: React.ReactNode;
  label: string;
  count: number;
  /** At the header's right — the Board's "+". */
  action?: React.ReactNode;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  /** Shown when the column has no cards. */
  empty?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex w-72 flex-shrink-0 flex-col rounded-lg bg-muted/60 dark:bg-muted/30"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className="flex h-10 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          {mark}
          <span className="truncate text-[13px] font-medium">{label}</span>
          <Chip>{count}</Chip>
        </div>
        {action}
      </header>
      <div className="min-h-[80px] flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-1.5">
        {count === 0 && empty ? <p className="px-1.5 py-2 text-[12px] text-muted-foreground">{empty}</p> : children}
      </div>
    </section>
  );
}
