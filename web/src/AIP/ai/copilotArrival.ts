// The arrival decision for the AI surfaces (the AI screen and the
// pop-up — two windows onto the one conversation CopilotProvider
// holds). The owner's rule: coming to the AI chat always lands on a
// fresh conversation; the previous one is never resumed automatically
// and is reached again only from the history list. "Coming to" is a
// false→true transition of "any AI surface visible" — staying is not
// arriving, and three exemptions keep deliberate gestures intact:
//
// - carry: the transition was caused by expanding the pop-up into the
//   AI screen or shrinking the screen back to the pop-up. The two
//   windows are one surface; those gestures mean "keep talking".
// - streaming: the shown conversation has a live turn. Navigation
//   never interrupts a turn, and the user must not lose a
//   half-written answer by stepping away and back. The next arrival
//   after it settles is fresh.
// - fresh: the shown conversation is already a new one (no kept
//   session, no messages) — resetting would be a no-op anyway.
//
// The reset this gates is display-only (the provider's
// newConversation): the previous session's row, its run and any
// pending approvals persist server-side, untouched.

/** One visibility change of the AI surfaces, as page.tsx observes it. */
export interface CopilotArrivalTransition {
  /** "Any AI surface visible" before the change. */
  wasVisible: boolean;
  /** "Any AI surface visible" after the change. */
  visible: boolean;
  /** The change came from the expand/minimize carry gestures. */
  carry: boolean;
}

export interface CopilotArrivalInput extends CopilotArrivalTransition {
  /** The shown conversation is currently streaming a turn. */
  streaming: boolean;
  /** The shown conversation is already fresh (no session, no messages). */
  fresh: boolean;
}

export function shouldResetOnArrival(input: CopilotArrivalInput): boolean {
  // Only an arrival counts: hidden→visible. Staying on a surface,
  // moving between the two windows (still visible), and leaving all
  // leave the conversation as it is.
  if (!input.visible || input.wasVisible) return false;
  if (input.carry) return false;
  if (input.streaming) return false;
  if (input.fresh) return false;
  return true;
}
