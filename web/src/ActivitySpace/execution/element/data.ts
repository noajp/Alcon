'use client';

import type { DependencyBlocker } from '@/ActivitySpace/execution/element/dependencyReadiness';
import { computeBlockers, upstreamIdsOf } from '@/ActivitySpace/execution/element/dependencyReadiness';
import { applyOptimisticExplorerPatch, invalidateElementDetail } from '@/Function/sync/explorerCache';
import {
  insertElementIntoExplorer,
  mapElementInExplorer,
  patchElementInExplorer,
  patchSubelementInExplorer,
  removeElementFromExplorer,
} from '@/Function/sync/explorerPatch';
import { selectIn } from '@/hooks/chunkedIn';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import type {
  ApprovalState,
  Element,
  ElementApproval,
  ElementApprovalInsert,
  ElementAssignee,
  ElementAssigneeWithWorker,
  ElementEdgeWithElement,
  ElementWithDetails,
  Subelement,
  Worker,
} from '@/types/database';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

// ============================================
// Element CRUD
// ============================================

export async function createElement(element: {
  title: string;
  object_id?: string | null;  // null = Domain-direct Element (sidebar Elements view)
  owner_id?: string | null;   // set = personal Element (My Elements scope)
  description?: string | null;
  type?: string | null;        // Domain-shared Element type (TASK / Feature / Fix / …)
  labels?: string[];           // 自由文字列ラベル。省略時は空配列
  // status / priority: omit for the column default, pass null to leave the
  // Element explicitly unset (an add row under "No status" / "No priority").
  status?: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled' | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null;
  start_date?: string | null;
  start_time?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  estimated_hours?: number | null;
  order_index?: number;
}): Promise<Element> {
  // Get max order_index in the matching scope (same object_id, or null scope)
  let query = supabase
    .from('elements')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1);
  query = element.object_id
    ? query.eq('object_id', element.object_id)
    : query.is('object_id', null);
  const { data: existing } = await query;
  const maxOrder = existing?.[0]?.order_index ?? -1;

  const orderIndex = element.order_index ?? maxOrder + 1;
  const insertRow = {
    title: element.title,
    object_id: element.object_id ?? null,
    owner_id: element.owner_id ?? null,
    description: element.description || null,
    type: element.type ?? null,
    labels: element.labels ?? [],
    status: element.status ?? 'todo',
    priority: element.priority ?? 'medium',
    start_date: element.start_date || null,
    start_time: element.start_time || null,
    due_date: element.due_date || null,
    due_time: element.due_time || null,
    estimated_hours: element.estimated_hours || null,
    order_index: orderIndex,
  };

  // Optimistic insert with a temp id — the new row shows up immediately
  // (Enter → it's in the list) instead of after the network round-trip.
  // Personal Elements (owner_id set) live in the "My Elements" hook, not the
  // explorer cache, so we only optimistically insert Domain/Object Elements.
  const isExplorerScoped = !element.owner_id;
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let rollback: (() => void) | null = null;
  if (isExplorerScoped) {
    const nowIso = new Date().toISOString();
    const tempEl = {
      ...insertRow,
      id: tempId,
      display_id: null, seq_number: null,
      color: null, actual_hours: null, progress: null, direction: null,
      is_approval: null, approval_state: null, note_id: null, phase_id: null,
      carried_over_count: 0,
      claimed_by: null, claim_expires_at: null, branch: null,
      created_at: nowIso, updated_at: nowIso,
      subelements: [], assignees: [],
      objectIds: element.object_id ? [element.object_id] : [],
      isMultiHomed: false,
    } as ElementWithDetails;
    rollback = applyOptimisticExplorerPatch(data => insertElementIntoExplorer(data, tempEl));
  }

  try {
    const { data, error } = await supabase
      .from('elements')
      .insert(insertRow)
      .select()
      .single();
    if (error) throw error;

    // The junction row for the primary Object. The database's
    // trg_element_primary_object already created it the moment the Element
    // landed (so a row written by SQL or an agent is never invisible); this
    // upsert is what carries the app's order_index onto it — a plain insert
    // would collide with the trigger's row and lose the position. Domain-
    // direct Elements have no Object and skip it.
    if (element.object_id) {
      const { error: junctionErr } = await supabase.from('element_objects').upsert({
        element_id: data.id,
        object_id: element.object_id,
        order_index: orderIndex,
        is_primary: true,
      }, { onConflict: 'element_id,object_id' });
      if (junctionErr) console.error('Failed to place the Element in its Object:', junctionErr);
    }

    // Swap the temp row for the real one (real id + server-assigned fields).
    // The delta stream lands the same row by id, so whichever arrives first
    // wins and the other is a no-op; swapping now avoids any flash of the
    // temp id.
    if (isExplorerScoped) {
      const realEl = {
        ...data,
        subelements: [], assignees: [],
        objectIds: element.object_id ? [element.object_id] : [],
        isMultiHomed: false,
      } as ElementWithDetails;
      applyOptimisticExplorerPatch(d => insertElementIntoExplorer(removeElementFromExplorer(d, tempId), realEl));
    }

    return data;
  } catch (err) {
    rollback?.();
    throw err;
  }
}

export async function updateElement(
  id: string,
  updates: Partial<Omit<Element, 'id' | 'created_at'>>
): Promise<Element> {
  // Centralised status → progress normalisation. ElementProgressMark renders
  // anything with progress >= 100 as Done regardless of status, so a drag
  // from Done → Todo on the Board (which only sets `status`) used to leave
  // progress at 100 and keep showing the green check in the List. Mirror
  // StatusPicker.applyStatus so every surface — board drop, list inline
  // edit, status picker — behaves identically.
  //
  // Skipped when the caller passes an explicit `progress` (they're driving
  // both fields together — don't second-guess).
  const normalized: Partial<Omit<Element, 'id' | 'created_at'>> = { ...updates };
  if ('status' in updates && !('progress' in updates)) {
    if (updates.status === 'done') {
      normalized.progress = 100;
    } else if (updates.status === 'backlog' || updates.status === 'todo') {
      normalized.progress = null;
    }
    // in_progress / review / blocked / cancelled keep their existing value —
    // they're deliberate workflow states, not progress buckets.
  }

  // Optimistic — patch the explorer cache before awaiting the network so the
  // UI reflects the change instantly (board drag-drop, inline rename, status
  // change, etc.). Rollback to the pre-patch snapshot on error.
  const optimisticPatch = { ...normalized, updated_at: new Date().toISOString() };
  const rollback = applyOptimisticExplorerPatch(data =>
    patchElementInExplorer(data, id, optimisticPatch)
  );
  try {
    const { data, error } = await supabase
      .from('elements')
      .update({ ...normalized, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    rollback();
    throw err;
  }
}

export async function reorderElements(updates: { id: string; order_index: number }[]) {
  // Optimistic — apply the new order_index to every cached explorer query and
  // re-sort each object's elements (+ rootElements) so the drag lands
  // instantly instead of snapping back until the next refetch. The RPC sorts
  // by elements.order_index, so persisting these values keeps the order.
  const orderById = new Map(updates.map(u => [u.id, u.order_index]));
  const rollback = applyOptimisticExplorerPatch(data => {
    const bump = (els: ElementWithDetails[]): ElementWithDetails[] => {
      let touched = false;
      const next = els.map(e => {
        const oi = orderById.get(e.id);
        if (oi === undefined || oi === e.order_index) return e;
        touched = true;
        return { ...e, order_index: oi };
      });
      if (!touched) return els;
      return [...next].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    };
    return {
      objects: data.objects.map(obj => {
        const els = obj.elements ?? [];
        const nextEls = bump(els);
        return nextEls === els ? obj : { ...obj, elements: nextEls };
      }),
      rootElements: bump(data.rootElements),
    };
  });
  try {
    await Promise.all(updates.map(u =>
      supabase.from('elements').update({ order_index: u.order_index }).eq('id', u.id)
    ));
  } catch (err) {
    rollback();
    throw err;
  }
}

export async function deleteElement(id: string): Promise<void> {
  // Optimistic — the row vanishes the instant you hit delete. Restore on error.
  const rollback = applyOptimisticExplorerPatch(data => removeElementFromExplorer(data, id));
  try {
    // One delete: the database keeps a snapshot of the Element and everything
    // under it (element_deletions) before it goes, so it can be restored.
    const { error } = await supabase
      .from('elements')
      .delete()
      .eq('id', id);
    if (error) throw error;
  } catch (err) {
    rollback();
    throw err;
  }
}

/**
 * One Element, hydrated the way the lists hydrate theirs, so it can be handed
 * straight to ElementDetailView.
 *
 * Every surface that opens a detail view so far reached it from a list that
 * had already loaded the row. The Inbox has only an id: a notification names
 * an Element that may sit in a Domain the reader never opened. Returns null
 * when the row is gone or RLS hides it — a notification can outlive its
 * subject, and the caller has to say so rather than render an empty shell.
 */
export async function fetchElementWithDetails(elementId: string): Promise<ElementWithDetails | null> {
  const { data: row, error } = await supabase
    .from('elements')
    .select('*')
    .eq('id', elementId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const element = row as Element;

  const [{ data: subs }, { data: assigneeRows }, { data: homes }] = await Promise.all([
    supabase.from('subelements').select('*').eq('element_id', elementId).order('order_index'),
    supabase.from('element_assignees').select('*').eq('element_id', elementId),
    supabase.from('element_objects').select('object_id').eq('element_id', elementId),
  ]);

  const assignees = (assigneeRows || []) as ElementAssignee[];
  let workers: Worker[] = [];
  const workerIds = Array.from(new Set(assignees.map(a => a.worker_id)));
  if (workerIds.length > 0) {
    const { data: workerRows } = await supabase.from('workers').select('*').in('id', workerIds);
    workers = (workerRows || []) as Worker[];
  }

  // Home Objects: the multi-home junction ∪ the primary FK, resolved to names.
  const objectIds = Array.from(new Set([
    ...(element.object_id ? [element.object_id] : []),
    ...((homes || []) as { object_id: string }[]).map(h => h.object_id),
  ]));
  let objects: { id: string; name: string }[] = [];
  if (objectIds.length > 0) {
    const { data: objectRows } = await supabase.from('objects').select('id, name').in('id', objectIds);
    objects = ((objectRows || []) as { id: string; name: string }[]);
  }

  return {
    ...element,
    subelements: (subs || []) as Subelement[],
    assignees: assignees.map(a => ({ ...a, worker: workers.find(w => w.id === a.worker_id) })),
    objectIds,
    isMultiHomed: objectIds.length > 1,
    objects,
  } as ElementWithDetails;
}

// ============================================
// Subelement CRUD
// ============================================

export async function createSubelement(subelement: {
  title: string;
  element_id: string;
  is_completed?: boolean;
  order_index?: number;
}): Promise<Subelement> {
  const { data: existing } = await supabase
    .from('subelements')
    .select('order_index')
    .eq('element_id', subelement.element_id)
    .order('order_index', { ascending: false })
    .limit(1);

  const maxOrder = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('subelements')
    .insert({
      title: subelement.title,
      element_id: subelement.element_id,
      is_completed: subelement.is_completed ?? false,
      order_index: subelement.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSubelement(
  id: string,
  updates: Partial<Omit<Subelement, 'id' | 'created_at'>>
): Promise<Subelement> {
  // Optimistic — toggleSubelementComplete() delegates here, so the inline
  // checklist checkbox feels instant for free.
  const optimisticPatch = { ...updates, updated_at: new Date().toISOString() };
  const rollback = applyOptimisticExplorerPatch(data =>
    patchSubelementInExplorer(data, id, optimisticPatch)
  );
  try {
    const { data, error } = await supabase
      .from('subelements')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    rollback();
    throw err;
  }
}

export async function deleteSubelement(id: string): Promise<void> {
  const { error } = await supabase
    .from('subelements')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function toggleSubelementComplete(id: string, isCompleted: boolean): Promise<Subelement> {
  return updateSubelement(id, { is_completed: isCompleted });
}

// ============================================
// Element Assignee CRUD
// ============================================

export async function addElementAssignee(assignee: {
  element_id: string;
  worker_id: string;
  role?: 'assignee' | 'reviewer' | 'collaborator';
  /** Pass the picked Worker so the avatar chip can render instantly; without
   *  it the optimistic chip shows initials until the next refetch. */
  worker?: Worker;
}): Promise<ElementAssignee> {
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tempAssignee: ElementAssigneeWithWorker = {
    id: tempId,
    element_id: assignee.element_id,
    worker_id: assignee.worker_id,
    role: assignee.role || 'assignee',
    assigned_at: new Date().toISOString(),
    worker: assignee.worker,
  };
  // Optimistic — the assignee chip appears immediately on the element.
  const rollback = applyOptimisticExplorerPatch(data =>
    mapElementInExplorer(data, assignee.element_id, el => ({
      ...el,
      assignees: [...(el.assignees ?? []), tempAssignee],
    })),
  );
  try {
    const { data, error } = await supabase
      .from('element_assignees')
      .insert({
        element_id: assignee.element_id,
        worker_id: assignee.worker_id,
        role: assignee.role || 'assignee',
      })
      .select()
      .single();
    if (error) throw error;
    // Swap temp id → real id (keep the worker we already have).
    applyOptimisticExplorerPatch(d =>
      mapElementInExplorer(d, assignee.element_id, el => ({
        ...el,
        assignees: (el.assignees ?? []).map(a =>
          a.id === tempId ? { ...a, ...data } : a,
        ),
      })),
    );
    return data;
  } catch (err) {
    rollback();
    throw err;
  }
}

export async function removeElementAssignee(id: string): Promise<void> {
  // Optimistic — drop the chip wherever this assignee row appears. We only
  // have the assignee id, so scan every element's assignees for a match.
  const rollback = applyOptimisticExplorerPatch(data => {
    let any = false;
    const dropFrom = (el: ElementWithDetails): ElementWithDetails => {
      const list = el.assignees ?? [];
      const next = list.filter(a => a.id !== id);
      if (next.length === list.length) return el;
      any = true;
      return { ...el, assignees: next };
    };
    const objects = data.objects.map(obj => {
      const els = obj.elements ?? [];
      let hit = false;
      const nextEls = els.map(el => { const n = dropFrom(el); if (n !== el) hit = true; return n; });
      return hit ? { ...obj, elements: nextEls } : obj;
    });
    const rootElements = data.rootElements.map(dropFrom);
    return any ? { objects, rootElements } : data;
  });
  try {
    const { data, error } = await supabase
      .from('element_assignees')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) throw error;
    // RLS turns a refused delete into "no rows" (the Element is no longer
    // visible); say so rather than leave the chip gone until the next read.
    if (!data?.length) throw new Error(translate('This assignee could not be removed.'));
  } catch (err) {
    rollback();
    throw err;
  }
}

// ============================================
// Element Edges (Dependencies)
// ============================================

export async function getElementEdges(elementId: string): Promise<{
  incoming: ElementEdgeWithElement[];
  outgoing: ElementEdgeWithElement[];
}> {
  // Outgoing (from this element) and incoming (to it) are independent
  // lookups — run them in parallel, then resolve the related rows once.
  const [
    { data: outgoingEdges, error: outError },
    { data: incomingEdges, error: inError },
  ] = await Promise.all([
    supabase.from('element_edges').select('*').eq('from_element', elementId),
    supabase.from('element_edges').select('*').eq('to_element', elementId),
  ]);
  if (outError) throw outError;
  if (inError) throw inError;

  // Get related element IDs
  const outgoingElementIds = (outgoingEdges || []).map(e => e.to_element);
  const incomingElementIds = (incomingEdges || []).map(e => e.from_element);
  const allRelatedIds = [...new Set([...outgoingElementIds, ...incomingElementIds])];

  // Fetch related elements
  const relatedElements = await selectIn(allRelatedIds, chunk =>
    supabase.from('elements').select('*').in('id', chunk),
  ) as Element[];

  // Build edges with element info
  const outgoing: ElementEdgeWithElement[] = (outgoingEdges || []).map(edge => ({
    ...edge,
    related_element: relatedElements.find(e => e.id === edge.to_element),
  }));

  const incoming: ElementEdgeWithElement[] = (incomingEdges || []).map(edge => ({
    ...edge,
    related_element: relatedElements.find(e => e.id === edge.from_element),
  }));

  return { incoming, outgoing };
}

/**
 * Unresolved `depends_on` upstreams for a whole set of Elements, in two
 * chunked passes regardless of set size: the incoming edges, then the
 * upstreams those edges point at. Elements that are ready get no entry.
 *
 * The judgment itself is `computeBlockers` — a pure rule shared with the row
 * marker and the Ready filter, so this function only fetches.
 *
 * Not exported — its only caller, useElementBlockers, lives in this file.
 */
async function fetchElementBlockers(
  elementIds: string[],
): Promise<Record<string, DependencyBlocker[]>> {
  if (elementIds.length === 0) return {};

  const edges = await selectIn(elementIds, chunk =>
    supabase
      .from('element_edges')
      .select('from_element, to_element, edge_type')
      .eq('edge_type', 'depends_on')
      .in('to_element', chunk),
  );

  const upstreamIds = upstreamIdsOf(elementIds, edges);
  if (upstreamIds.length === 0) return {};

  const upstreams = await selectIn(upstreamIds, chunk =>
    supabase.from('elements').select('id, title, display_id, status').in('id', chunk),
  );

  return shareBlockerEntries(computeBlockers(elementIds, edges, upstreams));
}

// Last known blocker list per Element, shared across every id-set key (same
// reason as lastActivityById): an unchanged blocker set keeps its array
// identity so a memoised row re-renders only when its own upstreams moved.
const lastBlockersById = new Map<string, DependencyBlocker[]>();
function shareBlockerEntries(
  next: Record<string, DependencyBlocker[]>,
): Record<string, DependencyBlocker[]> {
  const shared: Record<string, DependencyBlocker[]> = {};
  for (const [id, blockers] of Object.entries(next)) {
    const p = lastBlockersById.get(id);
    const same =
      p &&
      p.length === blockers.length &&
      p.every((b, i) => b.id === blockers[i].id && b.status === blockers[i].status);
    const entry = same ? p : blockers;
    lastBlockersById.set(id, entry);
    shared[id] = entry;
  }
  return shared;
}

/**
 * Dependency blockers for a whole visible list in ONE pair of queries.
 * Entries whose blocker set didn't change keep their previous array
 * reference (shareBlockerEntries), so a memoised row re-renders only when
 * its own upstreams moved.
 */
const ELEMENT_BLOCKERS_QUERY_PREFIX = ['element-blockers'] as const;
const EMPTY_BLOCKERS: Record<string, DependencyBlocker[]> = {};

/**
 * Unresolved `depends_on` upstreams for every visible Element, keyed by
 * Element id; ready Elements have no entry. Read through the query cache;
 * an entry keeps its array identity across id-set keys when its blocker set
 * didn't change (shareBlockerEntries), so a memoised row re-renders only
 * when its own upstreams moved. Kept current by Function/sync/deltaStream
 * (edges drawn or cut, any Element update).
 */
export function useElementBlockers(elementIds: string[]) {
  // Callers rebuild the ids array every render (flatMap over sections) —
  // depend on the sorted membership, not the array identity.
  const idsKey = useMemo(() => [...elementIds].sort().join('\n'), [elementIds]);
  const query = useQuery({
    queryKey: [...ELEMENT_BLOCKERS_QUERY_PREFIX, idsKey],
    queryFn: () => fetchElementBlockers(idsKey.split('\n')),
    enabled: !!idsKey,
    placeholderData: keepPreviousData,
    // One entry per visible id set — don't let abandoned sets linger.
    gcTime: 5 * 60_000,
  });
  return query.data ?? EMPTY_BLOCKERS;
}

// ============================================
// Multi-homing: Element Objects CRUD
// ============================================

export async function addElementToObject(elementId: string, objectId: string, isPrimary = false) {
  const { data, error } = await supabase
    .from('element_objects')
    .insert({ element_id: elementId, object_id: objectId, is_primary: isPrimary })
    .select()
    .single();
  if (error) throw error;
  if (isPrimary) {
    await supabase.from('elements').update({ object_id: objectId }).eq('id', elementId);
  }
  invalidateElementDetail(elementId);
  return data;
}

export async function removeElementFromObject(elementId: string, objectId: string) {
  const { data: row } = await supabase
    .from('element_objects')
    .select('is_primary')
    .eq('element_id', elementId)
    .eq('object_id', objectId)
    .single();

  await supabase.from('element_objects').delete()
    .eq('element_id', elementId).eq('object_id', objectId);

  if (row?.is_primary) {
    const { data: remaining } = await supabase
      .from('element_objects')
      .select('object_id')
      .eq('element_id', elementId)
      .order('created_at', { ascending: true })
      .limit(1);
    const newPrimary = remaining?.[0]?.object_id ?? null;
    await supabase.from('elements').update({ object_id: newPrimary }).eq('id', elementId);
    if (newPrimary) {
      await supabase.from('element_objects').update({ is_primary: true })
        .eq('element_id', elementId).eq('object_id', newPrimary);
    }
  }
  invalidateElementDetail(elementId);
}

// ============================================
// Approvals
// ============================================
export async function fetchElementApprovals(elementId: string): Promise<ElementApproval[]> {
  const { data, error } = await supabase
    .from('element_approvals')
    .select('*')
    .eq('element_id', elementId)
    .order('decided_at', { ascending: false });
  if (error) throw error;
  return (data || []) as ElementApproval[];
}

export async function decideApproval(input: ElementApprovalInsert): Promise<ElementApproval> {
  const { data, error } = await supabase
    .from('element_approvals')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as ElementApproval;
}

export async function setElementIsApproval(elementId: string, isApproval: boolean): Promise<void> {
  const updates: Partial<{ is_approval: boolean; approval_state: ApprovalState | null }> = {
    is_approval: isApproval,
  };
  if (isApproval) updates.approval_state = 'pending';
  else updates.approval_state = null;
  const { error } = await supabase.from('elements').update(updates).eq('id', elementId);
  if (error) throw error;
}

// ============================================
// Deleted Elements
// ============================================
export interface ElementDeletion { id: string; element_id: string; object_id: string | null; title: string; display_id: string | null; deleted_by_name: string | null; deleted_at: string }

/** Elements deleted from an Object, or — with `mine` — everything the caller deleted or owned, newest first. */
export async function fetchElementDeletions(scope: { objectId: string } | { mine: string }, limit = 100): Promise<ElementDeletion[]> {
  let query = supabase.from('element_deletions').select('id, element_id, object_id, title, display_id, deleted_by_name, deleted_at').order('deleted_at', { ascending: false }).limit(limit);
  query = 'objectId' in scope ? query.eq('object_id', scope.objectId) : query.or(`deleted_by.eq.${scope.mine},owner_id.eq.${scope.mine}`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ElementDeletion[];
}

/** Put a deleted Element back where it was, with its history. */
export async function restoreElement(deletionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('restore_element', { p_deletion: deletionId });
  if (error) throw new Error(error.message);
  return data as string;
}
