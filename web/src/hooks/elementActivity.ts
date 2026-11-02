'use client';

// The Activity rail's data: what happened to an Element, when, by whom.
//
// Backed by `element_activity`. Changes to the Element itself — status,
// title, description, priority, dates, estimate, people, moves, deletion and
// restore — are written by database triggers, so a change made by an agent,
// by SQL or by another client shows up here too, and none can be forged. The
// UI appends only what the database cannot see: direction, sub-element notes,
// reactions and Note links. Reads go through the
// query cache like every other Element read (ADR 0018).

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import type { ElementActivity } from '@/types/database';
import { latestClosedAt, latestDoneAt } from '@/Function/shared/completion';

export type ActivityKind =
  | 'created'
  | 'renamed'
  | 'description'
  | 'direction'
  | 'status'
  | 'priority'
  | 'assigned'
  | 'unassigned'
  | 'due'
  | 'estimate'
  | 'subelement'
  | 'note'
  | 'comment'
  | 'moved'
  | 'deleted'
  | 'restored';

type ActivityEntry = ElementActivity;

/** What the rail draws: persisted entries plus the synthetic "created" line. */
interface ActivityRow {
  id: string;
  kind: ActivityKind | 'created';
  detail: string;
  author: string;
  createdAt: Date;
}

const KEY = (elementId: string) => ['elementActivity', elementId] as const;
const LIMIT = 200;

async function fetchActivity(elementId: string): Promise<ActivityEntry[]> {
  const { data, error } = await supabase
    .from('element_activity')
    .select('*')
    .eq('element_id', elementId)
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return (data ?? []) as ActivityEntry[];
}

export function useElementActivityLog(elementId: string) {
  return useQuery({
    queryKey: KEY(elementId),
    queryFn: () => fetchActivity(elementId),
    staleTime: 15_000,
  });
}

/**
 * Re-read the rail now. Status rows are written by a database trigger, not by
 * the client; the delta stream will announce the row too, but the person who
 * just changed the status should not wait on a round trip to see it.
 */
export async function invalidateElementActivity(elementId: string): Promise<void> {
  await getQueryClient().invalidateQueries({ queryKey: KEY(elementId) });
}

// PostgREST caps a response at 1000 rows, so the read pages through
// `.range()`. The page cap is a safety valve, not a budget: when it is hit,
// `truncated` says the count is a lower bound (rows come newest first, so
// what is dropped is the oldest moves, and a count can only miss, never gain).
const DONE_TIMES_PAGE = 1000;
const DONE_TIMES_MAX_PAGES = 20;

interface DoneTimes {
  /** Each Element's latest move into done in the window (ISO). */
  doneAt: Map<string, string>;
  /** The page cap cut the read short — counts from doneAt are at least, not exactly. */
  truncated: boolean;
}

/**
 * When each visible Element last moved into done, for moves at or after
 * `since` (feed it to countCompletedSince). Only status rows that end in done
 * are read, and RLS limits them to Elements the viewer can see; the window
 * keeps the read small without listing ids in the URL. deltaStream
 * invalidates the `elementDoneTimes` key when a move into done arrives.
 */
export function useDoneTimesSince(since: Date) {
  const sinceIso = since.toISOString();
  return useQuery({
    queryKey: ['elementDoneTimes', sinceIso],
    queryFn: async (): Promise<DoneTimes> => {
      const { rows, truncated } = await fetchMovesIntoSince('done', sinceIso);
      return { doneAt: latestDoneAt(rows), truncated };
    },
    staleTime: 60_000,
  });
}

interface ClosedTimes {
  /** Each Element's latest move into done or cancelled in the window (ISO). */
  closedAt: Map<string, string>;
  truncated: boolean;
}

/**
 * When each visible Element last moved into done or cancelled, for moves at
 * or after `since` — the list's "Completed Elements" window. Off while
 * `enabled` is false (the window is 'all' or 'none' and needs no times).
 * deltaStream invalidates the `elementClosedTimes` key on such a move.
 */
export function useClosedTimesSince(since: Date, enabled: boolean) {
  const sinceIso = since.toISOString();
  return useQuery({
    queryKey: ['elementClosedTimes', sinceIso],
    queryFn: async (): Promise<ClosedTimes> => {
      const [done, cancelled] = await Promise.all([
        fetchMovesIntoSince('done', sinceIso),
        fetchMovesIntoSince('cancelled', sinceIso),
      ]);
      return {
        closedAt: latestClosedAt([...done.rows, ...cancelled.rows]),
        truncated: done.truncated || cancelled.truncated,
      };
    },
    enabled,
    // The key moves at midnight; keep the day's times until the new read lands.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/**
 * Record a close this client just made, before the read catches up: put
 * `elementId → at` into every cached close-time map, then read again. Without
 * it the window judges the Element by its created_at until the delta stream
 * arrives — and keeps it hidden if the stream never does.
 */
export function noteElementClosed(elementId: string, at: string): void {
  const qc = getQueryClient();
  qc.setQueriesData<ClosedTimes>({ queryKey: ['elementClosedTimes'] }, (old) => {
    if (!old) return old;
    const closedAt = new Map(old.closedAt);
    closedAt.set(elementId, at);
    return { ...old, closedAt };
  });
  void qc.invalidateQueries({ queryKey: ['elementClosedTimes'] });
}

type StatusRow = Pick<ElementActivity, 'element_id' | 'kind' | 'detail' | 'created_at'>;

/** Status rows that end in `status`, at or after `sinceIso`, newest first. */
async function fetchMovesIntoSince(status: 'done' | 'cancelled', sinceIso: string): Promise<{ rows: StatusRow[]; truncated: boolean }> {
  const rows: StatusRow[] = [];
  for (let page = 0; page < DONE_TIMES_MAX_PAGES; page++) {
    const from = page * DONE_TIMES_PAGE;
    const { data, error } = await supabase
      .from('element_activity')
      .select('element_id, kind, detail, created_at')
      .eq('kind', 'status')
      .like('detail', `%→ ${status}`)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + DONE_TIMES_PAGE - 1);
    if (error) throw error;
    const got = (data ?? []) as StatusRow[];
    rows.push(...got);
    if (got.length < DONE_TIMES_PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Append an entry and refresh the rail. actor_id is stamped by the database. */
export async function logActivity(
  elementId: string,
  kind: ActivityKind,
  detail: string,
  author: string = 'You',
): Promise<void> {
  const { error } = await supabase
    .from('element_activity')
    .insert({ element_id: elementId, kind, detail, author });
  if (error) throw error;
  await invalidateElementActivity(elementId);
}

/**
 * Pure. Newest first; the Element's own creation is a row too, derived from
 * created_at so it exists for Elements older than the table.
 */
export function mergeActivity(
  entries: readonly ActivityEntry[],
  element: { created_at: string | null; title: string },
): ActivityRow[] {
  const rows: ActivityRow[] = entries.map((e) => ({
    id: e.id,
    kind: e.kind as ActivityKind,
    detail: e.detail,
    author: e.author,
    createdAt: new Date(e.created_at),
  }));
  if (element.created_at) {
    rows.push({
      id: 'created',
      kind: 'created',
      detail: translate('Created “{title}”', { title: element.title }),
      author: translate('System'),
      createdAt: new Date(element.created_at),
    });
  }
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
