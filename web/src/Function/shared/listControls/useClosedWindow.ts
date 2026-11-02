'use client';

import { useMemo } from 'react';
import { useClosedTimesSince } from '@/hooks/elementActivity';
import { addDays, startOfDay } from '@/Function/shared/dateUtils';
import { useNow } from '@/Function/shared/useNow';
import { MAX_CLOSED_WINDOW_DAYS, needsCloseTimes } from './closedWindow';
import type { ListClosedWindow } from './types';

/**
 * The clock and close times buildSections needs for the Display's
 * "Completed Elements" window. The clock ticks (useNow) so an Element drops
 * out as its close ages past the window; it is held still, and nothing is
 * read, while the window is 'all' or 'none'.
 */
export function useClosedWindow(window: ListClosedWindow | undefined): {
  now: number;
  closedAt: ReadonlyMap<string, string> | undefined;
} {
  const ticking = needsCloseTimes(window);
  const clock = useNow();
  // The server's clock is +Infinity (useNow); NaN makes the window keep
  // closed Elements until the client's real clock arrives.
  const now = ticking && Number.isFinite(clock) ? clock : Number.NaN;
  // Read from the start of the day the widest window reaches back to, so the
  // query key holds for the day.
  const today = startOfDay(new Date(Number.isFinite(clock) ? clock : 0)).getTime();
  const since = useMemo(() => addDays(new Date(today), -MAX_CLOSED_WINDOW_DAYS), [today]);
  const closedTimes = useClosedTimesSince(since, ticking && Number.isFinite(clock));
  const closedAt = closedTimes.data?.closedAt;
  return useMemo(() => ({ now, closedAt }), [now, closedAt]);
}
