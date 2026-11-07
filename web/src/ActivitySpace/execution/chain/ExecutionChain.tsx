'use client';

import type React from 'react';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { STATUS, STATUS_ORDER } from '@/shared/designTokens';
import { BoardColumn } from '../element/board/BoardColumn';

// The Execution Chain: work in the Board's Status columns, drawn with the
// Board's columns and cards. What waits on a person is a chip on its card
// (WaitingChip), not a column of its own. A Strategy's Execution Chain tab
// uses it with its own cards (the Planner's draft among them); a Domain's is
// the Board itself.

export type ChainStatus = (typeof STATUS_ORDER)[number];

export function ExecutionChain({ columns, className }: {
  /** The cards of each Status column, in order. */
  columns: Record<ChainStatus, { key: string; node: React.ReactNode }[]>;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={className ?? 'flex h-full gap-3 overflow-x-auto px-4 pb-4 pt-1'}>
      {STATUS_ORDER.map((status) => (
        <BoardColumn key={status} mark={<ElementProgressMark status={status} size={14} />} label={t(STATUS[status].label)}
          count={columns[status].length} empty={t('No Elements')}>
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
