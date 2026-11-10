'use client';

// Automations: a harness started by a schedule or an outside event (see
// supabase/functions/automations). Members of the Space read them; the
// person who made one, or a Space owner, changes it.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { nextCronRun } from '@/AIP/automation/cron';

export type AutomationKind = 'schedule' | 'webhook';

export interface Automation {
  id: string;
  activity_space_id: string;
  name: string;
  enabled: boolean;
  /** Optional: an automation without a harness runs on its workflow. */
  definition_id: string | null;
  /** Its own steps, in the harness's Procedure form (`# 進め方`). */
  workflow: string;
  object_id: string;
  kind: AutomationKind;
  cron: string | null;
  timezone: string;
  has_token: boolean;
  owner_id: string;
  next_run_at: string | null;
  last_fired_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
}

export interface AutomationEvent {
  id: string;
  source: 'schedule' | 'webhook' | 'manual';
  status: 'received' | 'started' | 'skipped' | 'failed';
  element_id: string | null;
  run_id: string | null;
  /** The run's current status, when the reader can see the run; a run
   *  stopped at an approval ('awaiting_approval') is the one state an
   *  automation's list must not hide — under the Ask-every-time mode
   *  stopping there is the specified behavior, not a failure. */
  run_status: string | null;
  error: string | null;
  created_at: string;
}

/** Pure. A started run that is waiting on a person's approval. */
export function runWaitingOnApproval(runStatus: string | null | undefined): boolean {
  return runStatus === 'awaiting_approval';
}

const COLUMNS = 'id, activity_space_id, name, enabled, definition_id, workflow, object_id, kind, cron, timezone, token_hash, owner_id, next_run_at, last_fired_at, last_status, last_error, created_at';
const key = (spaceId: string | null) => ['automations', spaceId ?? 'none'] as const;

function fromRow(r: Record<string, unknown>): Automation {
  const { token_hash, ...rest } = r;
  return { ...(rest as Omit<Automation, 'has_token'>), has_token: !!token_hash };
}

export function useAutomations(spaceId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: key(spaceId),
    enabled: !!spaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('automations').select(COLUMNS).eq('activity_space_id', spaceId!).order('created_at');
      if (error) throw error;
      return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
    },
  });
  return {
    data: query.data ?? [],
    loading: !!spaceId && query.isPending,
    refetch: () => qc.invalidateQueries({ queryKey: key(spaceId) }),
  };
}

export function useAutomationEvents(automationId: string | null) {
  const query = useQuery({
    queryKey: ['automation-events', automationId ?? 'none'],
    enabled: !!automationId,
    queryFn: async () => {
      const { data, error } = await supabase.from('automation_events')
        .select('id, source, status, element_id, run_id, error, created_at')
        .eq('automation_id', automationId!).order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      const events = (data ?? []) as Omit<AutomationEvent, 'run_status'>[];
      // Each started event names its run; read the runs' states so a run
      // stopped at an approval shows as waiting, not as a plain start.
      // A run the reader cannot see simply carries no status.
      const runIds = [...new Set(events.map((e) => e.run_id).filter((id): id is string => !!id))];
      const statuses = new Map<string, string>();
      if (runIds.length) {
        const { data: runs } = await supabase.from('agent_runs').select('id, status').in('id', runIds);
        for (const r of (runs ?? []) as { id: string; status: string }[]) statuses.set(r.id, r.status);
      }
      return events.map((e) => ({ ...e, run_status: e.run_id ? statuses.get(e.run_id) ?? null : null }));
    },
  });
  return { data: query.data ?? [], loading: !!automationId && query.isPending, refetch: () => query.refetch() };
}

/** When a schedule next runs; null for a webhook or an unreadable cron. */
function nextRunOf(kind: AutomationKind, cron: string | null, timezone: string): string | null {
  if (kind !== 'schedule' || !cron) return null;
  try { return nextCronRun(cron, new Date(), timezone)?.toISOString() ?? null; } catch { return null; }
}

export async function createAutomation(input: {
  spaceId: string; name: string; definitionId: string | null; workflow?: string; objectId: string; kind: AutomationKind; cron: string | null; timezone: string;
}): Promise<Automation> {
  const { data, error } = await supabase.from('automations').insert({
    activity_space_id: input.spaceId, name: input.name.trim(), definition_id: input.definitionId, workflow: input.workflow ?? '', object_id: input.objectId,
    kind: input.kind, cron: input.kind === 'schedule' ? input.cron?.trim() || null : null, timezone: input.timezone,
    next_run_at: nextRunOf(input.kind, input.cron, input.timezone),
  }).select(COLUMNS).single();
  if (error) throw error;
  return fromRow(data as Record<string, unknown>);
}

/** Changes what an automation is: its harness (null for none), where its
 *  work goes, or its workflow. */
export async function updateAutomation(id: string, patch: Partial<Pick<Automation, 'definition_id' | 'object_id' | 'workflow' | 'name'>>): Promise<void> {
  const { error } = await supabase.from('automations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function setAutomationEnabled(a: Automation, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('automations')
    .update({ enabled, next_run_at: enabled ? nextRunOf(a.kind, a.cron, a.timezone) : a.next_run_at, updated_at: new Date().toISOString() })
    .eq('id', a.id);
  if (error) throw error;
}

export async function deleteAutomation(id: string): Promise<void> {
  const { error } = await supabase.from('automations').delete().eq('id', id);
  if (error) throw error;
}

/** A new webhook token. Only its hash is kept, so it is shown once. */
export async function issueWebhookToken(id: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const { error } = await supabase.from('automations').update({ token_hash: hash, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  return token;
}

export function webhookUrl(id: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/automations?hook=${id}`;
}

/** Starts it now, as its owner. Throws the function's own message on refusal. */
export async function runAutomationNow(id: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('automations', { body: { fire: id } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = error.message;
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) message = String(j.error); } catch { /* keep */ }
    }
    throw new Error(message);
  }
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
}
