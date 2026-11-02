// How far back a list keeps Elements that are off the plate (done or
// cancelled) — Linear's "Completed issues" display option.
//
// The moment an Element closed comes from the audit trail: its latest move
// into done or cancelled (completion.ts's latestClosedAt over the status rows
// the database trigger writes). The caller reads only moves inside the
// widest window, so an Element with no entry either closed before it or has
// no recorded move (e.g. created already closed); `created_at` stands in for
// both — it is never later than the close, so an old Element stays out.
//
// Pure. The clock and the close times are passed in.

import { isOpenStatus } from '@/Function/shared/completion';
import { DAY_MS } from '@/Function/shared/dateUtils';
import type { ListClosedWindow } from './types';

const WINDOW_DAYS: Record<Exclude<ListClosedWindow, 'all' | 'none'>, number> = {
  day: 1,
  week: 7,
  month: 30,
};

/** The widest window in days — how far back the close times must be read. */
export const MAX_CLOSED_WINDOW_DAYS = WINDOW_DAYS.month;

/** Whether `window` needs the close times at all ('all' / 'none' do not). */
export function needsCloseTimes(window: ListClosedWindow | undefined): boolean {
  return window === 'day' || window === 'week' || window === 'month';
}

interface ClosableElement {
  id: string;
  status?: string | null;
  created_at?: string | null;
}

export interface ClosedWindowContext {
  window: ListClosedWindow | undefined;
  /** Milliseconds since the epoch. */
  now: number;
  /** Each Element's latest move into done / cancelled within the widest
   *  window. Undefined while it is still being read — closed Elements then
   *  stay, rather than vanish and come back. */
  closedAt: ReadonlyMap<string, string> | undefined;
}

/** Whether an Element stays visible. Open Elements always do; closed ones
 *  only when they closed inside the window. */
export function isWithinClosedWindow(element: ClosableElement, ctx: ClosedWindowContext): boolean {
  const { window } = ctx;
  if (isOpenStatus(element.status)) return true;
  if (!window || window === 'all') return true;
  if (window === 'none') return false;
  if (!ctx.closedAt || !Number.isFinite(ctx.now)) return true;
  const at = Date.parse(ctx.closedAt.get(element.id) ?? element.created_at ?? '');
  if (Number.isNaN(at)) return false;
  return at >= ctx.now - WINDOW_DAYS[window] * DAY_MS;
}
