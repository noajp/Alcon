// Who may change an Object, decided once — the same answer the database
// gives, given ahead of the write.
//
// objects UPDATE is `user_is_object_member(id)`; domain object types are
// owner/admin of the Domain. A viewer who can see an Object through its
// Domain but is not on object_members gets a refused write (0 rows) that the
// UI used to swallow into console.error (ELE_STR-026). Pure, so the rule is
// testable and identical on every surface that draws an Object row.

/**
 * `memberships` is the set of Object ids the viewer belongs to, or undefined
 * while it is still loading. Unknown is treated as allowed: the write is
 * still guarded by RLS and rolled back on refusal, and a control that flips
 * from disabled to enabled a moment after mount reads as a flicker, not as
 * caution.
 */
export function canEditObject(memberships: ReadonlySet<string> | undefined, objectId: string): boolean {
  return memberships === undefined || memberships.has(objectId);
}

/** Adding a Type to a Domain needs owner or admin there. Same unknown rule. */
export function canManageDomainTypes(
  roles: ReadonlyMap<string, string> | undefined,
  domainId: string | null | undefined,
): boolean {
  if (!domainId) return false;
  if (roles === undefined) return true;
  const role = roles.get(domainId);
  return role === 'owner' || role === 'admin';
}
