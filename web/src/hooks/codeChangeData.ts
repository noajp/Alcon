'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { selectIn } from '@/hooks/chunkedIn';
import type { CodeChange, CodeChangeComment, CodeChangeReview, Json } from '@/types/database';

// An Element's code changes — the pull requests that carry it out — and the
// team's review of them against the intent. Reading and unlinking go straight
// to the tables (RLS follows the Element); linking, the diff and the AI's
// intent check go through the code-changes Edge Function, which holds the
// Space's GitHub credential. Verdicts and line comments are written by their
// author.

const CHANGE_COLUMNS = 'id, element_id, activity_space_id, provider, repo, number, url, title, body, state, base_ref, head_ref, head_sha, author_login, additions, deletions, changed_files, intent_check, linked_via, run_id, linked_by, synced_at, created_at, updated_at';

const changesKey = (elementId: string) => ['code-changes', elementId] as const;
const reviewsKey = (changeId: string) => ['code-change-reviews', changeId] as const;
const commentsKey = (changeId: string) => ['code-change-comments', changeId] as const;
const diffKey = (changeId: string) => ['code-change-diff', changeId] as const;

export interface CodeDiffFile {
  filename: string;
  previous_filename: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
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

/** The code changes of many Elements at once — an Initiative's view of what
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
  ]);

  const link = useMutation({
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
    mutationFn: (changeId: string) => invoke<{ intent_check: Json }>({ action: 'check', changeId }),
    onSuccess: ({ intent_check }, changeId) => {
      qc.setQueryData<CodeChange[]>(changesKey(elementId), (rows) => rows?.map((r) => (r.id === changeId ? { ...r, intent_check } : r)));
    },
    onSettled: refresh,
  });

  return { link, unlink, check };
}

/** The change's files and patches, read from GitHub (also refreshes its metadata). */
export function useCodeDiff(change: CodeChange | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: diffKey(change?.id ?? ''),
    enabled: !!change,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const out = await invoke<{ change: Partial<CodeChange>; files: CodeDiffFile[] }>({ action: 'diff', changeId: change!.id });
      // The refreshed metadata (state, head) feeds the Element's list too.
      qc.setQueryData<CodeChange[]>(changesKey(change!.element_id), (rows) =>
        rows?.map((r) => (r.id === change!.id ? { ...r, ...out.change, intent_check: r.intent_check } : r)));
      return out.files;
    },
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
    mutationFn: async (input: Pick<CodeChangeReview, 'verdict' | 'body' | 'head_sha' | 'reviewer_name'>) => {
      const { error } = await supabase.from('code_change_reviews').insert({ code_change_id: changeId, ...input });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: reviewsKey(changeId) }),
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
    mutationFn: async (input: Pick<CodeChangeComment, 'path' | 'line' | 'side' | 'body' | 'head_sha' | 'author_name'>) => {
      const { error } = await supabase.from('code_change_comments').insert({ code_change_id: changeId, ...input });
      if (error) throw error;
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
  subelements: { title: string; is_completed: boolean }[];
  initiatives: {
    id: string;
    name: string;
    description: string | null;
    intents: { id: string; kind: string; title: string; subtitle: string | null }[];
  }[];
}

/** The Element's task and the intent of the Initiatives its Object serves —
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
        supabase.from('subelements').select('title, is_completed').eq('element_id', elementId!).order('order_index'),
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
        subelements: ((subs.data ?? []) as { title: string; is_completed: boolean | null }[]).map((s) => ({ title: s.title, is_completed: !!s.is_completed })),
        initiatives: ((strategies.data ?? []) as { id: string; name: string; description: string | null }[]).map((s) => ({
          ...s,
          intents: intentRows.filter((i) => i.strategy_id === s.id && i.title?.trim())
            .map((i) => ({ id: i.id, kind: i.kind ?? 'decision', title: i.title, subtitle: i.subtitle })),
        })),
      };
    },
  });
}
