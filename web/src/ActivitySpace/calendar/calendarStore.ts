'use client';

import { useSyncExternalStore } from 'react';
import { toDateOnlyString } from '@/Function/shared/dateUtils';

// The Calendar sidebar (mini month + people) and the main grid do not share
// a parent below the shell, so the day being looked at and the Workers being
// hidden live here. Same shape as railApps: a module store read through
// `useSyncExternalStore`, with the hidden-people choice kept in localStorage
// so it survives a reload. The day lives for the page: leaving the Calendar
// and coming back lands on the day that was open, a reload on today.

const HIDDEN_KEY = 'clayware:calendar-hidden-workers';
const CHANGE_EVENT = 'clayware:calendar-change';

const EMPTY: string[] = Object.freeze([]) as unknown as string[];

let day: string | null = null;
let hidden: string[] | null = null;
// Assignees of the Elements the grid is showing — the people the sidebar
// offers to hide. Published by the grid, read by the sidebar.
let scopedWorkers: string[] = EMPTY;
const listeners = new Set<() => void>();
let wired = false;

function readHidden(): string[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : EMPTY;
  } catch {
    return EMPTY;
  }
}

function getDay(): string {
  if (day === null) day = toDateOnlyString(new Date());
  return day;
}

function getHidden(): string[] {
  if (hidden === null) hidden = readHidden();
  return hidden;
}

function invalidate() {
  hidden = readHidden();
  listeners.forEach(fn => fn());
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== HIDDEN_KEY) return;
  invalidate();
}

function subscribe(listener: () => void) {
  if (!wired) {
    wired = true;
    window.addEventListener(CHANGE_EVENT, invalidate);
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The `yyyy-MM-dd` day the Calendar is looking at. */
export function useCalendarDay(): string {
  return useSyncExternalStore(subscribe, getDay, getDay);
}

export function setCalendarDay(next: string) {
  if (next === day) return;
  day = next;
  listeners.forEach(fn => fn());
}

/** Workers whose Elements the Calendar leaves out. */
export function useHiddenCalendarWorkers(): string[] {
  return useSyncExternalStore(subscribe, getHidden, () => EMPTY);
}

export function setCalendarWorkerHidden(workerId: string, isHidden: boolean) {
  const current = readHidden().filter(id => id !== workerId);
  const next = isHidden ? [...current, workerId] : current;
  window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function showAllCalendarWorkers() {
  window.localStorage.setItem(HIDDEN_KEY, '[]');
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Workers assigned to anything on the Calendar as currently scoped. */
export function useCalendarWorkerIds(): string[] {
  return useSyncExternalStore(subscribe, () => scopedWorkers, () => EMPTY);
}

export function setCalendarWorkerIds(ids: string[]) {
  if (ids.length === scopedWorkers.length && ids.every((id, i) => id === scopedWorkers[i])) return;
  scopedWorkers = ids;
  listeners.forEach(fn => fn());
}
