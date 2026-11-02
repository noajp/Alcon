'use client';

import { useMemo } from 'react';
import { useClosedTimesSince } from '@/hooks/elementActivity';
import { addDays, startOfDay } from '@/Function/shared/dateUtils';
import { useNowMinute } from '@/Function/shared/useNow';
import { MAX_CLOSED_WINDOW_DAYS, needsCloseTimes } from './closedWindow';
import type { ListClosedWindow } from './types';

/**
 * The clock and close times buildSections needs for the Display's
 * "Completed Elements" window. The clock moves once a minute so an Element
 * drops out as its close ages past the window; while the window is 'all' or
 * 'none' nothing ticks and nothing is read. `failed` says the close times
 * could not be read — closed Elements then all stay, and the Display says so.
 */
export function useClosedWindow(window: ListClosedWindow | undefined): {
  now: number;
  closedAt: ReadonlyMap<string, string> | undefined;
  failed: boolean;
} {
  const bounded = needsCloseTimes(window);
  const clock = useNowMinute(bounded);
  // The server's clock is +Infinity (useNow); NaN makes the window keep
  // closed Elements until the client's real clock arrives.
  const live = bounded && Number.isFinite(clock);
  const now = live ? clock : Number.NaN;
  // Read from the start of the day the widest window reaches back to, so the
  // query key holds for the day.
  const today = live ? startOfDay(new Date(clock)).getTime() : 0;
  const since = useMemo(() => addDays(new Date(today), -MAX_CLOSED_WINDOW_DAYS), [today]);
  const closedTimes = useClosedTimesSince(since, live);
  const closedAt = live ? closedTimes.data?.closedAt : undefined;
  const failed = live && closedTimes.isError && !closedTimes.data;
  return useMemo(() => ({ now, closedAt, failed }), [now, closedAt, failed]);
}
