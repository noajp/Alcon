// One Escape closes one layer.
//
// Every dialog, popover, picker and detail view in alcon/ used to own its own
// window keydown listener for Escape. Listeners fire in registration order, so
// a modal opened over a detail view took the key *after* the view underneath
// had already navigated away — one Escape closed two things, the wrong one
// first. Radix surfaces never had this problem: DismissableLayer handles
// Escape in the capture phase, top layer only, and marks the event handled.
// This is the same contract for everything that is not Radix.
//
// A layer registers when it opens and leaves when it closes. Escape goes to
// the layer that opened last, and only to it. An Escape another handler has
// already consumed (`defaultPrevented` — a Radix layer, or a field cancelling
// its own edit) is not delivered at all, and an Escape that ends an IME
// composition is the IME's, not ours.

export interface EscapeLayerOptions {
  /** The layer's root element. An Escape typed into an editable element
   *  outside that root belongs to the element's own surface (a rename in the
   *  sidebar while a detail page is open, say) and is left alone. A layer
   *  with an overlay does not need this — nothing outside it can have focus. */
  root?: () => Element | null;
}

interface Layer {
  onEscape: () => void;
  root?: () => Element | null;
}

const layers: Layer[] = [];

function isEditable(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Route one keydown to the topmost layer. Exported for the listener and for
 *  tests; returns whether a layer took the key. */
export function dispatchEscape(e: KeyboardEvent): boolean {
  // `keyCode === 229` is the deprecated fallback for the same fact
  // `isComposing` names — some browser/IME pairings report `isComposing:
  // false` on the very keydown that ends a composition, and only the
  // legacy code still carries it for that keystroke.
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return false;
  const top = layers[layers.length - 1];
  if (!top) return false;
  if (top.root) {
    const root = top.root();
    if (root && isEditable(e.target) && !root.contains(e.target)) return false;
  }
  e.preventDefault();
  top.onEscape();
  return true;
}

let listening = false;

function listen() {
  if (listening || typeof window === 'undefined') return;
  // Bubble phase, deliberately: Radix's capture-phase handler and any React
  // onKeyDown on the focused element both run first, and either can mark
  // the event handled so it never reaches a layer.
  window.addEventListener('keydown', dispatchEscape);
  listening = true;
}

function unlisten() {
  if (!listening) return;
  window.removeEventListener('keydown', dispatchEscape);
  listening = false;
}

/** Register a layer. Returns the function that removes it — call it when the
 *  layer closes, whether or not Escape was what closed it. */
export function pushEscapeLayer(onEscape: () => void, options: EscapeLayerOptions = {}): () => void {
  const layer: Layer = { onEscape, root: options.root };
  layers.push(layer);
  listen();
  return () => {
    const i = layers.lastIndexOf(layer);
    if (i >= 0) layers.splice(i, 1);
    if (layers.length === 0) unlisten();
  };
}

/** How many layers are open. For tests. */
export function escapeLayerDepth(): number {
  return layers.length;
}
