// Archived Objects — the rules every surface shares.
//
// An Object no longer in use is archived (objects.archived_at): its data
// stays, it opens by id (links, search, Element detail), and it leaves every
// list and picker. Lists that read `objects` directly go through
// `onlyActiveObjects`; the server RPCs (get_explorer_data, get_now_work,
// get_my_elements) filter on their own. Only whoever manages the Object may
// archive or restore it: owner/admin of its primary Domain, or of the Object
// itself while it has no Domain (alcon_internal.user_manages_object).

/** The column the database stamps when an Object is archived. */
const ARCHIVED_AT = 'archived_at';

export function isArchivedObject(object: { archived_at?: string | null } | null | undefined): boolean {
  return !!object?.archived_at;
}

/** Narrow a PostgREST `objects` read to the Objects still in use. */
export function onlyActiveObjects<Q extends { is(column: string, value: null): Q }>(query: Q): Q {
  return query.is(ARCHIVED_AT, null);
}

/**
 * Whether the viewer manages this Object — the same answer as
 * alcon_internal.user_manages_object. `undefined` maps mean "still loading"
 * and count as allowed, like the other access rules: the write is checked by
 * the database either way.
 */
export function canManageObject(
  domainRoles: ReadonlyMap<string, string> | undefined,
  objectRoles: ReadonlyMap<string, string> | undefined,
  object: { id: string; domain_id: string | null },
): boolean {
  const manages = (role: string | undefined) => role === 'owner' || role === 'admin';
  if (object.domain_id) return domainRoles === undefined || manages(domainRoles.get(object.domain_id));
  return objectRoles === undefined || manages(objectRoles.get(object.id));
}

/**
 * A realtime UPDATE that archives or restores an Object cannot be patched in
 * place: lists must drop or regain it, and its Elements leave or rejoin the
 * active reads. True when any cached copy disagrees with the new state.
 */
export function archiveStateChanged(
  caches: readonly { objects: readonly { id: string; archived_at?: string | null }[] }[],
  objectId: string,
  archivedAt: string | null | undefined,
): boolean {
  const archived = !!archivedAt;
  return caches.some((data) => data.objects.some((o) => o.id === objectId && isArchivedObject(o) !== archived));
}

/**
 * The database refuses to delete a Domain that still has Objects
 * (domains_delete_guard: errcode 23503, hint `domain_has_objects`, the count
 * in `details`). Returns that count, or null for any other error.
 */
export function domainObjectsRefusal(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { code?: unknown; hint?: unknown; details?: unknown };
  if (e.code !== '23503' || e.hint !== 'domain_has_objects') return null;
  const count = Number(e.details);
  return Number.isFinite(count) && count > 0 ? count : 1;
}
