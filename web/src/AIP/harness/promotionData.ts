'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PromotionDraft, PromotionDraftStatus } from '@/types/database';

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
