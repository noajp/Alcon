'use client';

import { supabase } from '@/lib/supabase';
import { displayIdOf } from '@/Function/shared/element/displayId';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { indexSpaceFiles, searchAttachments, type FoundFile } from '@/hooks/attachmentData';


// ============================================
// Global Search (⌘K) — searches Elements, Objects, Notes, the active
// Space's CRM records (deals, companies, contacts) and its attached files —
// by name, by what they are attached to, and by the words in them. The CRM
// has no search box of its own: finding a record is ⌘K's job.
// ============================================
export interface SearchResult {
  kind: 'element' | 'object' | 'note' | 'deal' | 'company' | 'contact' | 'file';
  id: string;
  title: string;
  snippet?: string | null;
  objectId?: string | null;
  /** The quotable id — `ELE_MED-001`. Absent for kinds that have none. */
  displayId?: string | null;
  /** An Object's primary Domain, so opening it switches to that Domain. */
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
  const none = Promise.resolve({ data: [] as { id: string; name: string; detail: string | null }[] });
  if (spaceId && Date.now() - (lastIndexed.get(spaceId) ?? 0) > INDEX_EVERY_MS) {
    lastIndexed.set(spaceId, Date.now());
    void indexSpaceFiles(spaceId);
  }
  const [elementsRes, objectsRes, notesRes, dealsRes, companiesRes, contactsRes, files] = await Promise.all([
    // display_id is searched as well as returned. It is the string an Element
    // is called by in a comment or a SITREP, so someone reading "ELE_MED-001 is
    // blocked" reaches for ⌘K and types exactly that.
    supabase
      .from('elements')
      .select('id, title, description, object_id, display_id')
      .or(`title.ilike.${like},description.ilike.${like},display_id.ilike.${like}`)
      .limit(limit),
    // Archived Objects stay searchable: search is how an Object that left
    // every list is found again.
    supabase
      .from('objects')
      .select('id, name, description, domain_id, archived_at')
      .or(`name.ilike.${like},description.ilike.${like}`)
      .limit(limit),
    supabase
      .from('notes')
      .select('id, title, parent_id')
      .ilike('title', like)
      .limit(limit),
    spaceId ? supabase.from('crm_deals').select('id, name, detail:next_step').eq('activity_space_id', spaceId).ilike('name', like).limit(limit) : none,
    spaceId ? supabase.from('crm_companies').select('id, name, detail:industry').eq('activity_space_id', spaceId).ilike('name', like).limit(limit) : none,
    spaceId ? supabase.from('crm_contacts').select('id, name, detail:email').eq('activity_space_id', spaceId).or(`name.ilike.${like},email.ilike.${like}`).limit(limit) : none,
    spaceId ? searchAttachments(spaceId, q, limit) : Promise.resolve([] as FoundFile[]),
  ]);

  const out: SearchResult[] = [];
  for (const r of (elementsRes.data || [])) {
    out.push({ kind: 'element', id: r.id, title: r.title, snippet: r.description, objectId: r.object_id, displayId: displayIdOf(r) });
  }
  for (const r of (objectsRes.data || [])) {
    out.push({ kind: 'object', id: r.id, title: r.name, snippet: r.description, domainId: r.domain_id, archived: !!r.archived_at });
  }
  for (const r of (notesRes.data || [])) {
    out.push({ kind: 'note', id: r.id, title: r.title || 'Untitled' });
  }
  const records = [['deal', dealsRes], ['company', companiesRes], ['contact', contactsRes]] as const;
  for (const [kind, res] of records) {
    for (const r of (res.data || []) as { id: string; name: string; detail: string | null }[]) out.push({ kind, id: r.id, title: r.name, snippet: r.detail });
  }
  for (const f of files) out.push({ kind: 'file', id: f.id, title: f.name, snippet: f.snippet ?? f.owner_label, file: f });
  return out;
}
