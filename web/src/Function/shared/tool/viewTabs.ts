// Which of a tool's views are tabs, and in what order — the viewer's choice,
// kept per tool. Pure, so the rules below are tested rather than eyeballed.
//
//   - The home view (the Overview) is always the first tab and cannot be hidden.
//   - A view the tool added since the order was saved appears at the end.
//   - A saved id the tool no longer has is dropped.

export interface ViewTabState {
  /** Every view id, in tab order (hidden ones included, so showing one puts it back where it was). */
  order: string[];
  /** Views taken off the tab strip. */
  hidden: string[];
}

export function arrangeViews<V extends { id: string }>(views: readonly V[], state: ViewTabState | null, home: string) {
  const byId = new Map(views.map((view) => [view.id, view]));
  const saved = (state?.order ?? []).filter((id) => byId.has(id));
  const order = [...saved, ...views.map((view) => view.id).filter((id) => !saved.includes(id))];
  const ids = byId.has(home) ? [home, ...order.filter((id) => id !== home)] : order;
  const hidden = new Set((state?.hidden ?? []).filter((id) => id !== home && byId.has(id)));
  return {
    shown: ids.filter((id) => !hidden.has(id)).map((id) => byId.get(id)!),
    hidden: ids.filter((id) => hidden.has(id)).map((id) => byId.get(id)!),
  };
}

/** The state after hiding, showing or reordering, from the current arrangement. */
export function nextViewTabState(
  current: { shown: readonly { id: string }[]; hidden: readonly { id: string }[] },
  change: { hide: string } | { show: string } | { reorder: string[] },
): ViewTabState {
  const shown = current.shown.map((view) => view.id);
  const hidden = current.hidden.map((view) => view.id);
  if ('hide' in change) return { order: [...shown, ...hidden], hidden: [...hidden, change.hide] };
  if ('show' in change) {
    // A shown view rejoins the strip at the end, so it appears where the eye
    // expects the one just added.
    return { order: [...shown.filter((id) => id !== change.show), change.show, ...hidden.filter((id) => id !== change.show)], hidden: hidden.filter((id) => id !== change.show) };
  }
  return { order: [...change.reorder, ...hidden], hidden };
}

/** Read a stored state, tolerating anything that is not one. */
export function parseViewTabState(raw: string | null): ViewTabState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object') return null;
    const { order, hidden } = value as { order?: unknown; hidden?: unknown };
    const strings = (list: unknown) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
    return { order: strings(order), hidden: strings(hidden) };
  } catch {
    return null;
  }
}
