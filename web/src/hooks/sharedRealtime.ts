'use client';

import { useEffect } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// One websocket subscription per topic, however many hook instances ask for
// it. Previously every hook instance minted its own channel (a per-instance
// random suffix worked around realtime-js de-duping channels by topic and
// refusing new listeners after subscribe), so six mounted useObjects meant six
// channels, six postgres_changes fan-outs, and six handlers reacting to the
// same event. Refcounting keeps the first channel alive until the last
// subscriber leaves. `build` must attach module-level handlers — it runs only
// for the first subscriber, so it must not close over component state.

interface Entry { channel: RealtimeChannel; count: number }
const entries = new Map<string, Entry>();

function retainChannel(
  topic: string,
  build: (channel: RealtimeChannel) => RealtimeChannel,
): () => void {
  let entry = entries.get(topic);
  if (!entry) {
    entry = { channel: build(supabase.channel(topic)).subscribe(), count: 0 };
    entries.set(topic, entry);
  }
  entry.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = entries.get(topic);
    if (!current) return;
    current.count -= 1;
    if (current.count <= 0) {
      entries.delete(topic);
      void supabase.removeChannel(current.channel);
    }
  };
}

/** Hook form: hold the shared channel for `topic` while mounted. */
export function useSharedChannel(
  topic: string | null,
  build: (channel: RealtimeChannel) => RealtimeChannel,
): void {
  useEffect(() => {
    if (!topic) return;
    return retainChannel(topic, build);
    // `build` is module-level by contract (see above) — only the topic matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);
}
