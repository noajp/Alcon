'use client';

import { suggestObjectPrefix } from '@/ActivitySpace/execution/object/objectPrefix';
import { applyOptimisticExplorerPatch } from '@/Function/sync/explorerCache';
import { translate } from '@/Function/i18n/I18nProvider';
import { getCurrentUserId, supabase } from '@/lib/supabase';
import type { AlconObject, ObjectTab, ObjectTabInsert, ObjectTabUpdate } from '@/types/database';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';


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
  // Top-level only — pick the next order_index across the whole table.
  const { data: existing } = await supabase
    .from('objects')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1);
  const maxOrder = existing?.[0]?.order_index ?? -1;

  // Stamp the creator. Records "who made this Object" on the row itself —
  // mirrors domains.user_id and pairs with the object_members owner row
  // added below.
  const creatorId = await getCurrentUserId();

  // The DB trigger that backfills prefix mangles CJK names ("TF-MED — 医療"
  // → "T—医" → el_T—医-001), so compute an ASCII prefix client-side — the
  // trigger keeps an explicitly provided one. Every Domain the Object will
  // land in counts as a sibling scope, since multi-homing means the prefix is
  // read next to all of them. If the sibling prefixes can't be read the
  // suggestion would be unvalidated, which is worse than a mangled one, so
  // leave prefix off and let the trigger decide.
  const prefixScope = Array.from(new Set([
    ...(obj.domain_ids ?? []),
    ...(obj.domain_id ? [obj.domain_id] : []),
  ].filter(Boolean)));
  const prefix = await suggestPrefixForDomains(obj.name, prefixScope);

  const { data, error } = await supabase
    .from('objects')
    .insert({
      name: obj.name,
      color: obj.color || null,
      description: obj.description || null,
      order_index: obj.order_index ?? maxOrder + 1,
      domain_id: obj.domain_id ?? null,
      user_id: creatorId,
      ...(obj.type !== undefined ? { type: obj.type } : {}),
      ...(obj.lead_id !== undefined ? { lead_id: obj.lead_id } : {}),
      ...(obj.due_date !== undefined ? { due_date: obj.due_date } : {}),
      ...(prefix ? { prefix } : {}),
    })
    .select()
    .single();

  if (error) throw error;

  // Write to object_domains junction table for domain multi-homing
  const domainIds = obj.domain_ids && obj.domain_ids.length > 0
    ? obj.domain_ids
    : obj.domain_id ? [obj.domain_id] : [];
  if (domainIds.length > 0) {
    await supabase.from('object_domains').insert(
      domainIds.map((did, i) => ({
        object_id: data.id,
        domain_id: did,
        is_primary: i === 0,
        order_index: i,
      }))
    );
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
 * Replace an Object's full Domain membership, keeping the legacy primary FK
 * (objects.domain_id) in sync with the object_domains junction so every
 * resolver — list, overview rail, membership queries — agrees. The first id in
 * `domainIds` becomes the primary; passing a single id is a plain "move".
 */
export async function setObjectDomains(objectId: string, domainIds: string[]): Promise<void> {
  const unique = Array.from(new Set(domainIds.filter(Boolean)));
  const primary = unique[0] ?? null;
  // Changing the primary Domain is for owners/admins of both Domains
  // (objects_domain_move_guard); stop before touching the junction if refused.
  const { error: moveError } = await supabase
    .from('objects')
    .update({ domain_id: primary, updated_at: new Date().toISOString() })
    .eq('id', objectId);
  if (moveError?.code === '42501') throw new Error(translate('Only owners or admins of both Domains can move this Object.'));
  if (moveError) throw moveError;
  await supabase.from('object_domains').delete().eq('object_id', objectId);
  if (unique.length > 0) {
    await supabase.from('object_domains').insert(
      unique.map((did, i) => ({
        object_id: objectId,
        domain_id: did,
        is_primary: i === 0,
        order_index: i,
      })),
    );
  }
}

export async function deleteObject(id: string): Promise<void> {
  // Detach Elements that this Object owns. Multi-homed Elements (registered
  // in another Object via element_objects) just lose this link; sole-parent
  // Elements get hard-deleted along with the Object.
  const { data: elementRelations } = await supabase
    .from('element_objects')
    .select('element_id')
    .eq('object_id', id);

  if (elementRelations && elementRelations.length > 0) {
    for (const rel of elementRelations) {
      const { data: otherObjects } = await supabase
        .from('element_objects')
        .select('id')
        .eq('element_id', rel.element_id)
        .neq('object_id', id);

      if (otherObjects && otherObjects.length > 0) {
        await supabase.from('element_objects').delete()
          .eq('element_id', rel.element_id).eq('object_id', id);
      } else {
        await supabase.from('subelements').delete().eq('element_id', rel.element_id);
        await supabase.from('elements').delete().eq('id', rel.element_id);
      }
    }
  }

  // Delete the object itself.
  const { error } = await supabase
    .from('objects')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Mirror reorderElements: bulk-update objects.order_index with an
// optimistic explorer-cache patch so a drag lands instantly instead of
// snapping back until the next refetch.
export async function reorderObjects(updates: { id: string; order_index: number }[]) {
  const orderById = new Map(updates.map(u => [u.id, u.order_index]));
  const rollback = applyOptimisticExplorerPatch(data => {
    let touched = false;
    const next = data.objects.map(obj => {
      const oi = orderById.get(obj.id);
      if (oi === undefined || oi === obj.order_index) return obj;
      touched = true;
      return { ...obj, order_index: oi };
    });
    if (!touched) return data;
    return { ...data, objects: [...next].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)) };
  });
  try {
    await Promise.all(updates.map(u =>
      supabase.from('objects').update({ order_index: u.order_index }).eq('id', u.id)
    ));
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
  const { data: siblings } = await supabase
    .from('objects')
    .select('id, order_index')
    .order('order_index');

  const otherSiblings = (siblings || []).filter(s => s.id !== objectId);
  otherSiblings.splice(newIndex, 0, { id: objectId, order_index: newIndex });

  for (let i = 0; i < otherSiblings.length; i++) {
    await supabase
      .from('objects')
      .update({ order_index: i })
      .eq('id', otherSiblings[i].id);
  }
}

// ============================================
// Object Tabs - Chrome-like tabs for Objects
// ============================================

// Fetch all tabs for an object
export async function fetchObjectTabs(objectId: string): Promise<ObjectTab[]> {
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

// Update a tab
export async function updateObjectTab(tabId: string, updates: ObjectTabUpdate): Promise<ObjectTab> {
  const { data, error } = await supabase
    .from('object_tabs')
    .update(updates)
    .eq('id', tabId)
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
