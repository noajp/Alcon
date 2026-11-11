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
// something says an answer was sent (refreshAwaitingAnswers). A read
// that fails is not tried again until it would be stale anyway.

const STALE_MS = 30_000;
const EMPTY: ReadonlySet<string> = new Set();

let ids: ReadonlySet<string> = EMPTY;
/** Whose tickets `ids` holds: another person signing in starts from nothing. */
let owner: string | null = null;
/** When the store last tried to read — a failed try counts, so rows
 *  mounting one after another do not each try again. */
let triedAt = 0;
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
  triedAt = Date.now();
  try {
    const userId = await getCurrentUserId();
    if (userId !== owner) { owner = userId; emit(EMPTY); }
    if (!userId) return;
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
  } catch (error) {
    // A failed read keeps what was known: a mark that goes missing is
    // quieter than one that lies, and the Inbox still holds the question.
    console.error('Failed to read the Elements waiting for an answer:', error);
  } finally {
    reading = false;
  }
}

const readIfStale = () => { if (Date.now() - triedAt > STALE_MS) void read(); };
const onVisible = () => { if (document.visibilityState === 'visible') readIfStale(); };

/** Something changed what waits (an answer was sent): read again now. */
export function refreshAwaitingAnswers(): void {
  triedAt = 0;
  if (listeners.size > 0) void read();
}

// One listener on the document for the whole store, however many rows
// read it: there while anything is subscribed, gone with the last.
function subscribe(listener: () => void) {
  if (listeners.size === 0) document.addEventListener('visibilitychange', onVisible);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) document.removeEventListener('visibilitychange', onVisible);
  };
}
const snapshot = () => ids;
const serverSnapshot = () => EMPTY;

/** The Elements with a question waiting for the signed-in person's answer. */
export function useAwaitingAnswerElementIds(): ReadonlySet<string> {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(readIfStale, []);
  return current;
}
