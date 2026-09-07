'use client';

// The Activity rail's data: what happened to an Element, when, by whom.
//
// Backed by `element_activity`. The UI appends an entry on the changes it
// makes (priority / assignee / due / estimate / title / description /
// direction / subelement); status changes are written by a database trigger
// instead, so a status set by an agent, by SQL, or by another client shows
// up here too — that gap is what el_TRJ-005 was about. Reads go through the
// query cache like every other Element read (ADR 0018).

import { useQuery } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { ElementActivity } from '@/types/database';

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
  | 'comment';

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

export function useElementActivity(elementId: string) {
  return useQuery({
    queryKey: KEY(elementId),
    queryFn: () => fetchActivity(elementId),
    staleTime: 15_000,
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
  await getQueryClient().invalidateQueries({ queryKey: KEY(elementId) });
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
      detail: `Created “${element.title}”`,
      author: 'System',
      createdAt: new Date(element.created_at),
    });
  }
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
