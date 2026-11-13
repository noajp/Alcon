'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { selectIn } from '@/hooks/chunkedIn';
import type { CodeChange, CodeChangeComment, CodeChangeReview, Json } from '@/types/database';

// An Element's code changes — the pull requests that carry it out — and the
// team's review of them against the intent. Reading and unlinking go straight
// to the tables (RLS follows the Element); linking, the diff, the AI's intent
// check and walk-through, merging, and carrying reviews to GitHub go through
// the code-changes Edge Function, which holds the Space's GitHub credential.
// Verdicts and line comments are written by their author, then posted to the
// pull request.

const CHANGE_COLUMNS = 'id, element_id, activity_space_id, provider, repo, number, url, title, body, state, base_ref, head_ref, head_sha, author_login, additions, deletions, changed_files, intent_check, guide, linked_via, run_id, linked_by, synced_at, created_at, updated_at, ci_state, ci_url, ci_at, amend_rounds, amend_exhausted_at';

const changesKey = (elementId: string) => ['code-changes', elementId] as const;
const reviewsKey = (changeId: string) => ['code-change-reviews', changeId] as const;
const commentsKey = (changeId: string) => ['code-change-comments', changeId] as const;
const diffKey = (changeId: string) => ['code-change-diff', changeId] as const;
const INBOX_KEY = 'code-review-inbox';

export interface CodeDiffFile {
  filename: string;
  previous_filename: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

/** A line comment written on GitHub rather than in Clayware. */
export interface GithubLineComment {
  id: number;
  path: string;
  line: number | null;
  side: 'LEFT' | 'RIGHT';
  body: string;
  user: string | null;
  created_at: string;
  url: string | null;
}

export interface CodeDiff {
  files: CodeDiffFile[];
  githubComments: GithubLineComment[];
}

/** An Edge Function error with the function's own `error` message when it sent one. */
async function functionError(error: Error): Promise<Error> {
  let message = error.message;
  if ('context' in error && error.context instanceof Response) {
    try { message = (await error.context.json()).error ?? message; } catch { /* keep the transport error */ }
  }
  return new Error(message);
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('code-changes', { body });
  if (error) throw await functionError(error);
  return data as T;
}

const EMPTY_CHANGES: CodeChange[] = [];

export function useCodeChanges(elementId: string | null) {
  const query = useQuery({
    queryKey: changesKey(elementId ?? ''),
    enabled: !!elementId,
    staleTime: 30_000,
    queryFn: async (): Promise<CodeChange[]> => {
      const { data, error } = await supabase.from('code_changes').select(CHANGE_COLUMNS)
        .eq('element_id', elementId!).order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CodeChange[];
    },
  });
  return { data: query.data ?? EMPTY_CHANGES, loading: !!elementId && query.isPending, error: (query.error as Error | null) ?? null };
}

/** One code change by its own id — the created-entity card's live
 *  read (coding capability PR3): the card's identity is the
 *  code_changes row the publish linked, and the row carries the PR's
 *  current state, so the card shows merged or closed as it happens
 *  rather than open as it was when the run ended. `settled` follows
 *  the by-id reads' discipline: true once the read has answered,
 *  so a missing row reads as gone, not as still loading. */
export function useCodeChangeById(id: string | null | undefined) {
  const query = useQuery({
    queryKey: ['code-change-by-id', id],
    enabled: !!id,
    staleTime: 30_000,
    queryFn: async (): Promise<CodeChange | null> => {
      const { data, error } = await supabase.from('code_changes').select(CHANGE_COLUMNS)
        .eq('id', id!).maybeSingle();
      if (error) throw error;
      return (data as CodeChange | null) ?? null;
    },
  });
  return {
    change: query.data ?? null,
    settled: !id || query.isFetched,
  };
}

/** The code changes of many Elements at once — a Strategy's view of what
 *  its Objects' work has shipped. */
export function useCodeChangesForElements(elementIds: readonly string[]) {
  const ids = [...new Set(elementIds)].sort();
  const query = useQuery({
    queryKey: ['code-changes-many', ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<CodeChange[]> => {
      const rows = await selectIn<CodeChange>(ids, (chunk) =>
        supabase.from('code_changes').select(CHANGE_COLUMNS).in('element_id', chunk));
      return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
  });
  return { data: query.data ?? EMPTY_CHANGES, loading: ids.length > 0 && query.isPending };
}

export function useCodeChangeActions(elementId: string) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: changesKey(elementId) }),
    qc.invalidateQueries({ queryKey: ['code-changes-many'] }),
    qc.invalidateQueries({ queryKey: [INBOX_KEY] }),
  ]);

  const link = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: (url: string) => invoke<{ id: string | null }>({ action: 'link', elementId, url }),
    onSettled: refresh,
  });

  const unlink = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('code_changes').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('This code change could not be unlinked.');
    },
    onSettled: refresh,
  });

  const check = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: (changeId: string) => invoke<{ intent_check: Json }>({ action: 'check', changeId }),
    onSuccess: ({ intent_check }, changeId) => {
      qc.setQueryData<CodeChange[]>(changesKey(elementId), (rows) => rows?.map((r) => (r.id === changeId ? { ...r, intent_check } : r)));
    },
    onSettled: refresh,
  });

  const guide = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: (changeId: string) => invoke<{ guide: Json }>({ action: 'guide', changeId }),
    onSuccess: ({ guide: g }, changeId) => {
      qc.setQueryData<CodeChange[]>(changesKey(elementId), (rows) => rows?.map((r) => (r.id === changeId ? { ...r, guide: g } : r)));
    },
    onSettled: refresh,
  });

  const merge = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: ({ changeId, method }: { changeId: string; method: 'merge' | 'squash' | 'rebase' }) =>
      invoke<{ change: Partial<CodeChange> }>({ action: 'merge', changeId, method }),
    onSettled: refresh,
  });

  return { link, unlink, check, guide, merge };
}

/** The change's files and patches, and the line comments written on GitHub,
 *  read from GitHub (also refreshes its metadata). `follow` re-reads it every
 *  20 seconds — while an agent is pushing to the branch. */
export function useCodeDiff(change: CodeChange | null, follow = false) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: diffKey(change?.id ?? ''),
    enabled: !!change,
    staleTime: 60_000,
    retry: false,
    refetchInterval: follow ? 20_000 : false,
    queryFn: async (): Promise<CodeDiff> => {
      const out = await invoke<{ change: Partial<CodeChange>; files: CodeDiffFile[]; github_comments?: GithubLineComment[] }>({ action: 'diff', changeId: change!.id });
      // The refreshed metadata (state, head) feeds the Element's list too.
      qc.setQueryData<CodeChange[]>(changesKey(change!.element_id), (rows) =>
        rows?.map((r) => (r.id === change!.id ? { ...r, ...out.change, intent_check: r.intent_check, guide: r.guide } : r)));
      void qc.invalidateQueries({ queryKey: [INBOX_KEY] });
      return { files: out.files, githubComments: out.github_comments ?? [] };
    },
  });
}

/** Posts the caller's own review or line comment to the pull request. A
 *  refusal is kept on the row (github_error), not thrown: the review stands in
 *  Clayware either way. */
function publishToGithub(changeId: string, target: { reviewId: string } | { commentId: string }) {
  return invoke<{ github_id?: number; github_error?: string }>({ action: 'publish', changeId, ...target });
}

export function useRetryPublish(changeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: { reviewId: string } | { commentId: string }) => publishToGithub(changeId, target),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: reviewsKey(changeId) }),
      qc.invalidateQueries({ queryKey: commentsKey(changeId) }),
    ]),
  });
}

// ── Verdicts ───────────────────────────────────────────────────────────────

export function useCodeChangeReviews(changeId: string | null) {
  return useQuery({
    queryKey: reviewsKey(changeId ?? ''),
    enabled: !!changeId,
    staleTime: 15_000,
    queryFn: async (): Promise<CodeChangeReview[]> => {
      const { data, error } = await supabase.from('code_change_reviews').select('*')
        .eq('code_change_id', changeId!).order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CodeChangeReview[];
    },
  });
}

export function useSubmitCodeReview(changeId: string) {
  const qc = useQueryClient();
  return useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async (input: Pick<CodeChangeReview, 'verdict' | 'body' | 'head_sha' | 'reviewer_name'>) => {
      const { data, error } = await supabase.from('code_change_reviews').insert({ code_change_id: changeId, ...input }).select('id').single();
      if (error) throw error;
      await publishToGithub(changeId, { reviewId: data.id }).catch(() => undefined);
    },
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: reviewsKey(changeId) }),
      qc.invalidateQueries({ queryKey: [INBOX_KEY] }),
    ]),
  });
}

// ── Line comments ──────────────────────────────────────────────────────────

export function useCodeChangeComments(changeId: string | null) {
  return useQuery({
    queryKey: commentsKey(changeId ?? ''),
    enabled: !!changeId,
    staleTime: 15_000,
    queryFn: async (): Promise<CodeChangeComment[]> => {
      const { data, error } = await supabase.from('code_change_comments').select('*')
        .eq('code_change_id', changeId!).order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CodeChangeComment[];
    },
  });
}

export function useCodeCommentActions(changeId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: commentsKey(changeId) });
  const add = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async (input: Pick<CodeChangeComment, 'path' | 'line' | 'side' | 'body' | 'head_sha' | 'author_name'>) => {
      const { data, error } = await supabase.from('code_change_comments').insert({ code_change_id: changeId, ...input }).select('id').single();
      if (error) throw error;
      await publishToGithub(changeId, { commentId: data.id }).catch(() => undefined);
    },
    onSettled: refresh,
  });
  const resolve = useMutation({
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      const { error } = await supabase.from('code_change_comments').update({ resolved }).eq('id', id);
      if (error) throw error;
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('code_change_comments').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('This comment can only be deleted by its author.');
    },
    onSettled: refresh,
  });
  return { add, resolve, remove };
}

// ── The intent a change is read against ────────────────────────────────────

export interface ElementIntent {
  element: { id: string; display_id: string | null; title: string; description: string | null };
  subElements: { title: string; done: boolean }[];
  initiatives: {
    id: string;
    name: string;
    description: string | null;
    intents: { id: string; kind: string; title: string; subtitle: string | null }[];
  }[];
}

/** The Element's task and the intent of the Strategies its Object serves —
 *  what the review screen shows beside the diff. */
export function useElementIntent(elementId: string | null) {
  return useQuery({
    queryKey: ['element-intent', elementId],
    enabled: !!elementId,
    staleTime: 60_000,
    queryFn: async (): Promise<ElementIntent> => {
      const { data: el, error } = await supabase.from('elements')
        .select('id, display_id, title, description, object_id').eq('id', elementId!).single();
      if (error) throw error;
      const [subs, links] = await Promise.all([
        supabase.from('elements').select('title, status').eq('parent_id', elementId!).order('order_index'),
        el.object_id
          ? supabase.from('strategy_objects').select('strategy_id').eq('object_id', el.object_id)
          : Promise.resolve({ data: [] as { strategy_id: string }[], error: null }),
      ]);
      const strategyIds = ((links.data ?? []) as { strategy_id: string }[]).map((l) => l.strategy_id);
      const [strategies, intents] = strategyIds.length
        ? await Promise.all([
          supabase.from('strategies').select('id, name, description').in('id', strategyIds),
          supabase.from('intents').select('id, strategy_id, kind, title, subtitle, order_index')
            .in('strategy_id', strategyIds).is('superseded_by_intent_id', null).order('order_index'),
        ])
        : [{ data: [] }, { data: [] }];
      const intentRows = (intents.data ?? []) as { id: string; strategy_id: string; kind: string | null; title: string; subtitle: string | null }[];
      return {
        element: { id: el.id, display_id: el.display_id, title: el.title, description: el.description },
        subElements: ((subs.data ?? []) as { title: string; status: string | null }[]).map((s) => ({ title: s.title, done: s.status === 'done' })),
        initiatives: ((strategies.data ?? []) as { id: string; name: string; description: string | null }[]).map((s) => ({
          ...s,
          intents: intentRows.filter((i) => i.strategy_id === s.id && i.title?.trim())
            .map((i) => ({ id: i.id, kind: i.kind ?? 'decision', title: i.title, subtitle: i.subtitle })),
        })),
      };
    },
  });
}
