'use client';

import { DOMAINS_CHANGED_EVENT, notifyDomainsChanged } from '@/alcon/domain/domainsStore';
import { assembleStrategies } from '@/alcon/element/actions/campaignObjects';
import type { PhaseCloseWrite } from '@/alcon/phase/phaseClose';
import type { LoadElement } from '@/alcon/shared/assignmentLoad';
import { ACTIVE_SPACE_CHANGE_EVENT, getActiveSpaceId } from '@/alcon/space/activeSpaceStore';
import { selectIn } from '@/hooks/chunkedIn';
import { getQueryClient } from '@/lib/queryClient';
import { getCurrentUserId, supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type {
  ActivitySpace,
  ActivitySpaceInsert,
  ActivitySpaceUpdate,
  AgentRun,
  AgentRunStatus,
  AgentRunStep,
  AlconObject,
  DataTable,
  DataTableCell,
  DataTableColumn,
  DataTableColumnType,
  DataTableInsert,
  DataTableRow,
  DataTableUpdate,
  Document,
  DocumentInsert,
  DocumentUpdate,
  DocumentWithChildren,
  Domain,
  DomainInsert,
  DomainUpdate,
  Element,
  ElementAssignee,
  ElementComment,
  ElementCommentInsert,
  ElementCommentUpdate,
  ElementObject,
  ElementReaction,
  ElementReactionInsert,
  ElementTemplate,
  ElementTemplateInsert,
  ElementTemplateUpdate,
  ElementUpdate,
  ElementWithDetails,
  Intent,
  IntentAlignment,
  IntentAudit,
  IntentBinding,
  IntentBindingInsert,
  IntentEscalation,
  IntentEscalationStatus,
  IntentInsert,
  IntentLineage,
  IntentNextAction,
  IntentNextActionStatus,
  IntentPrediction,
  IntentResource,
  IntentUpdate,
  Json,
  Notification,
  NotificationInsert,
  ObjectMilestone,
  ObjectMilestoneInsert,
  ObjectMilestoneUpdate,
  Phase,
  PhaseInsert,
  PhaseStatus,
  PhaseUpdate,
  Strategy,
  StrategyChild,
  StrategyComment,
  StrategyCommentInsert,
  StrategyInsert,
  StrategyObject,
  StrategyUpdate,
  StrategyWithObjects,
  Subelement,
  Worker,
  WorkerAvailability,
  WorkerAvailabilityInsert
} from '@/types/database';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

export {
  invalidateElementDetail
} from '@/alcon/sync/explorerCache';
export type { ExplorerData } from '@/alcon/sync/explorerPatch';
export type {
  AgentRun, AgentRunStatus, AgentRunStep, AlconObject,
  AlconObjectWithChildren, ApprovalState, CustomColumn, CustomColumnType, CustomColumnValue,
  CustomColumnWithValues, DataTable, DataTableCell, DataTableColumn, DataTableColumnType, DataTableRow, Document,
  DocumentWithChildren, Domain, DomainAIConfig, DomainMember,
  DomainMemberInsert, DomainPrivacy, EdgeType, Element, ElementApproval, ElementAssignee,
  ElementAssigneeWithWorker, ElementComment, ElementEdge,
  ElementEdgeWithElement, ElementObject, ElementReaction, ElementWithDetails, Notification,
  NotificationKind, ObjectDomain, ObjectMember,
  ObjectMemberInsert, ObjectMilestone, ObjectTab,
  ObjectTabType, Phase, Strategy, StrategyComment,
  StrategyCommentInsert, StrategyObject, StrategyStatus, StrategyWithObjects, Subelement,
  Worker,
  WorkerAvailability,
  WorkerAvailabilityKind
} from '@/types/database';


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
  // Say so on failure — the cache keeps the last map (stale beats blank),
  // but a silent failure would let the chart lie with no trace.
  const rows = await fetchWorkerAvailability(ids).catch((e) => {
    console.error('Failed to fetch worker availability:', e);
    throw e;
  });
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
    // A roster change selects a new key; keep the previous map painted
    // until the new one lands rather than showing every worker absence-free.
    placeholderData: keepPreviousData,
    gcTime: 5 * 60_000,
  });
  const byWorker = query.data ?? EMPTY_AVAILABILITY;
  // Optimistic edits land in the cache so every reader of this roster moves.
  // Cancel any in-flight fetch first — its (pre-write) rows would otherwise
  // overwrite the edit when it resolved.
  const setByWorker = useCallback(
    (update: (prev: Record<string, WorkerAvailability[]>) => Record<string, WorkerAvailability[]>) => {
      void qc.cancelQueries({ queryKey: key });
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
    queryFn: () =>
      fetchWorkerCommitments(idsKey.split('\n')).catch((e) => {
        // Stale beats blank, but a silent failure would let the menu report
        // "fits fine" from a load it failed to read.
        console.error('Failed to fetch worker commitments:', e);
        throw e;
      }),
    enabled: !!idsKey,
    // A roster change selects a new key; keep the previous map until the
    // new one lands.
    placeholderData: keepPreviousData,
    gcTime: 5 * 60_000,
  });
  return query.data ?? EMPTY_COMMITMENTS;
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
const DOCUMENTS_QUERY_KEY = ['documents'] as const;
const EMPTY_DOCUMENTS: Document[] = [];
const EMPTY_DOCUMENT_TREE: DocumentWithChildren[] = [];

export function useDocuments() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: DOCUMENTS_QUERY_KEY, queryFn: fetchDocuments });
  const documents = query.data ?? EMPTY_DOCUMENTS;
  const documentTree = useMemo(
    () => (query.data ? buildDocumentTree(query.data) : EMPTY_DOCUMENT_TREE),
    [query.data],
  );
  const refetch = useCallback(async () => { await qc.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY }); }, [qc]);
  return {
    documents,
    documentTree,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
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

// ============================================
// Carry-over reasons — why THIS Element, not just how many times.
//
// carried_over_count answers "how many rounds" but not "why" (el_STR-019):
// the same ↺1 means "planned, this was always lower priority" for one Element
// and "unplanned, someone else's work spilled onto it" for another, and a
// Phase's own closing_note is one sentence for every unfinished Element at
// once. Rather than a new column or an intent_bindings-style structure (a
// carry reason isn't a Campaign-level decision — most are one line, and
// forcing every one through that heavier record would price most of them
// out), this reuses element_comments with a fixed, greppable prefix: the same
// "convention over schema" the friction board's own report format already
// relies on (▶/●/⬆/✔/■). PhaseCloseDialog writes it; this reads it back.
// ============================================

export const CARRY_OVER_REASON_PREFIX = '↺ Carried over — ';

const CARRY_OVER_REASONS_QUERY_PREFIX = ['carry-over-reasons'] as const;

/** Call after writing a carry-over reason comment. The query key is scoped to
 *  the element id *set* a given Phase view happens to be showing, which the
 *  writer (PhaseCloseDialog) has no way to predict — so this invalidates
 *  every such query rather than one, the same blunt-but-correct approach
 *  `invalidateDomains`/`invalidatePhases` already use for their own lists. */
export function invalidateCarryOverReasons(): void {
  void getQueryClient().invalidateQueries({ queryKey: CARRY_OVER_REASONS_QUERY_PREFIX });
}

export interface CarryOverReason {
  reason: string;
  createdAt: string;
}

async function fetchCarryOverReasons(elementIds: string[]): Promise<Map<string, CarryOverReason>> {
  const rows = await selectIn<{ element_id: string; content: string; created_at: string }>(
    elementIds,
    (chunk) =>
      supabase
        .from('element_comments')
        .select('element_id, content, created_at')
        .in('element_id', chunk)
        .ilike('content', `${CARRY_OVER_REASON_PREFIX}%`)
        .order('created_at', { ascending: false }),
  );
  // Chunk-ordered newest-first, and every row for one Element lands in the
  // same chunk (selectIn splits by id, not by row) — so the first row seen
  // per element_id is its latest reason.
  const byElement = new Map<string, CarryOverReason>();
  for (const row of rows) {
    if (byElement.has(row.element_id)) continue;
    byElement.set(row.element_id, { reason: row.content.slice(CARRY_OVER_REASON_PREFIX.length), createdAt: row.created_at });
  }
  return byElement;
}

const EMPTY_CARRY_OVER_REASONS = new Map<string, CarryOverReason>();

/** Latest recorded carry-over reason per Element id, for the ids given (pass
 *  only Elements with carried_over_count > 0 — nothing else will match). */
export function useCarryOverReasons(elementIds: string[]) {
  const key = [...elementIds].sort().join(',');
  const query = useQuery({
    queryKey: [...CARRY_OVER_REASONS_QUERY_PREFIX, key],
    queryFn: () => fetchCarryOverReasons(elementIds),
    enabled: elementIds.length > 0,
  });
  return query.data ?? EMPTY_CARRY_OVER_REASONS;
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
      // A background refetch (stale-on-mount, reconnect, row-hover prefetch)
      // resolving after this write would overwrite it — cancel it first.
      void qc.cancelQueries({ queryKey: key });
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
 * reference (lastActivityById), so a memoised row re-renders only when its
 * own thread actually moved. Kept current by alcon/sync/deltaStream (a
 * comment INSERT bumps the entry in place).
 */
const ELEMENT_ACTIVITY_QUERY_PREFIX = ['element-activity'] as const;
const EMPTY_ACTIVITY: Record<string, ElementActivity> = {};

// Last known entry per Element, shared across every id-set key. The query
// cache's structural sharing only compares a key with its own previous data,
// and the visible id set (filter, sort, create, delete) is part of the key —
// so without this, every visible-set change would hand memoised rows a fresh
// object for an unchanged rollup and re-render all of them.
const lastActivityById = new Map<string, ElementActivity>();

async function fetchElementActivity(ids: string[]): Promise<Record<string, ElementActivity>> {
  const { data: rows, error } = await supabase
    .rpc('get_element_activity', { p_element_ids: ids });
  if (error) throw error;
  const next: Record<string, ElementActivity> = {};
  type Row = { element_id: string; comment_count: number; last_comment_at: string };
  for (const r of (rows ?? []) as Row[]) {
    const count = Number(r.comment_count);
    const prev = lastActivityById.get(r.element_id);
    const entry =
      prev && prev.commentCount === count && prev.lastCommentAt === r.last_comment_at
        ? prev
        : { commentCount: count, lastCommentAt: r.last_comment_at };
    lastActivityById.set(r.element_id, entry);
    next[r.element_id] = entry;
  }
  return next;
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
    // flicker to blank. Unchanged entries keep their identity across keys
    // (see lastActivityById), so memoised rows skip re-rendering.
    placeholderData: keepPreviousData,
    // One entry per visible id set — don't let abandoned sets linger.
    gcTime: 5 * 60_000,
  });
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

const EMPTY_STRATEGIES: StrategyWithObjects[] = [];

export function useStrategies() {
  const query = useQuery({ queryKey: STRATEGIES_QUERY_KEY, queryFn: fetchStrategies });
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

const STRATEGY_COMMENTS_PREFIX = ['strategy-comments'] as const;
const NO_STRATEGY_COMMENTS: StrategyComment[] = [];

/**
 * One Campaign's thread, live. The realtime subscription is the point: the
 * comments that matter most here are written by agents over the API while
 * the Campaign sits open on screen, and a thread that only refreshes on
 * navigation would show a stale answer to a question just asked.
 */
export function useStrategyComments(strategyId: string | null) {
  const qc = useQueryClient();
  const key = useMemo(() => [...STRATEGY_COMMENTS_PREFIX, strategyId ?? ''] as const, [strategyId]);
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      fetchStrategyComments(strategyId!).catch((e) => {
        // The cache keeps whatever is on screen — a blank thread would read
        // as "nothing was ever said here" — but say so rather than failing
        // silently.
        console.error('Failed to load Campaign comments:', e);
        throw e;
      }),
    enabled: !!strategyId,
  });
  const reload = useCallback(() => { void qc.invalidateQueries({ queryKey: key }); }, [qc, key]);
  const setComments = useCallback(
    (update: StrategyComment[] | ((prev: StrategyComment[]) => StrategyComment[])) => {
      void qc.cancelQueries({ queryKey: key });
      qc.setQueryData<StrategyComment[]>(key, (prev) =>
        typeof update === 'function' ? update(prev ?? NO_STRATEGY_COMMENTS) : update,
      );
    },
    [qc, key],
  );
  return { comments: query.data ?? NO_STRATEGY_COMMENTS, reload, setComments };
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

const EMPTY_PHASES: Phase[] = [];

export function usePhases(domainId: string | null) {
  const query = useQuery({
    queryKey: [...PHASES_QUERY_PREFIX, domainId],
    queryFn: () => fetchPhases(domainId!),
    enabled: !!domainId,
  });
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
const emptyIntentBundle = (): IntentBundle => ({
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

async function fetchStrategyIntentBundle(strategyId: string): Promise<IntentBundle> {
  // 1) Pull every Intent under this Strategy.
  const { data: intentRows, error: iErr } = await supabase
    .from('intents')
    .select('*')
    .eq('strategy_id', strategyId)
    .order('order_index', { ascending: true })
  if (iErr) throw iErr
  const allIntents = (intentRows || []) as Intent[]
  const intentIds = allIntents.map((i) => i.id)
  if (intentIds.length === 0) return emptyIntentBundle()

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
  const master = allIntents.find((i) => i.parent_intent_id === null) ?? null
  return {
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
  }
}

export function useStrategyIntentBundle(strategyId: string | null) {
  const qc = useQueryClient()
  const key = useMemo(() => ['strategy-intent-bundle', strategyId ?? ''] as const, [strategyId])
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchStrategyIntentBundle(strategyId!),
    enabled: !!strategyId,
  })
  const refetch = useCallback(() => { void qc.invalidateQueries({ queryKey: key }) }, [qc, key])
  return {
    data: strategyId ? (query.data ?? null) : null,
    loading: !!strategyId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  }
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

const OBJECT_MILESTONES_QUERY_PREFIX = ['object-milestones'] as const;
const EMPTY_MILESTONES: ObjectMilestone[] = [];

/** Read-only milestones for a set of Objects, e.g. the Gantt's diamond
 *  markers. Keyed on the sorted id set (not the array reference) so passing
 *  a freshly-mapped array every render still hits the same cache entry. */
export function useObjectMilestones(objectIds: string[]) {
  const key = [...objectIds].sort().join(',');
  const query = useQuery({
    queryKey: [...OBJECT_MILESTONES_QUERY_PREFIX, key],
    queryFn: () => fetchObjectMilestones(objectIds),
    enabled: objectIds.length > 0,
  });
  return {
    data: query.data ?? EMPTY_MILESTONES,
    loading: objectIds.length > 0 && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
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

async function fetchDataTablesWithCounts(): Promise<DataTableWithRowCount[]> {
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
  const counts: Record<string, number> = {};
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
  return tableRows.map((t) => ({ ...t, rowCount: counts[t.id] ?? 0 }));
}

const DATA_TABLES_QUERY_KEY = ['data-tables'] as const;
const EMPTY_DATA_TABLES: DataTableWithRowCount[] = [];

export function useDataTables() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: DATA_TABLES_QUERY_KEY, queryFn: fetchDataTablesWithCounts });
  const refetch = useCallback(() => { void qc.invalidateQueries({ queryKey: DATA_TABLES_QUERY_KEY }); }, [qc]);
  return {
    data: query.data ?? EMPTY_DATA_TABLES,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
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

export {
  useObjects
} from '@/alcon/sync/explorerData';

export {
  createObject, createObjectTab, deleteObject, deleteObjectTab, fetchObjectDomainIds, fetchObjectLabels, fetchObjectTabs, moveObject, renameObjectPrefix, reorderObjects, reorderObjectTabs, setObjectDomains, updateObject, updateObjectTab, useObjectTabs
} from '@/alcon/object/data';

export {
  addElementAssignee, addElementToObject, canElementStart, createElement, createElementEdge, createSubelement, decideApproval, deleteElement, deleteElementEdge, deleteSubelement, fetchElementApprovals, fetchElementWithDetails, getElementAssignees, getElementEdges, getElementObjects, removeElementAssignee, removeElementFromObject, reorderElements, setElementIsApproval, toggleSubelementComplete, updateElement, updateSubelement, useElementBlockers
} from '@/alcon/element/data';

export {
  createCustomColumn, deleteCustomColumn, deleteCustomColumnObjectValue, deleteCustomColumnValue, deleteIntersection,
  fetchCustomColumns,
  fetchCustomColumnsWithValues, fetchDomainCustomColumnsWithValues, fetchElementCustomColumnsWithValues, getIntersections, reorderCustomColumns, setCustomColumnObjectValue, setCustomColumnValue, updateCustomColumn, upsertIntersection
} from '@/alcon/property/data';
