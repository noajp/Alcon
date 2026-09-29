// What a keystroke means in a field, decided once.
//
// Enter has three meanings and every field used to pick its own: plain Enter
// is the primary action in a single-line field and a newline in a multi-line
// one; Cmd/Ctrl+Enter is the primary action from a multi-line field. Two
// things spoil a bare `e.key === 'Enter'`: the Enter that confirms an IME
// conversion (it arrives with `isComposing`, and a Japanese title would submit
// mid-word), and key auto-repeat (a held Enter would submit once per repeat).
// Both are refused here so no field has to remember to.

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  /** React's synthetic event keeps `isComposing` on the native event. */
  nativeEvent?: { isComposing?: boolean };
  /** Some browser/IME pairings report `isComposing: false` on the very
   *  keydown that ends a composition — the deprecated `keyCode === 229` is
   *  the fallback signal for that keystroke, still sent for it alone. */
  keyCode?: number;
}

function composing(e: KeyLike): boolean {
  return e.isComposing === true || e.nativeEvent?.isComposing === true || e.keyCode === 229;
}

/** Plain Enter — the primary action of a single-line field. */
export function isCommitEnter(e: KeyLike): boolean {
  return e.key === 'Enter'
    && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey
    && !e.repeat && !composing(e);
}

/** Cmd/Ctrl+Enter — the primary action from a multi-line field, where plain
 *  Enter is a newline. */
export function isSubmitChord(e: KeyLike): boolean {
  return e.key === 'Enter'
    && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
    && !e.repeat && !composing(e);
}

/** Escape: leave the current field or layer. What leaving means is the
 *  caller's — an autosaved field saves, a dialog or an add-new input
 *  discards. An Escape that ends an IME composition is the IME's. */
export function isCancelKey(e: KeyLike): boolean {
  return e.key === 'Escape' && !composing(e);
}
