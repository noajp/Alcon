'use client';

import { selectIn } from '@/hooks/chunkedIn';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import type { ElementComment, ElementCommentActivity, ElementCommentInsert, ElementCommentUpdate, ElementReaction, ElementReactionInsert } from '@/types/database';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';


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
  // RLS lets only the author delete; anyone else's delete matches no row and
  // returns no error — report it so the caller can put the comment back.
  const { data, error } = await supabase.from('element_comments').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error(translate('This comment can only be deleted by its author.'));
}

// ============================================
// Carry-over reasons — why THIS Element, not just how many times.
//
// carried_over_count answers "how many rounds" but not "why" (el_STR-019):
// the same ↺1 means "planned, this was always lower priority" for one Element
// and "unplanned, someone else's work spilled onto it" for another, and a
// Phase's own closing_note is one sentence for every unfinished Element at
// once. Rather than a new column or an intent_bindings-style structure (a
// carry reason isn't a Initiative-level decision — most are one line, and
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
 *  detail prefetch in ActivitySpace/execution/element/elementDetailQueries). `setComments`
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

export type { ElementCommentActivity };

/** Hang each Element's rollup on the Element itself, so a column, a card and a
 *  sort all read one field instead of each carrying its own map. An Element
 *  whose rollup did not change keeps its object identity, which is what lets
 *  memoised rows skip the re-render. */
const attached = new WeakMap<object, { stamp: string; out: object }>();
// Compared by value, not by reference: two surfaces watching the same
// Elements read different query keys, and a realtime comment builds a
// separate entry object for each of them. Equal counts and timestamps mean
// the same rollup, whoever built the object.
const stampOf = (a: ElementCommentActivity | undefined) => a ? `${a.commentCount}@${a.lastCommentAt}` : '';
export function withCommentActivity<T extends { id: string; activity?: ElementCommentActivity }>(
  elements: T[],
  activity: Record<string, ElementCommentActivity>,
): T[] {
  return elements.map((el) => {
    const next = activity[el.id];
    const stamp = stampOf(next);
    if (stamp === stampOf(el.activity)) return el;
    const prev = attached.get(el);
    if (prev && prev.stamp === stamp) return prev.out as T;
    const out = { ...el, activity: next };
    attached.set(el, { stamp, out });
    return out;
  });
}

/**
 * Comment activity for a whole list of Elements in ONE aggregated RPC call
 * (get_element_activity: GROUP BY on the server, RLS-checked, POST body so
 * a large visible set can't blow the URL or trip the PostgREST row cap).
 * Elements with zero comments get no entry (rows render nothing for them).
 *
 * Entries whose count/timestamp didn't change keep their previous object
 * reference (lastActivityById), so a memoised row re-renders only when its
 * own thread actually moved. Kept current by Function/sync/deltaStream (a
 * comment INSERT bumps the entry in place).
 */
const ELEMENT_ACTIVITY_QUERY_PREFIX = ['element-activity'] as const;
const EMPTY_ACTIVITY: Record<string, ElementCommentActivity> = {};

// Last known entry per Element, shared across every id-set key. The query
// cache's structural sharing only compares a key with its own previous data,
// and the visible id set (filter, sort, create, delete) is part of the key —
// so without this, every visible-set change would hand memoised rows a fresh
// object for an unchanged rollup and re-render all of them.
const lastActivityById = new Map<string, ElementCommentActivity>();

async function fetchElementCommentActivity(ids: string[]): Promise<Record<string, ElementCommentActivity>> {
  const { data: rows, error } = await supabase
    .rpc('get_element_activity', { p_element_ids: ids });
  if (error) throw error;
  const next: Record<string, ElementCommentActivity> = {};
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

export function useElementCommentActivity(elementIds: string[]) {
  // Callers typically rebuild the ids array every render (flatMap over
  // sections) — depend on the sorted membership, not the array identity.
  // \n can never appear in an id, so the key is collision-safe to split.
  const idsKey = useMemo(() => [...elementIds].sort().join('\n'), [elementIds]);
  const query = useQuery({
    queryKey: [...ELEMENT_ACTIVITY_QUERY_PREFIX, idsKey],
    queryFn: () => fetchElementCommentActivity(idsKey.split('\n')),
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

async function addReaction(input: ElementReactionInsert): Promise<ElementReaction> {
  const { data, error } = await supabase
    .from('element_reactions')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as ElementReaction;
}

async function removeReaction(reactionId: string): Promise<void> {
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
