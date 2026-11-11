'use client';

import type React from 'react';
import { cn } from '@/lib/utils';
import { Hand } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { WaitingReason } from '@/ActivitySpace/execution/chain/waiting';

// One column of Element cards: a mark and a name, the count as a chip,
// then the cards. Every Execution Chain — a Strategy's and a Domain's —
// draws its columns with it, so the two read the same. A board lying
// horizontal draws the same group as a BoardLane instead: the same
// header, laid at the row's left, and the cards flowing sideways.

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
      className={cn('inline-flex h-5 min-w-0 shrink-0 items-center gap-1 rounded-full border border-[var(--border-default)] px-2 text-[11px] leading-none tabular-nums text-[var(--text-secondary)]', className)}>
      {children}
    </span>
  );
}

const WARNING = 'var(--status-warning)';
const DANGER = 'var(--status-danger)';

/** The one width of a chain column — and of a card in a horizontal lane,
 *  which keeps its column's width. Single-sourced so the two can never
 *  drift apart. */
export const CHAIN_COLUMN_WIDTH = 'w-80';

/** The board's ground: one definite step off the island, one step under
 *  the cards that stand on it. Every board — Chain and Cascade alike —
 *  stands on this and nothing else. */
export const BOARD_GROUND = 'bg-muted';

type Translate = ReturnType<typeof useI18n>['t'];

/** The chip's short label for a reason: why this card waits, in the words
 *  the chain strips' segments use. A person's verb needs no second word —
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

/** On a card that waits — in whatever column it sits. It says why:
 *  warning-toned when a person's act unblocks it, danger for blocked,
 *  muted when it waits on work, not a person. */
export function WaitingChip({ reason }: { reason: WaitingReason }) {
  const { t } = useI18n();
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
  /** At the header's right — the chain's "+". */
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
      className={cn('flex flex-shrink-0 flex-col rounded-lg', BOARD_GROUND, CHAIN_COLUMN_WIDTH)}
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

/** One row of a board lying horizontal: the BoardColumn's header — mark,
 *  name, count, the header's right-hand slot — as a rail at the left,
 *  and the cards in a strip that scrolls sideways. The caller sizes the
 *  cards (a chain card keeps its column's width). */
export function BoardLane({ mark, label, count, action, onDragOver, onDrop, empty, children }: {
  /** Before the name: the lane's mark. */
  mark?: React.ReactNode;
  label: string;
  count: number;
  /** At the rail's right — the chain's "+". */
  action?: React.ReactNode;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  /** Shown when the lane has no cards. */
  empty?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn('flex w-full flex-shrink-0 rounded-lg', BOARD_GROUND)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className="flex h-10 w-52 flex-shrink-0 items-center justify-between self-start px-3">
        <div className="flex min-w-0 items-center gap-2">
          {mark}
          <span className="truncate text-[13px] font-medium">{label}</span>
          <Chip>{count}</Chip>
        </div>
        {action}
      </header>
      <div className="flex min-h-[80px] min-w-0 flex-1 items-start gap-1.5 overflow-x-auto px-1.5 py-1.5">
        {count === 0 && empty ? <p className="px-1.5 py-2 text-[12px] text-muted-foreground">{empty}</p> : children}
      </div>
    </section>
  );
}
