'use client';

import { supabase } from '@/lib/supabase';
import { displayIdOf } from '@/ActivitySpace/execution/element/displayId';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';


// ============================================
// Global Search (⌘K) — searches Elements, Objects, Notes, and the active
// Space's tool records (CRM deals, companies, contacts; SCM items). The
// tools have no search box of their own: finding a record is ⌘K's job.
// ============================================
export interface SearchResult {
  kind: 'element' | 'object' | 'note' | 'deal' | 'company' | 'contact' | 'item';
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
}

export async function globalSearch(query: string, limit = 8): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;

  const spaceId = getActiveSpaceId();
  const none = Promise.resolve({ data: [] as { id: string; name: string; detail: string | null }[] });
  const [elementsRes, objectsRes, notesRes, dealsRes, companiesRes, contactsRes, itemsRes] = await Promise.all([
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
    spaceId ? supabase.from('scm_items').select('id, name, detail:sku').eq('activity_space_id', spaceId).or(`name.ilike.${like},sku.ilike.${like}`).limit(limit) : none,
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
  const records = [['deal', dealsRes], ['company', companiesRes], ['contact', contactsRes], ['item', itemsRes]] as const;
  for (const [kind, res] of records) {
    for (const r of (res.data || []) as { id: string; name: string; detail: string | null }[]) out.push({ kind, id: r.id, title: r.name, snippet: r.detail });
  }
  return out;
}
