'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getCurrentUserId, supabase } from '@/lib/supabase';

// The Elements that wait on the signed-in person: a run they started
// asked a question about the Element, and the ticket still stands open.
// Lists mark those rows, so "is anything of mine stuck on me?" is read
// off the list instead of the Inbox alone.
//
// One store for every row and every list on the page — a row reads a
// Set, it never asks the database. The store is read when a list first
// shows, again when the tab is looked at after a while, and whenever
// something says an answer was sent (refreshAwaitingAnswers).

const STALE_MS = 30_000;
const EMPTY: ReadonlySet<string> = new Set();

let ids: ReadonlySet<string> = EMPTY;
let readAt = 0;
let reading = false;
const listeners = new Set<() => void>();

function emit(next: ReadonlySet<string>) {
  ids = next;
  listeners.forEach((fn) => fn());
}

/** Pure. The Elements named by these ticket rows, once each. */
export function awaitingElementIds(rows: readonly { element_id: string | null }[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const r of rows) if (r.element_id) out.add(r.element_id);
  return out;
}

async function read(): Promise<void> {
  if (reading) return;
  reading = true;
  try {
    const userId = await getCurrentUserId();
    if (!userId) { emit(EMPTY); return; }
    // Only the run's starter can answer its question, so only their
    // tickets count as waiting on them.
    const { data, error } = await supabase
      .from('question_tickets')
      .select('element_id, agent_runs!inner(triggered_by)')
      .eq('status', 'open')
      .gt('expires_at', new Date().toISOString())
      .not('element_id', 'is', null)
      .eq('agent_runs.triggered_by', userId)
      .limit(500);
    if (error) throw error;
    emit(awaitingElementIds((data ?? []) as { element_id: string | null }[]));
    readAt = Date.now();
  } catch (error) {
    // A failed read keeps what was known: a mark that goes missing is
    // quieter than one that lies, and the Inbox still holds the question.
    console.error('Failed to read the Elements waiting for an answer:', error);
  } finally {
    reading = false;
  }
}

/** Something changed what waits (an answer was sent): read again now. */
export function refreshAwaitingAnswers(): void {
  readAt = 0;
  if (listeners.size > 0) void read();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const snapshot = () => ids;

/** The Elements with a question waiting for the signed-in person's answer. */
export function useAwaitingAnswerElementIds(): ReadonlySet<string> {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    const readIfStale = () => { if (Date.now() - readAt > STALE_MS) void read(); };
    readIfStale();
    const onVisible = () => { if (document.visibilityState === 'visible') readIfStale(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return current;
}
