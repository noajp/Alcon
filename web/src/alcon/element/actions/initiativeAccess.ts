// Who may change an Initiative, decided once.
//
// The write policy on `strategies` is owner-only (el_STR-008 widened SELECT to
// the Space, not UPDATE). RLS enforces that correctly — but silently: a
// non-owner's edit returns 0 rows, the optimistic UI keeps the change, and
// the loss shows only on reload (ELE_STR-021). The UI therefore has to know
// the same answer the database knows, ahead of the write. Pure, so the rule
// is testable and cannot drift between the title, the Object picker and the
// child links.

/** True when the signed-in user is the Initiative's creator. */
export function canEditInitiative(userId: string | null | undefined, createdBy: string | null | undefined): boolean {
  return !!userId && !!createdBy && userId === createdBy;
}
