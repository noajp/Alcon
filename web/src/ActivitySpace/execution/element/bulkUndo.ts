'use client';

// Lightweight single-level undo for bulk Element actions.
//
// A bulk operation (move / add-to-object / duplicate) registers an inverse
// closure via `pushUndo`. Pressing Cmd/Ctrl+Z anywhere (outside a text
// field) runs the most recently registered inverse and clears it — one
// level deep, which matches the "oops, undo that" intent. The list visibly
// reverts since the inverse runs the same CRUD + refresh the action did.
//
// Delete is intentionally NOT undoable here (it hard-deletes rows and their
// relations); the BulkActionBar guards it with a confirmation instead.

export interface UndoEntry {
  /** Short human label, e.g. "Move 3 Elements". Not shown anywhere yet, but
   *  handy for a future toast. */
  label: string;
  /** Revert the action. Should run its own data refresh. */
  undo: () => void | Promise<void>;
}

let current: UndoEntry | null = null;
let running = false;
let installed = false;

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable === true;
}

function installGlobalListener() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z');
    if (!isUndo) return;
    if (isTypingTarget(e.target)) return; // let inputs do their own undo
    if (!current || running) return;
    e.preventDefault();
    void runUndo();
  });
}

/** Register the inverse of the action just performed. Replaces any prior
 *  pending undo (single level). */
export function pushUndo(entry: UndoEntry): void {
  current = entry;
  installGlobalListener();
}

/** Run the pending undo (also invoked by Cmd/Ctrl+Z). No-op when empty. */
async function runUndo(): Promise<void> {
  if (!current || running) return;
  const entry = current;
  current = null;
  running = true;
  try {
    await entry.undo();
  } catch (err) {
    console.error('Undo failed', err);
  } finally {
    running = false;
  }
}
