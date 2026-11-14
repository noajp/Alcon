'use client';

import type React from 'react';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { BoardOrientation } from '@/Function/shared/boardOrientation';
import { STATUS, STATUS_ORDER } from '@/shared/designTokens';
import { BoardColumn, BoardLane, CHAIN_COLUMN_WIDTH } from '../element/board/BoardColumn';

// The Execution Chain: work in Status columns, drawn with the shared
// columns and cards. What waits on a person is a chip on its card
// (WaitingChip), not a column of its own. Both hosts draw this one
// component — a Strategy's Execution tab (the Planner's draft among its
// cards) and a Domain's Flow tab alike.
//
// Every column renders at full width, empty or not — the columns are the
// map of where work can stand, and an empty one is a place work can be
// dropped, not a gap to fold away. An empty column's body is blank.
//
// The board's orientation is the reader's: vertical, the Statuses stand
// as columns and the cards stack down; horizontal, they lie as lanes
// and the cards flow sideways, each at its column's width. A drop means
// the same in either.
//
// A card drags with its Element's id, and the host decides what a drop
// means: pass onDropStatus and the columns become drop targets for it.

export type ChainStatus = (typeof STATUS_ORDER)[number];

export function ExecutionChain({ columns, className, onDropStatus, columnAction, orientation = 'vertical' }: {
  /** The cards of each Status column, in order. */
  columns: Record<ChainStatus, { key: string; node: React.ReactNode }[]>;
  className?: string;
  /** When set, a card dropped on a column asks the host to move that
   *  Element to the column's Status. */
  onDropStatus?: (status: ChainStatus, elementId: string) => void;
  /** The column header's right-hand slot, per column (a host's add control). */
  columnAction?: (status: ChainStatus) => React.ReactNode;
  /** Columns standing (default), or lanes lying. */
  orientation?: BoardOrientation;
}) {
  const { t } = useI18n();
  const groupProps = (status: ChainStatus) => ({
    mark: <ElementProgressMark status={status} size={14} />,
    label: t(STATUS[status].label),
    count: columns[status].length,
    action: columnAction?.(status),
    onDragOver: onDropStatus ? (e: React.DragEvent<HTMLDivElement>) => e.preventDefault() : undefined,
    onDrop: onDropStatus ? (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/id');
      if (id) onDropStatus(status, id);
    } : undefined,
  });
  if (orientation === 'horizontal') {
    return (
      <div className={className ?? 'flex h-full flex-col gap-3 overflow-y-auto px-4 pb-4 pt-1'}>
        {STATUS_ORDER.map((status) => (
          <BoardLane key={status} {...groupProps(status)}>
            {columns[status].map((c) => <div key={c.key} className={`${CHAIN_COLUMN_WIDTH} shrink-0`}>{c.node}</div>)}
          </BoardLane>
        ))}
      </div>
    );
  }
  return (
    <div className={className ?? 'flex h-full gap-3 overflow-x-auto px-4 pb-4 pt-1'}>
      {STATUS_ORDER.map((status) => (
        <BoardColumn key={status} {...groupProps(status)} folded={columns[status].length === 0}>
          {columns[status].map((c) => <div key={c.key}>{c.node}</div>)}
        </BoardColumn>
      ))}
    </div>
  );
}

/** Pure. Empty Status columns, to fill. */
export function emptyChain<T>(): Record<ChainStatus, T[]> {
  return Object.fromEntries(STATUS_ORDER.map((s) => [s, [] as T[]])) as Record<ChainStatus, T[]>;
}

/** Pure. The column an Element's Status puts it in (no Status reads as To do). */
export function chainStatusOf(status: string | null | undefined): ChainStatus {
  return (STATUS_ORDER as readonly string[]).includes(status ?? '') ? status as ChainStatus : 'todo';
}
