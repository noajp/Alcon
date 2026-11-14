'use client';

import type React from 'react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Hand } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { extractPlainText } from '@/Function/notebook/contentUtils';
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
      className={cn('inline-flex h-5 min-w-0 shrink-0 items-center gap-1 rounded-full border border-transparent bg-foreground/[0.06] px-2 text-[11px] leading-none tabular-nums text-[var(--text-secondary)]', className)}>
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

/** A card standing on the board: a soft frame that firms up under the
 *  pointer (the border and the shadow, not the ground), so a column of cards
 *  stays quiet until one is reached for. Element and Object cards share it. */
export const BOARD_CARD = 'rounded-xl border border-[var(--border-subtle)] bg-card shadow-[var(--shadow-card)] transition-[border-color,box-shadow] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-1)] dark:bg-[var(--surface-rail)]';

/** What a card says under its title — a count, a source — as quiet text
 *  with its glyph, not a framed chip. */
export function CardMeta({ icon, children, title }: { icon?: React.ReactNode; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex min-w-0 items-center gap-1 text-[12px] leading-4 text-muted-foreground">
      {icon != null && <span className="grid shrink-0 place-items-center text-muted-foreground/70">{icon}</span>}
      <span className="truncate tabular-nums">{children}</span>
    </span>
  );
}

/** A card's description: the first lines of what was written, as plain
 *  text. Renders nothing when there is nothing to say. */
export function CardDescription({ html }: { html: string | null | undefined }) {
  const text = useMemo(() => (html ? extractPlainText(html).replace(/\s+/g, ' ').trim() : ''), [html]);
  if (!text) return null;
  return <p className="mt-1 line-clamp-2 text-[12.5px] leading-[18px] text-muted-foreground">{text}</p>;
}

/** The group's header: mark, name, and how many — the count as plain text. */
function GroupHeading({ mark, label, count }: { mark?: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {mark}
      <span className="truncate text-[13px] font-semibold">{label}</span>
      <span className="text-[12px] tabular-nums text-muted-foreground">{count}</span>
    </div>
  );
}

/** An empty group: a dashed outline where its cards would stand. */
function EmptyGroup({ text }: { text?: string }) {
  return (
    <div className="grid min-h-[72px] w-full place-items-center rounded-xl border border-dashed border-[var(--border-default)] px-3 text-center text-[12px] text-muted-foreground">
      {text}
    </div>
  );
}

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

export function BoardColumn({ mark, label, count, action, onDragOver, onDrop, empty, folded = false, children }: {
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
  /** An empty column folds to a narrow strip — its mark, name and count
   *  standing upright — so the columns that hold cards have the width.
   *  It still takes a dropped card. */
  folded?: boolean;
  children?: React.ReactNode;
}) {
  if (folded) {
    return (
      <section aria-label={`${label} (${count})`}
        className={cn('flex w-10 flex-shrink-0 flex-col items-center gap-2 rounded-xl py-3', BOARD_GROUND)}
        onDragOver={onDragOver} onDrop={onDrop}>
        {mark}
        <span className="text-[12px] font-medium text-muted-foreground [writing-mode:vertical-rl]">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
        {action}
      </section>
    );
  }
  return (
    <section
      aria-label={label}
      className={cn('flex flex-shrink-0 flex-col rounded-xl', BOARD_GROUND, CHAIN_COLUMN_WIDTH)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className="flex h-10 items-center justify-between px-3">
        <GroupHeading mark={mark} label={label} count={count} />
        {action}
      </header>
      <div className="min-h-[80px] flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {count === 0 ? <EmptyGroup text={empty} /> : children}
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
      className={cn('flex w-full flex-shrink-0 rounded-xl', BOARD_GROUND)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className="flex h-10 w-52 flex-shrink-0 items-center justify-between self-start px-3">
        <GroupHeading mark={mark} label={label} count={count} />
        {action}
      </header>
      <div className="flex min-h-[80px] min-w-0 flex-1 items-start gap-2 overflow-x-auto p-2">
        {count === 0 ? <EmptyGroup text={empty} /> : children}
      </div>
    </section>
  );
}
