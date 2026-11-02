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

import { useQuery } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import type { ElementActivity } from '@/types/database';
import { latestDoneAt } from '@/Function/shared/completion';

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
  const qc = getQueryClient();
  await Promise.all([
    qc.invalidateQueries({ queryKey: KEY(elementId) }),
    qc.invalidateQueries({ queryKey: DONE_TIMES_PREFIX }),
  ]);
}

/** Key prefix of useDoneTimesSince — deltaStream invalidates it on a new status row. */
const DONE_TIMES_PREFIX = ['elementDoneTimes'] as const;
const DONE_TIMES_LIMIT = 5000;

/**
 * When each visible Element last moved into done, for moves at or after
 * `since` (feed it to countCompletedSince). Only status rows that end in done
 * are read, and RLS limits them to Elements the viewer can see; the window
 * keeps the read small without listing ids in the URL.
 */
export function useDoneTimesSince(since: Date) {
  const sinceIso = since.toISOString();
  return useQuery({
    queryKey: [...DONE_TIMES_PREFIX, sinceIso],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('element_activity')
        .select('element_id, kind, detail, created_at')
        .eq('kind', 'status')
        .like('detail', '%→ done')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(DONE_TIMES_LIMIT);
      if (error) throw error;
      return latestDoneAt((data ?? []) as Pick<ElementActivity, 'element_id' | 'kind' | 'detail' | 'created_at'>[]);
    },
    staleTime: 60_000,
  });
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
