'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { pushEscapeLayer } from './escapeLayer';

/** Make this surface an Escape layer while `active`. Escape reaches the
 *  layer that opened last, so a surface opened on top of this one takes the
 *  key until it closes — see escapeLayer.ts.
 *
 *  `onEscape` may be a fresh closure every render; only `active` decides when
 *  the layer is pushed and popped, so the layer keeps its place in the stack.
 *
 *  **Do not let two nested surfaces become active in the same commit.** The
 *  stack is built by effects, and React runs a commit's effects child before
 *  parent — so a parent and a child that both turn on at once (an initial
 *  render, or state read from the URL, rather than a click on top of an open
 *  surface) push the child *under* the parent, and Escape reaches the parent
 *  while the child is the thing on screen. Every caller today becomes active
 *  from a later interaction, which is why nothing shows this; a deep link that
 *  opens a modal over a page would.
 *
 *  If that case arrives, the fix is not a bigger comment: the stack has to be
 *  ordered by what is in front rather than by what registered first (an
 *  explicit priority, or pushing parents first as a rule the code enforces). */
export function useEscapeLayer(
  active: boolean,
  onEscape: () => void,
  root?: RefObject<Element | null>,
): void {
  const handlerRef = useRef(onEscape);
  useEffect(() => {
    handlerRef.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    return pushEscapeLayer(
      () => handlerRef.current(),
      root ? { root: () => root.current } : undefined,
    );
  }, [active, root]);
}
