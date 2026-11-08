'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentUserId, supabase } from '@/lib/supabase';
import type { IntegrationDraft } from '@/types/database';
import { foldDraftName } from './draftModel';

// AI-drafted connections (G4): the draft records of a Space, the run that
// drafts each one, and the two writes the screens make — start a draft
// (entry C) and talk to its run (answer its question, or ask it to fix a
// test round). Members read every draft (a draft holds no secret, ever);
// the run is driven only by the person who started it, as for every run.

/** The open-draft caps (§8-5), mirroring _shared/connectorDraft.ts. */
const MAX_OPEN_DRAFTS_PER_SPACE = 10;
const MAX_OPEN_DRAFTS_PER_REQUESTER = 5;

const OPEN_STATUSES = ['drafting', 'awaiting_input', 'testing', 'awaiting_review'];
const DRAFT_COLUMNS = 'id, activity_space_id, name, name_key, kind, status, request_context, endpoint, auth_type, auth_header, manifest, guide, test_inputs, sources, test_results, required_commands, dropped_commands, tested_hash, tested_structure_hash, tested_permission_hash, tested_content, materialized_integration_id, target_integration_id, activated_integration_id, draft_run_id, decided_by, decided_at, activated_hash, activated_structure_hash, activated_permission_hash, failure_class, awaiting_question, change_events, expires_at, created_by, created_at, updated_at';

const draftsKey = (spaceId: string | null) => ['integration-drafts', spaceId] as const;

async function fetchDrafts(spaceId: string): Promise<IntegrationDraft[]> {
  const { data, error } = await supabase
    .from('integration_drafts')
    .select(DRAFT_COLUMNS)
    .eq('activity_space_id', spaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as IntegrationDraft[];
}

const EMPTY: IntegrationDraft[] = [];

export function useIntegrationDrafts(spaceId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: draftsKey(spaceId),
    queryFn: () => fetchDrafts(spaceId!),
    enabled: !!spaceId,
    staleTime: 10_000,
    // An open draft is being worked on by its run; keep the list fresh.
    refetchInterval: (q) => ((q.state.data as IntegrationDraft[] | undefined)?.some((d) => OPEN_STATUSES.includes(d.status)) ? 5000 : false),
  });
  return {
    data: query.data ?? EMPTY,
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: () => qc.invalidateQueries({ queryKey: draftsKey(spaceId) }),
  };
}

/** One draft by id (the Inbox card's subject), kept fresh while open. */
export function useIntegrationDraft(draftId: string | null) {
  const query = useQuery({
    queryKey: ['integration-draft', draftId] as const,
    enabled: !!draftId,
    queryFn: async (): Promise<IntegrationDraft | null> => {
      const { data, error } = await supabase
        .from('integration_drafts').select(DRAFT_COLUMNS).eq('id', draftId!).maybeSingle();
      if (error) throw error;
      return (data as unknown as IntegrationDraft | null) ?? null;
    },
    refetchInterval: (q) => {
      const d = q.state.data as IntegrationDraft | null | undefined;
      return d && OPEN_STATUSES.includes(d.status) ? 5000 : false;
    },
  });
  return { draft: query.data ?? null, loading: !!draftId && query.isPending };
}

/** The active draft a connection was activated from (§4.11's record). */
export function useActiveDraftForIntegration(integrationId: string | null) {
  const query = useQuery({
    queryKey: ['integration-draft-for-integration', integrationId] as const,
    enabled: !!integrationId,
    queryFn: async (): Promise<IntegrationDraft | null> => {
      const { data, error } = await supabase
        .from('integration_drafts').select(DRAFT_COLUMNS)
        .eq('activated_integration_id', integrationId!).eq('status', 'active').maybeSingle();
      if (error) throw error;
      return (data as unknown as IntegrationDraft | null) ?? null;
    },
    staleTime: 30_000,
  });
  return { draft: query.data ?? null };
}

/** Owner decisions on a tested draft: the RPCs re-check the owner and
 *  the tested content on the server; the screen only asks. */
export async function activateDraft(draftId: string): Promise<string> {
  const { data, error } = await supabase.rpc('activate_integration_draft', { p_draft_id: draftId });
  if (error) throw error;
  return data as unknown as string;
}

export async function rejectDraft(draftId: string): Promise<void> {
  const { error } = await supabase.rpc('reject_integration_draft', { p_draft_id: draftId });
  if (error) throw error;
}

export interface DraftRun {
  id: string;
  status: string;
  summary: string | null;
  error: string | null;
}

export interface DraftStepRow { id: string; type: string; title: string; detail: string | null }

/** One draft, its drafting run and the run's steps (the audit trail the
 *  review screen shows). Polls while the run is working or the draft is
 *  waiting on a person. */
export function useDraftDetail(draft: IntegrationDraft | null) {
  const runId = draft?.draft_run_id ?? null;
  const query = useQuery({
    queryKey: ['integration-draft-detail', draft?.id, runId] as const,
    enabled: !!draft,
    queryFn: async (): Promise<{ run: DraftRun | null; steps: DraftStepRow[] }> => {
      if (!runId) return { run: null, steps: [] };
      const [{ data: run }, { data: steps }] = await Promise.all([
        supabase.from('agent_runs').select('id, status, summary, error').eq('id', runId).maybeSingle(),
        supabase.from('agent_run_steps').select('id, type, title, detail').eq('run_id', runId).order('idx', { ascending: true }),
      ]);
      return { run: (run as DraftRun | null) ?? null, steps: (steps ?? []) as DraftStepRow[] };
    },
    refetchInterval: (q) => {
      const run = (q.state.data as { run: DraftRun | null } | undefined)?.run;
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
export async function sendDraftMessage(runId: string, message: string): Promise<void> {
  const { error } = await supabase.functions.invoke('run-agent', { body: { runId, message } });
  if (error) throw await functionError(error);
}

/** Starts a run without words (its opening carries the request context). */
async function startDraftRun(runId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('run-agent', { body: { runId } });
  if (error) throw await functionError(error);
}

/** Runs one command-level test round for a draft in testing (the
 *  integration-draft-test function; owner only, checked there too). */
export async function runDraftTest(draftId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('integration-draft-test', { body: { draftId } });
  if (error) throw await functionError(error);
}

/** The owner's call on a round that could not verify authentication:
 *  the draft goes to review with the evidence as it stands. */
export async function settleDraftToReview(draftId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('integration-draft-test', { body: { draftId, settle: 'review' } });
  if (error) throw await functionError(error);
}

export interface NewDraftAsk {
  name: string;
  purpose: string;
  docsUrl?: string | null;
  entry: string;
  waitingFor?: string | null;
  sourceRunId?: string | null;
  sourceSessionId?: string | null;
  elementIds?: string[];
}

/**
 * Entry C (and, later, the connect card): create the draft record and
 * its drafting run, then set the run going. The open-draft caps are
 * checked here in the open (the reconcile's unique index is the hard
 * backstop for the name; the caps are the abuse bound from §8-5).
 * Returns the created draft.
 */
export async function createDraft(spaceId: string, ask: NewDraftAsk, existing: readonly IntegrationDraft[]): Promise<IntegrationDraft> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Sign in to continue.');
  const open = existing.filter((d) => OPEN_STATUSES.includes(d.status));
  if (open.length >= MAX_OPEN_DRAFTS_PER_SPACE) {
    throw new Error('Too many drafts are open in this Space. Finish or close one before starting another.');
  }
  if (open.filter((d) => d.created_by === userId).length >= MAX_OPEN_DRAFTS_PER_REQUESTER) {
    throw new Error('You have too many drafts open. Finish or close one before starting another.');
  }
  const name = ask.name.trim();
  const { data, error } = await supabase.from('integration_drafts').insert({
    activity_space_id: spaceId,
    name,
    name_key: foldDraftName(name),
    kind: 'http',
    status: 'drafting',
    request_context: {
      entry: ask.entry,
      waitingFor: ask.waitingFor ?? null,
      purpose: ask.purpose,
      docsUrl: ask.docsUrl || null,
      sourceRunId: ask.sourceRunId ?? null,
      sourceSessionId: ask.sourceSessionId ?? null,
      elementIds: ask.elementIds ?? [],
    },
    created_by: userId,
  }).select(DRAFT_COLUMNS).single();
  if (error) throw error;
  const draft = data as unknown as IntegrationDraft;
  const { data: run, error: runError } = await supabase.from('agent_runs').insert({
    integration_draft_id: draft.id, element_id: null, triggered_by: userId, triggered_from: ask.entry,
    status: 'queued', mode: 'draft',
  }).select('id').single();
  if (runError) throw runError;
  await startDraftRun((run as { id: string }).id);
  return draft;
}
