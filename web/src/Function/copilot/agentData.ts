'use client';
import { getCurrentUserId, supabase } from '@/lib/supabase';
import type { AgentAction, AgentOutput, AgentRun, AgentRunMode, AgentRunStatus, AgentRunStep } from '@/types/database';
import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================
// Agent Runs — an AI carrying out an Element's task (ADR 0027)
// ============================================
// The run-agent Edge Function works the task with the person's permissions,
// stops for their approval before external writes (agent_actions), saves
// deliverables when the task calls for them (agent_artifacts) and ends with a
// report comment. agent_run_steps is the live "Workpad"; the hook below polls
// it while a run is working.

/** A run that is still this Element's run: one at a time. */
const AGENT_RUN_OPEN_STATUSES: AgentRunStatus[] = ['queued', 'running', 'awaiting_approval', 'paused'];
/** A run whose Workpad is moving. */
const AGENT_RUN_WORKING_STATUSES: AgentRunStatus[] = ['queued', 'running'];

function isAgentRunActive(run: AgentRun | null | undefined): boolean {
  return !!run && AGENT_RUN_WORKING_STATUSES.includes(run.status);
}

export function isAgentRunOpen(run: AgentRun | null | undefined): boolean {
  return !!run && AGENT_RUN_OPEN_STATUSES.includes(run.status);
}

// run-agent's SESSION_PAUSE, word for word: the one pause that resumes on
// its own when the run's person opens the Element.
const SESSION_PAUSE = 'セッションの期限が切れたため一時停止しました。Element を開くと続きから再開します。';

/** Pure. The paused runs that resume on their own when their person opens them. */
function resumesOnOpen(run: AgentRun | null | undefined): boolean {
  return !!run && run.status === 'paused' && run.error === SESSION_PAUSE;
}

/** A queued run the engine never picked up (its hand-off failed) is handed over again after this long. */
const STUCK_QUEUED_MS = 30_000;

// The run's columns a browser may read: everything but the transcript and
// the continuation token, which stay with the Edge Function (they can hold
// data read with the starter's permissions).
const AGENT_RUN_COLUMNS =
  'id, element_id, domain_id, worker_id, status, model, triggered_from, triggered_by, summary, result, error, step_count, started_at, finished_at, created_at, mode, prompt, reply_to, input_tokens, output_tokens, cost_usd, activity_space_id, continuation_count';

// Latest run for an Element (any status), or null if it's never been run.
async function fetchLatestAgentRun(elementId: string): Promise<AgentRun | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select(AGENT_RUN_COLUMNS)
    .eq('element_id', elementId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentRun) ?? null;
}

async function fetchAgentRunSteps(runId: string): Promise<AgentRunStep[]> {
  const { data, error } = await supabase
    .from('agent_run_steps')
    .select('*')
    .eq('run_id', runId)
    .order('idx', { ascending: true });
  if (error) throw error;
  return (data || []) as AgentRunStep[];
}

async function fetchPendingAgentAction(runId: string): Promise<AgentAction | null> {
  const { data, error } = await supabase
    .from('agent_actions')
    .select('*')
    .eq('run_id', runId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentAction) ?? null;
}

async function fetchAgentOutputs(elementId: string): Promise<AgentOutput[]> {
  const { data, error } = await supabase
    .from('agent_artifacts')
    .select('*')
    .eq('element_id', elementId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as AgentOutput[];
}

/** Ask the engine to act on a run. The user's session goes with the call. */
async function invokeEngine(body: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.functions.invoke('run-agent', { body });
  if (error) {
    // supabase-js wraps non-2xx answers; surface the engine's own message.
    const ctx = (error as { context?: Response }).context;
    let message = error.message;
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) message = String(j.error); } catch { /* keep */ }
    }
    throw new Error(message);
  }
}

// Start a run for an Element: create the queued row, then hand it to the
// engine. One open run per Element — an open one is returned instead, with
// `existing: true`, so the caller can say so rather than drop the request.
interface StartOptions {
  elementId: string;
  domainId?: string | null;
  triggeredFrom?: 'board' | 'detail' | 'comment';
  workerId?: string | null;
  mode?: AgentRunMode;
  prompt?: string | null;
  replyTo?: string | null;
}

async function startAgentRun(opts: StartOptions, retried = false): Promise<{ run: AgentRun; existing: boolean }> {
  const userId = await getCurrentUserId();
  const { data: existing } = await supabase
    .from('agent_runs')
    .select(AGENT_RUN_COLUMNS)
    .eq('element_id', opts.elementId)
    .in('status', AGENT_RUN_OPEN_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existing && existing.length > 0) {
    const open = existing[0] as AgentRun;
    // A queued run whose hand-off was lost would block the Element for good:
    // its person hands it over again (the engine's claim makes this safe).
    if (open.status === 'queued' && open.triggered_by === userId
        && Date.now() - new Date(open.created_at).getTime() > STUCK_QUEUED_MS) {
      try { await invokeEngine({ runId: open.id }); } catch { /* already claimed */ }
    }
    return { run: open, existing: true };
  }

  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      element_id: opts.elementId,
      domain_id: opts.domainId ?? null,
      worker_id: opts.workerId ?? null,
      triggered_from: opts.triggeredFrom ?? null,
      triggered_by: userId ?? null,
      status: 'queued',
      mode: opts.mode ?? 'execute',
      prompt: opts.prompt?.trim() || null,
      reply_to: opts.replyTo ?? null,
    })
    .select(AGENT_RUN_COLUMNS)
    .single();
  // Another start won the race (one open run per Element): return its run.
  if (error?.code === '23505' && !retried) return startAgentRun(opts, true);
  if (error) throw error;
  const run = data as unknown as AgentRun;
  // The engine answers 202 at once and works in the background. If the
  // hand-off fails, the queued row is closed so it doesn't hold the Element.
  try {
    await invokeEngine({ runId: run.id });
  } catch (e) {
    await cancelAgentRun(run.id).catch(() => undefined);
    throw e;
  }
  return { run, existing: false };
}

/** What became of a request to start a run. */
export type AgentStartOutcome = 'started' | 'busy' | 'failed';

/** Starts an Element's run from outside its page (a Strategy's Execute
 *  tab): 'busy' when it already has an open run. */
export async function startElementRun(elementId: string, domainId?: string | null): Promise<AgentStartOutcome> {
  try {
    const { existing } = await startAgentRun({ elementId, domainId: domainId ?? null, triggeredFrom: 'board' });
    return existing ? 'busy' : 'started';
  } catch {
    return 'failed';
  }
}

async function cancelAgentRun(runId: string): Promise<void> {
  const { error } = await supabase
    .from('agent_runs')
    .update({ status: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', runId)
    .in('status', AGENT_RUN_OPEN_STATUSES);
  if (error) throw error;
}

async function resumeAgentRun(runId: string): Promise<void> {
  await invokeEngine({ runId, resume: true });
}

/** Approve or reject a pending action — bound to the input that was shown. */
async function decideAgentAction(opts: {
  runId: string;
  action: AgentAction;
  approve: boolean;
  note?: string;
}): Promise<void> {
  await invokeEngine({
    runId: opts.runId,
    decision: { actionId: opts.action.id, approve: opts.approve, inputHash: opts.action.input_hash, note: opts.note?.trim() || undefined },
  });
}

// Runtime check for settings screens — the engine reports whether its
// model key is configured.
export async function pingAgentRuntime(): Promise<{
  ok: boolean;
  key_configured: boolean;
  model_default?: string;
}> {
  const { data, error } = await supabase.functions.invoke('run-agent', {
    body: { ping: true },
  });
  if (error) throw error;
  return data as { ok: boolean; key_configured: boolean; model_default?: string };
}

// Hook: an Element's latest run, its Workpad, its pending approval and the
// Element's deliverables. `autoLoad` (default true) fetches on mount; board
// cards pass false and stay idle until pressed. While the run works the hook
// polls every 1.5s; a run waiting on a person is re-read every 8s so a
// decision made elsewhere shows up.
export function useAgentRun(
  elementId: string | null,
  opts?: { autoLoad?: boolean },
) {
  const autoLoad = opts?.autoLoad ?? true;
  const [run, setRun] = useState<AgentRun | null>(null);
  const [steps, setSteps] = useState<AgentRunStep[]>([]);
  const [pending, setPending] = useState<AgentAction | null>(null);
  const [outputs, setOutputs] = useState<AgentOutput[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [starting, setStarting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const resumedRef = useRef<string | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getCurrentUserId().then((id) => { if (!cancelled) setMe(id ?? null); });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async (id: string | null) => {
    const latest = id ? await fetchLatestAgentRun(id) : null;
    const [latestSteps, latestPending, latestArtifacts] = await Promise.all([
      latest ? fetchAgentRunSteps(latest.id) : Promise.resolve([]),
      latest?.status === 'awaiting_approval' ? fetchPendingAgentAction(latest.id) : Promise.resolve(null),
      id ? fetchAgentOutputs(id) : Promise.resolve([]),
    ]);
    return { latest, latestSteps, latestPending, latestArtifacts };
  }, []);

  useEffect(() => {
    if (!autoLoad) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await load(elementId);
        if (cancelled) return;
        setRun(r.latest);
        setSteps(r.latestSteps);
        setPending(r.latestPending);
        setOutputs(r.latestArtifacts);
      } catch (e) {
        console.error('useAgentRun load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [autoLoad, elementId, load]);

  const status = run?.status ?? null;
  const runId = run?.id ?? null;

  // Poll while working (fast) or waiting on a person (slow).
  useEffect(() => {
    if (!runId || !status || !AGENT_RUN_OPEN_STATUSES.includes(status)) return;
    const every = AGENT_RUN_WORKING_STATUSES.includes(status) ? 1500 : 8000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await load(elementId);
        if (cancelled) return;
        if (r.latest) setRun(r.latest);
        setSteps(r.latestSteps);
        setPending(r.latestPending);
        setOutputs(r.latestArtifacts);
      } catch (e) {
        console.error('useAgentRun poll failed', e);
      }
      if (!cancelled) timer = setTimeout(tick, every);
    };
    timer = setTimeout(tick, every);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [runId, status, elementId, load]);

  // A run paused only because its session expired resumes when its person
  // opens the Element again — once per page view.
  useEffect(() => {
    if (!run || !resumesOnOpen(run) || resumedRef.current === run.id) return;
    resumedRef.current = run.id;
    void (async () => {
      const me = await getCurrentUserId();
      if (me && me === run.triggered_by) {
        try {
          await resumeAgentRun(run.id);
          setRun((prev) => (prev ? { ...prev, status: 'running', error: null } : prev));
        } catch (e) {
          console.error('auto-resume failed', e);
        }
      }
    })();
  }, [run]);

  const start = useCallback(
    async (startOpts?: {
      domainId?: string | null;
      triggeredFrom?: 'board' | 'detail' | 'comment';
      workerId?: string | null;
      mode?: AgentRunMode;
      prompt?: string | null;
      replyTo?: string | null;
    }): Promise<AgentStartOutcome> => {
      if (!elementId) return 'failed';
      if (startingRef.current) return 'busy';
      startingRef.current = true;
      setStarting(true);
      setError(null);
      try {
        const { run: newRun, existing } = await startAgentRun({ elementId, ...startOpts });
        if (existing) {
          // The Element's open run stays as it is — its approval card included.
          const r = await load(elementId);
          setRun(r.latest);
          setSteps(r.latestSteps);
          setPending(r.latestPending);
          return 'busy';
        }
        setRun(newRun);
        setPending(null);
        setSteps([]);
        return 'started';
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return 'failed';
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [elementId, load],
  );

  const cancel = useCallback(async () => {
    if (!run) return;
    const before = { run, pending };
    setRun({ ...run, status: 'cancelled' });
    setPending(null);
    try {
      await cancelAgentRun(run.id);
    } catch (e) {
      setRun(before.run);
      setPending(before.pending);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [run, pending]);

  const resume = useCallback(async () => {
    if (!run) return;
    const before = run;
    setRun({ ...run, status: 'running', error: null });
    setError(null);
    try {
      await resumeAgentRun(run.id);
    } catch (e) {
      setRun(before);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [run]);

  const decide = useCallback(async (approve: boolean, note?: string) => {
    if (!run || !pending || deciding) return;
    setDeciding(true);
    setError(null);
    const before = { run, pending };
    setRun({ ...run, status: 'running' });
    setPending(null);
    try {
      await decideAgentAction({ runId: run.id, action: before.pending, approve, note });
    } catch (e) {
      setRun(before.run);
      setPending(before.pending);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeciding(false);
    }
  }, [run, pending, deciding]);

  const isActive = isAgentRunActive(run);
  /** Only the run's starter may approve, reject or resume it (ADR 0027); others watch and may stop it. */
  const isMine = !!run && !!me && run.triggered_by === me;
  return { run, steps, pending, outputs, loading, starting, deciding, error, isActive, isMine, start, cancel, resume, decide };
}
