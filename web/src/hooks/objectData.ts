'use client';

import { suggestObjectPrefix } from '@/Function/shared/objectPrefix';
import { applyOptimisticExplorerPatch } from '@/Function/sync/explorerCache';
import { reorderObjectsInExplorer } from '@/Function/sync/explorerPatch';
import { translate } from '@/Function/i18n/I18nProvider';
import { throwOnFailedWrites } from './writeResults';
import { supabase } from '@/lib/supabase';
import type { AlconObject, ObjectTab, ObjectTabInsert } from '@/types/database';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

// object_domains refusals (RLS): filing an Object under a Domain needs
// someone who manages the Object (an owner/admin of its Domain) and is an
// owner/admin of that Domain; taking it out needs one of the two.
const LINK_REFUSED = 'Only owners or admins of both this Object and the Domain can file it there.';
const UNLINK_REFUSED = 'Only owners or admins of this Object or of the Domain can take it out of there.';
const DELETE_REFUSED = 'Only owners or admins of this Object or of its Domain can delete it.';
const CREATE_CLEANUP_FAILED = 'The Object was created but could not be filed under every chosen Domain, and it could not be removed. Delete it, or ask an owner or admin of those Domains to file it.';
const MOVE_NEEDS_MEMBERSHIP = 'You need to be a member of this Object to move it.';
const CREATE_REFUSED = 'You can create an Object only in a Domain you can see.';
const DOMAIN_REQUIRED = 'Choose a Domain for this Object.';

// ============================================
// Object CRUD
// ============================================

/**
 * ASCII prefix for a new Object, unique among every Object already homed in
 * `domainIds`. Membership is the object_domains junction plus the legacy
 * objects.domain_id column, the same union get_explorer_data resolves.
 *
 * Returns null when the sibling prefixes can't be read — including the
 * Domain-less case, where the sibling set would be the whole table — so the
 * caller omits prefix and the DB trigger keeps its say.
 */
async function suggestPrefixForDomains(name: string, domainIds: string[]): Promise<string | null> {
  if (domainIds.length === 0) return null;

  const [{ data: linked, error: linkedError }, { data: legacy, error: legacyError }] = await Promise.all([
    supabase.from('object_domains').select('objects(prefix)').in('domain_id', domainIds),
    supabase.from('objects').select('prefix').in('domain_id', domainIds),
  ]);
  if (linkedError || legacyError) return null;

  // The embed is many-to-one so PostgREST returns a single row, but the
  // generated types call it an array — read both shapes.
  const embedded = (r: { objects: unknown }): (string | null)[] => {
    const o = r.objects;
    if (Array.isArray(o)) return o.map((x) => (x as { prefix?: string | null })?.prefix ?? null);
    return [(o as { prefix?: string | null } | null)?.prefix ?? null];
  };

  const taken = [
    ...(linked ?? []).flatMap(embedded),
    ...(legacy ?? []).map((r) => r.prefix),
  ].filter((p): p is string => Boolean(p));

  return suggestObjectPrefix(name, taken);
}

export async function createObject(obj: {
  name: string;
  color?: string | null;
  description?: string | null;
  order_index?: number;
  system_id?: string | null;  // legacy
  domain_id?: string | null;  // primary domain (UUID FK)
  domain_ids?: string[];      // multi-homing: all domains this object belongs to
  type?: string | null;
  lead_id?: string | null;
  due_date?: string | null;
}): Promise<AlconObject> {
  // An Object always sits in a Domain (Domain → Object → Element).
  const primaryDomainId = obj.domain_id ?? obj.domain_ids?.[0] ?? null;
  if (!primaryDomainId) throw new Error(translate(DOMAIN_REQUIRED));

  // Top-level only — pick the next order_index across the whole table.
  const { data: existing } = await supabase
    .from('objects')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1);
  const maxOrder = existing?.[0]?.order_index ?? -1;

  // The DB trigger that backfills prefix mangles CJK names ("TF-MED — 医療"
  // → "T—医" → el_T—医-001), so compute an ASCII prefix client-side — the
  // trigger keeps an explicitly provided one. Every Domain the Object will
  // land in counts as a sibling scope, since multi-homing means the prefix is
  // read next to all of them. If the sibling prefixes can't be read the
  // suggestion would be unvalidated, which is worse than a mangled one, so
  // leave prefix off and let the trigger decide.
  const prefixScope = Array.from(new Set([
    ...(obj.domain_ids ?? []),
    primaryDomainId,
  ].filter(Boolean)));
  const prefix = await suggestPrefixForDomains(obj.name, prefixScope);

  // Insert without RETURNING, then read the row back by an id chosen here.
  // RETURNING is checked against the objects SELECT policy before the AFTER
  // INSERT trigger enrols the creator as owner, so an Object in a private
  // Domain the caller sees only through that Object would be refused (42501).
  // The creator (objects.user_id) and the owner row are written by the
  // database (objects_stamp_creator / objects_enrol_creator).
  const id = crypto.randomUUID();
  const { error: insertError } = await supabase
    .from('objects')
    .insert({
      id,
      name: obj.name,
      color: obj.color || null,
      description: obj.description || null,
      order_index: obj.order_index ?? maxOrder + 1,
      domain_id: primaryDomainId,
      ...(obj.type !== undefined ? { type: obj.type } : {}),
      ...(obj.lead_id !== undefined ? { lead_id: obj.lead_id } : {}),
      ...(obj.due_date !== undefined ? { due_date: obj.due_date } : {}),
      ...(prefix ? { prefix } : {}),
    });
  // Objects are created only in a Domain the caller can see.
  if (insertError?.code === '42501') throw new Error(translate(CREATE_REFUSED));
  if (insertError) throw insertError;

  const { data, error } = await supabase.from('objects').select().eq('id', id).single();
  if (error) throw error;

  // Write to object_domains junction table for domain multi-homing
  const domainIds = obj.domain_ids && obj.domain_ids.length > 0
    ? obj.domain_ids
    : [primaryDomainId];
  if (domainIds.length > 0) {
    // Filing under a Domain other than the primary needs an owner/admin of
    // that Domain (object_domains_insert). On a refusal, take the new Object
    // back so the create is all-or-nothing and retrying makes no duplicate.
    const { error: linkError } = await supabase.from('object_domains').insert(
      domainIds.map((did, i) => ({
        object_id: data.id,
        domain_id: did,
        is_primary: i === 0,
        order_index: i,
      }))
    );
    if (linkError) {
      const { data: removed, error: removeError } = await supabase
        .from('objects').delete().eq('id', data.id).select('id');
      if (removeError || !removed?.length) throw new Error(translate(CREATE_CLEANUP_FAILED));
      throw linkError.code === '42501' ? new Error(translate(LINK_REFUSED)) : linkError;
    }
  }

  // The database enrols the creator as the Object's owner in the same insert
  // (objects_enrol_creator) — the browser writes no owner rows.
  return data;
}

export async function updateObject(
  id: string,
  updates: Partial<Omit<AlconObject, 'id' | 'created_at'>>
): Promise<AlconObject> {
  const { data, error } = await supabase
    .from('objects')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Manual prefix rename (RenamePrefixDialog.tsx) — routed through a
// SECURITY DEFINER RPC, not a plain updateObject(), because the check and
// the write have to happen inside one transaction under the same
// pg_advisory_xact_lock the auto-generate trigger already uses
// (20260903000000_object_prefix_advisory_lock.sql): a client-side
// SELECT-then-UPDATE can't close the race between two people renaming
// different Objects to the same prefix, or see a collision in a private
// Domain the caller isn't a member of. See the RPC's own migration
// (20260905010000_object_prefix_rename_rpc.sql) for the full rationale.
export async function renameObjectPrefix(objectId: string, newPrefix: string): Promise<AlconObject> {
  const { data, error } = await supabase.rpc('rename_object_prefix', {
    p_object_id: objectId,
    p_new_prefix: newPrefix,
  });
  if (error) throw error;
  return data as AlconObject;
}

/**
 * Read an Object's Domain membership (primary first) from the object_domains
 * junction, falling back to the legacy objects.domain_id FK when the junction
 * is empty. Used by the Object actions menu to drive Move / Multi-home state.
 */
export async function fetchObjectDomainIds(objectId: string): Promise<string[]> {
  const { data } = await supabase
    .from('object_domains')
    .select('domain_id, is_primary, order_index')
    .eq('object_id', objectId)
    .order('order_index');
  const ids = (data ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((r) => r.domain_id as string)
    .filter(Boolean);
  if (ids.length > 0) return ids;
  const { data: obj } = await supabase.from('objects').select('domain_id').eq('id', objectId).single();
  return obj?.domain_id ? [obj.domain_id as string] : [];
}

/**
 * File an existing Object under more Domains, one link at a time, and return
 * the Domain ids that were refused (the caller does not manage the Object or
 * that Domain). Used where a partial result is better than none — Duplicate
 * keeps the copy in its primary Domain and says which links it skipped.
 */
export async function fileObjectUnderDomains(objectId: string, domainIds: string[], firstOrderIndex = 1): Promise<string[]> {
  const refused: string[] = [];
  for (const [i, did] of domainIds.entries()) {
    const { error } = await supabase.from('object_domains').insert({
      object_id: objectId,
      domain_id: did,
      is_primary: false,
      order_index: firstOrderIndex + i,
    });
    if (error?.code === '42501') refused.push(did);
    else if (error) throw error;
  }
  return refused;
}

/**
 * Replace an Object's Domain membership, keeping the legacy primary FK
 * (objects.domain_id) in sync with the object_domains junction so every
 * resolver — list, overview rail, membership queries — agrees. The first id in
 * `domainIds` becomes the primary; passing a single id is a plain "move".
 *
 * Only the links that change are written, in an order that leaves the
 * previous state in place when something is refused: add the new links,
 * then move the primary, then drop the old links. Filing under a Domain needs
 * someone who manages the Object and that Domain, taking it out needs one of
 * the two (object_domains RLS), and moving needs an owner/admin of both
 * Domains who is also a member of the Object (objects RLS and
 * objects_domain_move_guard). Links to Domains the caller cannot see are
 * never read, so they are never touched.
 */
export async function setObjectDomains(objectId: string, domainIds: string[]): Promise<void> {
  const unique = Array.from(new Set(domainIds.filter(Boolean)));
  const primary = unique[0] ?? null;

  const [{ data: objectRow, error: objectError }, { data: rows, error: readError }] = await Promise.all([
    supabase.from('objects').select('domain_id').eq('id', objectId).single(),
    supabase.from('object_domains').select('domain_id, is_primary').eq('object_id', objectId),
  ]);
  if (objectError) throw objectError;
  if (readError) throw readError;
  const currentPrimary = (objectRow?.domain_id as string | null) ?? null;
  const current = new Map((rows ?? []).map((r) => [r.domain_id as string, Boolean(r.is_primary)]));

  // 1. Add the new links.
  const added = unique.filter((id) => !current.has(id));
  if (added.length > 0) {
    const { error } = await supabase.from('object_domains').insert(
      added.map((did) => ({
        object_id: objectId,
        domain_id: did,
        is_primary: did === primary,
        order_index: unique.indexOf(did),
      })),
    );
    if (error?.code === '42501') throw new Error(translate(LINK_REFUSED));
    if (error) throw error;
  }

  // 2. Move the primary. A refusal takes the links just added back out.
  if (primary !== currentPrimary) {
    const { data: moved, error: moveError } = await supabase
      .from('objects')
      .update({ domain_id: primary, updated_at: new Date().toISOString() })
      .eq('id', objectId)
      .select('id');
    if (moveError || !moved?.length) {
      if (added.length > 0) {
        await supabase.from('object_domains').delete().eq('object_id', objectId).in('domain_id', added);
      }
      if (moveError?.code === '42501') throw new Error(translate('Only owners or admins of both Domains can move this Object.'));
      if (moveError) throw moveError;
      throw new Error(translate(MOVE_NEEDS_MEMBERSHIP));
    }
  }

  // 3. Keep the primary flag on the kept links in step with objects.domain_id.
  // Only a move changes it, and the mover manages both of those Domains.
  const flips = [...current.entries()].filter(([id, isPrimary]) => unique.includes(id) && isPrimary !== (id === primary));
  const flipped = await Promise.all(flips.map(([id]) =>
    supabase.from('object_domains').update({ is_primary: id === primary })
      .eq('object_id', objectId).eq('domain_id', id).select('domain_id'),
  ));
  for (const { data, error } of flipped) {
    if (error?.code === '42501' || (!error && !data?.length)) throw new Error(translate(LINK_REFUSED));
    if (error) throw error;
  }

  // 4. Drop the old links. A refused delete matches no rows; ask for them so
  // a refusal is visible.
  const removed = [...current.keys()].filter((id) => !unique.includes(id));
  if (removed.length > 0) {
    const { data: gone, error } = await supabase
      .from('object_domains')
      .delete()
      .eq('object_id', objectId)
      .in('domain_id', removed)
      .select('domain_id');
    if (error) throw error;
    if ((gone?.length ?? 0) < removed.length) throw new Error(translate(UNLINK_REFUSED));
  }
}

export async function deleteObject(id: string): Promise<void> {
  // Detach Elements that this Object owns. Multi-homed Elements (registered
  // in another Object via element_objects) just lose this link — moving to
  // another home first when this is their primary one, since the primary row
  // cannot be deleted on its own; sole-parent Elements get hard-deleted along
  // with the Object.
  const { data: elementRelations } = await supabase
    .from('element_objects')
    .select('element_id, is_primary')
    .eq('object_id', id);

  if (elementRelations && elementRelations.length > 0) {
    for (const rel of elementRelations) {
      const { data: otherObjects } = await supabase
        .from('element_objects')
        .select('object_id')
        .eq('element_id', rel.element_id)
        .neq('object_id', id);

      // A refused or failed step stops the delete: going on would cascade
      // the Object away with Elements that were meant to stay elsewhere.
      if (otherObjects && otherObjects.length > 0) {
        const { error: detachError } = rel.is_primary
          ? await supabase.from('elements').update({ object_id: otherObjects[0].object_id }).eq('id', rel.element_id)
          : await supabase.from('element_objects').delete().eq('element_id', rel.element_id).eq('object_id', id);
        if (detachError) throw detachError;
      } else {
        const { error: deleteError } = await supabase.from('elements').delete().eq('id', rel.element_id);
        if (deleteError) throw deleteError;
      }
    }
  }

  // Delete the object itself. A delete RLS refuses matches no rows rather
  // than erroring; ask for the row so a refusal is visible.
  const { data: gone, error } = await supabase
    .from('objects')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!gone?.length) throw new Error(translate(DELETE_REFUSED));
}

// Mirror reorderElements: bulk-update objects.order_index with an
// optimistic explorer-cache patch so a drag lands instantly instead of
// snapping back until the next refetch.
export async function reorderObjects(updates: { id: string; order_index: number }[]) {
  const rollback = applyOptimisticExplorerPatch(data => reorderObjectsInExplorer(data, updates));
  try {
    throwOnFailedWrites(await Promise.all(updates.map(u =>
      supabase.from('objects').update({ order_index: u.order_index }).eq('id', u.id).select('id')
    )), 'reorderObjects');
  } catch (err) {
    rollback();
    throw err;
  }
}

// ============================================
// Reorder Functions (for drag and drop)
// ============================================

// Move an object to a new position. Object nesting is gone — there's no
// "new parent" anymore. The 2nd argument is kept (always null) for callers
// that haven't been updated yet; it's ignored.
export async function moveObject(
  objectId: string,
  _newParentId: string | null,
  newIndex: number
): Promise<void> {
  void _newParentId;
  // Siblings are the Objects of the same Domain — numbering every Object the
  // viewer can see would rewrite other Domains' (and Spaces') order too.
  const { data: self, error: selfError } = await supabase
    .from('objects').select('domain_id').eq('id', objectId).maybeSingle();
  if (selfError) throw selfError;
  if (!self?.domain_id) return;
  const { data: siblings, error } = await supabase
    .from('objects')
    .select('id, order_index')
    .eq('domain_id', self.domain_id)
    .order('order_index');
  if (error) throw error;

  const ordered = (siblings || []).filter(s => s.id !== objectId);
  ordered.splice(newIndex, 0, { id: objectId, order_index: newIndex });

  // Write only the rows whose number changes.
  const changed = ordered
    .map((s, i) => ({ id: s.id, order_index: i, before: s.order_index }))
    .filter(s => s.id === objectId || s.before !== s.order_index);
  throwOnFailedWrites(await Promise.all(changed.map(s =>
    supabase.from('objects').update({ order_index: s.order_index }).eq('id', s.id).select('id')
  )), 'moveObject');
}

// ============================================
// Object Tabs - Chrome-like tabs for Objects
// ============================================

// Fetch all tabs for an object
async function fetchObjectTabs(objectId: string): Promise<ObjectTab[]> {
  const { data, error } = await supabase
    .from('object_tabs')
    .select('*')
    .eq('object_id', objectId)
    .order('order_index', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Create a new tab
export async function createObjectTab(tab: ObjectTabInsert): Promise<ObjectTab> {
  // Get the max order_index for this object
  const { data: existing } = await supabase
    .from('object_tabs')
    .select('order_index')
    .eq('object_id', tab.object_id)
    .order('order_index', { ascending: false })
    .limit(1);

  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('object_tabs')
    .insert({
      ...tab,
      order_index: tab.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete a tab
export async function deleteObjectTab(tabId: string): Promise<void> {
  const { error } = await supabase
    .from('object_tabs')
    .delete()
    .eq('id', tabId);

  if (error) throw error;
}

// Reorder tabs
export async function reorderObjectTabs(objectId: string, tabIds: string[]): Promise<void> {
  for (let i = 0; i < tabIds.length; i++) {
    const { error } = await supabase
      .from('object_tabs')
      .update({ order_index: i })
      .eq('id', tabIds[i])
      .eq('object_id', objectId);
    if (error) throw error;
  }
}

// Hook: Fetch tabs for an object
const EMPTY_TABS: ObjectTab[] = [];

export function useObjectTabs(objectId: string | null) {
  const qc = useQueryClient();
  const key = useMemo(() => ['object', objectId ?? '', 'tabs'] as const, [objectId]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchObjectTabs(objectId!),
    enabled: !!objectId,
  });
  const refetch = useCallback(async () => { await qc.invalidateQueries({ queryKey: key }); }, [qc, key]);
  return {
    tabs: query.data ?? EMPTY_TABS,
    loading: !!objectId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
}

// All distinct Labels used by Elements in an Object — the Object-scoped label
// pool. Labels are shared within their Object: a label created on one Element
// shows up as a pickable suggestion for the others.
export async function fetchObjectLabels(objectId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('elements')
    .select('labels')
    .eq('object_id', objectId);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of data ?? []) {
    for (const l of (row.labels ?? [])) {
      const t = (l ?? '').trim();
      if (t) set.add(t);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export interface ObjectMemberRow {
  id: string;
  user_id: string;
  role: string;
  worker?: { id: string; name: string; avatar_url: string | null };
}

/** A member of the Object's Domain who is not on the Object yet. */
export interface ObjectMemberCandidate {
  user_id: string;
  worker_id: string | null;
  name: string | null;
  avatar_url: string | null;
}

/** Who is on the Object, and which Domain members could be invited to it
 *  (object_members ⊆ domain_members is kept by the UI). One Worker per user
 *  is the norm; when there are several, the first is shown. */
export async function fetchObjectMemberAccess(
  objectId: string,
  domainId: string | null,
): Promise<{ members: ObjectMemberRow[]; candidates: ObjectMemberCandidate[] }> {
  const { data: memberRows } = await supabase
    .from('object_members')
    .select('id, user_id, role')
    .eq('object_id', objectId)
    .order('created_at');
  const memberUserIds = (memberRows ?? []).map((r) => r.user_id as string);
  const workersOf = async (userIds: string[]) => {
    const byUser = new Map<string, { id: string; name: string; avatar_url: string | null }>();
    if (!userIds.length) return byUser;
    const { data } = await supabase.from('workers').select('id, name, avatar_url, user_id').in('user_id', userIds);
    for (const w of data ?? []) {
      if (w.user_id && !byUser.has(w.user_id)) byUser.set(w.user_id, { id: w.id, name: w.name, avatar_url: w.avatar_url });
    }
    return byUser;
  };
  const memberWorkers = await workersOf(memberUserIds);
  const members = (memberRows ?? []).map((m) => ({ id: m.id, user_id: m.user_id, role: m.role, worker: memberWorkers.get(m.user_id) }));
  if (!domainId) return { members, candidates: [] };

  const { data: domMembers } = await supabase.from('domain_members').select('user_id').eq('domain_id', domainId);
  const onObject = new Set(memberUserIds);
  const candidateIds = (domMembers ?? []).map((r) => r.user_id as string).filter((uid) => !onObject.has(uid));
  const candidateWorkers = await workersOf(candidateIds);
  return {
    members,
    candidates: candidateIds.map((uid) => {
      const w = candidateWorkers.get(uid);
      return { user_id: uid, worker_id: w?.id ?? null, name: w?.name ?? null, avatar_url: w?.avatar_url ?? null };
    }),
  };
}

/** A refused delete matches no rows, so `removed` is false without an error:
 *  the last owner stays unless a manager of the Domain removes them. */
export async function removeObjectMember(memberId: string) {
  const { data, error } = await supabase.from('object_members').delete().eq('id', memberId).select('id');
  return { error, removed: !!data?.length };
}
