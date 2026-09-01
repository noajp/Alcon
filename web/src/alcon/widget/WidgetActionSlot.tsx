'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// =============================================================
// Where a surface's widget controls render.
//
// The + belongs in the chrome (the TabBar's right end), but the board that
// knows what can be added lives in the surface below it. Rather than lift the
// board up — which would tie the shell to widget internals and break the
// moment a surface is rendered without its TabBar — the chrome offers a
// target and the surface portals into it.
//
// No target mounted (Home, a surface with the tab bar hidden) means the
// picker falls back to rendering in place, so a board is never left without
// its one control.
// =============================================================

interface SlotValue {
  node: HTMLElement | null;
  setNode: (el: HTMLElement | null) => void;
}

const SlotContext = createContext<SlotValue | null>(null);

/**
 * Wrap whatever renders both the chrome and the surface.
 *
 * Nesting is a pass-through, and that is the point: an Object detail can be
 * rendered on its own (its own TabBar) or inside a Domain shell that hides
 * that TabBar and draws its own. Both wrap their tree, and only the outer one
 * — the one whose target is actually mounted — wins. A second provider that
 * shadowed the first would hand the surface an empty slot forever.
 */
export function WidgetActionSlotProvider({ children }: { children: React.ReactNode }) {
  const outer = useContext(SlotContext);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ node, setNode }), [node]);
  if (outer) return <>{children}</>;
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
}

/** Drop this where the controls should appear — e.g. TabBar's `rightSlot`. */
export function WidgetActionSlotTarget({ className = '' }: { className?: string }) {
  const ctx = useContext(SlotContext);
  const setNode = ctx?.setNode;
  // A stable callback ref: an inline arrow would be a new function every
  // render, which React answers by calling it with null and then the node
  // again — remounting the portal's children on every parent render.
  const attach = useCallback(
    (el: HTMLDivElement | null) => { setNode?.(el); },
    [setNode],
  );
  if (!ctx) return null;
  return <div ref={attach} className={`flex items-center ${className}`} />;
}

/** The mounted target, or null when the surface has none. */
export function useWidgetActionSlot(): HTMLElement | null {
  return useContext(SlotContext)?.node ?? null;
}
