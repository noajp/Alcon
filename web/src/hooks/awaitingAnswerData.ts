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
// something says what waits may have changed (refreshAwaitingAnswers):
// an answer sent from the Inbox, a question arriving there. A read that
// fails is not tried again until it would be stale anyway.

const STALE_MS = 30_000;
const EMPTY: ReadonlySet<string> = new Set();

let ids: ReadonlySet<string> = EMPTY;
/** Whose tickets `ids` holds: another person signing in starts from nothing. */
let owner: string | null = null;
/** When the store last tried to read — a failed try counts, so rows
 *  mounting one after another do not each try again. */
let triedAt = 0;
let reading = false;
/** Asked to read again while a read was under way: that read may have
 *  been answered before the change, so one more follows it. */
let again = false;
const listeners = new Set<() => void>();

/** Hands the rows a new Set only when what it holds changed: every row
 *  on the page reads it, and the same answer must not redraw them all. */
function emit(next: ReadonlySet<string>) {
  if (next.size === ids.size && [...next].every((id) => ids.has(id))) return;
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
    // Only the run's starter can answer its question, and only while the
    // run still rests on it — a run that was stopped leaves its ticket
    // open, and nobody can answer that. The Inbox card asks the same.
    const { data, error } = await supabase
      .from('question_tickets')
      .select('element_id, agent_runs!inner(triggered_by, status)')
      .eq('status', 'open')
      .gt('expires_at', new Date().toISOString())
      .not('element_id', 'is', null)
      .eq('agent_runs.triggered_by', userId)
      .eq('agent_runs.status', 'awaiting_input')
      .limit(500);
    if (error) throw error;
    emit(awaitingElementIds((data ?? []) as { element_id: string | null }[]));
  } catch (error) {
    // A failed read keeps what was known: a mark that goes missing is
    // quieter than one that lies, and the Inbox still holds the question.
    console.error('Failed to read the Elements waiting for an answer:', error);
  } finally {
    reading = false;
    if (again) { again = false; void read(); }
  }
}

const readIfStale = () => { if (Date.now() - triedAt > STALE_MS) void read(); };
const onVisible = () => { if (document.visibilityState === 'visible') readIfStale(); };

/** Something changed what waits (an answer was sent): read again now. */
export function refreshAwaitingAnswers(): void {
  triedAt = 0;
  if (listeners.size === 0) return;
  if (reading) again = true; else void read();
}

/** Whoever signs out or in, the marks are theirs alone: the previous
 *  person's are dropped at once, not at the next read. */
let authSubscription: { unsubscribe: () => void } | null = null;
function onAuthChange(userId: string | null) {
  if (userId === owner) return;
  owner = userId;
  emit(EMPTY);
  triedAt = 0;
  if (userId && listeners.size > 0) void read();
}

// One listener on the document for the whole store, however many rows
// read it: there while anything is subscribed, gone with the last.
function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    document.addEventListener('visibilitychange', onVisible);
    authSubscription = supabase.auth.onAuthStateChange((_event, session) => onAuthChange(session?.user?.id ?? null)).data.subscription;
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener('visibilitychange', onVisible);
      authSubscription?.unsubscribe();
      authSubscription = null;
    }
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
