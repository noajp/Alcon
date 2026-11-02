// How far back a list keeps Elements that are off the plate (done or
// cancelled) — Linear's "Completed issues" display option.
//
// There is no completion timestamp on the Element row, so the moment an
// Element closed is approximated by its `updated_at` (falling back to
// `created_at`): editing a closed Element moves it back inside the window.
//
// Pure. The clock is passed in.

import { isOpenStatus } from '@/Function/shared/completion';
import { DAY_MS } from '@/Function/shared/dateUtils';
import type { ListClosedWindow } from './types';

const WINDOW_DAYS: Record<Exclude<ListClosedWindow, 'all' | 'none'>, number> = {
  day: 1,
  week: 7,
  month: 30,
};

interface ClosableElement {
  status?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

/** Whether an Element stays visible under `window` at `now`. Open Elements
 *  always do; closed ones only when they closed inside the window. A closed
 *  Element with no usable timestamp counts as old. */
export function isWithinClosedWindow(element: ClosableElement, window: ListClosedWindow | undefined, now: Date): boolean {
  if (isOpenStatus(element.status)) return true;
  if (!window || window === 'all') return true;
  if (window === 'none') return false;
  const closedAt = Date.parse(element.updated_at ?? element.created_at ?? '');
  if (Number.isNaN(closedAt)) return false;
  return closedAt >= now.getTime() - WINDOW_DAYS[window] * DAY_MS;
}

export function applyClosedWindow<T extends ClosableElement>(elements: T[], window: ListClosedWindow | undefined, now: Date): T[] {
  if (!window || window === 'all') return elements;
  return elements.filter((element) => isWithinClosedWindow(element, window, now));
}
