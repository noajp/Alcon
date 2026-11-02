import { displayIdOf } from '@/Function/shared/element/displayId';
import type { SearchResult } from '@/Function/shared/searchData';

// ⌘K finds Elements in the Space that is open, as it finds CRM records: an
// Element lives in a Domain through its Object, and a Domain belongs to one
// Space. Rows come with that chain embedded; this keeps only the ones whose
// Domain is in the Space and remembers the Domain, so opening a result can
// switch to it first.

/** The embed `globalSearch` selects with each Element row. */
export const ELEMENT_SEARCH_SELECT =
  'id, title, description, object_id, display_id, object:objects!elements_object_id_fkey!inner(domain_id, domain:domains!objects_domain_id_fkey!inner(activity_space_id))';

export interface ElementSearchRow {
  id: string;
  title: string;
  description: string | null;
  object_id: string | null;
  display_id: string | null;
  object: { domain_id: string | null; domain: { activity_space_id: string | null } | null } | null;
}

export function elementSearchResults(rows: readonly ElementSearchRow[], spaceId: string | null): SearchResult[] {
  if (!spaceId) return [];
  const out: SearchResult[] = [];
  for (const r of rows) {
    if (r.object?.domain?.activity_space_id !== spaceId) continue;
    out.push({
      kind: 'element',
      id: r.id,
      title: r.title,
      snippet: r.description,
      objectId: r.object_id,
      domainId: r.object.domain_id,
      displayId: displayIdOf(r),
    });
  }
  return out;
}
