'use client';

import { useRef } from 'react';

// Escape-to-cancel for a field that saves on blur. `cancel()` is called from
// the field's own Escape handler, right before it restores the saved value
// and calls `.blur()` to leave the field; `consumeCancel()` is the first
// line of the blur/save handler. blur() fires synchronously, before React
// has applied the restoring setState, so the save handler would otherwise
// still see the just-typed text and persist it — the flag is what tells that
// one blur apart from every other blur (clicking away, tabbing out) that
// should save normally.
export function useCancelOnEscape() {
  const ref = useRef(false);
  return {
    cancel: () => {
      ref.current = true;
    },
    /** True (and cleared) exactly once, for the blur Escape's own .blur()
     *  call triggers. Every other blur returns false and saves as usual. */
    consumeCancel: (): boolean => {
      if (!ref.current) return false;
      ref.current = false;
      return true;
    },
  };
}
