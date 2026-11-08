'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { heartbeatSettingsOf, monthSpendOf, type HeartbeatSettings, type HeartbeatWake } from '@/Function/settings/heartbeatModel';

// A Space's heartbeat: its settings (read by every member, changed
// only through set_space_heartbeat — the RPC checks ownership and
// schedules the wake, so the screen never updates the columns itself)
// and its wake history (the runs are the Space's record; members read
// them, and a wake's steps with them).

const settingsKey = (spaceId: string | null) => ['space-heartbeat', spaceId] as const;
const stepsKey = (runId: string | null) => ['heartbeat-steps', runId] as const;

export interface HeartbeatStep { idx: number; type: string; title: string; detail: string | null }

export function useSpaceHeartbeat(spaceId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: settingsKey(spaceId),
    queryFn: async () => {
      const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
      const [space, wakes, month] = await Promise.all([
        supabase.from('activity_spaces')
          .select('heartbeat_enabled, heartbeat_owner_id, heartbeat_cadence_minutes, heartbeat_next_at, heartbeat_timezone, heartbeat_quiet_start, heartbeat_quiet_end, heartbeat_notify_after_hours, heartbeat_monthly_budget_usd, heartbeat_last_wake_at, heartbeat_last_tick_at')
          .eq('id', spaceId!).maybeSingle(),
        supabase.from('agent_runs')
          .select('id, status, summary, cost_usd, created_at, finished_at')
          .eq('activity_space_id', spaceId!).eq('mode', 'heartbeat')
          .order('created_at', { ascending: false }).limit(10),
        supabase.from('agent_runs')
          .select('cost_usd, created_at')
          .eq('activity_space_id', spaceId!).eq('mode', 'heartbeat')
          .gte('created_at', monthStart.toISOString()).limit(1500),
      ]);
      if (space.error) throw space.error;
      if (wakes.error) throw wakes.error;
      if (month.error) throw month.error;
      const monthRows = (month.data ?? []) as { cost_usd: number | string; created_at: string }[];
      return {
        settings: heartbeatSettingsOf(space.data as Record<string, unknown> | null),
        wakes: (wakes.data ?? []) as unknown as HeartbeatWake[],
        monthSpent: monthSpendOf(monthRows, new Date()),
      };
    },
    enabled: !!spaceId,
    staleTime: 10_000,
  });
  return {
    settings: query.data?.settings ?? null,
    wakes: query.data?.wakes ?? [],
    monthSpent: query.data?.monthSpent ?? 0,
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: () => qc.invalidateQueries({ queryKey: settingsKey(spaceId) }),
  };
}

/** One wake's steps, read when its record is opened (the settings
 *  history's expansion, or a digest's Inbox card). */
export function useHeartbeatSteps(runId: string | null) {
  const query = useQuery({
    queryKey: stepsKey(runId),
    queryFn: async () => {
      const { data, error } = await supabase.from('agent_run_steps')
        .select('idx, type, title, detail')
        .eq('run_id', runId!)
        .order('idx', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as HeartbeatStep[];
    },
    enabled: !!runId,
    staleTime: 30_000,
  });
  return { steps: query.data ?? [], loading: !!runId && query.isPending };
}

/** Changes the settings through the one RPC (owner-only; enabling
 *  names the caller as the wake's actor and schedules the first wake). */
export async function setSpaceHeartbeat(spaceId: string, s: HeartbeatSettings): Promise<void> {
  const { error } = await supabase.rpc('set_space_heartbeat', {
    p_space_id: spaceId,
    p_enabled: s.enabled,
    p_cadence_minutes: s.cadenceMinutes,
    p_notify_after_hours: s.notifyAfterHours,
    p_quiet_start: s.quietStart,
    p_quiet_end: s.quietEnd,
    p_timezone: s.timezone,
    p_monthly_budget_usd: s.monthlyBudgetUsd,
  });
  if (error) throw error;
}

/** "Wake now": an extra wake, standing as the owner who enabled the
 *  heartbeat (the automations function checks the presser is a Space
 *  owner, and that no wake is already running). */
export async function wakeHeartbeatNow(spaceId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('automations', { body: { heartbeat: spaceId } });
  if (error) throw error;
  const result = (data ?? {}) as { wake?: string; error?: string };
  if (result.error) throw new Error(result.error);
  if (result.wake !== 'fired') throw new Error('The heartbeat could not be woken.');
}
