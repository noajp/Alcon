'use client';

import { useEffect, useRef, useState, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase, getCurrentUserId } from '@/lib/supabase';
import { getQueryClient } from '@/lib/queryClient';
import { useCurrentUserId } from '@/providers/authContext';
import { useSharedChannel } from '@/hooks/sharedRealtime';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getActiveSpaceId, ACTIVE_SPACE_CHANGE_EVENT } from '@/alcon/space/activeSpaceStore';
import { DOMAINS_CHANGED_EVENT, notifyDomainsChanged } from '@/alcon/domain/domainsStore';
import { suggestObjectPrefix } from '@/alcon/object/objectPrefix';
import { selectIn } from '@/hooks/chunkedIn';
import { computeBlockers, upstreamIdsOf } from '@/alcon/element/dependencyReadiness';
import { assembleStrategies } from '@/alcon/element/actions/campaignObjects';
import type { DependencyBlocker } from '@/alcon/element/dependencyReadiness';
import type { PhaseCloseWrite } from '@/alcon/phase/phaseClose';
import type { LoadElement } from '@/alcon/shared/assignmentLoad';
import type {
  AlconObject,
  AlconObjectWithChildren,
  Element,
  ElementUpdate,
  ElementWithDetails,
  Subelement,
  Worker,
  WorkerAvailability,
  WorkerAvailabilityInsert,
  WorkerAvailabilityKind,
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
  CustomColumnPlacementInsert,
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
  ElementTemplate,
  ElementTemplateInsert,
  ElementTemplateUpdate,
  ActivitySpace,
  ActivitySpaceInsert,
  ActivitySpaceUpdate,
  DomainPrivacy,
  DomainMember,
  DomainMemberInsert,
  ObjectMember,
  ObjectMemberInsert,
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
  AgentRun,
  AgentRunStep,
  AgentRunStatus,
  DomainAIConfig,
  Strategy,
  StrategyInsert,
  StrategyUpdate,
  StrategyStatus,
  StrategyObject,
  StrategyChild,
  StrategyWithObjects,
  StrategyComment,
  StrategyCommentInsert,
  Phase,
  PhaseInsert,
  PhaseStatus,
  PhaseUpdate,
  Intent,
  IntentInsert,
  IntentUpdate,
  IntentBinding,
  IntentBindingInsert,
  IntentAudit,
  IntentPrediction,
  IntentLineage,
  IntentResource,
  IntentAlignment,
  IntentEscalation,
  IntentNextAction,
  IntentNextActionStatus,
  IntentEscalationStatus,
  ObjectMilestone,
  ObjectMilestoneInsert,
  ObjectMilestoneUpdate,
  DataTable,
  DataTableInsert,
  DataTableUpdate,
  DataTableColumn,
  DataTableRow,
  DataTableCell,
  DataTableColumnType,
} from '@/types/database';

// Re-export types
export type {
  AlconObject,
  AlconObjectWithChildren,
  Element,
  ElementWithDetails,
  Subelement,
  Worker,
  WorkerAvailability,
  WorkerAvailabilityKind,
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
  DomainPrivacy,
  DomainMember,
  DomainMemberInsert,
  ObjectMember,
  ObjectMemberInsert,
  ObjectDomain,
  ElementComment,
  ElementReaction,
  Notification,
  NotificationKind,
  ElementApproval,
  ApprovalState,
  AgentRun,
  AgentRunStep,
  AgentRunStatus,
  DomainAIConfig,
  Strategy,
  StrategyStatus,
  StrategyObject,
  StrategyWithObjects,
  StrategyComment,
  StrategyCommentInsert,
  Phase,
  ObjectMilestone,
  DataTable,
  DataTableColumn,
  DataTableRow,
  DataTableCell,
  DataTableColumnType,
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
  // Single round trip — the get_explorer_data RPC assembles the whole
  // enriched tree (objects → elements → subelements / assignees+worker,
  // plus domain-scope + object_members membership filtering and the
  // rootElements split) in Postgres. Replaces the previous ~6-query
  // client-side waterfall. SECURITY INVOKER so RLS still applies exactly as
  // before; the output shape matches ExplorerData 1:1.
  const { data, error } = await supabase.rpc('get_explorer_data', {
    p_domain_id: domainId ?? null,
  });
  if (error) throw error;
  return (data as ExplorerData | null) ?? EMPTY_EXPLORER_DATA;
}

// ----- Cache patch helpers (for optimistic mutations) -----
//
// Patches walk the explorer tree and clone-on-write the changed element /
// subelement. TanStack Query's built-in structural sharing (replaceEqualDeep)
// preserves references for unchanged subtrees, so combined with React.memo
// on list rows (Phase 3) this re-renders only the rows whose entity actually
// changed — Linear's "one delta, one cell", adapted.

// Structural-sharing patch: only the changed element (and the arrays / object
// on the path to it) get fresh references; every untouched element, object,
// and array keeps its identity. When the id isn't present at all, the SAME
// `data` reference is returned — so setQueryData sees no change and skips the
// notify, and React.memo'd rows skip re-render. This is what makes "1 delta =
// 1 row re-render" hold (Linear's "one delta, one cell").
function patchElementInExplorer(
  data: ExplorerData,
  id: string,
  patch: Partial<Element>,
): ExplorerData {
  let any = false;
  const patchList = (list: ElementWithDetails[]): ElementWithDetails[] => {
    let hit = false;
    const next = list.map(el => {
      if (el.id !== id) return el;
      hit = true; any = true;
      return { ...el, ...patch };
    });
    return hit ? next : list; // unchanged list keeps its reference
  };
  const objects = data.objects.map(obj => {
    const els = obj.elements ?? [];
    const nextEls = patchList(els);
    return nextEls === els ? obj : { ...obj, elements: nextEls };
  });
  const rootElements = patchList(data.rootElements);
  if (!any) return data; // id not in this cache → no-op, preserve identity
  return { objects, rootElements };
}

function patchSubelementInExplorer(
  data: ExplorerData,
  id: string,
  patch: Partial<Subelement>,
): ExplorerData {
  let any = false;
  const patchEl = (el: ElementWithDetails): ElementWithDetails => {
    const subs = el.subelements ?? [];
    let hit = false;
    const nextSubs = subs.map(s => {
      if (s.id !== id) return s;
      hit = true; any = true;
      return { ...s, ...patch };
    });
    return hit ? { ...el, subelements: nextSubs } : el;
  };
  const objects = data.objects.map(obj => {
    const els = obj.elements ?? [];
    let objHit = false;
    const nextEls = els.map(el => {
      const next = patchEl(el);
      if (next !== el) objHit = true;
      return next;
    });
    return objHit ? { ...obj, elements: nextEls } : obj;
  });
  const rootElements = data.rootElements.map(patchEl);
  if (!any) return data;
  return { objects, rootElements };
}

// Apply a transform to the element with `id` wherever it appears (an Element
// can be multi-homed into several objects). Structural sharing: untouched
// elements/objects keep their refs; an absent id returns the same `data`.
function mapElementInExplorer(
  data: ExplorerData,
  id: string,
  fn: (el: ElementWithDetails) => ElementWithDetails,
): ExplorerData {
  let any = false;
  const apply = (el: ElementWithDetails): ElementWithDetails => {
    if (el.id !== id) return el;
    any = true;
    return fn(el);
  };
  const objects = data.objects.map(obj => {
    const els = obj.elements ?? [];
    let hit = false;
    const nextEls = els.map(el => {
      const next = apply(el);
      if (next !== el) hit = true;
      return next;
    });
    return hit ? { ...obj, elements: nextEls } : obj;
  });
  const rootElements = data.rootElements.map(apply);
  if (!any) return data;
  return { objects, rootElements };
}

// Remove an element by id from every object list + rootElements. Same `data`
// ref when nothing matched.
function removeElementFromExplorer(data: ExplorerData, id: string): ExplorerData {
  let any = false;
  const drop = (els: ElementWithDetails[]): ElementWithDetails[] => {
    const next = els.filter(e => e.id !== id);
    if (next.length !== els.length) { any = true; return next; }
    return els;
  };
  const objects = data.objects.map(obj => {
    const els = obj.elements ?? [];
    const nextEls = drop(els);
    return nextEls === els ? obj : { ...obj, elements: nextEls };
  });
  const rootElements = drop(data.rootElements);
  if (!any) return data;
  return { objects, rootElements };
}

// Insert a (temp or real) element into its scope: appended to its parent
// object's list when it has one, otherwise to rootElements. Inserts into
// every cache that contains the parent object (or always, for root). De-dups
// by id so a double-apply can't create a duplicate row.
function insertElementIntoExplorer(data: ExplorerData, el: ElementWithDetails): ExplorerData {
  const parentId = el.objectIds?.[0] ?? el.object_id ?? null;
  const exists = (els: ElementWithDetails[]) => els.some(e => e.id === el.id);

  if (parentId) {
    let placed = false;
    const objects = data.objects.map(obj => {
      if (obj.id !== parentId) return obj;
      const els = obj.elements ?? [];
      if (exists(els)) { placed = true; return obj; }
      placed = true;
      return { ...obj, elements: [...els, el] };
    });
    if (!placed) return data; // this cache doesn't hold the parent object
    return { objects, rootElements: data.rootElements };
  }

  if (exists(data.rootElements)) return data;
  return { objects: data.objects, rootElements: [...data.rootElements, el] };
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

// Realtime for the explorer tree — apply small deltas instead of refetching
// the whole workspace. A field edit anywhere (status, priority, title, due
// date, progress…) arrives as an `elements` UPDATE; we patch just that element
// into every explorer cache via structural-sharing, so receiving a remote
// change costs one cell re-render, not a refetch + full tree rebuild.
//
// Structural changes (element INSERT/DELETE, and any subelement / assignee /
// custom-value change — which alter list membership or derived rollups via
// junction tables) still fall back to a debounced invalidate: correct, and
// coalesced so a burst is one refetch, not N.
let explorerInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
function invalidateExplorerSoon() {
  if (explorerInvalidateTimer) return;
  explorerInvalidateTimer = setTimeout(() => {
    explorerInvalidateTimer = null;
    void getQueryClient().invalidateQueries({ queryKey: EXPLORER_QUERY_PREFIX });
  }, 150);
}

function applyExplorerElementDelta(row: Partial<Element> & { id?: string }) {
  if (!row?.id) { invalidateExplorerSoon(); return; }
  const qc = getQueryClient();
  const id = row.id;
  // Spread only the base columns over the cached enriched element —
  // subelements / assignees / objectIds are preserved by the merge.
  for (const [key, data] of qc.getQueriesData<ExplorerData>({ queryKey: EXPLORER_QUERY_PREFIX })) {
    if (!data) continue;
    const next = patchElementInExplorer(data, id, row);
    if (next !== data) qc.setQueryData(key, next); // no-op if id absent
  }
}

function buildExplorerChannel(channel: RealtimeChannel): RealtimeChannel {
  return channel
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'elements' },
      (payload) => applyExplorerElementDelta(payload.new as Partial<Element> & { id?: string }))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'elements' }, invalidateExplorerSoon)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'elements' }, invalidateExplorerSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subelements' }, invalidateExplorerSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'element_assignees' }, invalidateExplorerSoon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_column_values' }, invalidateExplorerSoon);
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

  // Realtime — one shared channel for every useObjects instance (see
  // buildExplorerChannel); the handlers patch every explorer cache through
  // the singleton QueryClient, so they don't depend on this instance.
  useSharedChannel('explorer', buildExplorerChannel);

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
// Workers through the query cache, keyed by scope. PersonCell (the Assign /
// person-column cell) calls useWorkers PER CELL, so an Object list with N rows
// once fired N identical `workers` queries. One query key per scope means N
// cells share one request, remounts read the cache, and a warm cache fires
// nothing until a worker mutation invalidates it.
const WORKERS_QUERY_PREFIX = ['workers'] as const;

async function loadWorkers(objectId?: string): Promise<Worker[]> {
  let query = supabase.from('workers').select('*');
  if (objectId) query = query.eq('object_id', objectId);
  const { data, error } = await query.order('name');
  if (error) throw error;
  return (data || []) as Worker[];
}

/** Drop every cached worker list so the next read refetches (e.g. after a
 *  worker is added or removed). Covers useWorkers and fetchAllWorkers. */
export function invalidateWorkersCache() {
  void getQueryClient().invalidateQueries({ queryKey: WORKERS_QUERY_PREFIX });
}

const EMPTY_WORKERS: Worker[] = [];

export function useWorkers(objectId?: string) {
  const query = useQuery({
    queryKey: [...WORKERS_QUERY_PREFIX, 'scope', objectId ?? '__all__'],
    queryFn: () => loadWorkers(objectId),
  });
  return {
    data: query.data ?? EMPTY_WORKERS,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

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
  await supabase
    .from('objects')
    .update({ domain_id: primary, updated_at: new Date().toISOString() })
    .eq('id', objectId);
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

    // Dual-write: also insert into element_objects junction table when an
    // Object parent exists. Domain-direct Elements skip the junction.
    if (element.object_id) {
      await supabase.from('element_objects').insert({
        element_id: data.id,
        object_id: element.object_id,
        order_index: orderIndex,
        is_primary: true,
      });
    }

    // Swap the temp row for the real one (real id + server-assigned fields).
    // The realtime INSERT will also fire a debounced refetch that reconciles,
    // but swapping now avoids any flash of the temp id.
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

export async function deleteElement(id: string): Promise<void> {
  // Optimistic — the row vanishes the instant you hit delete, instead of
  // waiting on three sequential deletes. Restore on error.
  const rollback = applyOptimisticExplorerPatch(data => removeElementFromExplorer(data, id));
  try {
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
  invalidateWorkersCache();
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
  invalidateWorkersCache();
  return data;
}

export async function deleteWorker(id: string): Promise<void> {
  const { error } = await supabase
    .from('workers')
    .delete()
    .eq('id', id);

  if (error) throw error;
  invalidateWorkersCache();
}

// ============================================
// Worker availability CRUD
//
// The spans where a Worker's capacity is not the standing one. What they mean
// as hours per day lives in `alcon/shared/workerCapacity.ts`; this is only the
// reading and writing.
// ============================================

/**
 * Every availability span for the given Workers, oldest start first.
 *
 * The id list is as long as the roster, so it goes through `selectIn` — a bare
 * `.in()` puts the whole list in the query string and stops working on a board
 * big enough that nobody's fixture reproduces it.
 */
export async function fetchWorkerAvailability(
  workerIds: string[],
): Promise<WorkerAvailability[]> {
  return selectIn<WorkerAvailability>(
    workerIds,
    (chunk) => supabase
      .from('worker_availability')
      .select('*')
      .in('worker_id', chunk)
      .order('start_date', { ascending: true }),
    { compare: (a, b) => a.start_date.localeCompare(b.start_date) },
  );
}

async function createWorkerAvailability(
  span: WorkerAvailabilityInsert,
): Promise<WorkerAvailability> {
  const { data, error } = await supabase
    .from('worker_availability')
    .insert({
      worker_id: span.worker_id,
      start_date: span.start_date,
      end_date: span.end_date,
      kind: span.kind ?? 'leave',
      capacity_hours_per_day: span.capacity_hours_per_day ?? 0,
      note: span.note ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as WorkerAvailability;
}

async function deleteWorkerAvailability(id: string): Promise<void> {
  const { error } = await supabase
    .from('worker_availability')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/** Shared empty map, so an empty roster returns the same object every render. */
const EMPTY_AVAILABILITY: Record<string, WorkerAvailability[]> = {};

/**
 * Availability grouped by Worker, plus the writers that keep the group in step
 * with the server.
 *
 * The writers hand back the rolled-back state on failure rather than swallowing
 * it: an absence that looks saved but is not would put the load chart back to
 * the lie this table exists to end.
 */
async function fetchAvailabilityByWorker(ids: string[]): Promise<Record<string, WorkerAvailability[]>> {
  const rows = await fetchWorkerAvailability(ids);
  const next: Record<string, WorkerAvailability[]> = {};
  for (const row of rows) (next[row.worker_id] ??= []).push(row);
  return next;
}

export function useWorkerAvailability(workerIds: string[]) {
  // Callers rebuild the ids array every render (map over chart rows) — depend
  // on the sorted membership, not the array identity.
  const idsKey = useMemo(() => [...workerIds].sort().join('\n'), [workerIds]);
  const qc = useQueryClient();
  const key = useMemo(() => ['worker-availability', idsKey] as const, [idsKey]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchAvailabilityByWorker(idsKey.split('\n')),
    enabled: !!idsKey,
  });
  const byWorker = idsKey ? (query.data ?? EMPTY_AVAILABILITY) : EMPTY_AVAILABILITY;
  // Optimistic edits land in the cache so every reader of this roster moves.
  const setByWorker = useCallback(
    (update: (prev: Record<string, WorkerAvailability[]>) => Record<string, WorkerAvailability[]>) => {
      qc.setQueryData<Record<string, WorkerAvailability[]>>(key, (prev) => update(prev ?? {}));
    },
    [qc, key],
  );

  const add = useCallback(async (span: WorkerAvailabilityInsert) => {
    const now = new Date().toISOString();
    const temp: WorkerAvailability = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      worker_id: span.worker_id,
      start_date: span.start_date,
      end_date: span.end_date,
      kind: span.kind ?? 'leave',
      capacity_hours_per_day: span.capacity_hours_per_day ?? 0,
      note: span.note ?? null,
      created_at: now,
      updated_at: now,
    };
    const sorted = (rows: WorkerAvailability[]) =>
      [...rows].sort((a, b) => a.start_date.localeCompare(b.start_date));
    setByWorker((prev) => ({
      ...prev,
      [temp.worker_id]: sorted([...(prev[temp.worker_id] ?? []), temp]),
    }));
    try {
      const saved = await createWorkerAvailability(span);
      setByWorker((prev) => ({
        ...prev,
        [saved.worker_id]: sorted(
          (prev[saved.worker_id] ?? []).map((r) => (r.id === temp.id ? saved : r)),
        ),
      }));
    } catch (e) {
      setByWorker((prev) => ({
        ...prev,
        [temp.worker_id]: (prev[temp.worker_id] ?? []).filter((r) => r.id !== temp.id),
      }));
      throw e;
    }
  }, [setByWorker]);

  const remove = useCallback(async (span: WorkerAvailability) => {
    setByWorker((prev) => ({
      ...prev,
      [span.worker_id]: (prev[span.worker_id] ?? []).filter((r) => r.id !== span.id),
    }));
    try {
      await deleteWorkerAvailability(span.id);
    } catch (e) {
      setByWorker((prev) => ({
        ...prev,
        [span.worker_id]: [...(prev[span.worker_id] ?? []), span]
          .sort((a, b) => a.start_date.localeCompare(b.start_date)),
      }));
      throw e;
    }
  }, [setByWorker]);

  return { byWorker, add, remove };
}

// ============================================
// Worker commitments
//
// What each Worker is already holding, cut down to the columns that decide
// load: the dates it spans and what it costs. The assignee menu asks this
// before anybody is added, so it pulls the Elements themselves rather than the
// Explorer tree — a Worker's other work is spread across Domains the open list
// never loaded.
// ============================================

/** Shared empty map, so an empty roster returns the same object every render. */
const EMPTY_COMMITMENTS: Record<string, LoadElement[]> = {};

async function fetchWorkerCommitments(
  workerIds: string[],
): Promise<Record<string, LoadElement[]>> {
  const links = await selectIn<{ element_id: string; worker_id: string }>(
    workerIds,
    (chunk) => supabase
      .from('element_assignees')
      .select('element_id, worker_id')
      .in('worker_id', chunk),
  );
  if (links.length === 0) return {};

  const rows = await selectIn<LoadElement>(
    links.map((l) => l.element_id),
    (chunk) => supabase
      .from('elements')
      .select('id, start_date, due_date, estimated_hours, priority, status')
      .in('id', chunk),
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const byWorker: Record<string, LoadElement[]> = {};
  for (const link of links) {
    const element = byId.get(link.element_id);
    if (!element) continue;
    (byWorker[link.worker_id] ??= []).push(element);
  }
  return byWorker;
}

/**
 * Every dated Element the given Workers hold, grouped by Worker.
 *
 * Read-only and unsubscribed: it answers a question asked inside an open menu,
 * and a live subscription would keep the whole roster's work in memory for as
 * long as the app runs to serve a panel that is usually closed.
 */
export function useWorkerCommitments(workerIds: string[]) {
  const idsKey = useMemo(() => [...workerIds].sort().join('\n'), [workerIds]);
  const query = useQuery({
    queryKey: ['worker-commitments', idsKey],
    queryFn: () => fetchWorkerCommitments(idsKey.split('\n')),
    enabled: !!idsKey,
  });
  // Stale beats blank: react-query keeps the last data while refetching.
  return idsKey ? (query.data ?? EMPTY_COMMITMENTS) : EMPTY_COMMITMENTS;
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
    const { error } = await supabase
      .from('element_assignees')
      .delete()
      .eq('id', id);
    if (error) throw error;
  } catch (err) {
    rollback();
    throw err;
  }
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
 * Not exported — its only callers, canElementStart and useElementBlockers,
 * live in this same file. Making it public API when nothing outside this
 * file has ever needed it was the actual defect unwired-lint caught.
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

  return computeBlockers(elementIds, edges, upstreams);
}

// Check if element can start (all depends_on are done)
export async function canElementStart(elementId: string): Promise<{
  can_start: boolean;
  blocking: DependencyBlocker[];
}> {
  const blocking = (await fetchElementBlockers([elementId]))[elementId] ?? [];
  return {
    can_start: blocking.length === 0,
    blocking,
  };
}

/**
 * Dependency blockers for a whole visible list in ONE pair of queries — the
 * list counterpart to `canElementStart`, which costs a round-trip per row.
 *
 * Entries whose blocker set didn't change keep their previous array reference
 * (structural sharing), so a memoised row re-renders only when its own
 * upstreams moved. Refetches when the visible id set changes, when an edge is
 * drawn or cut, or when an Element's status changes under us (both debounced).
 */
const ELEMENT_BLOCKERS_QUERY_PREFIX = ['element-blockers'] as const;
const EMPTY_BLOCKERS: Record<string, DependencyBlocker[]> = {};

// One shared channel; an edge drawn/cut or any Element UPDATE (an upstream
// flipping to done is what unblocks a row, and the upstream is often
// outside the visible set) invalidates every mounted reader, debounced.
let blockersInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
function invalidateBlockersSoon() {
  if (blockersInvalidateTimer) clearTimeout(blockersInvalidateTimer);
  blockersInvalidateTimer = setTimeout(() => {
    blockersInvalidateTimer = null;
    void getQueryClient().invalidateQueries({ queryKey: ELEMENT_BLOCKERS_QUERY_PREFIX });
  }, 300);
}
function buildBlockersChannel(channel: RealtimeChannel): RealtimeChannel {
  return channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'element_edges' }, invalidateBlockersSoon)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'elements' }, invalidateBlockersSoon);
}

/**
 * Unresolved `depends_on` upstreams for every visible Element, keyed by
 * Element id; ready Elements have no entry. Read through the query cache:
 * the cache's structural sharing keeps an entry's array reference when its
 * blocker set didn't change, so a memoised row re-renders only when its own
 * upstreams moved.
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
  });
  useSharedChannel('element-blockers', buildBlockersChannel);
  return query.data ?? EMPTY_BLOCKERS;
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

  // Both axes ride in the same query string, so both are chunked: one request
  // per (row chunk × column chunk) pair.
  return await selectIn(rowElementIds, async rows => ({
    data: await selectIn(colElementIds, cols =>
      supabase
        .from('element_edges')
        .select('*')
        .eq('edge_type', 'intersection')
        .in('from_element', rows)
        .in('to_element', cols),
    ) as ElementEdge[],
    error: null,
  }));
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
export function fetchAllWorkers(domainId?: string | null): Promise<Worker[]> {
  // Cached per Domain: a dozen surfaces (detail views, table rows, pickers)
  // each call this from an effect, so without the cache an Element table
  // fired one workers + one domain_members query per row.
  return getQueryClient().fetchQuery({
    queryKey: [...WORKERS_QUERY_PREFIX, 'domain', domainId ?? '__all__'],
    queryFn: () => fetchAllWorkersUncached(domainId),
    staleTime: 30_000,
  });
}

async function fetchAllWorkersUncached(domainId?: string | null): Promise<Worker[]> {
  // Domain-scoped — humans must be members of this Domain (via
  // domain_members.user_id), AI / robot workers are always included since
  // membership for them is implicit (they're scoped via ai_config etc.).
  // No domainId given → return everyone (global view / backwards-compat).
  // The two lookups are independent, so they run in parallel.
  const [{ data, error }, memberRows] = await Promise.all([
    supabase.from('workers').select('*').order('name'),
    domainId
      ? supabase.from('domain_members').select('user_id').eq('domain_id', domainId).then((r) => r.data)
      : Promise.resolve(null),
  ]);
  if (error) throw error;
  const workers = (data || []) as Worker[];
  if (!domainId) return workers;

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

// Attach element-keyed values to a set of column definitions. Each column id
// only ever has values of a single scope (Element-scoped columns get
// element_id-keyed rows; Object-scoped get object_id-keyed), so we filter in
// JS rather than building a partial-index-aware query. Pass `elementId` to
// narrow the value fetch to one Element (the detail panel's case).
async function attachElementValues(
  columns: CustomColumn[],
  elementId?: string,
): Promise<CustomColumnWithValues[]> {
  if (columns.length === 0) return [];
  let query = supabase
    .from('custom_column_values')
    .select('*')
    .in('column_id', columns.map(c => c.id));
  if (elementId) query = query.eq('element_id', elementId);
  const { data: values, error } = await query;
  if (error) throw error;

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

// Resolve the columns PLACED on Element lists (an Object's list, or a user's
// My Elements) via custom_column_placements — local and Space-library columns
// alike. Ordered by the column's own order_index so a library column keeps a
// stable position across lists.
async function fetchPlacedColumns(
  target: { objectId: string } | { objectIds: string[] } | { ownerUserId: string },
): Promise<CustomColumn[]> {
  let placements: { column_id: string }[];
  if ('objectIds' in target) {
    // My Elements spans every Object the reader can see, so this list grows
    // with the board.
    placements = await selectIn(target.objectIds, chunk =>
      supabase.from('custom_column_placements').select('column_id').in('object_id', chunk),
    );
  } else {
    const query = supabase.from('custom_column_placements').select('column_id');
    const { data, error: plError } = 'objectId' in target
      ? await query.eq('object_id', target.objectId)
      : await query.eq('owner_user_id', target.ownerUserId);
    if (plError) throw plError;
    placements = data ?? [];
  }

  const columnIds = Array.from(new Set(placements.map(p => p.column_id)));
  if (columnIds.length === 0) return [];

  const { data: columns, error: colError } = await supabase
    .from('custom_columns')
    .select('*')
    .in('id', columnIds)
    .eq('is_visible', true)
    .order('order_index');
  if (colError) throw colError;
  return (columns || []) as CustomColumn[];
}

// Fetch the custom columns shown on an Object's Elements list, with values
// keyed by element_id. Placement-driven: local columns AND any Space-library
// columns added to this Object.
export async function fetchCustomColumnsWithValues(objectId: string): Promise<CustomColumnWithValues[]> {
  const columns = await fetchPlacedColumns({ objectId });
  return attachElementValues(columns);
}

// Fetch the personal (and any placed library) columns for a user's My
// Elements list, values keyed by element_id.
export async function fetchOwnerCustomColumnsWithValues(ownerUserId: string): Promise<CustomColumnWithValues[]> {
  const columns = await fetchPlacedColumns({ ownerUserId });
  return attachElementValues(columns);
}

// Element-centric fetch for the detail panel: the union of columns placed on
// EVERY list the Element is homed in (primary object + element_objects
// junction homes), with only this Element's values attached. This is Asana's
// "the task detail shows the fields of every project it's multi-homed in" —
// which list the panel was opened from doesn't matter.
export async function fetchElementCustomColumnsWithValues(
  elementId: string,
  primaryObjectId: string | null,
): Promise<CustomColumnWithValues[]> {
  const { data: junction, error: jError } = await supabase
    .from('element_objects')
    .select('object_id')
    .eq('element_id', elementId);
  if (jError) throw jError;

  const homeIds = new Set<string>();
  if (primaryObjectId) homeIds.add(primaryObjectId);
  for (const row of junction || []) {
    if (row.object_id) homeIds.add(row.object_id);
  }
  const columns = await fetchPlacedColumns({ objectIds: Array.from(homeIds) });
  return attachElementValues(columns, elementId);
}

// Space library columns ("global fields") — the definitions a Space shares.
// Used by the add-property picker's "From library" section.
export async function fetchSpaceLibraryColumns(spaceId: string): Promise<CustomColumn[]> {
  const { data, error } = await supabase
    .from('custom_columns')
    .select('*')
    .eq('activity_space_id', spaceId)
    .order('name');
  if (error) throw error;
  return (data || []) as CustomColumn[];
}

// Add / remove a column on a list. Removing a placement only hides the column
// from that list — the definition and every Element's value survive (re-adding
// the column brings the values back, Asana-style).
export async function placeColumn(
  columnId: string,
  target: { objectId: string } | { ownerUserId: string },
): Promise<void> {
  const row: CustomColumnPlacementInsert = 'objectId' in target
    ? { column_id: columnId, object_id: target.objectId }
    : { column_id: columnId, owner_user_id: target.ownerUserId };
  const { error } = await supabase.from('custom_column_placements').insert(row);
  if (error) throw error;
}

export async function unplaceColumn(
  columnId: string,
  target: { objectId: string } | { ownerUserId: string },
): Promise<void> {
  let query = supabase.from('custom_column_placements').delete().eq('column_id', columnId);
  query = 'objectId' in target
    ? query.eq('object_id', target.objectId)
    : query.eq('owner_user_id', target.ownerUserId);
  const { error } = await query;
  if (error) throw error;
}

// ---- Domain custom-column cache (memory + localStorage) ----
// The Object list paints its rows from already-loaded boot data, but its
// custom columns (Assign / Status / Note …) come from the separate fetch
// below. On a cold reload that left the custom columns popping in a beat after
// the built-in columns (Name / Type / Due date). We remember the last result
// per Domain — in memory for SPA navigations, and in localStorage so a full
// page reload can paint the columns on the first frame and then revalidate.
const domainColumnsCache = new Map<string, CustomColumnWithValues[]>();
const DOMAIN_COLS_LS_PREFIX = 'alcon:domain-cols:';

/** Synchronously read the last-known columns for a Domain (memory first, then
 *  localStorage). Returns null on a true cold start so the caller can show its
 *  own empty state. Safe to call during render / a useState initialiser. */
export function getCachedDomainColumns(domainId: string): CustomColumnWithValues[] | null {
  const mem = domainColumnsCache.get(domainId);
  if (mem) return mem;
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DOMAIN_COLS_LS_PREFIX + domainId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomColumnWithValues[];
    domainColumnsCache.set(domainId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** Persist the freshly-fetched columns so the next first paint is instant. */
export function cacheDomainColumns(domainId: string, cols: CustomColumnWithValues[]) {
  domainColumnsCache.set(domainId, cols);
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DOMAIN_COLS_LS_PREFIX + domainId, JSON.stringify(cols));
  } catch {
    // Quota or serialisation failure — the in-memory cache still serves SPA
    // navigations; we just lose the cross-reload head start. Non-fatal.
  }
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
// Create a column definition and, for Element-list columns, its first
// placement. Local (object_id) and personal (owner_user_id) definitions place
// themselves; a library (activity_space_id) definition is placed where it was
// created via `placement`. Domain columns (Object-tagging axis) never place.
export async function createCustomColumn(
  column: CustomColumnInsert,
  placement?: { objectId: string } | { ownerUserId: string },
): Promise<CustomColumn> {
  const scopeQuery = supabase
    .from('custom_columns')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1);

  const { data: existing } = column.object_id
    ? await scopeQuery.eq('object_id', column.object_id)
    : column.activity_space_id
    ? await scopeQuery.eq('activity_space_id', column.activity_space_id)
    : column.owner_user_id
    ? await scopeQuery.eq('owner_user_id', column.owner_user_id)
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
  const created = data as CustomColumn;

  const target = placement
    ?? (created.object_id ? { objectId: created.object_id }
      : created.owner_user_id ? { ownerUserId: created.owner_user_id }
      : undefined);
  if (target) {
    try {
      await placeColumn(created.id, target);
    } catch (e) {
      // Don't leave a placement-less Element column behind — it would exist
      // but show on no list, which reads as data loss.
      try { await deleteCustomColumn(created.id); } catch { /* best-effort */ }
      throw e;
    }
  }
  return created;
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
}

export async function deleteDomain(id: string): Promise<void> {
  const { error } = await supabase.from('domains').delete().eq('id', id);
  if (error) throw error;
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

  return next;
}

// Set a Label's colour for a Domain (domains.label_colors[name] = paletteKey).
// Colours are Domain-wide so a label looks the same everywhere it appears.
export async function setDomainLabelColor(domainId: string, name: string, colorKey: string): Promise<Record<string, string>> {
  const { data: d, error: readErr } = await supabase
    .from('domains')
    .select('label_colors')
    .eq('id', domainId)
    .single();
  if (readErr) throw readErr;

  const current = (d?.label_colors ?? {}) as Record<string, string>;
  const next = { ...current, [name]: colorKey };
  const { data, error } = await supabase
    .from('domains')
    .update({ label_colors: next, updated_at: new Date().toISOString() })
    .eq('id', domainId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Couldn't save — you may not have access to this Domain.");
  }
  return next;
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

// ============================================
// Element Templates (Settings > Elements > Templates, el_QLT-029)
// Domain-scoped saved Element shapes. RLS: any Domain member can read (and
// use, from QuickAdd); only an owner/admin can author — see the migration.
// ============================================

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function parseElementTemplate(row: Record<string, unknown>): ElementTemplate {
  return {
    id: row.id as string,
    domain_id: row.domain_id as string,
    name: row.name as string,
    type: (row.type as string | null) ?? null,
    status: (row.status as ElementTemplate['status']) ?? null,
    priority: (row.priority as ElementTemplate['priority']) ?? null,
    labels: toStringArray(row.labels),
    assignee_worker_ids: toStringArray(row.assignee_worker_ids),
    description: (row.description as string | null) ?? null,
    estimated_hours: (row.estimated_hours as number | null) ?? null,
    order_index: (row.order_index as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

async function fetchElementTemplates(domainId: string): Promise<ElementTemplate[]> {
  const { data, error } = await supabase
    .from('element_templates')
    .select('*')
    .eq('domain_id', domainId)
    .order('order_index')
    .order('name');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(parseElementTemplate);
}

// Same cross-instance-sync problem `useDomains` already solved for the
// Domain list (DOMAINS_CHANGED_EVENT/notifyDomainsChanged in domainsStore.ts)
// — a plain useState+useEffect fetch has no shared cache, so a Settings-page
// edit would otherwise leave an already-mounted QuickAdd popup's own
// `useElementTemplates(domainId)` (a different tab, or one that just hasn't
// remounted) showing stale template contents indefinitely.
const ELEMENT_TEMPLATES_CHANGED_EVENT = 'alcon:element-templates-changed';
function notifyElementTemplatesChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ELEMENT_TEMPLATES_CHANGED_EVENT));
}

export async function createElementTemplate(input: ElementTemplateInsert): Promise<ElementTemplate> {
  const { data, error } = await supabase
    .from('element_templates')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  notifyElementTemplatesChanged();
  return parseElementTemplate(data as Record<string, unknown>);
}

export async function updateElementTemplate(id: string, updates: ElementTemplateUpdate): Promise<ElementTemplate> {
  const { data, error } = await supabase
    .from('element_templates')
    .update(updates)
    .eq('id', id)
    .select('*');
  if (error) throw error;
  // RLS-blocked update: PostgREST answers with an empty success, not an
  // error, when the row exists but the actor isn't an owner/admin of its
  // Domain — a Settings page must not read that as saved.
  if (!data || data.length === 0) {
    throw new Error("Couldn't save — you may not have owner/admin access to this Domain.");
  }
  notifyElementTemplatesChanged();
  return parseElementTemplate(data[0] as Record<string, unknown>);
}

export async function deleteElementTemplate(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('element_templates')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Couldn't delete — you may not have owner/admin access to this Domain.");
  }
  notifyElementTemplatesChanged();
}

const ELEMENT_TEMPLATES_QUERY_PREFIX = ['element-templates'] as const;
const EMPTY_TEMPLATES: ElementTemplate[] = [];

// Template edits broadcast ELEMENT_TEMPLATES_CHANGED_EVENT (notifyElementTemplatesChanged
// above); one module-level listener invalidates every mounted reader.
if (typeof window !== 'undefined') {
  window.addEventListener(ELEMENT_TEMPLATES_CHANGED_EVENT, () => {
    void getQueryClient().invalidateQueries({ queryKey: ELEMENT_TEMPLATES_QUERY_PREFIX });
  });
}

export function useElementTemplates(domainId: string | null) {
  const qc = useQueryClient();
  const key = useMemo(() => [...ELEMENT_TEMPLATES_QUERY_PREFIX, domainId ?? ''] as const, [domainId]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchElementTemplates(domainId!),
    enabled: !!domainId,
  });
  const refetch = useCallback(async () => { await qc.invalidateQueries({ queryKey: key }); }, [qc, key]);
  return {
    templates: query.data ?? EMPTY_TEMPLATES,
    loading: !!domainId && query.isPending,
    error: query.error ? (query.error instanceof Error ? query.error.message : 'Failed to load templates') : null,
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
  const { error: updateErr } = await supabase
    .from('domains')
    .update({ object_types: next, updated_at: new Date().toISOString() })
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

// Membership-scoped Domain list, shared through the query cache. useDomains()
// is mounted independently by many surfaces (page, sidebar, every list view,
// several widgets) — with one query key they all read the same row and the
// whole app fires ONE membership lookup per session instead of one per mount.
// The IndexedDB persister restores the last list before first paint, so the
// header's Domain name renders correctly on a cold load too.
const DOMAINS_QUERY_KEY = ['domains'] as const;
const SPACE_IDS_QUERY_KEY = ['my-space-ids'] as const;

/** The ActivitySpace ids the user belongs to — used to tell their own Space's
 *  Domains apart from "guest" Domains (invited to a single Domain in a Space
 *  they're NOT a member of; a Domain invite must not grant Space access).
 *  Shared between useDomains and useActivitySpaces via fetchQuery so both
 *  hooks resolve it from one request. */
function fetchMySpaceIds(userId: string): Promise<string[]> {
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

/** Refetch the shared Domain list (create / delete / join). One invalidation
 *  serves every mounted useDomains — they all read the same query. */
function invalidateDomains(): Promise<void> {
  const qc = getQueryClient();
  void qc.invalidateQueries({ queryKey: SPACE_IDS_QUERY_KEY });
  return qc.invalidateQueries({ queryKey: DOMAINS_QUERY_KEY });
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
    // Domains change only through create / delete / join, all of which
    // broadcast DOMAINS_CHANGED_EVENT → invalidateDomains. No need to
    // revalidate on every mount after 30 s.
    staleTime: 5 * 60_000,
  });
  const allData = query.data?.domains ?? EMPTY_DOMAINS;
  const mySpaceIdList = query.data?.mySpaceIds ?? EMPTY_IDS;

  // Scope to the active ActivitySpace — Domains carry an activity_space_id, so
  // the sidebar/list show only the current space's Domains. Re-filters live on
  // a space switch (no refetch — the cache holds all the user's member Domains).
  const [spaceId, setSpaceId] = useState<string | null>(() => getActiveSpaceId());
  useEffect(() => {
    const h = (e: Event) => setSpaceId((e as CustomEvent<string>).detail ?? null);
    window.addEventListener(ACTIVE_SPACE_CHANGE_EVENT, h as EventListener);
    return () => window.removeEventListener(ACTIVE_SPACE_CHANGE_EVENT, h as EventListener);
  }, []);

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

// Cross-Domain Guests of a Space, for Administration > Member (el_QLT-026).
// domain_members' own RLS (`user_id = auth.uid() OR user_is_domain_member`)
// has no branch for "this Domain is workspace-privacy and I'm a Space
// member" — unlike `domains` itself, which does. A plain client-side query
// would silently return nothing for any Domain the viewer hasn't personally
// joined, regardless of that Domain's privacy. This RPC (SECURITY DEFINER,
// see its migration) reimplements the boundary correctly instead: workspace
// Domains are visible Space-wide, private Domains stay gated on the caller
// actually being a member of that specific Domain.
export interface SpaceGuestRow {
  user_id: string;
  domain_id: string;
  domain_name: string;
  domain_role: string;
}

export async function fetchSpaceGuests(spaceId: string): Promise<SpaceGuestRow[]> {
  const { data, error } = await supabase.rpc('get_space_guest_domain_members', { p_space_id: spaceId });
  if (error) throw error;
  return (data ?? []) as SpaceGuestRow[];
}

// ============================================
// ActivitySpace CRUD + useActivitySpaces hook
// The top-level org container (company / enterprise) above Domain.
// ============================================

export async function createActivitySpace(
  input: ActivitySpaceInsert & { user_id: string },
): Promise<ActivitySpace> {
  const { user_id, ...fields } = input;
  const { data, error } = await supabase
    .from('activity_spaces')
    .insert(fields)
    .select()
    .single();
  if (error) throw error;

  // Enrol the creator as 'owner' so the membership-scoped RLS + roster work
  // (mirrors createDomain's domain_members enrolment).
  await supabase.from('activity_space_members').insert({
    activity_space_id: data.id,
    user_id,
    role: 'owner',
  });

  return data as ActivitySpace;
}

export async function updateActivitySpace(id: string, updates: ActivitySpaceUpdate): Promise<ActivitySpace> {
  const { data, error } = await supabase
    .from('activity_spaces')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as ActivitySpace;
}

export async function deleteActivitySpace(id: string): Promise<void> {
  const { error } = await supabase.from('activity_spaces').delete().eq('id', id);
  if (error) throw error;
}

const SPACES_QUERY_KEY = ['spaces'] as const;

async function fetchMemberSpaces(userId: string): Promise<ActivitySpace[]> {
  const ids = await fetchMySpaceIds(userId);
  if (ids.length === 0) return [];
  const { data: rows, error } = await supabase
    .from('activity_spaces')
    .select('*')
    .in('id', ids)
    .order('order_index');
  if (error) throw error;
  return (rows ?? []) as ActivitySpace[];
}

const EMPTY_SPACES: ActivitySpace[] = [];

/** Membership-scoped ActivitySpace list — the spaces the signed-in user belongs
 *  to. Signed-out hands back an empty list (the gate then shows the create-space
 *  onboarding). Shared query: every mount reads one cached row. */
export function useActivitySpaces() {
  const userId = useCurrentUserId();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...SPACES_QUERY_KEY, userId],
    queryFn: () => fetchMemberSpaces(userId!),
    enabled: !!userId,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const refetch = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: SPACE_IDS_QUERY_KEY });
    await qc.invalidateQueries({ queryKey: SPACES_QUERY_KEY });
  }, [qc]);
  return {
    data: query.data ?? EMPTY_SPACES,
    loading: !!userId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
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

const NO_COMMENTS: ElementComment[] = [];

/** Comments for one Element through the query cache (key shared with the
 *  detail prefetch in alcon/element/elementDetailQueries). `setComments`
 *  keeps the optimistic-update call shape and writes into the cache. */
export function useElementComments(elementId: string | null) {
  const qc = useQueryClient();
  const key = useMemo(() => ['element', elementId ?? '', 'comments'] as const, [elementId]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchElementComments(elementId!),
    enabled: !!elementId,
  });
  const reload = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: key });
  }, [qc, key]);
  const setComments = useCallback(
    (update: ElementComment[] | ((prev: ElementComment[]) => ElementComment[])) => {
      qc.setQueryData<ElementComment[]>(key, (prev) =>
        typeof update === 'function' ? update(prev ?? NO_COMMENTS) : update,
      );
    },
    [qc, key],
  );
  return {
    comments: query.data ?? NO_COMMENTS,
    loading: !!elementId && query.isPending,
    reload,
    setComments,
  };
}

/** Comment activity rollup for one Element — count + when it last moved. */
export interface ElementActivity {
  commentCount: number;
  /** created_at of the newest comment (ISO). */
  lastCommentAt: string;
}

/**
 * Comment activity for a whole list of Elements in ONE aggregated RPC call
 * (get_element_activity: GROUP BY on the server, RLS-checked, POST body so
 * a large visible set can't blow the URL or trip the PostgREST row cap).
 * Elements with zero comments get no entry (rows render nothing for them).
 *
 * Entries whose count/timestamp didn't change keep their previous object
 * reference (structural sharing), so a memoised row re-renders only when
 * its own thread actually moved. Refetches when the visible id set changes
 * or when element_comments changes under us (realtime, debounced).
 */
const ELEMENT_ACTIVITY_QUERY_PREFIX = ['element-activity'] as const;
const EMPTY_ACTIVITY: Record<string, ElementActivity> = {};

async function fetchElementActivity(ids: string[]): Promise<Record<string, ElementActivity>> {
  const { data: rows, error } = await supabase
    .rpc('get_element_activity', { p_element_ids: ids });
  if (error) throw error;
  const next: Record<string, ElementActivity> = {};
  type Row = { element_id: string; comment_count: number; last_comment_at: string };
  for (const r of (rows ?? []) as Row[]) {
    next[r.element_id] = { commentCount: Number(r.comment_count), lastCommentAt: r.last_comment_at };
  }
  return next;
}

// element_comments changing anywhere moves some row's rollup — one shared
// channel, debounced, invalidates every mounted reader.
let activityInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
function buildActivityChannel(channel: RealtimeChannel): RealtimeChannel {
  return channel.on('postgres_changes', { event: '*', schema: 'public', table: 'element_comments' }, () => {
    if (activityInvalidateTimer) clearTimeout(activityInvalidateTimer);
    activityInvalidateTimer = setTimeout(() => {
      activityInvalidateTimer = null;
      void getQueryClient().invalidateQueries({ queryKey: ELEMENT_ACTIVITY_QUERY_PREFIX });
    }, 300);
  });
}

export function useElementActivity(elementIds: string[]) {
  // Callers typically rebuild the ids array every render (flatMap over
  // sections) — depend on the sorted membership, not the array identity.
  // \n can never appear in an id, so the key is collision-safe to split.
  const idsKey = useMemo(() => [...elementIds].sort().join('\n'), [elementIds]);
  const query = useQuery({
    queryKey: [...ELEMENT_ACTIVITY_QUERY_PREFIX, idsKey],
    queryFn: () => fetchElementActivity(idsKey.split('\n')),
    enabled: !!idsKey,
    // Keep the previous map while the visible set changes so rows don't
    // flicker to blank; the cache's structural sharing keeps unchanged
    // entries referentially stable, so memoised rows skip re-rendering.
    placeholderData: keepPreviousData,
  });
  useSharedChannel('element-activity', buildActivityChannel);
  return query.data ?? EMPTY_ACTIVITY;
}

// ============================================
// Reactions (emoji on Element OR Comment)
// ============================================
export async function fetchCommentReactions(commentIds: string[]): Promise<ElementReaction[]> {
  return await selectIn(commentIds, chunk =>
    supabase.from('element_reactions').select('*').in('comment_id', chunk),
  ) as ElementReaction[];
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
  // maybeSingle, not single: a muted kind (notification_preferences) makes
  // the BEFORE INSERT trigger skip the row, so zero rows back is an
  // intended outcome here, not a failure to log.
  const { data, error } = await supabase
    .from('notifications')
    .insert(input)
    .select('*')
    .maybeSingle();
  if (error) {
    console.error('createNotification failed:', error);
    return null;
  }
  return data as Notification | null;
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

// ---------------------------------------------------------------------------
// The Inbox feed is one thing, so it gets one store.
//
// The sidebar badge and the Inbox view are two windows onto the same list.
// Given a hook instance each they opened a realtime subscription each, and
// every instance answered every event by refetching the whole feed. "Mark all
// read" over 53 rows is 53 UPDATE events, so the client fetched all 53 rows
// 106 times to learn something it had already written itself.
//
// Two fixes, and they are one idea: hold the feed once, and treat a realtime
// event as the news it already contains rather than as a reason to ask again.
// A refetch remains available (`reload`) for the cases where the payload isn't
// enough — the initial load, and recovering from a failed write.
// ---------------------------------------------------------------------------

interface InboxStore {
  recipientId: string | null;
  /** Replaced wholesale on every change: hook instances compare by identity. */
  snapshot: { notifications: Notification[]; loading: boolean };
  listeners: Set<() => void>;
  channel: ReturnType<typeof supabase.channel> | null;
  /** How many mounted hooks want the feed. The channel lives while > 0. */
  refCount: number;
  /** Guards against a slow fetch landing after a newer one (or a recipient change). */
  loadToken: number;
  emitTimer: ReturnType<typeof setTimeout> | null;
}

const inboxStore: InboxStore = {
  recipientId: null,
  snapshot: { notifications: [], loading: true },
  listeners: new Set(),
  channel: null,
  refCount: 0,
  loadToken: 0,
  emitTimer: null,
};

const EMPTY_INBOX: Notification[] = [];

function emitInbox() {
  if (inboxStore.emitTimer) { clearTimeout(inboxStore.emitTimer); inboxStore.emitTimer = null; }
  for (const listen of inboxStore.listeners) listen();
}

/** Realtime arrives one websocket message per row; a burst (mark-all-read)
 *  should cost one render, not one per row. Local edits skip this and emit
 *  straight away so a click feels immediate. */
function emitInboxSoon() {
  if (inboxStore.emitTimer) return;
  inboxStore.emitTimer = setTimeout(() => { inboxStore.emitTimer = null; emitInbox(); }, 0);
}

function setInboxState(
  next: Partial<InboxStore['snapshot']>,
  schedule: 'now' | 'soon' = 'now',
) {
  inboxStore.snapshot = { ...inboxStore.snapshot, ...next };
  if (schedule === 'now') emitInbox(); else emitInboxSoon();
}

const byNewestFirst = (a: Notification, b: Notification) => b.created_at.localeCompare(a.created_at);

/** Fold one realtime payload into the list. Archiving is how a row leaves the
 *  Inbox, so an UPDATE that sets is_archived removes it. */
function applyInboxEvent(payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Partial<Notification>;
  old: Partial<Notification>;
}) {
  const list = inboxStore.snapshot.notifications;
  const row = payload.new as Notification | undefined;
  const id = (payload.new?.id ?? payload.old?.id) as string | undefined;
  if (!id) return;

  if (payload.eventType === 'DELETE') {
    if (!list.some(n => n.id === id)) return;
    setInboxState({ notifications: list.filter(n => n.id !== id) }, 'soon');
    return;
  }
  if (!row || row.is_archived) {
    if (!list.some(n => n.id === id)) return;
    setInboxState({ notifications: list.filter(n => n.id !== id) }, 'soon');
    return;
  }
  const at = list.findIndex(n => n.id === id);
  if (at === -1) {
    setInboxState({ notifications: [row, ...list].sort(byNewestFirst) }, 'soon');
    return;
  }
  const merged = { ...list[at], ...row };
  const next = [...list];
  next[at] = merged;
  setInboxState({ notifications: next }, 'soon');
}

async function loadInbox() {
  const recipientId = inboxStore.recipientId;
  const token = ++inboxStore.loadToken;
  if (!recipientId) { setInboxState({ notifications: EMPTY_INBOX, loading: false }); return; }
  setInboxState({ loading: true });
  try {
    const list = await fetchNotifications({ recipientId });
    if (token !== inboxStore.loadToken) return;
    setInboxState({ notifications: list, loading: false });
  } catch (e) {
    console.error('Failed to load notifications:', e);
    if (token === inboxStore.loadToken) setInboxState({ loading: false });
  }
}

function openInboxChannel() {
  const recipientId = inboxStore.recipientId;
  if (!recipientId || inboxStore.channel) return;
  inboxStore.channel = supabase
    .channel(`notifications:${recipientId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${recipientId}` },
      (payload) => {
        applyInboxEvent(payload as unknown as Parameters<typeof applyInboxEvent>[0]);
      },
    )
    .subscribe();
}

function closeInboxChannel() {
  if (!inboxStore.channel) return;
  void supabase.removeChannel(inboxStore.channel);
  inboxStore.channel = null;
}

function retainInbox(recipientId: string | null) {
  inboxStore.refCount += 1;
  if (inboxStore.recipientId !== recipientId) {
    closeInboxChannel();
    inboxStore.recipientId = recipientId;
    setInboxState({ notifications: EMPTY_INBOX, loading: !!recipientId });
    openInboxChannel();
    void loadInbox();
  } else if (inboxStore.refCount === 1) {
    openInboxChannel();
    void loadInbox();
  }
}

function releaseInbox() {
  inboxStore.refCount = Math.max(0, inboxStore.refCount - 1);
  if (inboxStore.refCount === 0) closeInboxChannel();
}

function subscribeInbox(listen: () => void) {
  inboxStore.listeners.add(listen);
  return () => { inboxStore.listeners.delete(listen); };
}

const getInboxSnapshot = () => inboxStore.snapshot;

/** Same shape as a `useState` setter so callers keep writing optimistic
 *  updates the way they always have — it just lands in the shared store, and
 *  the sidebar badge moves with the list. */
function setInboxNotifications(update: Notification[] | ((prev: Notification[]) => Notification[])) {
  const prev = inboxStore.snapshot.notifications;
  const next = typeof update === 'function' ? update(prev) : update;
  if (next === prev) return;
  setInboxState({ notifications: next });
}

export function useNotifications(recipientId: string | null) {
  const snapshot = useSyncExternalStore(subscribeInbox, getInboxSnapshot, getInboxSnapshot);

  useEffect(() => {
    retainInbox(recipientId);
    return () => { releaseInbox(); };
  }, [recipientId]);

  const reload = useCallback(() => { void loadInbox(); }, []);
  const notifications = snapshot.notifications;
  const unreadCount = useMemo(() => notifications.filter(n => !n.is_read).length, [notifications]);

  return {
    notifications,
    unreadCount,
    loading: snapshot.loading,
    reload,
    setNotifications: setInboxNotifications,
  };
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
// Global Search (⌘K) — searches Elements, Objects, Notes, Briefs
// ============================================
export interface SearchResult {
  kind: 'element' | 'object' | 'note' | 'brief';
  id: string;
  title: string;
  snippet?: string | null;
  objectId?: string | null;
  /** The quotable id — `ELE_MED-001`. Absent for kinds that have none. */
  displayId?: string | null;
}

export async function globalSearch(query: string, limit = 8): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;

  const [elementsRes, objectsRes, notesRes, briefsRes] = await Promise.all([
    // display_id is searched as well as returned. It is the string an Element
    // is called by in a comment or a SITREP, so someone reading "ELE_MED-001 is
    // blocked" reaches for ⌘K and types exactly that.
    supabase
      .from('elements')
      .select('id, title, description, object_id, display_id')
      .or(`title.ilike.${like},description.ilike.${like},display_id.ilike.${like}`)
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
    out.push({ kind: 'element', id: r.id, title: r.title, snippet: r.description, objectId: r.object_id, displayId: r.display_id });
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

// PostgREST's ascending `.order(col)` puts nulls last. Chunked fetches
// reassemble the order in JS, so the rule lives here too. ISO dates compare
// lexicographically, which is what the date columns hold.
function ascNullsLast(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

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
    const [linkedRows, legacyObjects] = await Promise.all([
      selectIn(domainIds, chunk =>
        supabase.from('object_domains').select('object_id').in('domain_id', chunk),
      ),
      selectIn(domainIds, chunk =>
        supabase.from('objects').select('id').in('domain_id', chunk),
      ),
    ]);
    for (const r of linkedRows) objectScope.add(r.object_id as string);
    for (const r of legacyObjects) objectScope.add(r.id as string);
  }

  if (objectScope.size === 0) return { elements: [], objects: [] };

  const objectIdsArr = Array.from(objectScope);

  // 2. Find every Element attached to any Object in scope (junction-first, then legacy)
  const elementIdSet = new Set<string>();
  const [junctionRows, legacyElems] = await Promise.all([
    selectIn(objectIdsArr, chunk =>
      supabase.from('element_objects').select('element_id').in('object_id', chunk),
    ),
    selectIn(objectIdsArr, chunk =>
      supabase.from('elements').select('id').in('object_id', chunk),
    ),
  ]);
  for (const r of junctionRows) elementIdSet.add(r.element_id as string);
  for (const r of legacyElems) elementIdSet.add(r.id as string);

  if (elementIdSet.size === 0) {
    const objectsOnly = await selectIn(objectIdsArr, chunk =>
      supabase.from('objects').select('*').in('id', chunk),
    ) as AlconObject[];
    return { elements: [], objects: objectsOnly };
  }

  const elementIdsArr = Array.from(elementIdSet);

  // 3. Fetch elements + subelements + assignees + workers in parallel.
  //    start_date orders the whole set, so it is re-applied across chunks:
  //    ascending with the undated last, the way PostgREST hands it back.
  const [elementsData, subs, assignees, objectsData, junctions] = await Promise.all([
    selectIn(
      elementIdsArr,
      chunk => supabase.from('elements').select('*').in('id', chunk).order('start_date'),
      { compare: (a, b) => ascNullsLast(a.start_date, b.start_date) },
    ) as Promise<Element[]>,
    selectIn(elementIdsArr, chunk =>
      supabase.from('subelements').select('*').in('element_id', chunk),
    ) as Promise<Subelement[]>,
    selectIn(elementIdsArr, chunk =>
      supabase.from('element_assignees').select('*').in('element_id', chunk),
    ) as Promise<ElementAssignee[]>,
    selectIn(objectIdsArr, chunk =>
      supabase.from('objects').select('*').in('id', chunk),
    ) as Promise<AlconObject[]>,
    selectIn(elementIdsArr, chunk =>
      supabase.from('element_objects').select('*').in('element_id', chunk),
    ) as Promise<ElementObject[]>,
  ]);

  const workerIds = Array.from(new Set(assignees.map(a => a.worker_id))).filter(Boolean);
  const workers = await selectIn(workerIds, chunk =>
    supabase.from('workers').select('*').in('id', chunk),
  ) as Worker[];

  const objIdsByElement = new Map<string, string[]>();
  for (const j of junctions) {
    if (!objIdsByElement.has(j.element_id)) objIdsByElement.set(j.element_id, []);
    objIdsByElement.get(j.element_id)!.push(j.object_id);
  }

  const elementsWithDetails: ElementWithDetails[] = elementsData.map(el => {
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

  return { elements: elementsWithDetails, objects: objectsData };
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

  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      element_id: opts.elementId,
      domain_id: opts.domainId ?? null,
      worker_id: opts.workerId ?? null,
      triggered_from: opts.triggeredFrom ?? null,
      triggered_by: userId ?? null,
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

// Shared query: the Strategy shell unmounts/remounts on every visit (tab
// switch, sidebar navigation) and six surfaces read the list at once — one
// key means one fetch, instant revisits from the cache (and from IndexedDB on
// a cold load), and one realtime channel instead of one per instance.
const STRATEGIES_QUERY_KEY = ['strategies'] as const;

async function fetchStrategies(): Promise<StrategyWithObjects[]> {
  const [{ data: strategies, error: sErr }, { data: links, error: lErr }, { data: nesting, error: nErr }] =
    await Promise.all([
      supabase.from('strategies').select('*').order('created_at', { ascending: false }),
      supabase.from('strategy_objects').select('*'),
      supabase.from('strategy_children').select('*'),
    ]);
  if (sErr) throw sErr;
  if (lErr) throw lErr;
  if (nErr) throw nErr;
  return assembleStrategies(
    (strategies || []) as Strategy[],
    (links || []) as StrategyObject[],
    (nesting || []) as StrategyChild[],
  );
}

function invalidateStrategies() {
  void getQueryClient().invalidateQueries({ queryKey: STRATEGIES_QUERY_KEY });
}

function buildStrategiesChannel(channel: RealtimeChannel): RealtimeChannel {
  return channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'strategies' }, invalidateStrategies)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'strategy_objects' }, invalidateStrategies)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'strategy_children' }, invalidateStrategies);
}

const EMPTY_STRATEGIES: StrategyWithObjects[] = [];

export function useStrategies() {
  const query = useQuery({ queryKey: STRATEGIES_QUERY_KEY, queryFn: fetchStrategies });
  useSharedChannel('strategies', buildStrategiesChannel);
  return {
    data: query.data ?? EMPTY_STRATEGIES,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: invalidateStrategies,
  };
}

export async function createStrategy(
  input: StrategyInsert,
  objectIds: string[] = [],
): Promise<Strategy> {
  // strategies.created_by is NOT NULL — stamp the signed-in user so callers
  // don't have to pass it (a missed `created_by` previously 23502'd out of the
  // insert with "null value in column created_by ... violates not-null
  // constraint"). Mirrors how createObject backfills its creator.
  const creatorId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('strategies')
    .insert({ ...input, created_by: input.created_by ?? creatorId })
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

// Strategy nesting (Asana-portfolio style — a Strategy can hold other
// Strategies as children, DAG so multi-parent is allowed). The DB only
// rejects a literal self-reference; deeper-cycle prevention is the picker's
// job (StrategyShell excludes the current Strategy's ancestors).
export async function addStrategyChild(parentStrategyId: string, childStrategyId: string): Promise<void> {
  const { error } = await supabase
    .from('strategy_children')
    .insert({ parent_strategy_id: parentStrategyId, child_strategy_id: childStrategyId });
  if (error) throw error;
}

export async function removeStrategyChild(parentStrategyId: string, childStrategyId: string): Promise<void> {
  const { error } = await supabase
    .from('strategy_children')
    .delete()
    .eq('parent_strategy_id', parentStrategyId)
    .eq('child_strategy_id', childStrategyId);
  if (error) throw error;
}

// ============================================
// Campaign comments — the Strategy layer's thread
// ============================================
//
// Same shape as element comments, and deliberately the same call signatures,
// so the two threads stay one concept with two homes. Delivery to the Inbox
// is a database trigger (notify_strategy_comment), not a call from here — a
// comment written over the API has to notify too, and that is the only place
// both paths pass through.

export async function fetchStrategyComments(strategyId: string): Promise<StrategyComment[]> {
  const { data, error } = await supabase
    .from('strategy_comments')
    .select('*')
    .eq('strategy_id', strategyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as StrategyComment[];
}

export async function createStrategyComment(input: StrategyCommentInsert): Promise<StrategyComment> {
  const { data, error } = await supabase
    .from('strategy_comments')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as StrategyComment;
}

export async function deleteStrategyComment(id: string): Promise<void> {
  const { error } = await supabase.from('strategy_comments').delete().eq('id', id);
  if (error) throw error;
}

/**
 * One Campaign's thread, live. The realtime subscription is the point: the
 * comments that matter most here are written by agents over the API while
 * the Campaign sits open on screen, and a thread that only refreshes on
 * navigation would show a stale answer to a question just asked.
 */
export function useStrategyComments(strategyId: string | null) {
  const [comments, setComments] = useState<StrategyComment[]>([]);
  // Refetches are driven by a version bump rather than by calling a loader,
  // so the fetch lives in one effect and nothing writes state synchronously
  // during commit. Realtime and the manual `reload()` both just bump it.
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = strategyId ? await fetchStrategyComments(strategyId) : [];
        if (!cancelled) setComments(list);
      } catch (e) {
        // Keep whatever is on screen — a blank thread would read as "nothing
        // was ever said here" — but say so rather than failing silently.
        console.error('Failed to load Campaign comments:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [strategyId, version]);

  useEffect(() => {
    if (!strategyId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`strategy-comments:${strategyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'strategy_comments', filter: `strategy_id=eq.${strategyId}` },
        () => {
          // Debounced: an agent posting a burst of reports would otherwise
          // refetch the thread once per row.
          if (timer) clearTimeout(timer);
          timer = setTimeout(reload, 300);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [strategyId, reload]);

  return { comments, reload, setComments };
}

// ============================================
// Phase — Linear-Cycle-style time-boxed periods
// ============================================
//
// Domain-scoped (mirrors Linear's per-team cycles). Objects / Elements join a
// Phase through their own phase_id column — assignment is just
// updateObject/updateElement({ phase_id }), no junction table.

const PHASES_QUERY_PREFIX = ['phases'] as const;

async function fetchPhases(domainId: string): Promise<Phase[]> {
  const { data: rows, error } = await supabase
    .from('phases')
    .select('*')
    .eq('domain_id', domainId)
    .order('start_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (rows || []) as Phase[];
}

function invalidatePhases() {
  void getQueryClient().invalidateQueries({ queryKey: PHASES_QUERY_PREFIX });
}

function buildPhasesChannel(channel: RealtimeChannel): RealtimeChannel {
  return channel.on('postgres_changes', { event: '*', schema: 'public', table: 'phases' }, invalidatePhases);
}

const EMPTY_PHASES: Phase[] = [];

export function usePhases(domainId: string | null) {
  const query = useQuery({
    queryKey: [...PHASES_QUERY_PREFIX, domainId],
    queryFn: () => fetchPhases(domainId!),
    enabled: !!domainId,
  });
  useSharedChannel(domainId ? 'phases' : null, buildPhasesChannel);
  return {
    data: query.data ?? EMPTY_PHASES,
    loading: !!domainId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: invalidatePhases,
  };
}

// ============================================
// Why a Phase's dates are what they are.
//
// The Strategy layer records the call — what was chosen, what it gave up — and
// binds it to the Phase it moved. Read from the Phase's own side, that binding
// is the answer to the question the Phase surface could not answer before:
// somebody opens a box that is running three weeks long and finds the reason,
// with the name of whoever made the call and the Campaign it was made in.
//
// Read-only on purpose. A Phase does not get to record a decision — a decision
// lives under a Campaign's root Intent, and inventing one from here would put a
// second author on a record whose whole value is that it has one.
// ============================================

export interface PhaseReschedule {
  bindingId: string
  intentId: string
  /** What was decided. */
  title: string
  /** What it gave up. */
  abandoned: string | null
  decidedByName: string | null
  /** ISO timestamp. */
  decidedAt: string | null
  strategyId: string
  strategyName: string
}

async function fetchPhaseReschedules(phaseId: string): Promise<PhaseReschedule[]> {
  const { data: bindingRows, error: bErr } = await supabase
    .from('intent_bindings')
    .select('id, intent_id, target_id')
    .eq('target_type', 'phase')
    .eq('target_id', phaseId)
    .eq('relationship_type', 'reschedules')
  if (bErr) throw bErr

  const bindings = (bindingRows || []) as { id: string; intent_id: string }[]
  if (bindings.length === 0) return []

  const intents = await selectIn<
    Pick<Intent, 'id' | 'title' | 'abandoned' | 'decided_by_name' | 'decided_at' | 'strategy_id'>
  >(
    bindings.map((b) => b.intent_id),
    (chunk) => supabase
      .from('intents')
      .select('id, title, abandoned, decided_by_name, decided_at, strategy_id')
      .in('id', chunk),
  )
  const byIntent = new Map(intents.map((i) => [i.id, i]))

  const strategies = await selectIn<Pick<Strategy, 'id' | 'name'>>(
    [...new Set(intents.map((i) => i.strategy_id))],
    (chunk) => supabase.from('strategies').select('id, name').in('id', chunk),
  )
  const byStrategy = new Map(strategies.map((s) => [s.id, s]))

  // A binding whose Intent is unreadable is dropped rather than shown as a
  // blank row: unlike the Campaign side, there is nothing a reader could do
  // about it here, and a row that says nothing is worse than no row.
  return bindings
    .flatMap((b) => {
      const intent = byIntent.get(b.intent_id)
      if (!intent) return []
      return [{
        bindingId: b.id,
        intentId: intent.id,
        title: intent.title,
        abandoned: intent.abandoned,
        decidedByName: intent.decided_by_name,
        decidedAt: intent.decided_at,
        strategyId: intent.strategy_id,
        strategyName: byStrategy.get(intent.strategy_id)?.name ?? 'Campaign',
      }]
    })
    // Newest call first — the latest one is why the dates are what they are
    // now, and the earlier ones are how they got there.
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
}

/**
 * The decisions recorded as having moved this Phase's dates.
 *
 * No loading flag. The section this feeds renders nothing until rows arrive and
 * nothing when there are none, so a third state would have no rendering of its
 * own — and holding it would mean a setState in the effect body, which is the
 * cascading render the lint rule is there to stop.
 */
export function usePhaseReschedules(phaseId: string | null) {
  const [state, setState] = useState<{
    forPhase: string | null
    rows: PhaseReschedule[]
    error: Error | null
  }>({ forPhase: null, rows: [], error: null })

  useEffect(() => {
    if (!phaseId) return
    let cancelled = false
    fetchPhaseReschedules(phaseId)
      .then((rows) => { if (!cancelled) setState({ forPhase: phaseId, rows, error: null }) })
      .catch((e) => {
        // Kept visible rather than swallowed: an empty section and a failed
        // read look identical, and only one of them means "nobody recorded a
        // reason".
        console.error('Failed to read why this Phase moved:', e)
        if (!cancelled) setState({ forPhase: phaseId, rows: [], error: e as Error })
      })
    return () => { cancelled = true }
  }, [phaseId])

  // A result belonging to the Phase that was open a moment ago is not this
  // Phase's answer. Read off the id it was fetched for rather than cleared in
  // the effect, so switching boxes never shows the previous one's reasons.
  const current = state.forPhase === phaseId
  return { data: current ? state.rows : [], error: current ? state.error : null }
}

export async function createPhase(input: PhaseInsert): Promise<Phase> {
  const { data, error } = await supabase.from('phases').insert(input).select().single();
  if (error) throw error;
  return data as Phase;
}

export async function updatePhase(id: string, updates: PhaseUpdate): Promise<Phase> {
  const { data, error } = await supabase
    .from('phases')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Phase;
}

export async function deletePhase(id: string): Promise<void> {
  // phase_id FKs are ON DELETE SET NULL — members drop back to "no Phase".
  const { error } = await supabase.from('phases').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Close a Phase: move the unfinished Elements where the closer sent them
 * (`planPhaseClose` decided that), then mark the Phase complete.
 *
 * Elements first, the `phases` row last, because PostgREST gives no
 * transaction across the two: `status = 'complete'` is the only mark that the
 * close happened, so a failed Element write leaves an open Phase that can
 * simply be closed again. Carried Elements have already left this Phase by
 * then, so the retry neither counts them a second time nor loses the rest.
 * The other order would leave a Phase reading closed over work that never
 * moved, with nothing on the surface to say so.
 */
export async function closePhase(
  phaseId: string,
  input: { closingNote: string; elementWrites: readonly PhaseCloseWrite[] },
): Promise<Phase> {
  for (const write of input.elementWrites) {
    const patch: ElementUpdate = { phase_id: write.phase_id, updated_at: new Date().toISOString() };
    if (write.carried_over_count !== undefined) patch.carried_over_count = write.carried_over_count;
    await selectIn(write.ids, chunk =>
      supabase.from('elements').update(patch).in('id', chunk).select('id'),
    );
  }
  return updatePhase(phaseId, {
    status: 'complete',
    closed_at: new Date().toISOString(),
    closing_note: input.closingNote.trim() || null,
  });
}

/**
 * Move a Phase back out of `complete`. `closed_at` goes with it — it dates an
 * act that has been undone. `closing_note` stays: what somebody wrote about
 * how the Phase ended is theirs to change, and the close dialog offers it back
 * as the draft next time. Nothing shows it while the Phase is open again.
 */
export async function reopenPhase(phaseId: string, status: Exclude<PhaseStatus, 'complete'>): Promise<Phase> {
  return updatePhase(phaseId, { status, closed_at: null });
}

/** The Element fields the Phase surface reads — membership, progress, and how
 *  many Phases this Element has already been carried through. */
export type PhaseCandidateElement = Pick<
  Element,
  'id' | 'title' | 'status' | 'due_date' | 'phase_id' | 'object_id' | 'carried_over_count'
>;

// Every Object and Element of a Domain with just the fields the Phase surface
// needs — membership rows for each Phase plus candidates for its "+" pickers.
// Elements come via their home Object (domain-direct Elements aren't listed).
export async function fetchPhaseCandidates(domainId: string): Promise<{
  objects: Pick<AlconObject, 'id' | 'name' | 'type' | 'due_date' | 'phase_id'>[];
  elements: PhaseCandidateElement[];
}> {
  const { data: objects, error: oErr } = await supabase
    .from('objects')
    .select('id, name, type, due_date, phase_id')
    .eq('domain_id', domainId)
    .order('order_index', { ascending: true, nullsFirst: false });
  if (oErr) throw oErr;
  const objectIds = (objects || []).map((o) => o.id);
  if (objectIds.length === 0) return { objects: [], elements: [] };
  // order_index joins the select so the chunks can be reordered back into one
  // Domain-wide sequence; the Phase surface reads the other fields.
  const elements = await selectIn(
    objectIds,
    chunk =>
      supabase
        .from('elements')
        .select('id, title, status, due_date, phase_id, object_id, carried_over_count, order_index')
        .in('object_id', chunk)
        .order('order_index', { ascending: true, nullsFirst: false }),
    { compare: (a, b) => ascNullsLast(a.order_index, b.order_index) },
  );
  return {
    objects: (objects || []) as Pick<AlconObject, 'id' | 'name' | 'type' | 'due_date' | 'phase_id'>[],
    elements: elements as PhaseCandidateElement[],
  };
}

// ============================================
// Strategy Intent layer — 認識2x2 + 実践2x2
// ============================================
//
// One Strategy hosts one Master Intent (+ optional Sub-Intents). The
// 8 child tables (bindings/audits/predictions/lineage/resources/alignments/
// escalations/next_actions) are all keyed off intent_id. This block gives
// the Strategy Document detail page a single fetch + a small set of
// imperative writers — write paths stay imperative (mirrors createStrategy
// etc.) rather than wrapping each in React Query for now, since this
// layer's update cadence is far slower than the rest of the app.

export interface IntentBundle {
  master: Intent | null
  subs: Intent[]
  bindings: IntentBinding[]
  audits: IntentAudit[]
  predictions: IntentPrediction[]
  lineage: IntentLineage[]
  resources: IntentResource[]
  alignments: IntentAlignment[]
  escalations: IntentEscalation[]
  nextActions: IntentNextAction[]
}

/**
 * Hydrate everything the Strategy Document detail page needs in one pass.
 * Returns a bundle keyed off the parent Strategy — Master Intent is split
 * out for the page header; everything else is grouped by intent_id at the
 * call site as needed.
 */
export function useStrategyIntentBundle(strategyId: string | null) {
  const [data, setData] = useState<IntentBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!strategyId) {
      setData(null)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        // 1) Pull every Intent under this Strategy.
        const { data: intentRows, error: iErr } = await supabase
          .from('intents')
          .select('*')
          .eq('strategy_id', strategyId)
          .order('order_index', { ascending: true })
        if (iErr) throw iErr
        const allIntents = (intentRows || []) as Intent[]
        const intentIds = allIntents.map((i) => i.id)
        if (intentIds.length === 0) {
          if (!cancelled) {
            setData({
              master: null,
              subs: [],
              bindings: [],
              audits: [],
              predictions: [],
              lineage: [],
              resources: [],
              alignments: [],
              escalations: [],
              nextActions: [],
            })
          }
          return
        }

        // 2) Fan out: all 8 child tables in parallel, scoped by intent_id IN (…).
        const [
          bindingsRes, auditsRes, predictionsRes, lineageRes,
          resourcesRes, alignmentsRes, escalationsRes, nextActionsRes,
        ] = await Promise.all([
          supabase.from('intent_bindings').select('*').in('intent_id', intentIds),
          supabase.from('intent_audits').select('*').in('intent_id', intentIds).order('ran_at', { ascending: false }),
          supabase.from('intent_predictions').select('*').in('intent_id', intentIds).is('archived_at', null),
          supabase.from('intent_lineage').select('*').in('intent_id', intentIds).order('occurred_at', { ascending: false }),
          supabase.from('intent_resources').select('*').in('intent_id', intentIds).order('captured_at', { ascending: false }),
          supabase.from('intent_alignments').select('*').in('intent_id', intentIds).is('resolved_at', null),
          supabase.from('intent_escalations').select('*').in('intent_id', intentIds).order('triggered_at', { ascending: false }),
          supabase.from('intent_next_actions').select('*').in('intent_id', intentIds).order('order_index', { ascending: true }),
        ])
        for (const r of [bindingsRes, auditsRes, predictionsRes, lineageRes, resourcesRes, alignmentsRes, escalationsRes, nextActionsRes]) {
          if (r.error) throw r.error
        }

        if (cancelled) return
        const master = allIntents.find((i) => i.parent_intent_id === null) ?? null
        setData({
          master,
          subs: allIntents.filter((i) => i.parent_intent_id !== null),
          bindings: (bindingsRes.data || []) as IntentBinding[],
          audits: (auditsRes.data || []) as IntentAudit[],
          predictions: (predictionsRes.data || []) as IntentPrediction[],
          lineage: (lineageRes.data || []) as IntentLineage[],
          resources: (resourcesRes.data || []) as IntentResource[],
          alignments: (alignmentsRes.data || []) as IntentAlignment[],
          escalations: (escalationsRes.data || []) as IntentEscalation[],
          nextActions: (nextActionsRes.data || []) as IntentNextAction[],
        })
      } catch (e) {
        if (!cancelled) setError(e as Error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [strategyId, tick])

  return { data, loading, error, refetch: () => setTick((t) => t + 1) }
}

/**
 * The bindings that land on a set of targets, and the Intents behind them —
 * the round trip read from the Execution side. `useStrategyIntentBundle`
 * reads a Campaign's edges outward; this reads an Element's (or an Object's,
 * or a Phase's) inward, which is the direction nothing could read before.
 *
 * Filters by target id only. Ids are uuids, so a collision across target
 * types is not a real case, and the caller checks the type against what it
 * asked about anyway.
 */
interface IntentBindingsBundle {
  bindings: IntentBinding[]
  intents: Intent[]
  lineage: IntentLineage[]
}

async function fetchIntentBindingsBundle(ids: string[]): Promise<IntentBindingsBundle> {
  // `selectIn` chunks the id list: an Object's Elements are the targets
  // here, and a few hundred of them in one `in()` overruns the URL.
  const found = await selectIn<IntentBinding>(ids, (chunk) =>
    supabase.from('intent_bindings').select('*').in('target_id', chunk),
  )
  const intentIds = [...new Set(found.map((b) => b.intent_id))]
  // Lineage comes with them because a decision's review state is not on
  // the decision: `reviewed` is "the day came AND was answered", and the
  // answer is a `revision` row. Without it a decision reviewed on time
  // reads as overdue forever.
  const [rows, lineage] = await Promise.all([
    selectIn<Intent>(intentIds, (chunk) =>
      supabase.from('intents').select('*').in('id', chunk),
    ),
    selectIn<IntentLineage>(intentIds, (chunk) =>
      supabase
        .from('intent_lineage')
        .select('*')
        .in('intent_id', chunk)
        .eq('action_kind', 'revision'),
    ),
  ])
  return { bindings: found, intents: rows, lineage }
}

export function useIntentBindingsForTargets(targetIds: string[]) {
  // The array identity changes every render at most call sites; the contents
  // are what matters, so key on those.
  const key = targetIds.join('\u0000')
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['intent-bindings', key],
    queryFn: () => fetchIntentBindingsBundle(key.split('\u0000')),
    enabled: Boolean(key),
  })
  const refetch = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['intent-bindings', key] })
  }, [qc, key])
  return {
    bindings: query.data?.bindings ?? NO_BINDINGS,
    intents: query.data?.intents ?? NO_INTENTS,
    lineage: query.data?.lineage ?? NO_LINEAGE,
    /** True while a non-empty key has no answer yet. */
    loading: Boolean(key) && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  }
}

const NO_BINDINGS: IntentBinding[] = []
const NO_INTENTS: Intent[] = []
const NO_LINEAGE: IntentLineage[] = []

// Master / Sub-Intent CRUD ────────────────────────────────────────────

export async function createIntent(input: IntentInsert): Promise<Intent> {
  const userId = await getCurrentUserId()
  const { data, error } = await supabase
    .from('intents')
    .insert({ ...input, created_by: input.created_by ?? userId ?? undefined })
    .select()
    .single()
  if (error) throw error
  return data as Intent
}

export async function updateIntent(id: string, updates: IntentUpdate): Promise<Intent> {
  const { data, error } = await supabase
    .from('intents')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Intent
}

export async function deleteIntent(id: string): Promise<void> {
  const { error } = await supabase.from('intents').delete().eq('id', id)
  if (error) throw error
}

// Bindings — Intent ↔ Domain/Object/Element with relationship_type ────

export async function addIntentBinding(input: IntentBindingInsert): Promise<IntentBinding> {
  const { data, error } = await supabase
    .from('intent_bindings')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data as IntentBinding
}

export async function removeIntentBinding(id: string): Promise<void> {
  const { error } = await supabase.from('intent_bindings').delete().eq('id', id)
  if (error) throw error
}

// Predictions — anonymous vote (archive + insert) ─────────────────────
//
// Voter identity is hashed at the call site so even RLS-bypassing
// service roles can't deanonymize. Per-intent uniqueness on the active
// row enforces "one open vote per voter"; superseded votes stay around
// for the trend chart with archived_at set.

export async function castIntentPrediction(args: {
  intentId: string
  voterHash: string
  probability: number
  roleGroup?: IntentPrediction['role_group']
  officialReport?: number | null
}): Promise<IntentPrediction> {
  // Archive any active row for this voter on this intent first. We can't
  // rely on ON CONFLICT because the unique index is partial (archived_at
  // IS NULL), so the upsert path doesn't see prior rows.
  await supabase
    .from('intent_predictions')
    .update({ archived_at: new Date().toISOString() })
    .eq('intent_id', args.intentId)
    .eq('voter_hash', args.voterHash)
    .is('archived_at', null)

  const { data, error } = await supabase
    .from('intent_predictions')
    .insert({
      intent_id: args.intentId,
      voter_hash: args.voterHash,
      probability: args.probability,
      role_group: args.roleGroup ?? null,
      official_report: args.officialReport ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as IntentPrediction
}

// Lineage — manual entries (LLM-summarized ones land via Edge Function) ─

export async function addIntentLineage(input: Omit<IntentLineage, 'id' | 'created_at' | 'created_by'>): Promise<IntentLineage> {
  const userId = await getCurrentUserId()
  const { data, error } = await supabase
    .from('intent_lineage')
    .insert({ ...input, created_by: userId ?? null })
    .select()
    .single()
  if (error) throw error
  return data as IntentLineage
}

// Escalation decisions — CEO picks Maintain / Revise / Retire ─────────

export async function decideIntentEscalation(
  id: string,
  status: Exclude<IntentEscalationStatus, 'awaiting'>,
  decisionNote: string | null = null,
): Promise<IntentEscalation> {
  const userId = await getCurrentUserId()
  const { data, error } = await supabase
    .from('intent_escalations')
    .update({
      status,
      decision_note: decisionNote,
      decided_at: new Date().toISOString(),
      decided_by: userId ?? null,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as IntentEscalation
}

// Next Actions — accept / reject / convert to Element ─────────────────

export async function updateIntentNextActionStatus(
  id: string,
  status: IntentNextActionStatus,
  convertedElementId?: string | null,
): Promise<IntentNextAction> {
  const { data, error } = await supabase
    .from('intent_next_actions')
    .update({ status, ...(convertedElementId !== undefined ? { converted_element_id: convertedElementId } : {}) })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as IntentNextAction
}

// ============================================
// Object Milestones — ◇ markers on the Timeline
// ============================================

/** Bulk-fetch milestones for a set of Objects. Used by the Strategy
 *  Timeline view to render diamonds above each Object's band. */
export async function fetchObjectMilestones(objectIds: string[]): Promise<ObjectMilestone[]> {
  return await selectIn(
    objectIds,
    chunk =>
      supabase
        .from('object_milestones')
        .select('*')
        .in('object_id', chunk)
        .order('date', { ascending: true }),
    { compare: (a, b) => ascNullsLast(a.date, b.date) },
  ) as ObjectMilestone[];
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

// =====================================================
// Data Tables (user-managed Notion-DB-like tables)
// =====================================================

// One row per (table, column, row) is heavy if we fetch each independently —
// the detail view hydrates table_columns + table_rows + table_cells in
// parallel, then stitches a `{ rowId → { columnId → value } }` map on the
// client. Schema CRUD is unsurprising: each public.<x> table maps to a hook
// that wraps a single supabase call with the type cast it deserves.

export interface DataTableWithRowCount extends DataTable {
  rowCount: number;
}

export function useDataTables() {
  const [data, setData] = useState<DataTableWithRowCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { data: tables, error: tErr } = await supabase
          .from('tables')
          .select('*')
          .order('order_index', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false });
        if (tErr) throw tErr;
        const tableRows = (tables || []) as DataTable[];
        // Row counts in one round-trip — group on table_id client-side. For
        // larger workloads this should move to a database view, but for the
        // typical "tens of tables" case it's cheaper than N queries.
        let counts: Record<string, number> = {};
        if (tableRows.length > 0) {
          const { data: rowIds, error: rErr } = await supabase
            .from('table_rows')
            .select('table_id')
            .in('table_id', tableRows.map((t) => t.id));
          if (rErr) throw rErr;
          for (const r of (rowIds || []) as { table_id: string }[]) {
            counts[r.table_id] = (counts[r.table_id] ?? 0) + 1;
          }
        }
        if (!cancelled) {
          setData(tableRows.map((t) => ({ ...t, rowCount: counts[t.id] ?? 0 })));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [tick]);

  return { data, loading, error, refetch: () => setTick((t) => t + 1) };
}

export async function createDataTable(input: DataTableInsert): Promise<DataTable> {
  // RLS requires created_by = auth.uid(). Stamp it automatically so callers
  // (and forms) don't have to thread the user id through.
  const creatorId = await getCurrentUserId();
  if (!creatorId) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('tables')
    .insert({ ...input, created_by: input.created_by ?? creatorId })
    .select()
    .single();
  if (error) throw error;
  return data as DataTable;
}

export async function updateDataTable(id: string, updates: DataTableUpdate): Promise<DataTable> {
  const { data, error } = await supabase
    .from('tables')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as DataTable;
}

export async function deleteDataTable(id: string): Promise<void> {
  const { error } = await supabase.from('tables').delete().eq('id', id);
  if (error) throw error;
}

// Schema + rows fetched together. The detail view almost always wants both.
export interface DataTableSchema {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  // cells indexed by row_id → column_id → value (JSON)
  cellsByRow: Record<string, Record<string, Json | null>>;
}

export async function fetchDataTableSchema(tableId: string): Promise<DataTableSchema> {
  const [colsRes, rowsRes] = await Promise.all([
    supabase
      .from('table_columns')
      .select('*')
      .eq('table_id', tableId)
      .order('order_index', { ascending: true }),
    supabase
      .from('table_rows')
      .select('*')
      .eq('table_id', tableId)
      .order('order_index', { ascending: true }),
  ]);
  if (colsRes.error) throw colsRes.error;
  if (rowsRes.error) throw rowsRes.error;
  const columns = (colsRes.data || []) as DataTableColumn[];
  const rows = (rowsRes.data || []) as DataTableRow[];
  const cellsByRow: Record<string, Record<string, Json | null>> = {};
  // Two separate limits meet here. The row_id list is a query-string budget,
  // so it is chunked; each chunk's response is capped at 1000 rows by
  // PostgREST, so it is paged through `.range()` until exhausted rather than
  // taking a silent truncation (300 rows × 8 columns is already 2400 cells).
  const CELL_PAGE = 1000;
  const cells = await selectIn(rows.map((r) => r.id), async chunk => {
    const page: DataTableCell[] = [];
    for (let from = 0; ; from += CELL_PAGE) {
      const { data, error } = await supabase
        .from('table_cells')
        .select('*')
        .in('row_id', chunk)
        .range(from, from + CELL_PAGE - 1);
      if (error) return { data: null, error };
      const got = (data || []) as DataTableCell[];
      page.push(...got);
      if (got.length < CELL_PAGE) break;
    }
    return { data: page, error: null };
  });
  for (const c of cells) {
    if (!cellsByRow[c.row_id]) cellsByRow[c.row_id] = {};
    cellsByRow[c.row_id][c.column_id] = c.value;
  }
  return { columns, rows, cellsByRow };
}

export async function addDataTableColumn(
  tableId: string,
  name: string,
  type: DataTableColumnType,
  orderIndex?: number,
): Promise<DataTableColumn> {
  // Auto-append at the end if no order_index is given so callers don't have to
  // compute the next slot themselves.
  let nextOrder = orderIndex;
  if (nextOrder == null) {
    const { data: tail } = await supabase
      .from('table_columns')
      .select('order_index')
      .eq('table_id', tableId)
      .order('order_index', { ascending: false })
      .limit(1);
    nextOrder = ((tail?.[0]?.order_index ?? -1) as number) + 1;
  }
  const { data, error } = await supabase
    .from('table_columns')
    .insert({ table_id: tableId, name, type, order_index: nextOrder })
    .select()
    .single();
  if (error) throw error;
  return data as DataTableColumn;
}

export async function addDataTableRow(tableId: string): Promise<DataTableRow> {
  const { data: tail } = await supabase
    .from('table_rows')
    .select('order_index')
    .eq('table_id', tableId)
    .order('order_index', { ascending: false })
    .limit(1);
  const nextOrder = ((tail?.[0]?.order_index ?? -1) as number) + 1;
  const { data, error } = await supabase
    .from('table_rows')
    .insert({ table_id: tableId, order_index: nextOrder })
    .select()
    .single();
  if (error) throw error;
  return data as DataTableRow;
}

export async function setDataTableCell(
  rowId: string,
  columnId: string,
  value: Json | null,
): Promise<void> {
  // upsert keyed on (row_id, column_id) so the editor doesn't care whether
  // the cell already existed.
  const { error } = await supabase
    .from('table_cells')
    .upsert({ row_id: rowId, column_id: columnId, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// Bulk-create a column set in one round-trip; used by CSV import to seed the
// schema before piping in rows. Preserves the caller's order via order_index.
export async function addDataTableColumns(
  tableId: string,
  defs: { name: string; type: DataTableColumnType }[],
  startOrder = 0,
): Promise<DataTableColumn[]> {
  if (defs.length === 0) return [];
  const rows = defs.map((d, i) => ({
    table_id: tableId,
    name: d.name,
    type: d.type,
    order_index: startOrder + i,
  }));
  const { data, error } = await supabase.from('table_columns').insert(rows).select();
  if (error) throw error;
  return (data || []) as DataTableColumn[];
}

// Bulk-create row records + their cells. Used by CSV import — `values` is one
// entry per row, each a record of columnId → cell value. Rows + cells go in
// two trips (rows must exist before cells can FK them); cells are chunked at
// 1000 inserts/round-trip to stay under the PostgREST default cap.
export async function bulkInsertDataTableRows(
  tableId: string,
  values: Record<string, Json | null>[],
  startOrder = 0,
): Promise<{ rows: DataTableRow[] }> {
  if (values.length === 0) return { rows: [] };
  const rowInserts = values.map((_, i) => ({ table_id: tableId, order_index: startOrder + i }));
  // Insert in 1000-row chunks too (defensive: PostgREST request body cap).
  const ROW_CHUNK = 1000;
  const createdRows: DataTableRow[] = [];
  for (let i = 0; i < rowInserts.length; i += ROW_CHUNK) {
    const slice = rowInserts.slice(i, i + ROW_CHUNK);
    const { data, error } = await supabase.from('table_rows').insert(slice).select();
    if (error) throw error;
    createdRows.push(...((data || []) as DataTableRow[]));
  }
  // Sort by order_index to align with the original `values` order — Supabase
  // doesn't guarantee returning rows in insert order across chunks.
  createdRows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

  const cellInserts: { row_id: string; column_id: string; value: Json | null }[] = [];
  for (let i = 0; i < createdRows.length; i++) {
    const row = createdRows[i];
    const vals = values[i] ?? {};
    for (const [columnId, val] of Object.entries(vals)) {
      cellInserts.push({ row_id: row.id, column_id: columnId, value: val });
    }
  }
  const CELL_CHUNK = 1000;
  for (let i = 0; i < cellInserts.length; i += CELL_CHUNK) {
    const chunk = cellInserts.slice(i, i + CELL_CHUNK);
    const { error } = await supabase.from('table_cells').insert(chunk);
    if (error) throw error;
  }
  return { rows: createdRows };
}

