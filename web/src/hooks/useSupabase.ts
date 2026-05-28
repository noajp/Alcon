'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getQueryClient } from '@/lib/queryClient';
import type {
  AlconObject,
  AlconObjectWithChildren,
  Element,
  ElementWithDetails,
  Subelement,
  Worker,
  ElementAssignee,
  ElementAssigneeWithWorker,
  ElementEdge,
  ElementEdgeWithElement,
  EdgeType,
  Json,
  CustomColumn,
  CustomColumnInsert,
  CustomColumnUpdate,
  CustomColumnValue,
  CustomColumnWithValues,
  CustomColumnType,
  ObjectTab,
  ObjectTabInsert,
  ObjectTabUpdate,
  ObjectTabType,
  Document,
  DocumentInsert,
  DocumentUpdate,
  DocumentWithChildren,
  ElementObject,
  Domain,
  DomainInsert,
  DomainUpdate,
  ObjectDomain,
  ElementComment,
  ElementCommentInsert,
  ElementCommentUpdate,
  ElementReaction,
  ElementReactionInsert,
  Notification,
  NotificationInsert,
  NotificationKind,
  ElementApproval,
  ElementApprovalInsert,
  ApprovalState,
  TimeEntry,
  TimeEntryInsert,
  TimeEntryUpdate,
  AgentRun,
  AgentRunStep,
  AgentRunStatus,
  DomainAIConfig,
  Strategy,
  StrategyInsert,
  StrategyUpdate,
  StrategyStatus,
  StrategyObject,
  StrategyWithObjects,
  ObjectMilestone,
  ObjectMilestoneInsert,
  ObjectMilestoneUpdate,
} from '@/types/database';

// Re-export types
export type {
  AlconObject,
  AlconObjectWithChildren,
  Element,
  ElementWithDetails,
  Subelement,
  Worker,
  ElementAssignee,
  ElementAssigneeWithWorker,
  ElementEdge,
  ElementEdgeWithElement,
  EdgeType,
  CustomColumn,
  CustomColumnValue,
  CustomColumnWithValues,
  CustomColumnType,
  ObjectTab,
  ObjectTabType,
  Document,
  DocumentWithChildren,
  ElementObject,
  Domain,
  ObjectDomain,
  ElementComment,
  ElementReaction,
  Notification,
  NotificationKind,
  ElementApproval,
  ApprovalState,
  TimeEntry,
  AgentRun,
  AgentRunStep,
  AgentRunStatus,
  DomainAIConfig,
  Strategy,
  StrategyStatus,
  StrategyObject,
  StrategyWithObjects,
  ObjectMilestone,
};

// ============================================
// Data structure for explorer (flat list of Objects)
// ============================================
// Flat 2-level model — Object nesting was dropped. AlconObjectWithChildren
// keeps the `children` field shape for now to avoid touching the rest of
// the codebase, but it's always [] from useObjects.
export interface ExplorerData {
  objects: AlconObjectWithChildren[];  // Top-level Objects in the active Domain
  rootElements: ElementWithDetails[];  // Domain-direct Elements (object_id IS NULL)
}

const EMPTY_EXPLORER_DATA: ExplorerData = { objects: [], rootElements: [] };
const ALL_DOMAINS_CACHE_KEY = '__all__';

// ============================================
// Hook: Fetch All Objects (flat list per Domain)
// ============================================
//
// Backed by TanStack Query — cache lives under ['explorer', domainId] and
// is shared between the sidebar tree, page views, and the optimistic-mutation
// helpers below (updateElement / updateSubelement). Mutations patch the cache
// in place before awaiting Supabase so the UI reflects user actions without
// waiting on the network. Realtime still drives reconciliation but a future
// phase will switch from invalidate-everything to delta-apply.

const EXPLORER_QUERY_PREFIX = ['explorer'] as const;

// Extracted fetcher — used as the queryFn for ['explorer', domainId] and
// reused by anyone who needs to read the full explorer view without going
// through the cache.
async function fetchExplorerData(domainId?: string | null): Promise<ExplorerData> {
  // Fetch objects filtered by domain (via object_domains junction for
  // multi-homing or the legacy domain_id FK). The orphan-fallback that
  // used to surface objects with no domain link is gone — the
  // 20260506_flatten_objects migration backfilled domain_id for every
  // pre-existing row.
  const { data: objectsData, error: objectsError } = await supabase
    .from('objects')
    .select('*')
    .order('order_index');
  if (objectsError) throw objectsError;
  let objects = (objectsData || []) as AlconObject[];

  if (domainId) {
    const { data: linksForDomain } = await supabase
      .from('object_domains')
      .select('object_id')
      .eq('domain_id', domainId);
    const linkedIds = new Set(
      (linksForDomain || []).map((r: { object_id: string }) => r.object_id)
    );
    objects = objects.filter(o => linkedIds.has(o.id) || o.domain_id === domainId);
  }

  // Membership filter — sidebar only shows Objects the user has joined.
  // Creator gets auto-membership via createObject; others join through the
  // 🔍 Discover modal. Domain-direct Elements (rootElements) aren't
  // affected — they're domain-level and inherit Domain membership.
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = authData?.user?.id ?? null;
  if (authUserId) {
    const { data: myObjectRows } = await supabase
      .from('object_members')
      .select('object_id')
      .eq('user_id', authUserId);
    const myObjectIds = new Set((myObjectRows ?? []).map((r) => r.object_id));
    objects = objects.filter((o) => myObjectIds.has(o.id));
  } else {
    objects = [];
  }

  // Fetch all elements (including root-level ones with object_id = null).
  // Personal Elements (owner_id IS NOT NULL) are excluded — those belong
  // to the sidebar's "My Elements" view and must not leak into Domain scopes.
  const { data: elementsData, error: elementsError } = await supabase
    .from('elements')
    .select('*')
    .is('owner_id', null)
    .order('order_index');
  if (elementsError) throw elementsError;
  const elements = (elementsData || []) as Element[];

  const elementIds = elements.map(e => e.id);
  let subelements: Subelement[] = [];
  if (elementIds.length > 0) {
    const { data: subelementsData, error: subelementsError } = await supabase
      .from('subelements')
      .select('*')
      .in('element_id', elementIds)
      .order('order_index');
    if (subelementsError) throw subelementsError;
    subelements = (subelementsData || []) as Subelement[];
  }

  let assignees: ElementAssignee[] = [];
  if (elementIds.length > 0) {
    const { data: assigneesData, error: assigneesError } = await supabase
      .from('element_assignees')
      .select('*')
      .in('element_id', elementIds);
    if (assigneesError) throw assigneesError;
    assignees = (assigneesData || []) as ElementAssignee[];
  }

  const workerIds = assignees.map(a => a.worker_id);
  let workers: Worker[] = [];
  if (workerIds.length > 0) {
    const { data: workersData, error: workersError } = await supabase
      .from('workers')
      .select('*')
      .in('id', workerIds);
    if (workersError) throw workersError;
    workers = (workersData || []) as Worker[];
  }

  // Element multi-homing junction (Element ↔ Object). Object nesting is
  // gone, so there's no object_parents fetch anymore.
  const { data: elementObjectsData } = await supabase
    .from('element_objects')
    .select('*')
    .order('order_index');
  const elementObjects = (elementObjectsData || []) as ElementObject[];

  const elementObjectMap = new Map<string, string[]>();
  for (const r of elementObjects) {
    if (!elementObjectMap.has(r.element_id)) elementObjectMap.set(r.element_id, []);
    elementObjectMap.get(r.element_id)!.push(r.object_id);
  }

  const elementsWithDetails: ElementWithDetails[] = elements.map(element => {
    const objIds = elementObjectMap.get(element.id) || (element.object_id ? [element.object_id] : []);
    return {
      ...element,
      subelements: subelements.filter(s => s.element_id === element.id),
      assignees: assignees
        .filter(a => a.element_id === element.id)
        .map(a => ({
          ...a,
          worker: workers.find(w => w.id === a.worker_id),
        })),
      objectIds: objIds,
      isMultiHomed: objIds.length > 1,
    };
  });

  const objectElementMap = new Map<string, string[]>();
  for (const r of elementObjects) {
    if (!objectElementMap.has(r.object_id)) objectElementMap.set(r.object_id, []);
    objectElementMap.get(r.object_id)!.push(r.element_id);
  }
  const elementById = new Map(elementsWithDetails.map(e => [e.id, e]));

  // Flat list of Objects — one row per Object, sorted by order_index.
  const objectsWithElements: AlconObjectWithChildren[] = objects.map(obj => {
    const objElementIds = objectElementMap.get(obj.id) || [];
    const objElements = objElementIds.map(eid => elementById.get(eid)).filter((e): e is ElementWithDetails => !!e);
    return {
      ...obj,
      elements: objElements,
      children: [],
      parentIds: [],
      isMultiHomed: false,
    };
  });
  const objectTree = objectsWithElements
    .slice()
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

  // Domain-direct Elements: those with no junction entry to any Object
  // AND no legacy object_id. They surface only in the sidebar Elements view.
  const elementsWithParents = new Set(elementObjects.map(r => r.element_id));
  const rootElements = elementsWithDetails.filter(e => !elementsWithParents.has(e.id) && !e.object_id);

  return { objects: objectTree, rootElements };
}

// ----- Cache patch helpers (for optimistic mutations) -----
//
// Patches walk the explorer tree and clone-on-write the changed element /
// subelement. TanStack Query's built-in structural sharing (replaceEqualDeep)
// preserves references for unchanged subtrees, so combined with React.memo
// on list rows (Phase 3) this re-renders only the rows whose entity actually
// changed — Linear's "one delta, one cell", adapted.

function patchElementInExplorer(
  data: ExplorerData,
  id: string,
  patch: Partial<Element>,
): ExplorerData {
  const patchOne = (el: ElementWithDetails): ElementWithDetails =>
    el.id === id ? { ...el, ...patch } : el;
  return {
    objects: data.objects.map(obj => ({
      ...obj,
      elements: (obj.elements ?? []).map(patchOne),
    })),
    rootElements: data.rootElements.map(patchOne),
  };
}

function patchSubelementInExplorer(
  data: ExplorerData,
  id: string,
  patch: Partial<Subelement>,
): ExplorerData {
  const patchSubs = (subs: Subelement[]): Subelement[] =>
    subs.map(s => (s.id === id ? { ...s, ...patch } : s));
  const patchEl = (el: ElementWithDetails): ElementWithDetails => ({
    ...el,
    subelements: patchSubs(el.subelements ?? []),
  });
  return {
    objects: data.objects.map(obj => ({
      ...obj,
      elements: (obj.elements ?? []).map(patchEl),
    })),
    rootElements: data.rootElements.map(patchEl),
  };
}

// Apply a patch to every cached explorer query and return a rollback that
// restores the pre-patch snapshot. Used by mutation helpers from non-hook
// contexts (where useQueryClient isn't available).
function applyOptimisticExplorerPatch(
  patch: (data: ExplorerData) => ExplorerData,
): () => void {
  const qc = getQueryClient();
  const snapshot = qc.getQueriesData<ExplorerData>({ queryKey: EXPLORER_QUERY_PREFIX });
  for (const [key, data] of snapshot) {
    if (!data) continue;
    qc.setQueryData<ExplorerData>(key, patch(data));
  }
  return () => {
    for (const [key, data] of snapshot) {
      qc.setQueryData(key, data);
    }
  };
}

export function useObjects(domainId?: string | null) {
  const cacheKey = domainId ?? ALL_DOMAINS_CACHE_KEY;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['explorer', cacheKey],
    queryFn: () => fetchExplorerData(domainId),
    // Keep the previous domain's data visible while a new one loads — same
    // effect as the old per-instance dataCacheRef, but cache-wide so a
    // remount inherits the last value too.
    placeholderData: keepPreviousData,
  });

  // Realtime — invalidate the explorer queries on any DB change. Phase 3
  // will replace this with delta application (queryClient.setQueryData with
  // payload.new / payload.old) so a 50-row update isn't 50 full refetches.
  //
  // realtime-js dedupes channels by topic, so two useObjects callers sharing
  // a topic (e.g. the sidebar tree + a PageView) collide — one instance's
  // unmount tears down the other's subscription and throws "cannot add
  // postgres_changes callbacks after subscribe()". Give every instance its
  // own channel via a per-instance key.
  const channelKeyRef = useRef('');
  if (!channelKeyRef.current) channelKeyRef.current = Math.random().toString(36).slice(2);
  useEffect(() => {
    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: EXPLORER_QUERY_PREFIX });
    };
    const channel = supabase
      .channel(`use-objects:${domainId ?? 'all'}:${channelKeyRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'elements' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subelements' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'element_assignees' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_column_values' }, invalidate)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [domainId, qc]);

  // Match the old API — returns a Promise so inline-add submission can await
  // the next data snapshot.
  const refetch = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['explorer', cacheKey] });
  }, [qc, cacheKey]);

  return {
    data: query.data ?? EMPTY_EXPLORER_DATA,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
}

// ============================================
// Hook: Fetch Workers
// ============================================
export function useWorkers(objectId?: string) {
  const [data, setData] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchWorkers() {
      try {
        let query = supabase.from('workers').select('*');
        if (objectId) {
          query = query.eq('object_id', objectId);
        }
        const { data: workersData, error } = await query.order('name');

        if (error) throw error;
        setData((workersData || []) as Worker[]);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }
    fetchWorkers();
  }, [objectId]);

  return { data, loading, error };
}

// ============================================
// Hook: Fetch Elements by Object
// ============================================
export function useElementsByObject(objectId: string | null) {
  const [data, setData] = useState<ElementWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    async function fetchElements() {
      if (!objectId) {
        setData([]);
        setLoading(false);
        return;
      }

      try {
        // Fetch elements
        const { data: elementsData, error: elementsError } = await supabase
          .from('elements')
          .select('*')
          .eq('object_id', objectId)
          .order('order_index');

        if (elementsError) throw elementsError;

        const elements = (elementsData || []) as Element[];
        const elementIds = elements.map(e => e.id);

        // Fetch subelements
        let subelements: Subelement[] = [];
        if (elementIds.length > 0) {
          const { data: subelementsData, error: subelementsError } = await supabase
            .from('subelements')
            .select('*')
            .in('element_id', elementIds)
            .order('order_index');

          if (subelementsError) throw subelementsError;
          subelements = (subelementsData || []) as Subelement[];
        }

        // Fetch assignees
        let assignees: ElementAssignee[] = [];
        if (elementIds.length > 0) {
          const { data: assigneesData, error: assigneesError } = await supabase
            .from('element_assignees')
            .select('*')
            .in('element_id', elementIds);

          if (assigneesError) throw assigneesError;
          assignees = (assigneesData || []) as ElementAssignee[];
        }

        // Fetch workers
        const workerIds = assignees.map(a => a.worker_id);
        let workers: Worker[] = [];
        if (workerIds.length > 0) {
          const { data: workersData, error: workersError } = await supabase
            .from('workers')
            .select('*')
            .in('id', workerIds);

          if (workersError) throw workersError;
          workers = (workersData || []) as Worker[];
        }

        // Build elements with details
        const elementsWithDetails: ElementWithDetails[] = elements.map(element => ({
          ...element,
          subelements: subelements.filter(s => s.element_id === element.id),
          assignees: assignees
            .filter(a => a.element_id === element.id)
            .map(a => ({
              ...a,
              worker: workers.find(w => w.id === a.worker_id),
            })),
        }));

        setData(elementsWithDetails);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }
    fetchElements();
  }, [objectId, refreshTick]);

  // Realtime — refetch when an element / sub-element / assignee / custom-
  // column value changes anywhere. The filter is intentionally coarse:
  // updates that don't touch this Object cause one wasted refetch, which
  // beats threading refresh callbacks through every mutation site.
  //
  // Per-instance key so two callers on the same Object don't share a topic
  // (realtime-js dedupes by topic, which would throw "cannot add
  // postgres_changes callbacks after subscribe()" — same fix as useObjects).
  const channelKeyRef = useRef('');
  if (!channelKeyRef.current) channelKeyRef.current = Math.random().toString(36).slice(2);
  useEffect(() => {
    if (!objectId) return;
    const channel = supabase
      .channel(`elements-by-object:${objectId}:${channelKeyRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'elements' },
        () => setRefreshTick((t) => t + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subelements' },
        () => setRefreshTick((t) => t + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'element_assignees' },
        () => setRefreshTick((t) => t + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_column_values' },
        () => setRefreshTick((t) => t + 1))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [objectId]);

  return { data, loading, error };
}

// ============================================
// Object CRUD
// ============================================

export async function createObject(obj: {
  name: string;
  color?: string | null;
  description?: string | null;
  order_index?: number;
  system_id?: string | null;  // legacy
  domain_id?: string | null;  // primary domain (UUID FK)
  domain_ids?: string[];      // multi-homing: all domains this object belongs to
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
  const { data: authData } = await supabase.auth.getUser();
  const creatorId = authData?.user?.id ?? null;

  const { data, error } = await supabase
    .from('objects')
    .insert({
      name: obj.name,
      color: obj.color || null,
      description: obj.description || null,
      order_index: obj.order_index ?? maxOrder + 1,
      domain_id: obj.domain_id ?? null,
      user_id: creatorId,
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

  // Auto-enrol the creator as an object_member with 'owner' role — same
  // pattern as createDomain, scoped one level finer.
  if (creatorId) {
    await supabase.from('object_members').insert({
      object_id: data.id,
      user_id: creatorId,
      role: 'owner',
    });
  }

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

// ============================================
// Element CRUD
// ============================================

export async function createElement(element: {
  title: string;
  object_id?: string | null;  // null = Domain-direct Element (sidebar Elements view)
  owner_id?: string | null;   // set = personal Element (My Elements scope)
  description?: string | null;
  status?: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
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

  const { data, error } = await supabase
    .from('elements')
    .insert({
      title: element.title,
      object_id: element.object_id ?? null,
      owner_id: element.owner_id ?? null,
      description: element.description || null,
      status: element.status || 'todo',
      priority: element.priority || 'medium',
      start_date: element.start_date || null,
      start_time: element.start_time || null,
      due_date: element.due_date || null,
      due_time: element.due_time || null,
      estimated_hours: element.estimated_hours || null,
      order_index: element.order_index ?? maxOrder + 1,
    })
    .select()
    .single();

  if (error) throw error;

  // Dual-write: also insert into element_objects junction table when an Object
  // parent exists. Domain-direct Elements (no object_id) skip the junction.
  if (element.object_id) {
    await supabase.from('element_objects').insert({
      element_id: data.id,
      object_id: element.object_id,
      order_index: element.order_index ?? maxOrder + 1,
      is_primary: true,
    });
  }

  return data;
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
  await Promise.all(updates.map(u =>
    supabase.from('elements').update({ order_index: u.order_index }).eq('id', u.id)
  ));
}

export async function deleteElement(id: string): Promise<void> {
  // Delete subelements first
  await supabase.from('subelements').delete().eq('element_id', id);

  // Delete assignees
  await supabase.from('element_assignees').delete().eq('element_id', id);

  // Delete element
  const { error } = await supabase
    .from('elements')
    .delete()
    .eq('id', id);

  if (error) throw error;
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
// Worker CRUD
// ============================================

export async function createWorker(worker: {
  name: string;
  type: 'human' | 'ai_agent';
  object_id?: string | null;
  role?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  ai_model?: string | null;
  ai_config?: Json | null;
}): Promise<Worker> {
  const { data, error } = await supabase
    .from('workers')
    .insert({
      name: worker.name,
      type: worker.type,
      object_id: worker.object_id || null,
      role: worker.role || null,
      email: worker.email || null,
      avatar_url: worker.avatar_url || null,
      ai_model: worker.ai_model || null,
      ai_config: worker.ai_config || null,
      status: 'active',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateWorker(
  id: string,
  updates: Partial<Omit<Worker, 'id' | 'created_at'>>
): Promise<Worker> {
  const { data, error } = await supabase
    .from('workers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteWorker(id: string): Promise<void> {
  const { error } = await supabase
    .from('workers')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================
// Element Assignee CRUD
// ============================================

export async function addElementAssignee(assignee: {
  element_id: string;
  worker_id: string;
  role?: 'assignee' | 'reviewer' | 'collaborator';
}): Promise<ElementAssignee> {
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
  return data;
}

export async function removeElementAssignee(id: string): Promise<void> {
  const { error } = await supabase
    .from('element_assignees')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function getElementAssignees(elementId: string): Promise<ElementAssigneeWithWorker[]> {
  const { data: assignees, error: assigneesError } = await supabase
    .from('element_assignees')
    .select('*')
    .eq('element_id', elementId);

  if (assigneesError) throw assigneesError;

  if (!assignees || assignees.length === 0) return [];

  const workerIds = assignees.map(a => a.worker_id);
  const { data: workers, error: workersError } = await supabase
    .from('workers')
    .select('*')
    .in('id', workerIds);

  if (workersError) throw workersError;

  return assignees.map(a => ({
    ...a,
    worker: workers?.find(w => w.id === a.worker_id),
  }));
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
// Element Edge CRUD (Dependencies)
// ============================================

export async function createElementEdge(edge: {
  from_element: string;
  to_element: string;
  edge_type: EdgeType;
  created_by?: string | null;
}): Promise<ElementEdge> {
  const { data, error } = await supabase
    .from('element_edges')
    .insert({
      from_element: edge.from_element,
      to_element: edge.to_element,
      edge_type: edge.edge_type,
      created_by: edge.created_by || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteElementEdge(id: string): Promise<void> {
  const { error } = await supabase
    .from('element_edges')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function getElementEdges(elementId: string): Promise<{
  incoming: ElementEdgeWithElement[];
  outgoing: ElementEdgeWithElement[];
}> {
  // Get outgoing edges (from this element)
  const { data: outgoingEdges, error: outError } = await supabase
    .from('element_edges')
    .select('*')
    .eq('from_element', elementId);

  if (outError) throw outError;

  // Get incoming edges (to this element)
  const { data: incomingEdges, error: inError } = await supabase
    .from('element_edges')
    .select('*')
    .eq('to_element', elementId);

  if (inError) throw inError;

  // Get related element IDs
  const outgoingElementIds = (outgoingEdges || []).map(e => e.to_element);
  const incomingElementIds = (incomingEdges || []).map(e => e.from_element);
  const allRelatedIds = [...new Set([...outgoingElementIds, ...incomingElementIds])];

  // Fetch related elements
  let relatedElements: Element[] = [];
  if (allRelatedIds.length > 0) {
    const { data: elementsData, error: elementsError } = await supabase
      .from('elements')
      .select('*')
      .in('id', allRelatedIds);

    if (elementsError) throw elementsError;
    relatedElements = (elementsData || []) as Element[];
  }

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

// Check if element can start (all depends_on are done)
export async function canElementStart(elementId: string): Promise<{
  can_start: boolean;
  blocking: ElementEdgeWithElement[];
}> {
  const { incoming } = await getElementEdges(elementId);

  // Filter to only depends_on edges where the source element is not done
  const blocking = incoming.filter(edge =>
    edge.edge_type === 'depends_on' &&
    edge.related_element?.status !== 'done'
  );

  return {
    can_start: blocking.length === 0,
    blocking,
  };
}

// ============================================
// Matrix View - Intersection CRUD
// ============================================

// Get all intersections between row elements and column elements
export async function getIntersections(
  rowElementIds: string[],
  colElementIds: string[]
): Promise<ElementEdge[]> {
  if (rowElementIds.length === 0 || colElementIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('element_edges')
    .select('*')
    .eq('edge_type', 'intersection')
    .in('from_element', rowElementIds)
    .in('to_element', colElementIds);

  if (error) throw error;
  return (data || []) as ElementEdge[];
}

// Create or update an intersection (upsert)
export async function upsertIntersection(
  fromElement: string,
  toElement: string,
  attributes: Record<string, unknown>
): Promise<ElementEdge> {
  // Try to find existing intersection
  const { data: existing } = await supabase
    .from('element_edges')
    .select('*')
    .eq('from_element', fromElement)
    .eq('to_element', toElement)
    .eq('edge_type', 'intersection')
    .single();

  if (existing) {
    // Update existing
    const { data, error } = await supabase
      .from('element_edges')
      .update({ attributes })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return data as ElementEdge;
  } else {
    // Create new
    const { data, error } = await supabase
      .from('element_edges')
      .insert({
        from_element: fromElement,
        to_element: toElement,
        edge_type: 'intersection',
        attributes,
      })
      .select()
      .single();

    if (error) throw error;
    return data as ElementEdge;
  }
}

// Delete an intersection
export async function deleteIntersection(
  fromElement: string,
  toElement: string
): Promise<void> {
  const { error } = await supabase
    .from('element_edges')
    .delete()
    .eq('from_element', fromElement)
    .eq('to_element', toElement)
    .eq('edge_type', 'intersection');

  if (error) throw error;
}

// ============================================
// Fetch All Workers (for actor selection)
// ============================================
export async function fetchAllWorkers(domainId?: string | null): Promise<Worker[]> {
  const { data, error } = await supabase
    .from('workers')
    .select('*')
    .order('name');
  if (error) throw error;
  const workers = (data || []) as Worker[];

  // Domain-scoped — humans must be members of this Domain (via
  // domain_members.user_id), AI / robot workers are always included since
  // membership for them is implicit (they're scoped via ai_config etc.).
  // No domainId given → return everyone (global view / backwards-compat).
  if (!domainId) return workers;

  const { data: memberRows } = await supabase
    .from('domain_members')
    .select('user_id')
    .eq('domain_id', domainId);
  const memberUserIds = new Set(
    ((memberRows ?? []) as { user_id: string }[]).map((r) => r.user_id),
  );
  return workers.filter(
    (w) => w.type !== 'human' || (w.user_id != null && memberUserIds.has(w.user_id)),
  );
}

// ============================================
// Custom Columns CRUD
// ============================================

// Fetch all custom columns for an object
export async function fetchCustomColumns(objectId: string): Promise<CustomColumn[]> {
  const { data, error } = await supabase
    .from('custom_columns')
    .select('*')
    .eq('object_id', objectId)
    .order('order_index');

  if (error) throw error;
  return (data || []) as CustomColumn[];
}

// Fetch custom columns with all their values for an object.
// Element-scoped: columns belong to objectId, values are keyed by element_id.
export async function fetchCustomColumnsWithValues(objectId: string): Promise<CustomColumnWithValues[]> {
  const { data: columns, error: colError } = await supabase
    .from('custom_columns')
    .select('*')
    .eq('object_id', objectId)
    .eq('is_visible', true)
    .order('order_index');

  if (colError) throw colError;

  if (!columns || columns.length === 0) {
    return [];
  }

  const columnIds = columns.map(c => c.id);
  const { data: values, error: valError } = await supabase
    .from('custom_column_values')
    .select('*')
    .in('column_id', columnIds);

  if (valError) throw valError;

  // Each column id only ever has values of a single scope (Element-scoped
  // columns get element_id-keyed rows; Object-scoped get object_id-keyed),
  // so we filter in JS rather than building a partial-index-aware query.
  const valuesByColumn: Record<string, Record<string, CustomColumnValue>> = {};
  for (const val of (values || [])) {
    if (val.element_id == null) continue;
    if (!valuesByColumn[val.column_id]) valuesByColumn[val.column_id] = {};
    valuesByColumn[val.column_id][val.element_id] = val as CustomColumnValue;
  }

  return columns.map(col => ({
    ...col,
    values: valuesByColumn[col.id] || {},
  })) as CustomColumnWithValues[];
}

// Fetch Domain-scoped columns + their per-Object values. Used by the
// Domain-level Object list to tag Objects directly. `values` is keyed by
// object_id (not element_id).
export async function fetchDomainCustomColumnsWithValues(domainId: string): Promise<CustomColumnWithValues[]> {
  const { data: columns, error: colError } = await supabase
    .from('custom_columns')
    .select('*')
    .eq('domain_id', domainId)
    .eq('is_visible', true)
    .order('order_index');

  if (colError) throw colError;
  if (!columns || columns.length === 0) return [];

  const columnIds = columns.map(c => c.id);
  const { data: values, error: valError } = await supabase
    .from('custom_column_values')
    .select('*')
    .in('column_id', columnIds);

  if (valError) throw valError;

  const valuesByColumn: Record<string, Record<string, CustomColumnValue>> = {};
  for (const val of (values || [])) {
    if (val.object_id == null) continue;
    if (!valuesByColumn[val.column_id]) valuesByColumn[val.column_id] = {};
    valuesByColumn[val.column_id][val.object_id] = val as CustomColumnValue;
  }

  return columns.map(col => ({
    ...col,
    values: valuesByColumn[col.id] || {},
  })) as CustomColumnWithValues[];
}

// Create a new custom column. Either `object_id` (Element-scoped) or
// `domain_id` (Object-scoped) must be set; the DB CHECK constraint
// enforces exactly-one.
export async function createCustomColumn(column: CustomColumnInsert): Promise<CustomColumn> {
  const scopeQuery = supabase
    .from('custom_columns')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1);

  const { data: existing } = column.object_id
    ? await scopeQuery.eq('object_id', column.object_id)
    : await scopeQuery.eq('domain_id', column.domain_id ?? '');

  const maxIndex = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('custom_columns')
    .insert({
      ...column,
      order_index: maxIndex + 1,
    })
    .select()
    .single();

  if (error) throw error;
  return data as CustomColumn;
}

// Update a custom column
export async function updateCustomColumn(id: string, updates: CustomColumnUpdate): Promise<CustomColumn> {
  const { data, error } = await supabase
    .from('custom_columns')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as CustomColumn;
}

// Delete a custom column
export async function deleteCustomColumn(id: string): Promise<void> {
  const { error } = await supabase
    .from('custom_columns')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Set a custom column value for an element. Uses partial-unique-index
// upsert via manual select/insert/update because Supabase's onConflict
// requires a real unique constraint.
export async function setCustomColumnValue(
  columnId: string,
  elementId: string,
  value: Json
): Promise<CustomColumnValue> {
  const { data: existing } = await supabase
    .from('custom_column_values')
    .select('id')
    .eq('column_id', columnId)
    .eq('element_id', elementId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('custom_column_values')
      .update({ value })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as CustomColumnValue;
  }

  const { data, error } = await supabase
    .from('custom_column_values')
    .insert({ column_id: columnId, element_id: elementId, value })
    .select()
    .single();
  if (error) throw error;
  return data as CustomColumnValue;
}

// Set a custom column value for an Object (Domain-scoped column).
export async function setCustomColumnObjectValue(
  columnId: string,
  objectId: string,
  value: Json
): Promise<CustomColumnValue> {
  const { data: existing } = await supabase
    .from('custom_column_values')
    .select('id')
    .eq('column_id', columnId)
    .eq('object_id', objectId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('custom_column_values')
      .update({ value })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as CustomColumnValue;
  }

  const { data, error } = await supabase
    .from('custom_column_values')
    .insert({ column_id: columnId, object_id: objectId, value })
    .select()
    .single();
  if (error) throw error;
  return data as CustomColumnValue;
}

// Delete a custom column value
export async function deleteCustomColumnValue(columnId: string, elementId: string): Promise<void> {
  const { error } = await supabase
    .from('custom_column_values')
    .delete()
    .eq('column_id', columnId)
    .eq('element_id', elementId);

  if (error) throw error;
}

export async function deleteCustomColumnObjectValue(columnId: string, objectId: string): Promise<void> {
  const { error } = await supabase
    .from('custom_column_values')
    .delete()
    .eq('column_id', columnId)
    .eq('object_id', objectId);

  if (error) throw error;
}

// Reorder columns
export async function reorderCustomColumns(objectId: string, columnIds: string[]): Promise<void> {
  const updates = columnIds.map((id, index) => ({
    id,
    order_index: index,
  }));

  for (const update of updates) {
    await supabase
      .from('custom_columns')
      .update({ order_index: update.order_index })
      .eq('id', update.id);
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
    await supabase
      .from('object_tabs')
      .update({ order_index: i })
      .eq('id', tabIds[i]);
  }
}

// Hook: Fetch tabs for an object
export function useObjectTabs(objectId: string | null) {
  const [tabs, setTabs] = useState<ObjectTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTabs = useCallback(async () => {
    if (!objectId) {
      setTabs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchObjectTabs(objectId);
      setTabs(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    fetchTabs();
  }, [fetchTabs]);

  return { tabs, loading, error, refetch: fetchTabs };
}

// ============================================
// Documents CRUD (Notion-like global documents)
// ============================================

// Build document tree from flat list
function buildDocumentTree(documents: Document[], parentId: string | null = null): DocumentWithChildren[] {
  return documents
    .filter(d => d.parent_id === parentId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map(doc => ({
      ...doc,
      children: buildDocumentTree(documents, doc.id),
    }));
}

// Fetch all documents
export async function fetchDocuments(): Promise<Document[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('order_index', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Create document
export async function createDocument(doc: DocumentInsert): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .insert(doc)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update document
export async function updateDocument(docId: string, updates: DocumentUpdate): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .update(updates)
    .eq('id', docId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete document (cascades to children)
export async function deleteDocument(docId: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', docId);

  if (error) throw error;
}

// Move document to a new parent (drag and drop)
export async function moveDocument(docId: string, newParentId: string | null): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .update({ parent_id: newParentId })
    .eq('id', docId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Hook: Fetch all documents as a tree
export function useDocuments() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentTree, setDocumentTree] = useState<DocumentWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDocuments();
      setDocuments(data);
      setDocumentTree(buildDocumentTree(data));
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { documents, documentTree, loading, error, refetch: fetchData };
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
}

export async function getElementObjects(elementId: string): Promise<ElementObject[]> {
  const { data, error } = await supabase
    .from('element_objects')
    .select('*')
    .eq('element_id', elementId)
    .order('is_primary', { ascending: false });
  if (error) throw error;
  return data || [];
}

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
  return data;
}

export async function deleteDomain(id: string): Promise<void> {
  const { error } = await supabase.from('domains').delete().eq('id', id);
  if (error) throw error;
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

  return next;
}

// Stable display order: by order_index. The old "Individual Domain pinned
// first" rule went away when the dedicated personal scope moved to the
// sidebar's "My Elements" entry (see 20260524_remove_individual_domain_…
// migration).
function sortDomains(rows: Domain[]): Domain[] {
  return [...rows].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
}

// Domains rarely change, but useDomains() is mounted independently by many
// views. Without a cache, every mount starts from [] and the header's domain
// name visibly flickers from a fallback ("Objects"/"Domain") to the real value
// once Supabase responds. Cache the last result in-memory + localStorage so
// remounts and cold loads render the correct name on first paint; the network
// fetch still runs in the background to refresh.
const DOMAINS_CACHE_KEY = 'alcon:domains-cache';
let domainsCache: Domain[] | null = null;

function readDomainsCache(): Domain[] | null {
  if (domainsCache) return domainsCache;
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(DOMAINS_CACHE_KEY) ?? 'null');
    if (Array.isArray(parsed) && parsed.length > 0) {
      domainsCache = parsed as Domain[];
      return domainsCache;
    }
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

function writeDomainsCache(rows: Domain[]) {
  domainsCache = rows;
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DOMAINS_CACHE_KEY, JSON.stringify(rows));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export function useDomains() {
  const [data, setData] = useState<Domain[]>(() => readDomainsCache() ?? []);
  const [loading, setLoading] = useState(() => readDomainsCache() === null);
  const [error, setError] = useState<Error | null>(null);

  const fetchDomains = useCallback(async () => {
    try {
      // Membership-scoped — sidebar shows only Domains the user is a member
      // of (creator gets auto-membership in createDomain; others join via
      // the 🔍 Discover modal). Anonymous / signed-out hands back an empty
      // list so we don't leak the full Domain catalogue.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        writeDomainsCache([]);
        setData([]);
        setError(null);
        return;
      }

      const { data: memberRows, error: memberErr } = await supabase
        .from('domain_members')
        .select('domain_id')
        .eq('user_id', user.id);
      if (memberErr) throw memberErr;
      const memberIds = (memberRows ?? []).map((r) => r.domain_id);
      if (memberIds.length === 0) {
        writeDomainsCache([]);
        setData([]);
        setError(null);
        return;
      }

      const { data: rows, error: err } = await supabase
        .from('domains')
        .select('*')
        .in('id', memberIds)
        .order('order_index');
      if (err) throw err;
      const sorted = sortDomains((rows || []) as Domain[]);
      writeDomainsCache(sorted);
      setData(sorted);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDomains();
  }, [fetchDomains]);

  const refetch = useCallback(() => fetchDomains(), [fetchDomains]);

  return { data, loading, error, refetch };
}

// ============================================
// Element comments (Asana-style threaded comments + @mentions)
// ============================================
export async function fetchElementComments(elementId: string): Promise<ElementComment[]> {
  const { data, error } = await supabase
    .from('element_comments')
    .select('*')
    .eq('element_id', elementId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as ElementComment[];
}

export async function createElementComment(input: ElementCommentInsert): Promise<ElementComment> {
  const { data, error } = await supabase
    .from('element_comments')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as ElementComment;
}

export async function updateElementComment(id: string, updates: ElementCommentUpdate): Promise<ElementComment> {
  const { data, error } = await supabase
    .from('element_comments')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as ElementComment;
}

export async function deleteElementComment(id: string): Promise<void> {
  const { error } = await supabase.from('element_comments').delete().eq('id', id);
  if (error) throw error;
}

export function useElementComments(elementId: string | null) {
  const [comments, setComments] = useState<ElementComment[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!elementId) { setComments([]); return; }
    setLoading(true);
    try {
      const list = await fetchElementComments(elementId);
      setComments(list);
    } finally { setLoading(false); }
  }, [elementId]);

  useEffect(() => { reload().catch(console.error); }, [reload]);

  return { comments, loading, reload, setComments };
}

// ============================================
// Reactions (emoji on Element OR Comment)
// ============================================
export async function fetchCommentReactions(commentIds: string[]): Promise<ElementReaction[]> {
  if (commentIds.length === 0) return [];
  const { data, error } = await supabase
    .from('element_reactions')
    .select('*')
    .in('comment_id', commentIds);
  if (error) throw error;
  return (data || []) as ElementReaction[];
}

export async function addReaction(input: ElementReactionInsert): Promise<ElementReaction> {
  const { data, error } = await supabase
    .from('element_reactions')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as ElementReaction;
}

export async function removeReaction(reactionId: string): Promise<void> {
  const { error } = await supabase.from('element_reactions').delete().eq('id', reactionId);
  if (error) throw error;
}

export async function toggleReaction(params: {
  userId: string;
  emoji: string;
  elementId?: string | null;
  commentId?: string | null;
}): Promise<'added' | 'removed'> {
  const { userId, emoji, elementId, commentId } = params;
  let q = supabase.from('element_reactions').select('id').eq('user_id', userId).eq('emoji', emoji);
  q = elementId ? q.eq('element_id', elementId) : q.eq('comment_id', commentId!);
  const { data: existing } = await q.maybeSingle();
  if (existing) {
    await removeReaction(existing.id);
    return 'removed';
  }
  await addReaction({
    user_id: userId,
    emoji,
    element_id: elementId ?? null,
    comment_id: commentId ?? null,
  });
  return 'added';
}

// ============================================
// Notifications (Inbox)
// ============================================
export async function fetchNotifications(opts: {
  recipientId: string;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<Notification[]> {
  let q = supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', opts.recipientId)
    .eq('is_archived', false)
    .order('created_at', { ascending: false });
  if (opts.unreadOnly) q = q.eq('is_read', false);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as Notification[];
}

export async function createNotification(input: NotificationInsert): Promise<Notification | null> {
  const { data, error } = await supabase
    .from('notifications')
    .insert(input)
    .select('*')
    .single();
  if (error) {
    console.error('createNotification failed:', error);
    return null;
  }
  return data as Notification;
}

export async function markNotificationRead(id: string, isRead = true): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: isRead })
    .eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(recipientId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', recipientId)
    .eq('is_read', false);
  if (error) throw error;
}

export async function archiveNotification(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_archived: true })
    .eq('id', id);
  if (error) throw error;
}

export function useNotifications(recipientId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  // The sidebar badge and the Inbox view both call useNotifications. realtime-js
  // dedupes channels by topic, so a shared name lets either component's unmount
  // tear down the other's subscription — give every instance its own channel.
  const channelKeyRef = useRef('');
  if (!channelKeyRef.current) channelKeyRef.current = Math.random().toString(36).slice(2);

  const reload = useCallback(async () => {
    if (!recipientId) { setNotifications([]); setLoading(false); return; }
    setLoading(true);
    try {
      const list = await fetchNotifications({ recipientId });
      setNotifications(list);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [recipientId]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime
  useEffect(() => {
    if (!recipientId) return;
    const channel = supabase
      .channel(`notifications:${recipientId}:${channelKeyRef.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${recipientId}` },
        () => { reload(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [recipientId, reload]);

  const unreadCount = notifications.filter(n => !n.is_read).length;
  return { notifications, unreadCount, loading, reload, setNotifications };
}

export async function notifyMany(
  recipients: string[],
  payload: Omit<NotificationInsert, 'recipient_id'>
): Promise<void> {
  const unique = Array.from(new Set(recipients.filter(Boolean)));
  if (unique.length === 0) return;
  const rows = unique.map(rid => ({ ...payload, recipient_id: rid }));
  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.error('notifyMany failed:', error);
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
// Time entries
// ============================================
export async function fetchTimeEntries(elementId: string): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('element_id', elementId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data || []) as TimeEntry[];
}

export async function getRunningTimer(userId: string): Promise<TimeEntry | null> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as TimeEntry | null;
}

export async function stopTimer(id: string): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from('time_entries')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as TimeEntry;
}

export async function startTimer(input: { elementId: string; userId: string; userName?: string | null }): Promise<TimeEntry> {
  const running = await getRunningTimer(input.userId);
  if (running) await stopTimer(running.id);
  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      element_id: input.elementId,
      user_id: input.userId,
      user_name: input.userName ?? null,
      started_at: new Date().toISOString(),
    } satisfies TimeEntryInsert)
    .select('*')
    .single();
  if (error) throw error;
  return data as TimeEntry;
}

export async function logTime(input: {
  elementId: string;
  userId: string;
  userName?: string | null;
  durationSec: number;
  note?: string | null;
}): Promise<TimeEntry> {
  const now = new Date();
  const started = new Date(now.getTime() - input.durationSec * 1000);
  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      element_id: input.elementId,
      user_id: input.userId,
      user_name: input.userName ?? null,
      started_at: started.toISOString(),
      ended_at: now.toISOString(),
      duration_sec: input.durationSec,
      note: input.note ?? null,
    } satisfies TimeEntryInsert)
    .select('*')
    .single();
  if (error) throw error;
  return data as TimeEntry;
}

export async function deleteTimeEntry(id: string): Promise<void> {
  const { error } = await supabase.from('time_entries').delete().eq('id', id);
  if (error) throw error;
}

export async function updateTimeEntry(id: string, updates: TimeEntryUpdate): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from('time_entries')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as TimeEntry;
}

// ============================================
// Global Search (⌘K) — searches Elements, Objects, Notes, Briefs
// ============================================
export interface SearchResult {
  kind: 'element' | 'object' | 'note' | 'brief';
  id: string;
  title: string;
  snippet?: string | null;
  objectId?: string | null;
}

export async function globalSearch(query: string, limit = 8): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;

  const [elementsRes, objectsRes, notesRes, briefsRes] = await Promise.all([
    supabase
      .from('elements')
      .select('id, title, description, object_id')
      .or(`title.ilike.${like},description.ilike.${like}`)
      .limit(limit),
    supabase
      .from('objects')
      .select('id, name, description')
      .or(`name.ilike.${like},description.ilike.${like}`)
      .limit(limit),
    supabase
      .from('notes')
      .select('id, title, parent_id')
      .ilike('title', like)
      .limit(limit),
    supabase
      .from('briefs')
      .select('id, title, summary')
      .or(`title.ilike.${like},summary.ilike.${like}`)
      .limit(limit),
  ]);

  const out: SearchResult[] = [];
  for (const r of (elementsRes.data || [])) {
    out.push({ kind: 'element', id: r.id, title: r.title, snippet: r.description, objectId: r.object_id });
  }
  for (const r of (objectsRes.data || [])) {
    out.push({ kind: 'object', id: r.id, title: r.name, snippet: r.description });
  }
  for (const r of (notesRes.data || [])) {
    out.push({ kind: 'note', id: r.id, title: r.title || 'Untitled' });
  }
  for (const r of (briefsRes.data || [])) {
    out.push({ kind: 'brief', id: r.id, title: r.title || 'Untitled', snippet: r.summary });
  }
  return out;
}

// ============================================
// Strategy: aggregate elements across multiple Domains and/or Objects
// Pulls everything via the multi-homing junctions so a multi-homed Element
// only shows up once even if multiple selected Objects own it.
// ============================================
export async function fetchStrategyElements(opts: {
  domainIds: string[];
  objectIds: string[];   // explicitly selected Objects (in addition to whole-domain selection)
}): Promise<{ elements: ElementWithDetails[]; objects: AlconObject[] }> {
  const { domainIds, objectIds: explicitObjectIds } = opts;
  if (domainIds.length === 0 && explicitObjectIds.length === 0) {
    return { elements: [], objects: [] };
  }

  // 1. Resolve the full Object scope:
  //    domainIds → all Objects linked to those domains via object_domains (or legacy domain_id)
  //    + explicitly chosen Objects
  const objectScope = new Set<string>(explicitObjectIds);

  if (domainIds.length > 0) {
    const [{ data: linkedRows }, { data: legacyObjects }] = await Promise.all([
      supabase.from('object_domains').select('object_id').in('domain_id', domainIds),
      supabase.from('objects').select('id').in('domain_id', domainIds),
    ]);
    for (const r of (linkedRows || [])) objectScope.add(r.object_id as string);
    for (const r of (legacyObjects || [])) objectScope.add(r.id as string);
  }

  if (objectScope.size === 0) return { elements: [], objects: [] };

  const objectIdsArr = Array.from(objectScope);

  // 2. Find every Element attached to any Object in scope (junction-first, then legacy)
  const elementIdSet = new Set<string>();
  const [{ data: junctionRows }, { data: legacyElems }] = await Promise.all([
    supabase.from('element_objects').select('element_id').in('object_id', objectIdsArr),
    supabase.from('elements').select('id').in('object_id', objectIdsArr),
  ]);
  for (const r of (junctionRows || [])) elementIdSet.add(r.element_id as string);
  for (const r of (legacyElems || [])) elementIdSet.add(r.id as string);

  if (elementIdSet.size === 0) {
    const { data: objectsData } = await supabase
      .from('objects')
      .select('*')
      .in('id', objectIdsArr);
    return { elements: [], objects: (objectsData || []) as AlconObject[] };
  }

  const elementIdsArr = Array.from(elementIdSet);

  // 3. Fetch elements + subelements + assignees + workers in parallel
  const [
    { data: elementsData },
    { data: subelementsData },
    { data: assigneesData },
    { data: objectsData },
    { data: elementJunctionAll },
  ] = await Promise.all([
    supabase.from('elements').select('*').in('id', elementIdsArr).order('start_date'),
    supabase.from('subelements').select('*').in('element_id', elementIdsArr),
    supabase.from('element_assignees').select('*').in('element_id', elementIdsArr),
    supabase.from('objects').select('*').in('id', objectIdsArr),
    supabase.from('element_objects').select('*').in('element_id', elementIdsArr),
  ]);

  const assignees = (assigneesData || []) as ElementAssignee[];
  const workerIds = Array.from(new Set(assignees.map(a => a.worker_id))).filter(Boolean);
  let workers: Worker[] = [];
  if (workerIds.length > 0) {
    const { data: workersData } = await supabase.from('workers').select('*').in('id', workerIds);
    workers = (workersData || []) as Worker[];
  }

  const subs = (subelementsData || []) as Subelement[];
  const junctions = (elementJunctionAll || []) as ElementObject[];
  const objIdsByElement = new Map<string, string[]>();
  for (const j of junctions) {
    if (!objIdsByElement.has(j.element_id)) objIdsByElement.set(j.element_id, []);
    objIdsByElement.get(j.element_id)!.push(j.object_id);
  }

  const elementsWithDetails: ElementWithDetails[] = ((elementsData || []) as Element[]).map(el => {
    const objIds = objIdsByElement.get(el.id) || (el.object_id ? [el.object_id] : []);
    return {
      ...el,
      subelements: subs.filter(s => s.element_id === el.id),
      assignees: assignees
        .filter(a => a.element_id === el.id)
        .map(a => ({ ...a, worker: workers.find(w => w.id === a.worker_id) })),
      objectIds: objIds,
      isMultiHomed: objIds.length > 1,
    };
  });

  return {
    elements: elementsWithDetails,
    objects: (objectsData || []) as AlconObject[],
  };
}

// ============================================
// Agent Runs — AI-driven Element execution (Symphony-style)
// ============================================
// An agent run executes a single Element autonomously: the run-agent Edge
// Function plans, works the task, ticks off sub-elements, posts a deliverable
// comment, and stops the Element at "review". agent_run_steps is the live
// "Workpad" — the frontend streams it by polling while the run is active.

const AGENT_RUN_ACTIVE_STATUSES: AgentRunStatus[] = ['queued', 'running'];

export function isAgentRunActive(run: AgentRun | null | undefined): boolean {
  return !!run && AGENT_RUN_ACTIVE_STATUSES.includes(run.status);
}

// Latest run for an Element (any status), or null if it's never been run.
export async function fetchLatestAgentRun(elementId: string): Promise<AgentRun | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('element_id', elementId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentRun) ?? null;
}

export async function fetchAgentRunSteps(runId: string): Promise<AgentRunStep[]> {
  const { data, error } = await supabase
    .from('agent_run_steps')
    .select('*')
    .eq('run_id', runId)
    .order('idx', { ascending: true });
  if (error) throw error;
  return (data || []) as AgentRunStep[];
}

// Start an agent run for an Element. Creates the queued row, then fires the
// run-agent Edge Function (server-side, runs to completion). The UI tracks
// progress by polling — we don't await the invoke. If a run is already
// queued/running for this Element, that existing run is returned instead.
export async function startAgentRun(opts: {
  elementId: string;
  domainId?: string | null;
  triggeredFrom?: 'board' | 'detail';
  workerId?: string | null;
}): Promise<AgentRun> {
  const { data: existing } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('element_id', opts.elementId)
    .in('status', AGENT_RUN_ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existing && existing.length > 0) return existing[0] as AgentRun;

  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      element_id: opts.elementId,
      domain_id: opts.domainId ?? null,
      worker_id: opts.workerId ?? null,
      triggered_from: opts.triggeredFrom ?? null,
      triggered_by: auth.user?.id ?? null,
      status: 'queued',
    })
    .select()
    .single();
  if (error) throw error;
  const run = data as AgentRun;

  // Fire-and-forget — the Edge Function runs server-side to completion.
  supabase.functions
    .invoke('run-agent', { body: { runId: run.id } })
    .then(({ error: invokeErr }) => {
      if (invokeErr) console.error('run-agent invoke error', invokeErr);
    })
    .catch((e) => console.error('run-agent invoke failed', e));

  return run;
}

export async function cancelAgentRun(runId: string): Promise<void> {
  const { error } = await supabase
    .from('agent_runs')
    .update({ status: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', runId)
    .in('status', AGENT_RUN_ACTIVE_STATUSES);
  if (error) throw error;
}

// Connection check for the Domain API Settings screen — verifies the
// ANTHROPIC_API_KEY secret is configured server-side.
export async function pingAgentRuntime(): Promise<{
  ok: boolean;
  key_configured: boolean;
  model_default?: string;
}> {
  const { data, error } = await supabase.functions.invoke('run-agent', {
    body: { ping: true },
  });
  if (error) throw error;
  return data as { ok: boolean; key_configured: boolean; model_default?: string };
}

// Hook: track the latest agent run for an Element + its live step log.
// `autoLoad` (default true) does an initial fetch on mount; pass false for
// board cards that should stay idle until the user presses Start. While a
// run is queued/running the hook polls every 1.5s (Symphony-style).
export function useAgentRun(
  elementId: string | null,
  opts?: { autoLoad?: boolean },
) {
  const autoLoad = opts?.autoLoad ?? true;
  const [run, setRun] = useState<AgentRun | null>(null);
  const [steps, setSteps] = useState<AgentRunStep[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [starting, setStarting] = useState(false);

  // Initial load — fetch the Element's latest run + its steps on mount.
  // All setState happens after an await so it never fires synchronously
  // inside the effect.
  useEffect(() => {
    if (!autoLoad) return;
    let cancelled = false;
    (async () => {
      try {
        const latest = elementId ? await fetchLatestAgentRun(elementId) : null;
        const latestSteps = latest ? await fetchAgentRunSteps(latest.id) : [];
        if (cancelled) return;
        setRun(latest);
        setSteps(latestSteps);
      } catch (e) {
        console.error('useAgentRun load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoLoad, elementId]);

  const isActive = isAgentRunActive(run);
  const runId = run?.id ?? null;

  // Poll while the run is active. Uses a self-scheduling timeout rather than
  // setInterval so a slow request can't stack up overlapping polls — the next
  // tick is only queued once the previous one has settled.
  useEffect(() => {
    if (!isActive || !runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const [{ data: freshRun }, freshSteps] = await Promise.all([
          supabase.from('agent_runs').select('*').eq('id', runId).maybeSingle(),
          fetchAgentRunSteps(runId),
        ]);
        if (cancelled) return;
        if (freshRun) setRun(freshRun as AgentRun);
        setSteps(freshSteps);
      } catch (e) {
        console.error('useAgentRun poll failed', e);
      }
      if (!cancelled) timer = setTimeout(tick, 1500);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isActive, runId]);

  const start = useCallback(
    async (startOpts?: {
      domainId?: string | null;
      triggeredFrom?: 'board' | 'detail';
      workerId?: string | null;
    }) => {
      if (!elementId || starting) return;
      setStarting(true);
      try {
        const newRun = await startAgentRun({
          elementId,
          domainId: startOpts?.domainId ?? null,
          triggeredFrom: startOpts?.triggeredFrom,
          workerId: startOpts?.workerId,
        });
        setRun(newRun);
        if (newRun.status === 'queued' || newRun.status === 'running') setSteps([]);
        else setSteps(await fetchAgentRunSteps(newRun.id));
      } catch (e) {
        console.error('startAgentRun failed', e);
      } finally {
        setStarting(false);
      }
    },
    [elementId, starting],
  );

  const cancel = useCallback(async () => {
    if (!run) return;
    try {
      await cancelAgentRun(run.id);
      setRun((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
    } catch (e) {
      console.error('cancelAgentRun failed', e);
    }
  }, [run]);

  return { run, steps, loading, starting, isActive, start, cancel };
}

// ============================================
// Strategy — cross-Domain Object groupings
// ============================================

export function useStrategies() {
  const [data, setData] = useState<StrategyWithObjects[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [{ data: strategies, error: sErr }, { data: links, error: lErr }] =
          await Promise.all([
            supabase.from('strategies').select('*').order('created_at', { ascending: false }),
            supabase.from('strategy_objects').select('*'),
          ]);
        if (sErr) throw sErr;
        if (lErr) throw lErr;
        const byStrategy = new Map<string, string[]>();
        for (const link of (links || []) as StrategyObject[]) {
          if (!byStrategy.has(link.strategy_id)) byStrategy.set(link.strategy_id, []);
          byStrategy.get(link.strategy_id)!.push(link.object_id);
        }
        if (cancelled) return;
        setData(((strategies || []) as Strategy[]).map((s) => ({
          ...s,
          objectIds: byStrategy.get(s.id) ?? [],
        })));
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    const channel = supabase
      .channel('strategies-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'strategies' }, () => setTick(t => t + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'strategy_objects' }, () => setTick(t => t + 1))
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [tick]);

  return { data, loading, error, refetch: () => setTick((t) => t + 1) };
}

export async function createStrategy(
  input: StrategyInsert,
  objectIds: string[] = [],
): Promise<Strategy> {
  const { data, error } = await supabase
    .from('strategies')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  const strategy = data as Strategy;
  if (objectIds.length > 0) {
    const rows = objectIds.map((object_id) => ({ strategy_id: strategy.id, object_id }));
    const { error: linkErr } = await supabase.from('strategy_objects').insert(rows);
    if (linkErr) throw linkErr;
  }
  return strategy;
}

export async function updateStrategy(id: string, updates: StrategyUpdate): Promise<Strategy> {
  const { data, error } = await supabase
    .from('strategies')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Strategy;
}

export async function deleteStrategy(id: string): Promise<void> {
  const { error } = await supabase.from('strategies').delete().eq('id', id);
  if (error) throw error;
}

export async function setStrategyObjects(strategyId: string, objectIds: string[]): Promise<void> {
  // Replace the link set in one transaction-ish flow. For V1 a delete+insert
  // is acceptable; the unique (strategy_id, object_id) constraint prevents
  // duplicates if a race occurs.
  const { error: delErr } = await supabase
    .from('strategy_objects')
    .delete()
    .eq('strategy_id', strategyId);
  if (delErr) throw delErr;
  if (objectIds.length > 0) {
    const rows = objectIds.map((object_id) => ({ strategy_id: strategyId, object_id }));
    const { error: insErr } = await supabase.from('strategy_objects').insert(rows);
    if (insErr) throw insErr;
  }
}

// ============================================
// Object Milestones — ◇ markers on the Timeline
// ============================================

/** Bulk-fetch milestones for a set of Objects. Used by the Strategy
 *  Timeline view to render diamonds above each Object's band. */
export async function fetchObjectMilestones(objectIds: string[]): Promise<ObjectMilestone[]> {
  if (objectIds.length === 0) return [];
  const { data, error } = await supabase
    .from('object_milestones')
    .select('*')
    .in('object_id', objectIds)
    .order('date', { ascending: true });
  if (error) throw error;
  return (data || []) as ObjectMilestone[];
}

export async function createObjectMilestone(input: ObjectMilestoneInsert): Promise<ObjectMilestone> {
  const { data, error } = await supabase
    .from('object_milestones')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as ObjectMilestone;
}

export async function updateObjectMilestone(
  id: string,
  updates: ObjectMilestoneUpdate,
): Promise<ObjectMilestone> {
  const { data, error } = await supabase
    .from('object_milestones')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as ObjectMilestone;
}

export async function deleteObjectMilestone(id: string): Promise<void> {
  const { error } = await supabase.from('object_milestones').delete().eq('id', id);
  if (error) throw error;
}
