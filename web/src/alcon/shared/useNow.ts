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
// The server has no clock the client would agree with; a fixed value keeps
// hydration quiet and the first client tick corrects it.
const getServerSnapshot = () => 0;

/** The current time, refreshed every 30 seconds, shared across subscribers. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
