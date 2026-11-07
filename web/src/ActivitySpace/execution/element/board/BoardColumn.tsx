'use client';

import type React from 'react';
import { cn } from '@/lib/utils';
import { Hand } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { WaitingReason } from '@/ActivitySpace/execution/chain/waiting';

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
const DANGER = 'var(--status-danger)';

type Translate = ReturnType<typeof useI18n>['t'];

/** The chip's short label for a reason: why this card waits, in the words
 *  the Strategy strip's segments use. A person's verb needs no second word —
 *  the verb chip beside it already says which. */
function reasonLabel(reason: WaitingReason, t: Translate): string {
  switch (reason.kind) {
    case 'approval': return t('Waiting: approval');
    case 'answer': return t('Waiting: your answer');
    case 'review': return t('Waiting: review');
    case 'readings': return t('Accept to record {n} readings', { n: reason.heldReadings });
    case 'blocked': return t('Blocked');
    case 'paused': return t('Paused');
    case 'dependency': return t('Waiting on work');
    case 'verb': return t('Waiting on you');
  }
}

/** On a card that waits — in whatever column it sits. Without a reason
 *  (the Board) it is the person's chip it has always been; with one (the
 *  Strategy chain) it says why: warning-toned when a person's act unblocks
 *  it, danger for blocked, muted when it waits on work, not a person. */
export function WaitingChip({ reason }: { reason?: WaitingReason | null }) {
  const { t } = useI18n();
  if (!reason) {
    return (
      <Chip className="mt-px border-transparent" style={{ color: WARNING, background: `color-mix(in srgb, ${WARNING} 14%, transparent)` }}>
        <Hand size={11} className="shrink-0" />{t('Waiting on you')}
      </Chip>
    );
  }
  if (!reason.needsPerson) {
    return <Chip className="mt-px" title={reason.detail ?? undefined}>{reasonLabel(reason, t)}</Chip>;
  }
  const tone = reason.kind === 'blocked' ? DANGER : WARNING;
  return (
    <Chip className="mt-px border-transparent" title={reason.detail ?? undefined}
      style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
      <Hand size={11} className="shrink-0" />{reasonLabel(reason, t)}
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
