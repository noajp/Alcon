'use client';

import { assembleStrategies } from '@/alcon/element/actions/campaignObjects';
import type { PhaseCloseWrite } from '@/alcon/phase/phaseClose';
import { selectIn } from '@/hooks/chunkedIn';
import { getQueryClient } from '@/lib/queryClient';
import { getCurrentUserId, supabase } from '@/lib/supabase';
import type {
  AlconObject,
  Element,
  ElementAssignee,
  ElementObject,
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
  Worker
} from '@/types/database';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

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

export {
  createWorker, deleteWorker, fetchAllWorkers, fetchWorkerAvailability, invalidateWorkersCache, updateWorker, useWorkerAvailability,
  useWorkerCommitments, useWorkers
} from '@/alcon/team/data';

export {
  addDomainElementType, addDomainObjectType, createDomain, deleteDomain, fetchLabelUsageByDomain, mergeDomainLabelColors, removeDomainElementType, reorderDomains, setDomainLabelColor, updateDomain, useDomains
} from '@/alcon/domain/data';

export {
  createActivitySpace, deleteActivitySpace, fetchSpaceGuests, updateActivitySpace, useActivitySpaces, type SpaceGuestRow
} from '@/alcon/space/data';

export {
  createDocument, deleteDocument, fetchDocuments, moveDocument, updateDocument, useDocuments
} from '@/alcon/brief/data';

export {
  addDataTableColumn, addDataTableColumns, addDataTableRow, bulkInsertDataTableRows, createDataTable, deleteDataTable, fetchDataTableSchema, setDataTableCell, updateDataTable, useDataTables, type DataTableSchema, type DataTableWithRowCount
} from '@/alcon/table/data';

export {
  archiveNotification, createNotification, fetchNotifications, markAllNotificationsRead, markNotificationRead, notifyMany, useNotifications
} from '@/alcon/element/notificationData';

export {
  createElementTemplate, deleteElementTemplate, updateElementTemplate, useElementTemplates
} from '@/alcon/element/templateData';

export {
  addReaction, CARRY_OVER_REASON_PREFIX, createElementComment, deleteElementComment, fetchCommentReactions, fetchElementComments, invalidateCarryOverReasons, removeReaction,
  toggleReaction, updateElementComment, useCarryOverReasons, useElementActivity, useElementComments, type CarryOverReason, type ElementActivity
} from '@/alcon/element/commentData';

export {
  globalSearch, type SearchResult
} from '@/alcon/shared/searchData';

export {
  cancelAgentRun, fetchAgentRunSteps, fetchLatestAgentRun, isAgentRunActive, pingAgentRuntime, startAgentRun, useAgentRun
} from '@/alcon/copilot/agentData';
