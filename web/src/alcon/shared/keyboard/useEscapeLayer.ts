'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { pushEscapeLayer } from './escapeLayer';

/** Make this surface an Escape layer while `active`. Escape reaches the
 *  layer that opened last, so a surface opened on top of this one takes the
 *  key until it closes — see escapeLayer.ts.
 *
 *  `onEscape` may be a fresh closure every render; only `active` decides when
 *  the layer is pushed and popped, so the layer keeps its place in the stack. */
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
