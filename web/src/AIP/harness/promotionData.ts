'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PromotionBinding, PromotionDraft, PromotionDraftEvent, PromotionDraftStatus } from '@/types/database';

// Promotion drafts: the records of one-off work becoming standing
// harnesses. Members read every draft (a draft holds no secret, ever);
// the decisions are the owner's, and they go through the RPCs — the
// only route by which a definition or an Automation is born from a
// draft. The drafting itself is driven from the Memory candidates and
// the run screens (PR5), which share the creation helper here.

const PROMOTION_OPEN_STATUSES: PromotionDraftStatus[] = ['drafting', 'awaiting_input', 'rehearsing', 'awaiting_review'];

/** The open-draft caps (§4.10), mirroring _shared/promotion.ts. */
const MAX_OPEN_PROMOTION_DRAFTS_PER_SPACE = 10;
const MAX_OPEN_PROMOTION_DRAFTS_PER_REQUESTER = 5;

const DRAFT_COLUMNS = 'id, activity_space_id, status, source_kind, source_memory_id, source_run_id, target_definition_id, requester_id, name, body, binding, base_definition_hash, tested_structure_hash, tested_binding_hash, draft_run_id, rehearsal_run_id, rehearsal_report, failure_class, awaiting_question, material_sources, activated_definition_id, activated_automation_id, activated_body, activated_structure_hash, activated_binding_hash, decided_by, decided_at, events, expires_at, created_by, created_at, updated_at';

const draftsKey = (spaceId: string | null) => ['promotion-drafts', spaceId] as const;

async function fetchDrafts(spaceId: string): Promise<PromotionDraft[]> {
  const { data, error } = await supabase
    .from('promotion_drafts')
    .select(DRAFT_COLUMNS)
    .eq('activity_space_id', spaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PromotionDraft[];
}

const EMPTY: PromotionDraft[] = [];

export function usePromotionDrafts(spaceId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: draftsKey(spaceId),
    queryFn: () => fetchDrafts(spaceId!),
    enabled: !!spaceId,
    staleTime: 10_000,
    // An open draft is being worked on by its run; keep the list fresh.
    refetchInterval: (q) => ((q.state.data as PromotionDraft[] | undefined)
      ?.some((d) => PROMOTION_OPEN_STATUSES.includes(d.status)) ? 5000 : false),
  });
  return {
    data: query.data ?? EMPTY,
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: () => qc.invalidateQueries({ queryKey: draftsKey(spaceId) }),
  };
}

/** The Space's Object names, for binding display (id → name). */
export function usePromotionObjectNames(spaceId: string | null) {
  const query = useQuery({
    queryKey: ['promotion-object-names', spaceId] as const,
    enabled: !!spaceId,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data: doms } = await supabase.from('domains').select('id').eq('activity_space_id', spaceId!);
      const ids = ((doms ?? []) as { id: string }[]).map((d) => d.id);
      if (!ids.length) return new Map();
      const { data } = await supabase.from('objects').select('id, name').in('domain_id', ids).is('archived_at', null);
      return new Map(((data ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
    },
    staleTime: 30_000,
  });
  return query.data ?? new Map<string, string>();
}

/** Creates a draft and its drafting run, then starts the run. The
 *  creation routes (a Memory candidate, a finished run, a conversation's
 *  start_promotion — the engine-side twin of this shape) all make the
 *  same two records; only the owner's activation ever makes more. On
 *  the one-open-draft conflict the existing open draft is returned —
 *  reconcile rule 1: join, never duplicate. */
export async function createPromotionDraft(args: {
  spaceId: string;
  source: { kind: 'memory'; memoryId: string } | { kind: 'run'; runId: string };
  targetDefinitionId?: string | null;
}): Promise<PromotionDraft> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Not signed in');
  const { data: open } = await supabase.from('promotion_drafts')
    .select(DRAFT_COLUMNS)
    .eq('activity_space_id', args.spaceId)
    .in('status', [...PROMOTION_OPEN_STATUSES]);
  const rows = (open ?? []) as unknown as PromotionDraft[];
  const sameSource = rows.find((d) => args.source.kind === 'memory'
    ? d.source_memory_id === args.source.memoryId
    : d.source_run_id === args.source.runId);
  if (sameSource) return sameSource;
  if (rows.length >= MAX_OPEN_PROMOTION_DRAFTS_PER_SPACE) {
    throw new Error('この Space の昇格ドラフトが上限に達しています');
  }
  if (rows.filter((d) => d.requester_id === userId).length >= MAX_OPEN_PROMOTION_DRAFTS_PER_REQUESTER) {
    throw new Error('あなたの昇格ドラフトが上限に達しています');
  }
  const { data: draft, error } = await supabase.from('promotion_drafts').insert({
    activity_space_id: args.spaceId,
    source_kind: args.source.kind,
    source_memory_id: args.source.kind === 'memory' ? args.source.memoryId : null,
    source_run_id: args.source.kind === 'run' ? args.source.runId : null,
    target_definition_id: args.targetDefinitionId ?? null,
    status: 'drafting',
    created_by: userId,
    requester_id: userId,
  }).select(DRAFT_COLUMNS).single();
  if (error || !draft) {
    // A unique-index race: join the draft that won.
    const { data: again } = await supabase.from('promotion_drafts')
      .select(DRAFT_COLUMNS)
      .eq('activity_space_id', args.spaceId)
      .in('status', [...PROMOTION_OPEN_STATUSES]);
    const winner = ((again ?? []) as unknown as PromotionDraft[]).find((d) => args.source.kind === 'memory'
      ? d.source_memory_id === args.source.memoryId
      : d.source_run_id === args.source.runId);
    if (winner) return winner;
    throw new Error(error?.message ?? '下書きを作れませんでした');
  }
  const made = draft as unknown as PromotionDraft;
  const { data: run, error: runError } = await supabase.from('agent_runs').insert({
    promotion_draft_id: made.id,
    activity_space_id: args.spaceId,
    triggered_by: userId,
    triggered_from: args.source.kind === 'memory' ? 'memory_settings' : 'run_screen',
    mode: 'promote',
    status: 'queued',
  }).select('id').single();
  if (runError || !run) throw new Error(runError?.message ?? '起草の実行を作れませんでした');
  await startPromotionRun((run as { id: string }).id);
  return made;
}

/** Pure. The binding an update draft carries (Automation builder
 *  design §5.4): the automation's Object and templates, and NO
 *  trigger — activation then updates the definition in place and
 *  creates no second automation; the existing row keeps firing, now
 *  on the new body. */
export function builderUpdateBindingOf(args: {
  objectId: string | null;
  titleTemplate?: string | null;
  descriptionTemplate?: string | null;
}): PromotionBinding {
  return {
    objectId: args.objectId,
    titleTemplate: args.titleTemplate ?? '',
    descriptionTemplate: args.descriptionTemplate ?? '',
    trigger: null,
  };
}

/** Pure. A builder draft's insert row: the seed (name, body,
 *  binding) written at insert, under the 'builder' source kind —
 *  a draft with no memory or run behind it. The drafts INSERT policy
 *  checks membership, authorship and the drafting status, not the
 *  column set, and the table grant is table-wide, so the seed lands
 *  with the row (the design's §5.4 fallback is implemented in
 *  createBuilderDraft regardless). */
export function builderDraftInsertOf(args: {
  spaceId: string;
  userId: string;
  targetDefinitionId?: string | null;
  seedName: string;
  seedBody: string;
  binding: PromotionBinding;
}) {
  return {
    activity_space_id: args.spaceId,
    source_kind: 'builder' as const,
    source_memory_id: null,
    source_run_id: null,
    target_definition_id: args.targetDefinitionId ?? null,
    status: 'drafting' as const,
    created_by: args.userId,
    requester_id: args.userId,
    name: args.seedName,
    body: args.seedBody,
    binding: args.binding,
  };
}

/** Pure. The skeleton body a new builder draft starts from: the
 *  sections the zone picks fill, in the grammar's canonical order,
 *  with the one line the promotion gate requires of any promoted
 *  definition — a numeric cost ceiling in the stop conditions. The
 *  drafting driver drafts around this seed; the person's own picks
 *  in the builder are already inside it. */
export function builderSeedBodyOf(name: string): string {
  return [
    '# 目的', name, '',
    '# 進め方', '',
    '# 点検', '',
    '# 止める条件', '- 費用 $2 まで', '',
    '# 成果物の型', '',
    '# 使うコネクタ', '',
    '# 入力', '',
  ].join('\n');
}

/** The Automation builder's door into promotion (design §5.4): a
 *  draft seeded from the zone picks — for a new automation, a fresh
 *  definition whose binding carries the trigger; for a live
 *  automation's body edit, an update draft against its definition
 *  (target_definition_id, trigger-less binding). Like the other
 *  creation routes it makes the draft and its drafting run and
 *  starts the run: the driver drafts around the seed, and takes a
 *  hand-edited body verbatim when it freezes the package, so builder
 *  edits made while drafting are picked up, not overwritten. An open
 *  draft already targeting the same definition is joined, never
 *  rivalled (the one-open-draft-per-target rule). The draft's base
 *  snapshot is pinned by the driver from the target, exactly as for
 *  the other sources. */
export async function createBuilderDraft(spaceId: string, seed: {
  targetDefinitionId?: string | null;
  seedName: string;
  seedBody: string;
  binding: PromotionBinding;
}): Promise<PromotionDraft> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Not signed in');
  const { data: open } = await supabase.from('promotion_drafts')
    .select(DRAFT_COLUMNS)
    .eq('activity_space_id', spaceId)
    .in('status', [...PROMOTION_OPEN_STATUSES]);
  const rows = (open ?? []) as unknown as PromotionDraft[];
  if (seed.targetDefinitionId) {
    const sameTarget = rows.find((d) => d.target_definition_id === seed.targetDefinitionId);
    if (sameTarget) return sameTarget;
  }
  if (rows.length >= MAX_OPEN_PROMOTION_DRAFTS_PER_SPACE) {
    throw new Error('この Space の昇格ドラフトが上限に達しています');
  }
  if (rows.filter((d) => d.requester_id === userId).length >= MAX_OPEN_PROMOTION_DRAFTS_PER_REQUESTER) {
    throw new Error('あなたの昇格ドラフトが上限に達しています');
  }
  const insert = builderDraftInsertOf({ spaceId, userId, ...seed });
  const { data: draft, error } = await supabase.from('promotion_drafts').insert(insert)
    .select(DRAFT_COLUMNS).single();
  let made = (draft ?? null) as unknown as PromotionDraft | null;
  if (error || !made) {
    // A unique-index race on the target: join the draft that won.
    if (seed.targetDefinitionId) {
      const { data: again } = await supabase.from('promotion_drafts')
        .select(DRAFT_COLUMNS)
        .eq('activity_space_id', spaceId)
        .in('status', [...PROMOTION_OPEN_STATUSES]);
      const winner = ((again ?? []) as unknown as PromotionDraft[]).find(
        (d) => d.target_definition_id === seed.targetDefinitionId,
      );
      if (winner) return winner;
    }
    if (!error) throw new Error('下書きを作れませんでした');
    // The design's §5.4 fallback: if the seeded insert is refused
    // (a narrowed INSERT policy on some database), land the seed
    // through the drafting-stage revision write right after a bare
    // insert — the same net state, through the sanctioned write.
    const { data: bare, error: bareError } = await supabase.from('promotion_drafts').insert({
      activity_space_id: spaceId,
      source_kind: 'builder',
      target_definition_id: seed.targetDefinitionId ?? null,
      status: 'drafting',
      created_by: userId,
      requester_id: userId,
    }).select(DRAFT_COLUMNS).single();
    if (bareError || !bare) throw new Error(bareError?.message ?? '下書きを作れませんでした');
    made = bare as unknown as PromotionDraft;
    await reviseDraftBody(made, seed.seedBody);
    const { data: seeded, error: seedError } = await supabase.from('promotion_drafts').update({
      name: seed.seedName, binding: seed.binding, updated_at: new Date().toISOString(),
    }).eq('id', made.id).eq('status', 'drafting').select(DRAFT_COLUMNS).single();
    if (seedError || !seeded) throw new Error(seedError?.message ?? '下書きに種を置けませんでした');
    made = seeded as unknown as PromotionDraft;
  }
  const { data: run, error: runError } = await supabase.from('agent_runs').insert({
    promotion_draft_id: made.id,
    activity_space_id: spaceId,
    triggered_by: userId,
    triggered_from: 'automation_builder',
    mode: 'promote',
    status: 'queued',
  }).select('id').single();
  if (runError || !run) throw new Error(runError?.message ?? '起草の実行を作れませんでした');
  await startPromotionRun((run as { id: string }).id);
  return made;
}

/** The run-screen door (source B): a finished run someone points at
 *  and says "make this standing". The Space comes from the run's
 *  Domain — the record the audit panel itself shows has no Space
 *  column, and the Domain is its home. */
export async function createPromotionDraftFromRun(runId: string, domainId: string): Promise<PromotionDraft> {
  const { data: dom, error } = await supabase.from('domains')
    .select('activity_space_id').eq('id', domainId).maybeSingle();
  if (error || !dom) throw new Error(error?.message ?? 'この実行の置き場が分かりませんでした');
  const spaceId = (dom as { activity_space_id: string }).activity_space_id;
  return createPromotionDraft({ spaceId, source: { kind: 'run', runId } });
}

export interface PromotionRun {
  id: string;
  status: string;
  summary: string | null;
  error: string | null;
}

export interface PromotionStepRow { id: string; type: string; title: string; detail: string | null }

/** One draft, its drafting run and the run's steps (the audit trail the
 *  review shows). Polls while the run is working. */
export function usePromotionDraftDetail(draft: PromotionDraft | null) {
  const runId = draft?.draft_run_id ?? null;
  const query = useQuery({
    queryKey: ['promotion-draft-detail', draft?.id, runId] as const,
    enabled: !!draft,
    queryFn: async (): Promise<{ run: PromotionRun | null; steps: PromotionStepRow[] }> => {
      if (!runId) return { run: null, steps: [] };
      const [{ data: run }, { data: steps }] = await Promise.all([
        supabase.from('agent_runs').select('id, status, summary, error').eq('id', runId).maybeSingle(),
        supabase.from('agent_run_steps').select('id, type, title, detail').eq('run_id', runId).order('idx', { ascending: true }),
      ]);
      return { run: (run as PromotionRun | null) ?? null, steps: (steps ?? []) as PromotionStepRow[] };
    },
    refetchInterval: (q) => {
      const run = (q.state.data as { run: PromotionRun | null } | undefined)?.run;
      return run && (run.status === 'queued' || run.status === 'running') ? 1500 : false;
    },
  });
  return { run: query.data?.run ?? null, steps: query.data?.steps ?? [], loading: query.isPending && !!draft };
}

/** An Edge Function error with the function's own `error` message when it sent one. */
async function functionError(error: Error): Promise<Error> {
  let message = error.message;
  if ('context' in error && error.context instanceof Response) {
    try { message = (await error.context.json()).error ?? message; } catch { /* keep the transport error */ }
  }
  return new Error(message);
}

/** Sends words to a draft's run (an answer, or "fix this"); the run's
 *  starter is the only one the engine accepts them from. */
export async function sendPromotionMessage(runId: string, message: string): Promise<void> {
  const { error } = await supabase.functions.invoke('run-agent', { body: { runId, message } });
  if (error) throw await functionError(error);
}

/** Starts a promotion run without words (its opening carries the source). */
async function startPromotionRun(runId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('run-agent', { body: { runId } });
  if (error) throw await functionError(error);
}
export function usePromotionDraft(draftId: string | null) {
  const query = useQuery({
    queryKey: ['promotion-draft', draftId] as const,
    enabled: !!draftId,
    queryFn: async (): Promise<PromotionDraft | null> => {
      const { data, error } = await supabase
        .from('promotion_drafts').select(DRAFT_COLUMNS).eq('id', draftId!).maybeSingle();
      if (error) throw error;
      return (data as unknown as PromotionDraft | null) ?? null;
    },
    staleTime: 5_000,
    refetchInterval: (q) => {
      const d = q.state.data as PromotionDraft | null | undefined;
      return d && PROMOTION_OPEN_STATUSES.includes(d.status) ? 5000 : false;
    },
  });
  return { data: query.data ?? null, loading: query.isPending && !!draftId };
}

/** The owner's revision of a reviewed draft (Sim P4, design §5.3):
 *  the body edited on the review canvas comes back for a new
 *  rehearsal. The write is the one the table's own rules already
 *  sanction — the UPDATE policy is owner-only, and the status guard
 *  in the WHERE clause does what transitionPromotionDraft's
 *  optimistic check does server-side: the move lands only from
 *  awaiting_review, the one status whose tested hashes mean anything.
 *  Body, the return to drafting and the clearing of everything the
 *  rehearsal proved (tested hashes, the report, the expiry) move in
 *  ONE update, so the freeze invariant the activation RPC trusts —
 *  "the tested text is the text on the row" — is never half-broken:
 *  there is no moment where the row holds edited text under tested
 *  hashes. A 'revised' event marks the move; the drafting run reads
 *  it and takes the edited body as its package, unchanged. */
async function reviseDraftBodyGuarded(draft: PromotionDraft, body: string, from: PromotionDraftStatus): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('Not signed in');
  if (!body.trim()) throw new Error('本文が空です');
  const now = new Date().toISOString();
  const events: PromotionDraftEvent[] = [...draft.events, { at: now, kind: 'revised', by: userId }];
  const { data, error } = await supabase.from('promotion_drafts').update({
    body,
    status: 'drafting',
    tested_structure_hash: null,
    tested_binding_hash: null,
    rehearsal_report: null,
    rehearsal_run_id: null,
    failure_class: null,
    awaiting_question: null,
    expires_at: null,
    events,
    updated_at: now,
  }).eq('id', draft.id).eq('status', from).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('ドラフトの状態が変わっていました。開き直して確認してください');
}

export async function revisePromotionDraftBody(draft: PromotionDraft, body: string): Promise<void> {
  return reviseDraftBodyGuarded(draft, body, 'awaiting_review');
}

/** The drafting-stage sibling (Automation builder design §5.2): the
 *  same guarded revision write, from `drafting` — the builder
 *  revises what Athena is drafting (a builder draft's seed, or an
 *  update draft's body while it is still being drafted). Same shape,
 *  same clearing semantics, same 'revised' event, in a single
 *  statement guarded on the status read: body, the (unchanged)
 *  drafting status and the clearing of anything a rehearsal proved
 *  move together, so the freeze invariant — "the tested text is the
 *  text on the row" — is never half-broken. The drafting driver
 *  takes the revised body verbatim when it freezes the package (the
 *  standing P4 rule), so a builder edit mid-drafting is picked up,
 *  not overwritten. */
export async function reviseDraftBody(draft: PromotionDraft, body: string): Promise<void> {
  return reviseDraftBodyGuarded(draft, body, 'drafting');
}

// ── The owner's decisions (the RPCs are the only route) ────────────────
export async function activatePromotionDraft(draftId: string): Promise<string> {
  const { data, error } = await supabase.rpc('activate_promotion_draft', { p_draft_id: draftId });
  if (error) throw error;
  return data as string;
}

export async function rejectPromotionDraft(draftId: string): Promise<void> {
  const { error } = await supabase.rpc('reject_promotion_draft', { p_draft_id: draftId });
  if (error) throw error;
}

export async function acceptUnverifiablePromotion(draftId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_unverifiable_promotion', { p_draft_id: draftId });
  if (error) throw error;
}

export async function rollbackPromotedDefinition(draftId: string): Promise<void> {
  const { error } = await supabase.rpc('rollback_promoted_definition', { p_draft_id: draftId });
  if (error) throw error;
}
