import { displayIdOf } from '@/Function/shared/element/displayId';
import type { SearchResult } from '@/Function/shared/searchData';

// ⌘K finds Elements in the Space that is open, as it finds CRM records: an
// Element lives in a Domain through its Object, and a Domain belongs to one
// Space. Rows come with that chain embedded; this keeps only the ones whose
// Domain is in the Space and remembers the Domain, so opening a result can
// switch to it first. The viewer's own personal Elements (no Object, owned by
// them) belong to no Space and are found from every Space.

const ELEMENT_COLUMNS = 'id, title, description, object_id, owner_id, display_id';

/** The embed `globalSearch` selects with each Space-scoped Element row. */
export const ELEMENT_SEARCH_SELECT =
  `${ELEMENT_COLUMNS}, object:objects!elements_object_id_fkey!inner(domain_id, domain:domains!objects_domain_id_fkey!inner(activity_space_id))`;

/** The viewer's personal Elements: no Object, so nothing to embed. */
export const PERSONAL_ELEMENT_SEARCH_SELECT = ELEMENT_COLUMNS;

export interface ElementSearchRow {
  id: string;
  title: string;
  description: string | null;
  object_id: string | null;
  owner_id: string | null;
  display_id: string | null;
  object?: { domain_id: string | null; domain: { activity_space_id: string | null } | null } | null;
}

export function elementSearchResults(
  rows: readonly ElementSearchRow[],
  spaceId: string | null,
  userId: string | null,
): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    const personal = !r.object_id && !!userId && r.owner_id === userId;
    const inSpace = !!spaceId && !!r.object && r.object.domain?.activity_space_id === spaceId;
    if (!personal && !inSpace) continue;
    seen.add(r.id);
    out.push({
      kind: 'element',
      id: r.id,
      title: r.title,
      snippet: r.description,
      objectId: r.object_id,
      domainId: inSpace ? r.object?.domain_id ?? null : null,
      displayId: displayIdOf(r),
    });
  }
  return out;
}
