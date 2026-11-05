'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentUserId, supabase } from '@/lib/supabase';
import type { AgentRunStatus } from '@/types/database';

// =============================================================
// A conversation on a Strategy: a run of the agent engine whose subject is
// the Strategy (run-agent's conversation mode). Each person has their own;
// the latest one they started is the one shown. A message is sent to the
// engine, which answers and waits for the next. The page reads the
// conversation from the run's steps: the transcript stays on the server.
// =============================================================

export interface ConversationRun {
  id: string;
  status: AgentRunStatus;
  summary: string | null;
  error: string | null;
  cost_usd: number | string;
  created_at: string;
}

export interface ConversationStepRow { id: string; type: string; title: string; detail: string | null }

const COLUMNS = 'id, status, summary, error, cost_usd, created_at';
const WORKING: AgentRunStatus[] = ['queued', 'running'];

async function fetchConversation(strategyId: string): Promise<{ run: ConversationRun | null; steps: ConversationStepRow[] }> {
  const userId = await getCurrentUserId();
  if (!userId) return { run: null, steps: [] };
  const { data, error } = await supabase.from('agent_runs').select(COLUMNS)
    .eq('strategy_id', strategyId).eq('triggered_by', userId).eq('mode', 'converse')
    .order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  const run = ((data ?? [])[0] as unknown as ConversationRun | undefined) ?? null;
  if (!run) return { run: null, steps: [] };
  const { data: steps, error: stepError } = await supabase.from('agent_run_steps').select('id, type, title, detail')
    .eq('run_id', run.id).order('idx', { ascending: true });
  if (stepError) throw stepError;
  return { run, steps: (steps ?? []) as ConversationStepRow[] };
}

/** Asks the engine to take the person's message; its own error message on failure. */
async function sendToEngine(runId: string, message: string): Promise<void> {
  const { error } = await supabase.functions.invoke('run-agent', { body: { runId, message } });
  if (!error) return;
  const ctx = (error as { context?: Response }).context;
  let text = error.message;
  if (ctx && typeof ctx.json === 'function') {
    try { const j = await ctx.json(); if (j?.error) text = String(j.error); } catch { /* keep */ }
  }
  throw new Error(text);
}

/**
 * The person's conversation on this Strategy. While the engine is answering
 * it is read again every 1.5 s; `onAnswered` runs once each time an answer
 * lands, so the page can re-read what the conversation wrote.
 */
export function useStrategyConversation(strategyId: string, onAnswered?: () => void) {
  const qc = useQueryClient();
  const key = ['strategy-conversation', strategyId] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchConversation(strategyId),
    refetchInterval: (q) => {
      const run = (q.state.data as { run: ConversationRun | null } | undefined)?.run;
      return run && WORKING.includes(run.status) ? 1500 : false;
    },
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The message just sent, shown until the transcript carries it.
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);

  const run = fresh ? null : query.data?.run ?? null;
  const working = sending || (!!run && WORKING.includes(run.status));

  // An answer landed: the conversation may have written to the Strategy.
  const answered = useRef(onAnswered);
  useEffect(() => { answered.current = onAnswered; });
  const wasWorking = useRef(false);
  useEffect(() => {
    const now = !!run && WORKING.includes(run.status);
    if (wasWorking.current && !now) answered.current?.();
    wasWorking.current = now;
  }, [run]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true); setError(null); setPendingText(message);
    try {
      let runId = run?.id ?? null;
      if (!runId) {
        const userId = await getCurrentUserId();
        const { data, error: insertError } = await supabase.from('agent_runs').insert({
          // Its Space is stamped from the Strategy.
          strategy_id: strategyId, element_id: null, triggered_by: userId, triggered_from: 'strategy',
          status: 'queued', mode: 'converse',
        }).select('id').single();
        if (insertError) throw insertError;
        runId = (data as { id: string }).id;
        setFresh(false);
      }
      await sendToEngine(runId, message);
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
      setPendingText(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- key is derived from strategyId
  }, [run?.id, sending, strategyId, qc]);

  /** Starts over: the next message opens a new conversation. */
  const startOver = useCallback(() => { setFresh(true); setError(null); }, []);

  return {
    run,
    steps: fresh ? [] : query.data?.steps ?? [],
    loading: query.isLoading,
    working,
    sending,
    pendingText,
    error: error ?? (query.error ? (query.error as Error).message : null),
    send,
    startOver,
  };
}
