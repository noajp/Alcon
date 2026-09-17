'use client';

import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { getQueryClient } from '@/lib/queryClient';
import { retainChannel } from '@/hooks/sharedRealtime';
import {
  type ExplorerData,
  patchElementInExplorer,
  patchElementInList,
  insertElementIntoExplorer,
  removeElementFromExplorer,
  removeElementFromList,
  appendElementToList,
  upsertSubelementInExplorer,
  upsertSubelementInList,
  removeSubelementFromExplorer,
  removeSubelementFromList,
  upsertAssigneeInExplorer,
  upsertAssigneeInList,
  removeAssigneeFromExplorer,
  removeAssigneeFromList,
  patchWorkerInExplorer,
  patchWorkerInList,
  patchObjectInExplorer,
} from '@/Function/sync/explorerPatch';
import type {
  Element,
  ElementAssignee,
  ElementAssigneeWithWorker,
  ElementComment,
  ElementReaction,
  ElementWithDetails,
  StrategyComment,
  Subelement,
  Worker,
} from '@/types/database';

// One ingress for every change the server confirms.
//
// Every row that changes in a workspace-shaped table arrives here once, on
// one websocket channel, and is applied to the normalised caches as a delta:
// an Element UPDATE patches that Element wherever it is cached, a Subelement
// INSERT lands on its parent, a comment INSERT lands on its thread and bumps
// the rollup. Whoever wrote the row (this tab, another tab, a teammate, an
// agent, CI) takes the same path, so a surface is correct as long as it reads
// the cache — no per-surface subscription, no writer-side invalidation to
// forget. Where a delta changes membership rather than a row (multi-homing,
// edges, Property definitions) the affected keys are invalidated instead,
// still from this one place.
//
// Realtime delivers only rows the caller may see (RLS), and a DELETE carries
// only the primary key (REPLICA IDENTITY DEFAULT) — so removals search the
// caches for the id instead of trusting `old`.

const WORKSPACE_TABLES = [
  'elements', 'subelements', 'element_assignees', 'element_objects',
  'custom_column_values', 'custom_columns', 'custom_column_placements',
  'element_comments', 'element_reactions', 'element_edges', 'element_activity',
  'objects', 'workers', 'domains', 'worker_availability',
  'domain_members', 'object_members', 'activity_space_members', 'object_domains',
  'widget_boards', 'tables', 'table_columns', 'table_rows', 'table_cells',
  'strategies', 'strategy_objects', 'strategy_children', 'strategy_comments', 'portfolios',
  'phases', 'domain_approaches', 'approach_conditions', 'approach_contributions', 'approach_assessments', 'approach_reviews',
  'intents', 'intent_bindings', 'intent_lineage', 'intent_next_actions',
  'intent_escalations', 'intent_alignments', 'intent_audits', 'intent_predictions', 'intent_resources',
] as const;

export type WorkspaceTable = (typeof WORKSPACE_TABLES)[number];
export type DeltaType = 'INSERT' | 'UPDATE' | 'DELETE';
export interface Delta {
  table: WorkspaceTable;
  type: DeltaType;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}
export interface DeltaContext {
  userId: string | null;
  /** Resolve a Worker not present in any cache (one request). */
  loadWorker?: (id: string) => Promise<Worker | null>;
}

interface MyElementsData { elements: ElementWithDetails[]; workers: Worker[] }

// ---------- debounced invalidation (leading edge: always fires within `ms`) ----------
const pendingInvalidations = new WeakMap<QueryClient, Map<string, ReturnType<typeof setTimeout>>>();
function invalidateSoon(qc: QueryClient, queryKey: readonly unknown[], ms = 150): void {
  const pending = pendingInvalidations.get(qc) ?? new Map<string, ReturnType<typeof setTimeout>>();
  pendingInvalidations.set(qc, pending);
  const k = JSON.stringify(queryKey);
  if (pending.has(k)) return;
  pending.set(k, setTimeout(() => {
    pending.delete(k);
    void qc.invalidateQueries({ queryKey: queryKey as unknown[] });
  }, ms));
}

// ---------- cache accessors ----------
function forEachExplorer(qc: QueryClient, fn: (data: ExplorerData) => ExplorerData): void {
  for (const [key, data] of qc.getQueriesData<ExplorerData>({ queryKey: ['explorer'] })) {
    if (!data) continue;
    const next = fn(data);
    if (next !== data) qc.setQueryData(key, next);
  }
}
function forEachMyElements(qc: QueryClient, fn: (list: ElementWithDetails[]) => ElementWithDetails[]): void {
  for (const [key, data] of qc.getQueriesData<MyElementsData>({ queryKey: ['my-elements'] })) {
    if (!data) continue;
    const next = fn(data.elements);
    if (next !== data.elements) qc.setQueryData(key, { ...data, elements: next });
  }
}
function forEachList<T>(
  qc: QueryClient,
  match: { queryKey: readonly unknown[]; predicate?: (key: readonly unknown[]) => boolean },
  fn: (list: T[]) => T[],
): void {
  for (const [key, data] of qc.getQueriesData<T[]>({
    queryKey: match.queryKey as unknown[],
    predicate: match.predicate ? (q) => match.predicate!(q.queryKey) : undefined,
  })) {
    if (!data) continue;
    const next = fn(data);
    if (next !== data) qc.setQueryData(key, next);
  }
}
function findWorkerInCaches(qc: QueryClient, workerId: string): Worker | null {
  for (const [, data] of qc.getQueriesData<Worker[]>({ queryKey: ['workers'] })) {
    const w = data?.find((x) => x.id === workerId);
    if (w) return w;
  }
  for (const [, data] of qc.getQueriesData<MyElementsData>({ queryKey: ['my-elements'] })) {
    const w = data?.workers.find((x) => x.id === workerId);
    if (w) return w;
  }
  for (const [, data] of qc.getQueriesData<ExplorerData>({ queryKey: ['explorer'] })) {
    if (!data) continue;
    for (const list of [data.rootElements, ...data.objects.map((o) => o.elements ?? [])]) {
      for (const el of list) {
        const a = el.assignees?.find((x) => x.worker_id === workerId && x.worker);
        if (a?.worker) return a.worker;
      }
    }
  }
  return null;
}
function myWorkerIds(qc: QueryClient): Set<string> {
  const ids = new Set<string>();
  for (const [, data] of qc.getQueriesData<MyElementsData>({ queryKey: ['my-elements'] })) {
    for (const w of data?.workers ?? []) ids.add(w.id);
  }
  return ids;
}
const facetIs = (facet: string) => (key: readonly unknown[]) => key[0] === 'element' && key[2] === facet;

function enrich(row: Element): ElementWithDetails {
  return {
    ...row,
    subelements: [],
    assignees: [],
    objectIds: row.object_id ? [row.object_id] : [],
    isMultiHomed: false,
  } as ElementWithDetails;
}

// ---------- appliers ----------
export function applyWorkspaceDelta(qc: QueryClient, ctx: DeltaContext, d: Delta): void {
  const row = d.new as Record<string, unknown>;
  const id = (d.type === 'DELETE' ? d.old.id : row.id) as string | undefined;

  if (['elements', 'element_assignees', 'element_objects', 'objects', 'object_domains',
    'domains', 'workers', 'domain_members', 'object_members', 'activity_space_members'].includes(d.table)) {
    invalidateSoon(qc, ['team-roster']);
  }
  if (['domains', 'domain_members', 'activity_space_members'].includes(d.table)) {
    invalidateSoon(qc, ['sustainment-domains']);
  }
  if (['elements', 'element_assignees', 'element_objects'].includes(d.table)) {
    invalidateSoon(qc, ['worker-commitments']);
    invalidateSoon(qc, ['element-detail']);
  }

  if (['elements', 'element_assignees', 'element_objects', 'element_edges', 'objects',
    'workers', 'domains', 'worker_availability', 'strategies', 'strategy_objects',
    'strategy_children', 'object_domains'].includes(d.table)) {
    invalidateSoon(qc, ['decisionLab']);
  }

  if (['elements', 'element_assignees', 'element_objects', 'element_comments',
    'objects', 'workers', 'domains', 'worker_availability', 'strategy_objects'].includes(d.table)) {
    invalidateSoon(qc, ['initiativeRisk']);
  }

  if (['elements', 'subelements', 'element_assignees', 'element_objects', 'element_edges', 'objects',
    'workers', 'domains', 'object_domains', 'activity_space_members', 'domain_members', 'object_members'].includes(d.table)) {
    invalidateSoon(qc, ['nowWork']);
    invalidateSoon(qc, ['coordination-element']);
  }

  if (['elements', 'element_assignees', 'element_objects', 'objects', 'object_domains',
    'domains', 'strategies', 'strategy_objects', 'domain_members', 'object_members', 'activity_space_members'].includes(d.table)) {
    invalidateSoon(qc, ['domain-overview']);
    invalidateSoon(qc, ['initiative-domains']);
  }

  if (['domain_approaches', 'approach_conditions', 'approach_contributions', 'approach_assessments', 'approach_reviews',
    'domains', 'strategies', 'intents', 'objects', 'object_domains', 'domain_members', 'object_members', 'activity_space_members'].includes(d.table)) {
    invalidateSoon(qc, ['domain-approaches']);
    invalidateSoon(qc, ['approach-references']);
  }

  switch (d.table) {
    case 'elements': {
      if (!id) return;
      if (d.type === 'UPDATE') {
        const patch = row as unknown as Partial<Element>;
        forEachExplorer(qc, (data) => patchElementInExplorer(data, id, patch));
        forEachMyElements(qc, (list) => patchElementInList(list, id, patch));
        // An upstream flipping to done is what unblocks a row, and the
        // upstream is often outside the visible set — the blocker maps
        // can't tell from their own rows. (A DELETE-less UPDATE payload
        // carries every column, so which one moved isn't knowable here.)
        invalidateSoon(qc, ['element-blockers'], 300);
        return;
      }
      if (d.type === 'INSERT') {
        // owner_id and object_id are independent: a personal Element may
        // also be homed in an Object, so both lists can want it.
        const el = enrich(row as unknown as Element);
        if (el.owner_id === ctx.userId) forEachMyElements(qc, (list) => appendElementToList(list, el));
        if (el.object_id) forEachExplorer(qc, (data) => insertElementIntoExplorer(data, el));
        else if (!el.owner_id) invalidateSoon(qc, ['explorer']); // Domain-direct: which cache it belongs to is the server's call
        return;
      }
      forEachExplorer(qc, (data) => removeElementFromExplorer(data, id));
      forEachMyElements(qc, (list) => removeElementFromList(list, id));
      qc.removeQueries({ queryKey: ['element', id] });
      return;
    }

    case 'element_activity': {
      // Append-only; a DELETE carries only its id. A new row — a status the
      // trigger recorded for an agent, a note another client left — asks the
      // one Element's rail to look again. The key is elementActivity.ts's.
      const a = row as { element_id?: string };
      if (d.type === 'INSERT' && a.element_id) invalidateSoon(qc, ['elementActivity', a.element_id]);
      return;
    }

    case 'subelements': {
      if (!id) return;
      if (d.type === 'DELETE') {
        forEachExplorer(qc, (data) => removeSubelementFromExplorer(data, id));
        forEachMyElements(qc, (list) => removeSubelementFromList(list, id));
        return;
      }
      const sub = row as unknown as Subelement;
      forEachExplorer(qc, (data) => upsertSubelementInExplorer(data, sub));
      forEachMyElements(qc, (list) => upsertSubelementInList(list, sub));
      return;
    }

    case 'element_assignees': {
      if (!id) return;
      if (d.type === 'DELETE') {
        forEachExplorer(qc, (data) => removeAssigneeFromExplorer(data, id));
        forEachMyElements(qc, (list) => removeAssigneeFromList(list, id));
        // Losing my own assignment may drop the Element from My Elements.
        invalidateSoon(qc, ['my-elements']);
        return;
      }
      const a = row as unknown as ElementAssignee;
      const apply = (worker: Worker | null) => {
        const full: ElementAssigneeWithWorker = { ...a, worker: worker ?? undefined };
        forEachExplorer(qc, (data) => upsertAssigneeInExplorer(data, full));
        forEachMyElements(qc, (list) => upsertAssigneeInList(list, full));
      };
      const cached = findWorkerInCaches(qc, a.worker_id);
      if (cached || !ctx.loadWorker) apply(cached);
      else void ctx.loadWorker(a.worker_id).then(apply, () => apply(null));
      // Being assigned may add an Element to My Elements that isn't there yet.
      if (myWorkerIds(qc).has(a.worker_id)) invalidateSoon(qc, ['my-elements']);
      return;
    }

    case 'element_objects': {
      // Membership: which lists an Element appears in. Structural, so refetch
      // the tree; the Element's own facets that read homes go too.
      invalidateSoon(qc, ['explorer']);
      const elementId = (row.element_id ?? d.old.element_id) as string | undefined;
      if (elementId) invalidateSoon(qc, ['element', elementId]);
      else invalidateSoon(qc, ['element']);
      return;
    }

    case 'custom_column_values': {
      invalidateSoon(qc, ['custom-columns']);
      const elementId = (row.element_id ?? d.old.element_id) as string | undefined;
      if (elementId) invalidateSoon(qc, ['element', elementId, 'custom-columns']);
      else void qc.invalidateQueries({ predicate: (q) => facetIs('custom-columns')(q.queryKey) });
      return;
    }
    case 'custom_columns':
    case 'custom_column_placements': {
      invalidateSoon(qc, ['custom-columns']);
      void qc.invalidateQueries({ predicate: (q) => facetIs('custom-columns')(q.queryKey) });
      return;
    }

    case 'element_comments': {
      if (!id) return;
      if (d.type === 'DELETE') {
        forEachList<ElementComment>(qc, { queryKey: ['element'], predicate: facetIs('comments') }, (list) =>
          list.some((c) => c.id === id) ? list.filter((c) => c.id !== id) : list,
        );
        // The row is gone with only its id; the rollup can't be decremented
        // without knowing whose it was.
        invalidateSoon(qc, ['element-activity']);
        return;
      }
      const c = row as unknown as ElementComment;
      forEachList<ElementComment>(qc, { queryKey: ['element', c.element_id, 'comments'] }, (list) => {
        const at = list.findIndex((x) => x.id === c.id);
        if (at === -1) return d.type === 'INSERT' ? [...list, c] : list;
        return list.map((x, i) => (i === at ? { ...x, ...c } : x));
      });
      if (d.type === 'INSERT') {
        // Rollup: one more comment, newest timestamp — a new entry object so
        // the memoised row for this Element (and only it) re-renders.
        for (const [key, data] of qc.getQueriesData<Record<string, { commentCount: number; lastCommentAt: string }>>({ queryKey: ['element-activity'] })) {
          if (!data) continue;
          const ids = String(key[1] ?? '').split('\n');
          if (!ids.includes(c.element_id)) continue;
          const prev = data[c.element_id];
          qc.setQueryData(key, {
            ...data,
            [c.element_id]: {
              commentCount: (prev?.commentCount ?? 0) + 1,
              lastCommentAt: prev && prev.lastCommentAt > c.created_at ? prev.lastCommentAt : c.created_at,
            },
          });
        }
      }
      return;
    }

    case 'element_reactions': {
      if (!id) return;
      if (d.type === 'DELETE') {
        forEachList<ElementReaction>(qc, { queryKey: ['element'], predicate: facetIs('reactions') }, (list) =>
          list.some((r) => r.id === id) ? list.filter((r) => r.id !== id) : list,
        );
        return;
      }
      const r = row as unknown as ElementReaction;
      if (!r.element_id) return; // comment reactions are read per thread, not cached here
      forEachList<ElementReaction>(qc, { queryKey: ['element', r.element_id, 'reactions'] }, (list) =>
        list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r],
      );
      return;
    }

    case 'element_edges': {
      const from = (row.from_element ?? d.old.from_element) as string | undefined;
      const to = (row.to_element ?? d.old.to_element) as string | undefined;
      if (from) invalidateSoon(qc, ['element', from, 'edges']); 
      if (to) invalidateSoon(qc, ['element', to, 'edges']);
      if (!from && !to) void qc.invalidateQueries({ predicate: (q) => facetIs('edges')(q.queryKey) });
      invalidateSoon(qc, ['element-blockers'], 300);
      return;
    }

    case 'objects': {
      if (d.type === 'UPDATE' && id) {
        forEachExplorer(qc, (data) => patchObjectInExplorer(data, id, row as Record<string, unknown>));
        return;
      }
      invalidateSoon(qc, ['explorer']);
      invalidateSoon(qc, ['action-targets']);
      return;
    }

    case 'workers': {
      if (d.type === 'UPDATE' && id) {
        const patch = row as unknown as Partial<Worker>;
        forEachExplorer(qc, (data) => patchWorkerInExplorer(data, id, patch));
        forEachMyElements(qc, (list) => patchWorkerInList(list, id, patch));
      }
      invalidateSoon(qc, ['workers']);
      return;
    }

    case 'worker_availability':
      invalidateSoon(qc, ['worker-availability']);
      return;

    case 'domain_members':
    case 'object_members':
    case 'activity_space_members':
    case 'object_domains':
      invalidateSoon(qc, ['domains']);
      invalidateSoon(qc, ['my-space-ids']);
      invalidateSoon(qc, ['explorer']);
      return;

    case 'strategies':
    case 'strategy_objects':
    case 'strategy_children':
      invalidateSoon(qc, ['strategies']);
      return;

    case 'portfolios':
      invalidateSoon(qc, ['portfolios']);
      return;

    case 'strategy_comments': {
      if (!id) return;
      const strategyId = row.strategy_id as string | undefined;
      if (d.type === 'DELETE') {
        forEachList<StrategyComment>(qc, { queryKey: ['strategy-comments'] }, (list) =>
          list.some((c) => c.id === id) ? list.filter((c) => c.id !== id) : list,
        );
        return;
      }
      if (!strategyId) return;
      const c = row as unknown as StrategyComment;
      forEachList<StrategyComment>(qc, { queryKey: ['strategy-comments', strategyId] }, (list) => {
        const at = list.findIndex((x) => x.id === c.id);
        if (at === -1) return d.type === 'INSERT' ? [...list, c] : list;
        return list.map((x, i) => (i === at ? { ...x, ...c } : x));
      });
      return;
    }

    case 'widget_boards':
      invalidateSoon(qc, ['widget-board']);
      return;

    case 'tables':
    case 'table_columns':
    case 'table_rows':
    case 'table_cells':
      invalidateSoon(qc, ['widget-table-data']);
      invalidateSoon(qc, ['data-tables']);
      return;

    case 'phases':
      invalidateSoon(qc, ['phases']);
      return;

    case 'intents':
    case 'intent_bindings':
    case 'intent_lineage':
    case 'intent_next_actions':
    case 'intent_escalations':
    case 'intent_alignments':
    case 'intent_audits':
    case 'intent_predictions':
    case 'intent_resources':
      invalidateSoon(qc, ['strategy-intent-bundle']);
      invalidateSoon(qc, ['initiative-measures']);
      invalidateSoon(qc, ['intent-bindings']);
      return;
  }
}

// ---------- the channel ----------
// The builder runs once for the first subscriber (retainChannel), so the
// signed-in user's id is read from a module slot the hook keeps current.
let currentUserId: string | null = null;

async function loadWorker(id: string): Promise<Worker | null> {
  const { data } = await supabase.from('workers').select('*').eq('id', id).maybeSingle();
  return (data as Worker | null) ?? null;
}

// One channel per table. Realtime rejects a whole subscription when any of
// its postgres_changes filters names a table outside the publication, so a
// single fat channel would go dark for every table the moment one is missing
// (e.g. before the publication migration lands). Per-table channels are
// multiplexed over the one socket and fail alone.
function buildTableChannel(table: WorkspaceTable) {
  return (channel: RealtimeChannel): RealtimeChannel =>
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      applyWorkspaceDelta(getQueryClient(), { userId: currentUserId, loadWorker }, {
        table,
        type: payload.eventType as DeltaType,
        new: (payload.new ?? {}) as Record<string, unknown>,
        old: (payload.old ?? {}) as Record<string, unknown>,
      });
    });
}

// Dev-only handle for inspecting channel state from the browser console.
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  (window as unknown as { __alconSupabase?: typeof supabase }).__alconSupabase = supabase;
}

/** Mount once, at the app root, while signed in. */
export function useWorkspaceDeltaStream(userId: string | null): void {
  useEffect(() => { currentUserId = userId; }, [userId]);
  useEffect(() => {
    if (!userId) return;
    const releases = WORKSPACE_TABLES.map((table) => retainChannel(`workspace:${table}`, buildTableChannel(table)));
    return () => { for (const release of releases) release(); };
  }, [userId]);
}
