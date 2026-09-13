'use client';

import { DOMAINS_CHANGED_EVENT, notifyDomainsChanged } from '@/ActivitySpace/execution/domain/domainsStore';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { selectIn } from '@/hooks/chunkedIn';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { Domain, DomainInsert, DomainUpdate } from '@/types/database';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';


// ============================================
// Domain CRUD + useDomains hook
// ============================================

export async function createDomain(domain: DomainInsert & { user_id: string }): Promise<Domain> {
  const { data, error } = await supabase
    .from('domains')
    .insert(domain)
    .select()
    .single();
  if (error) throw error;

  // Auto-enrol the creator as a domain_member with 'owner' role so they
  // appear in TeamSettings for this Domain and have full read/write rights
  // via the membership-based RLS policies.
  await supabase.from('domain_members').insert({
    domain_id: data.id,
    user_id: domain.user_id,
    role: 'owner',
  });

  notifyDomainsChanged();
  return data;
}

export async function updateDomain(id: string, updates: DomainUpdate): Promise<Domain> {
  const { data, error } = await supabase
    .from('domains')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  void invalidateDomains();
  return data;
}

// Persist a new Domain ordering. Caller passes the full list with its
// desired 0..N order_index; we write them all in parallel. Mirrors
// reorderObjects but for the sidebar Domain list.
export async function reorderDomains(updates: { id: string; order_index: number }[]): Promise<void> {
  await Promise.all(
    updates.map((u) =>
      supabase.from('domains').update({ order_index: u.order_index }).eq('id', u.id)
    )
  );
  void invalidateDomains();
}

export async function deleteDomain(id: string): Promise<void> {
  // RLS lets only owners delete, and a refused delete is not an error — it
  // just matches no rows. Ask for the deleted ids so a refusal is visible.
  const { data, error } = await supabase.from('domains').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Only an owner of this Domain can delete it.');
  notifyDomainsChanged();
}

// Append a new Element type to a Domain's shared `element_types` list.
// Reads fresh to avoid clobbering a concurrent edit; de-dups case-insensitively.
export async function addDomainElementType(domainId: string, name: string): Promise<string[]> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Element type name is empty');
  // Element types are stored with an uppercase first letter.
  const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);

  const { data: domain, error: readErr } = await supabase
    .from('domains')
    .select('element_types')
    .eq('id', domainId)
    .single();
  if (readErr) throw readErr;

  const current: string[] = Array.isArray(domain?.element_types) ? domain.element_types : [];
  if (current.some((t) => t.toLowerCase() === normalized.toLowerCase())) return current;

  const next = [...current, normalized];
  const { error: updateErr } = await supabase
    .from('domains')
    .update({ element_types: next, updated_at: new Date().toISOString() })
    .eq('id', domainId);
  if (updateErr) throw updateErr;

  void invalidateDomains();
  return next;
}

// Remove an Element type from a Domain's shared `element_types` list.
// Catalog-only: rows that already carry the type keep their value.
export async function removeDomainElementType(domainId: string, name: string): Promise<string[]> {
  const { data: domain, error: readErr } = await supabase
    .from('domains')
    .select('element_types')
    .eq('id', domainId)
    .single();
  if (readErr) throw readErr;

  const current: string[] = Array.isArray(domain?.element_types) ? domain.element_types : [];
  const next = current.filter((t) => t.toLowerCase() !== name.toLowerCase());
  if (next.length === current.length) return current;

  const { error: updateErr } = await supabase
    .from('domains')
    .update({ element_types: next, updated_at: new Date().toISOString() })
    .eq('id', domainId);
  if (updateErr) throw updateErr;

  void invalidateDomains();
  return next;
}

// Change a Domain's label colour map without reading it first
// (domains.label_colors = (label_colors || set) - remove, atomically, via
// the merge_domain_label_colors RPC). Two independent writers touch this
// column — Settings > Elements > Labels's bulk rename/delete/recolor, and a
// single inline pick from an Element's detail panel — and a read-then-write
// on the client let whichever one wrote second silently discard the
// other's pick with no error (ELE_QLT-032). Doing the merge in the
// database removes the read, and with it the window to race.
export async function mergeDomainLabelColors(
  domainId: string,
  patch: { set: Record<string, string>; remove: string[] },
): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('merge_domain_label_colors', {
    p_domain_id: domainId,
    p_set: patch.set,
    p_remove: patch.remove,
  });
  if (error) throw error;
  void invalidateDomains();
  return (data ?? {}) as Record<string, string>;
}

// Set a single Label's colour for a Domain — the Element detail panel's
// inline pick. See mergeDomainLabelColors for why this isn't read-then-write.
export async function setDomainLabelColor(domainId: string, name: string, colorKey: string): Promise<Record<string, string>> {
  return mergeDomainLabelColors(domainId, { set: { [name]: colorKey }, remove: [] });
}

const toLabelList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

// Which Elements carry labels, per Domain — the usage half of the label
// catalogue (domains.label_colors is the colour half). Scope is the union
// fetchStrategyElements resolves: Objects reached through object_domains or the
// legacy objects.domain_id, then Elements through element_objects or the legacy
// elements.object_id. A multi-homed Element counts under every Domain it
// reaches. Only Elements with at least one label come back, so the result is
// sized by labelling, not by the board.
export async function fetchLabelUsageByDomain(
  domainIds: string[],
): Promise<Map<string, { id: string; labels: string[] }[]>> {
  const result = new Map<string, { id: string; labels: string[] }[]>(domainIds.map((id) => [id, []]));
  if (domainIds.length === 0) return result;

  const objectDomains = new Map<string, Set<string>>();
  const linkObject = (objectId: string, domainId: string) => {
    const set = objectDomains.get(objectId) ?? new Set<string>();
    set.add(domainId);
    objectDomains.set(objectId, set);
  };
  const [linkedObjects, legacyObjects] = await Promise.all([
    selectIn(domainIds, chunk =>
      supabase.from('object_domains').select('object_id, domain_id').in('domain_id', chunk),
    ),
    selectIn(domainIds, chunk =>
      supabase.from('objects').select('id, domain_id').in('domain_id', chunk),
    ),
  ]);
  for (const r of linkedObjects) linkObject(r.object_id as string, r.domain_id as string);
  for (const r of legacyObjects) linkObject(r.id as string, r.domain_id as string);

  const objectIds = Array.from(objectDomains.keys());
  if (objectIds.length === 0) return result;

  const elementDomains = new Map<string, Set<string>>();
  const linkElement = (elementId: string, objectId: string) => {
    const set = elementDomains.get(elementId) ?? new Set<string>();
    for (const domainId of objectDomains.get(objectId) ?? []) set.add(domainId);
    elementDomains.set(elementId, set);
  };
  const labelsOf = new Map<string, string[]>();
  const [junctionRows, directRows] = await Promise.all([
    selectIn(objectIds, chunk =>
      supabase.from('element_objects').select('element_id, object_id').in('object_id', chunk),
    ),
    selectIn(objectIds, chunk =>
      supabase.from('elements').select('id, object_id, labels').in('object_id', chunk),
    ),
  ]);
  for (const r of directRows) {
    linkElement(r.id as string, r.object_id as string);
    labelsOf.set(r.id as string, toLabelList(r.labels));
  }
  for (const r of junctionRows) linkElement(r.element_id as string, r.object_id as string);

  // Elements reached only through the junction still need their labels.
  const unread = Array.from(elementDomains.keys()).filter((id) => !labelsOf.has(id));
  const extraRows = await selectIn(unread, chunk =>
    supabase.from('elements').select('id, labels').in('id', chunk),
  );
  for (const r of extraRows) labelsOf.set(r.id as string, toLabelList(r.labels));

  for (const [elementId, domains] of elementDomains) {
    const labels = labelsOf.get(elementId) ?? [];
    if (labels.length === 0) continue;
    for (const domainId of domains) result.get(domainId)?.push({ id: elementId, labels });
  }
  return result;
}

// Append a new Object type to a Domain's `object_types` list. Objects
// (Project-level) keep their own catalog — separate from element_types — so
// Element types like "Task" never leak into the Object Type picker.
export async function addDomainObjectType(domainId: string, name: string): Promise<string[]> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Object type name is empty');
  const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);

  const { data: domain, error: readErr } = await supabase
    .from('domains')
    .select('object_types')
    .eq('id', domainId)
    .single();
  if (readErr) throw readErr;

  const current: string[] = Array.isArray(domain?.object_types) ? domain.object_types : [];
  if (current.some((t) => t.toLowerCase() === normalized.toLowerCase())) return current;

  const next = [...current, normalized];
  // `.select().single()` so a write RLS refuses (0 rows, no error) throws
  // instead of resolving — the caller's failure path depends on it.
  const { error: updateErr } = await supabase
    .from('domains')
    .update({ object_types: next, updated_at: new Date().toISOString() })
    .eq('id', domainId)
    .select('id')
    .single();
  if (updateErr) throw updateErr;

  return next;
}

// Stable display order: by order_index. The old "Individual Domain pinned
// first" rule went away when the dedicated personal scope moved to the
// sidebar's "My Elements" entry (see 20260524_remove_individual_domain_…
// migration).
function sortDomains(rows: Domain[]): Domain[] {
  return [...rows].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
}

// Membership-scoped Domain list, shared through the query cache. useDomains()
// is mounted independently by many surfaces (page, sidebar, every list view,
// several widgets) — with one query key they all read the same row and the
// whole app fires ONE membership lookup per session instead of one per mount.
// The IndexedDB persister restores the last list before first paint, so the
// header's Domain name renders correctly on a cold load too.
const DOMAINS_QUERY_KEY = ['domains'] as const;
export const SPACE_IDS_QUERY_KEY = ['my-space-ids'] as const;

/** The ActivitySpace ids the user belongs to — used to tell their own Space's
 *  Domains apart from "guest" Domains (invited to a single Domain in a Space
 *  they're NOT a member of; a Domain invite must not grant Space access).
 *  Shared between useDomains and useActivitySpaces via fetchQuery so both
 *  hooks resolve it from one request. */
export function fetchMySpaceIds(userId: string): Promise<string[]> {
  return getQueryClient().fetchQuery({
    queryKey: [...SPACE_IDS_QUERY_KEY, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_space_members')
        .select('activity_space_id')
        .eq('user_id', userId);
      if (error) throw error;
      return (data ?? []).map((r) => r.activity_space_id as string);
    },
    staleTime: 30_000,
  });
}

interface DomainsQueryData {
  domains: Domain[];
  mySpaceIds: string[];
}

async function fetchMemberDomains(userId: string): Promise<DomainsQueryData> {
  // Membership-scoped — sidebar shows only Domains the user is a member of
  // (creator gets auto-membership in createDomain; others join via the 🔍
  // Discover modal). The two membership lookups are independent, so they run
  // in parallel rather than as a waterfall.
  const [mySpaceIds, { data: memberRows, error: memberErr }] = await Promise.all([
    fetchMySpaceIds(userId),
    supabase.from('domain_members').select('domain_id').eq('user_id', userId),
  ]);
  if (memberErr) throw memberErr;
  const memberIds = (memberRows ?? []).map((r) => r.domain_id);
  if (memberIds.length === 0) return { domains: [], mySpaceIds };

  const { data: rows, error } = await supabase
    .from('domains')
    .select('*')
    .in('id', memberIds)
    .order('order_index');
  if (error) throw error;
  return { domains: sortDomains((rows || []) as Domain[]), mySpaceIds };
}

/** Confirmed Domain writes refresh membership, visible scopes and the roster. */
async function invalidateDomains(): Promise<void> {
  const qc = getQueryClient();
  await Promise.all([
    qc.invalidateQueries({ queryKey: SPACE_IDS_QUERY_KEY }),
    qc.invalidateQueries({ queryKey: DOMAINS_QUERY_KEY }),
    qc.invalidateQueries({ queryKey: ['sustainment-domains'] }),
    qc.invalidateQueries({ queryKey: ['team-roster'] }),
  ]);
}

// Domain-list changes broadcast through DOMAINS_CHANGED_EVENT (domainsStore).
// One module-level listener, not one per hook instance: N listeners would
// call invalidateQueries N times, and each call restarts the in-flight
// refetch (cancelRefetch defaults to true).
if (typeof window !== 'undefined') {
  window.addEventListener(DOMAINS_CHANGED_EVENT, () => { void invalidateDomains(); });
}

const EMPTY_DOMAINS: Domain[] = [];
const EMPTY_IDS: string[] = [];

export function useDomains() {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: [...DOMAINS_QUERY_KEY, userId],
    queryFn: () => fetchMemberDomains(userId!),
    enabled: !!userId,
    placeholderData: keepPreviousData,
    // Every Domain writer in this module invalidates the list (and create /
    // delete / join also broadcast DOMAINS_CHANGED_EVENT), so the cache is
    // kept correct by the writers — no need to revalidate on every mount.
    staleTime: 5 * 60_000,
  });
  const allData = query.data?.domains ?? EMPTY_DOMAINS;
  const mySpaceIdList = query.data?.mySpaceIds ?? EMPTY_IDS;

  // Scope to the active ActivitySpace — Domains carry an activity_space_id, so
  // the sidebar/list show only the current space's Domains. Re-filters live on
  // a space switch (no refetch — the cache holds all the user's member Domains).
  const spaceId = useActiveSpaceId();

  // Domains in the active Space.
  const data = useMemo(
    () => (spaceId ? allData.filter((d) => d.activity_space_id === spaceId) : allData),
    [allData, spaceId],
  );

  // "Guest" Domains: ones the user is a member of but that live in a Space the
  // user does NOT belong to (invited to a single Domain). Shown in the sidebar's
  // "Shared with me" section regardless of the active Space — without exposing
  // the rest of that Space.
  const guestDomains = useMemo(() => {
    const mine = new Set(mySpaceIdList);
    return allData.filter((d) => !d.activity_space_id || !mine.has(d.activity_space_id));
  }, [allData, mySpaceIdList]);

  const refetch = useCallback(() => invalidateDomains(), []);

  return {
    data,
    guestDomains,
    // Signed-out is not "loading" — the query is disabled and the list is
    // legitimately empty. While the session resolves the caller sees an
    // empty list briefly; page.tsx gates on auth before this matters.
    loading: !!userId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
}
