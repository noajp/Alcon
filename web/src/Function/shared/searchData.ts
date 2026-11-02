'use client';

import { supabase } from '@/lib/supabase';
import { ELEMENT_SEARCH_SELECT, PERSONAL_ELEMENT_SEARCH_SELECT, elementSearchResults, type ElementSearchRow } from '@/Function/shared/elementSearch';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { indexSpaceFiles, searchAttachments, type FoundFile } from '@/hooks/attachmentData';


// ============================================
// Global Search (⌘K) — searches Elements, Objects, Notes and the active
// Space's attached files — by name, by what they are attached to, and by the
// words in them.
// ============================================
export interface SearchResult {
  kind: 'element' | 'object' | 'note' | 'file';
  id: string;
  title: string;
  snippet?: string | null;
  objectId?: string | null;
  /** The quotable id — `ELE_MED-001`. Absent for kinds that have none. */
  displayId?: string | null;
  /** An Object's primary Domain (an Element's: its Object's), so opening it
   *  switches to that Domain. */
  domainId?: string | null;
  /** Archived Objects are still found by search; the result says so. */
  archived?: boolean;
  /** A file: what it is attached to and its type, to open it there. */
  file?: FoundFile;
}

// A Space's files whose words are not kept yet are read in the background,
// at most every few minutes, the first time ⌘K searches it.
const INDEX_EVERY_MS = 5 * 60_000;
const lastIndexed = new Map<string, number>();

export async function globalSearch(query: string, limit = 8): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;

  const spaceId = getActiveSpaceId();
  if (spaceId && Date.now() - (lastIndexed.get(spaceId) ?? 0) > INDEX_EVERY_MS) {
    lastIndexed.set(spaceId, Date.now());
    void indexSpaceFiles(spaceId);
  }
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id ?? null;
  const elementMatch = `title.ilike.${like},description.ilike.${like},display_id.ilike.${like}`;
  const [elementsRes, personalRes, objectsRes, notesRes, files] = await Promise.all([
    // display_id is searched as well as returned. It is the string an Element
    // is called by in a comment or a SITREP, so someone reading "ELE_MED-001 is
    // blocked" reaches for ⌘K and types exactly that.
    // Only the open Space's Elements: one from another Space cannot be
    // opened from here.
    spaceId ? supabase
      .from('elements')
      .select(ELEMENT_SEARCH_SELECT)
      .eq('object.domain.activity_space_id', spaceId)
      .or(elementMatch)
      .limit(limit) : Promise.resolve({ data: [] as ElementSearchRow[] }),
    // The viewer's personal Elements belong to no Space: found from any.
    userId ? supabase
      .from('elements')
      .select(PERSONAL_ELEMENT_SEARCH_SELECT)
      .is('object_id', null)
      .eq('owner_id', userId)
      .or(elementMatch)
      .limit(limit) : Promise.resolve({ data: [] as ElementSearchRow[] }),
    // Archived Objects stay searchable: search is how an Object that left
    // every list is found again.
    supabase
      .from('objects')
      .select('id, name, description, domain_id, archived_at')
      .or(`name.ilike.${like},description.ilike.${like}`)
      .limit(limit),
    supabase
      .from('notes')
      // A Note's title is its `name`; folders and sections hold pages, not text.
      .select('id, title:name, parent_id')
      .eq('type', 'file')
      .ilike('name', like)
      .limit(limit),
    spaceId ? searchAttachments(spaceId, q, limit) : Promise.resolve([] as FoundFile[]),
  ]);

  const out: SearchResult[] = [];
  const elementRows = [...(elementsRes.data || []), ...(personalRes.data || [])] as unknown as ElementSearchRow[];
  out.push(...elementSearchResults(elementRows, spaceId, userId));
  for (const r of (objectsRes.data || [])) {
    out.push({ kind: 'object', id: r.id, title: r.name, snippet: r.description, domainId: r.domain_id, archived: !!r.archived_at });
  }
  for (const r of (notesRes.data || [])) {
    out.push({ kind: 'note', id: r.id, title: r.title || 'Untitled' });
  }
  for (const f of files) out.push({ kind: 'file', id: f.id, title: f.name, snippet: f.snippet ?? f.owner_label, file: f });
  return out;
}
