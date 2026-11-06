'use client';

import { useQuery } from '@tanstack/react-query';
import { selectIn } from '@/hooks/chunkedIn';
import { supabase } from '@/lib/supabase';
import type { AgentRunStatus } from '@/types/database';

// The status of each Element's latest AI run — what a board needs to say
// whether an AI is working on it or has stopped to ask a person.

interface RunRow { element_id: string | null; status: AgentRunStatus; created_at: string }

const WORKING: AgentRunStatus[] = ['queued', 'running'];
const EMPTY: Record<string, AgentRunStatus> = {};

async function fetchLatestRunStatuses(elementIds: string[]): Promise<Record<string, AgentRunStatus>> {
  const rows = await selectIn<RunRow>(
    elementIds,
    (chunk) => supabase.from('agent_runs')
      .select('element_id, status, created_at')
      .in('element_id', chunk)
      .order('created_at', { ascending: false }),
  );
  const latest: Record<string, RunRow> = {};
  for (const row of rows) {
    if (!row.element_id) continue;
    const seen = latest[row.element_id];
    if (!seen || row.created_at > seen.created_at) latest[row.element_id] = row;
  }
  return Object.fromEntries(Object.entries(latest).map(([id, row]) => [id, row.status]));
}

/** Element id → its latest run's status; Elements never run are absent.
 *  Re-read every 5s while any of those runs is working. */
export function useLatestRunStatuses(elementIds: string[]) {
  const key = [...elementIds].sort().join(',');
  const query = useQuery({
    queryKey: ['latest-run-statuses', key],
    queryFn: () => fetchLatestRunStatuses(elementIds),
    enabled: elementIds.length > 0,
    staleTime: 5_000,
    refetchInterval: (q) => (Object.values((q.state.data as Record<string, AgentRunStatus> | undefined) ?? {}).some((s) => WORKING.includes(s)) ? 5_000 : false),
  });
  return { data: query.data ?? EMPTY, loading: query.isPending && elementIds.length > 0 };
}
