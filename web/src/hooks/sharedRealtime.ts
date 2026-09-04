'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// One websocket subscription per topic, however many subscribers ask for it.
// Refcounting keeps the first channel alive until the last subscriber leaves.
// `build` must attach module-level handlers — it runs only when a channel is
// (re)opened, so it must not close over component state.
//
// Two timing rules keep this correct under React StrictMode (cleanup then
// re-run of every effect in the same tick) and user switches:
// - a release does not tear the channel down at once; a retain inside the
//   grace window keeps the live channel, so a remount never re-joins
// - a real teardown is async (leave, then close); the topic is marked
//   `leaving` until it completes, and a retain during that window waits for
//   it instead of reusing the channel object realtime-js would hand back
//   for the same topic while it is still leaving.

const RELEASE_GRACE_MS = 50;

interface Entry {
  channel: RealtimeChannel | null;
  count: number;
  build: (channel: RealtimeChannel) => RealtimeChannel;
  removal: ReturnType<typeof setTimeout> | null;
  leaving: Promise<void> | null;
}
const entries = new Map<string, Entry>();

function open(topic: string, entry: Entry): void {
  const start = () => {
    if (entry.count === 0 || entry.channel) return;
    entry.channel = entry.build(supabase.channel(topic)).subscribe((status, err) => {
      // A silent CHANNEL_ERROR looks exactly like "no changes happened" —
      // say so. The usual cause is a table missing from the
      // supabase_realtime publication (see supabase/migrations).
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`realtime channel "${topic}" ${status}`, err ?? '');
      } else if (process.env.NODE_ENV === 'development') {
        console.debug(`realtime channel "${topic}" ${status}`);
      }
    });
  };
  if (entry.leaving) void entry.leaving.then(start);
  else start();
}

function close(topic: string, entry: Entry): void {
  const channel = entry.channel;
  entry.channel = null;
  entry.leaving = (channel ? supabase.removeChannel(channel) : Promise.resolve('ok' as const)).then(() => {
    entry.leaving = null;
    if (entry.count === 0) entries.delete(topic);
    else open(topic, entry); // retained while leaving — reopen on a fresh channel
  });
}

export function retainChannel(
  topic: string,
  build: (channel: RealtimeChannel) => RealtimeChannel,
): () => void {
  let entry = entries.get(topic);
  if (!entry) {
    entry = { channel: null, count: 0, build, removal: null, leaving: null };
    entries.set(topic, entry);
  }
  if (entry.removal) {
    clearTimeout(entry.removal);
    entry.removal = null;
  }
  entry.count += 1;
  if (!entry.channel && !entry.leaving) open(topic, entry);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = entries.get(topic);
    if (!current) return;
    current.count -= 1;
    if (current.count > 0 || current.removal) return;
    current.removal = setTimeout(() => {
      current.removal = null;
      if (current.count === 0) close(topic, current);
    }, RELEASE_GRACE_MS);
  };
}
