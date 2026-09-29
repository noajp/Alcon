'use client';

import { useLayoutEffect, type RefObject } from 'react';

// One width for the id column of a list: the widest id actually drawn.
//
// Each row's id chip used to reserve a fixed floor (4.5rem) and let a longer
// id widen only its own row, so in a list mixing `AI-001`, `PLT-003` and
// `開発-001` the status mark and the title after the id started at a
// different x on every row. The chips now take their min-width from
// `--list-id-w`, which this hook sets on the list to the natural width of
// the widest id it renders (measured, not guessed from character counts —
// CJK and Latin prefixes differ in width). Chips still stop at their own
// max-width, so one runaway id cannot push every title off screen.

/** The CSS variable the id chips read their min-width from. */
const LIST_ID_WIDTH_VAR = '--list-id-w';

/** Marks a chip whose text width takes part in the measurement. */
const LIST_ID_ATTR = 'data-list-id';

/**
 * Pure. The width every id chip should reserve: the widest measured id,
 * rounded up to a whole pixel and capped. null when nothing was measured,
 * so the chips keep their own fallback.
 */
export function uniformIdWidth(widths: readonly number[], capPx: number): number | null {
  const finite = widths.filter((w) => Number.isFinite(w) && w > 0);
  if (finite.length === 0) return null;
  return Math.min(Math.ceil(Math.max(...finite)), capPx);
}

/** The natural width of a chip's text, ignoring the min-width it is given. */
function textWidth(el: Element): number {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width;
}

export function useUniformIdWidth(
  containerRef: RefObject<HTMLElement | null>,
  capPx: number,
  /** Anything that changes which ids are drawn (sections, collapse state). */
  signature: unknown,
): void {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const apply = () => {
      const chips = container.querySelectorAll(`[${LIST_ID_ATTR}]`);
      const width = uniformIdWidth(Array.from(chips, textWidth), capPx);
      if (width === null) container.style.removeProperty(LIST_ID_WIDTH_VAR);
      else container.style.setProperty(LIST_ID_WIDTH_VAR, `${width}px`);
    };
    apply();
    // The first paint can use the fallback font; measure again once the
    // web font is in, or the column ends up a few pixels short.
    let cancelled = false;
    void document.fonts?.ready.then(() => { if (!cancelled) apply(); });
    return () => { cancelled = true; };
  }, [containerRef, capPx, signature]);
}
