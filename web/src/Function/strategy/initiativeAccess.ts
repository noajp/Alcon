// Who may change an Initiative, decided once.
//
// The write rule on `strategies` (alcon_internal.user_can_edit_strategy):
// its creator, or an owner of the Space it belongs to. RLS enforces that, but the page did not
// know it: a non-owner's edit was refused (0 rows → PGRST116), the promise
// rejected with nothing catching it, the optimistic UI kept the change, and
// the loss showed only on reload (ELE_STR-021). The UI therefore has to know
// the same answer the database knows, ahead of the write. Pure, so the rule
// is testable and cannot drift between the title, the Object picker and the
// child links — and strategy_children's INSERT needs it true for the child
// as well as the parent.

/** True when the signed-in user is the Initiative's creator, or owns the
 *  Space it belongs to. */
export function canEditInitiative(
  userId: string | null | undefined,
  createdBy: string | null | undefined,
  ownsItsSpace = false,
): boolean {
  return !!userId && ((!!createdBy && userId === createdBy) || ownsItsSpace);
}
