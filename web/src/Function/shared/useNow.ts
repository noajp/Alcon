'use client';

// One clock for every "as of now" reading on a surface.
//
// A list of two hundred rows that each want to know whether a lease is still
// live must not run two hundred intervals. This is a single ticking store;
// every subscriber reads the same snapshot and re-renders together on the
// tick. useSyncExternalStore gives the server render a stable value too, so
// nothing hydrates against a different "now" than it rendered with.

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 30_000;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    // The timer stops when the last subscriber leaves, and `now` stops with
    // it. A surface mounted 45 minutes later must not read that frozen value
    // for its first 30 seconds — every lease that lapsed in between would
    // render as live. Refresh on start; React re-reads the snapshot after
    // subscribing and re-renders if it moved.
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => now;
// The server has no clock the client would agree with. +Infinity means "every
// lease has lapsed" — nothing is shown as held until the client's real clock
// says so. The fail-safe direction; 0 would have shown all of them.
const getServerSnapshot = () => Number.POSITIVE_INFINITY;

/** The current time, refreshed every 30 seconds, shared across subscribers. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
