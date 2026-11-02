'use client';

import { assembleStrategies } from '@/hooks/initiativeObjects';
import { selectIn } from '@/hooks/chunkedIn';
import { getQueryClient } from '@/lib/queryClient';
import { getCurrentUserId, supabase } from '@/lib/supabase';
import type {
  AlconObject,
  Element,
  ElementAssignee,
  ElementObject,
  ElementWithDetails,
  Intent,
  IntentAlignment,
  IntentAudit,
  IntentBinding,
  IntentBindingInsert,
  IntentEscalation,
  IntentInsert,
  IntentLineage,
  IntentNextAction,
  IntentPrediction,
  IntentResource,
  IntentUpdate,
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
} from '@/types/database';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { onlyActiveObjects } from '@/Function/shared/objectArchive';
import { getActiveSpaceId, useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useActivitySpaces } from '@/Function/space/data';
import { showsInSpace } from '@/Function/strategy/initiativeAccess';

// ============================================
// Strategy: aggregate elements across multiple Domains and/or Objects
// Pulls everything via the multi-homing junctions so a multi-homed Element
// only shows up once even if multiple selected Objects own it.
// ============================================

// PostgREST's ascending `.order(col)` puts nulls last. Chunked fetches
// reassemble the order in JS, so the rule lives here too. ISO dates compare
// lexicographically, which is what the date columns hold.
export function ascNullsLast(a: string | number | null, b: string | number | null): number {
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

  // Archived Objects leave the scope, and with them the Elements that live
  // only in archived Objects.
  const objectsData = await selectIn(Array.from(objectScope), chunk =>
    onlyActiveObjects(supabase.from('objects').select('*').in('id', chunk)),
  ) as AlconObject[];
  if (objectsData.length === 0) return { elements: [], objects: [] };
  const objectIdsArr = objectsData.map(o => o.id);

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

  if (elementIdSet.size === 0) return { elements: [], objects: objectsData };

  const elementIdsArr = Array.from(elementIdSet);

  // 3. Fetch elements + subelements + assignees + workers in parallel.
  //    start_date orders the whole set, so it is re-applied across chunks:
  //    ascending with the undated last, the way PostgREST hands it back.
  const [elementsData, subs, assignees, junctions] = await Promise.all([
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

/** The Initiatives a Space-wide list shows: useStrategies without those of
 *  the viewer's other Spaces (showsInSpace). Lookups by id or by Object use
 *  useStrategies, so an Object still shows an Initiative of another Space. */
export function useStrategiesInSpace() {
  const strategies = useStrategies();
  const activeSpaceId = useActiveSpaceId();
  const { data: spaces, loading: spacesLoading } = useActivitySpaces();
  const data = useMemo(() => {
    if (spacesLoading) return strategies.data;
    const mine = spaces.map((space) => space.id);
    const shown = strategies.data.filter((s) => showsInSpace(s, activeSpaceId, mine));
    return shown.length === strategies.data.length ? strategies.data : shown;
  }, [strategies.data, activeSpaceId, spaces, spacesLoading]);
  return { ...strategies, data };
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
    // The Space it is created in; a Portfolio or Vision overrides it (DB trigger).
    .insert({ ...input, created_by: input.created_by ?? creatorId, activity_space_id: input.activity_space_id ?? getActiveSpaceId() })
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
  // RLS lets only the creator delete, and a refused delete matches no rows
  // rather than erroring — ask for the ids so the refusal is visible.
  const { data, error } = await supabase.from('strategies').delete().eq('id', id).select('id');
  if (error) {
    // domain_approaches.strategy_id is ON DELETE RESTRICT.
    if (error.code === '23503') throw new Error('A Domain approach still points at this Initiative — remove it first.');
    throw error;
  }
  if (!data?.length) throw new Error("Only the Initiative's owner can delete it.");
  invalidateStrategies();
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
// Strategies as children, DAG so multi-parent is allowed). The DB refuses
// any edge that would close a cycle (23514); the picker also hides the
// current Strategy's ancestors so that is rarely reached.
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
// Initiative comments — the Strategy layer's thread
// ============================================
//
// Same shape as element comments, and deliberately the same call signatures,
// so the two threads stay one concept with two homes. Delivery to the Inbox
// is a database trigger (notify_strategy_comment), not a call from here — a
// comment written over the API has to notify too, and that is the only place
// both paths pass through.

async function fetchStrategyComments(strategyId: string): Promise<StrategyComment[]> {
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
 * One Initiative's thread, live. The realtime subscription is the point: the
 * comments that matter most here are written by agents over the API while
 * the Initiative sits open on screen, and a thread that only refreshes on
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
        console.error('Failed to load Initiative comments:', e);
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
 * reads a Initiative's edges outward; this reads an Element's (or an Object's,
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
  const { error } = await supabase.from('intents').delete().eq('id', id).select('id').single()
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
