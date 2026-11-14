'use client';

import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { fromBase64, toBase64 } from 'lib0/buffer';
import { supabase } from '@/lib/supabase';

// The wire for editing one Note together: its shared document (Yjs) and where
// everyone's cursor is, carried on the Note's private broadcast channel
// `note-edit:<id>` (only those who can write the Note may join it — migration
// 20270108090000). There is no server copy of the shared document: whoever has
// the Note open holds it, a newcomer asks the others for what they have, and
// the Note's saved HTML stays the record (the editor saves it as before).

const REMOTE = Symbol('note-collab-remote');

/** How long a newcomer waits to hear from anyone already editing. */
const SETTLE_MS = 700;

export interface NoteCollab {
  doc: Y.Doc;
  awareness: Awareness;
  /** 'peers' once someone already editing answered; 'alone' when nobody did. */
  settled: Promise<'peers' | 'alone'>;
  destroy: () => void;
}

export function openNoteCollab(noteId: string): NoteCollab {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const channel = supabase.channel(`note-edit:${noteId}`, {
    config: { private: true, broadcast: { self: false } },
  });
  let open = false;
  const send = (event: string, payload: Record<string, unknown>) => {
    if (open) void channel.send({ type: 'broadcast', event, payload });
  };

  let settle: (how: 'peers' | 'alone') => void = () => {};
  const settled = new Promise<'peers' | 'alone'>((resolve) => { settle = resolve; });
  let done = false;
  const finish = (how: 'peers' | 'alone') => { if (!done) { done = true; settle(how); } };

  channel.on('broadcast', { event: 'update' }, ({ payload }) => {
    if (typeof payload?.u !== 'string') return;
    Y.applyUpdate(doc, fromBase64(payload.u), REMOTE);
    finish('peers');
  });
  channel.on('broadcast', { event: 'sync' }, ({ payload }) => {
    // A newcomer's state vector: answer with what it is missing, and with
    // where this side's cursor is.
    if (typeof payload?.sv !== 'string') return;
    const missing = Y.encodeStateAsUpdate(doc, fromBase64(payload.sv));
    send('update', { u: toBase64(missing) });
    send('awareness', { u: toBase64(encodeAwarenessUpdate(awareness, [doc.clientID])) });
  });
  channel.on('broadcast', { event: 'awareness' }, ({ payload }) => {
    if (typeof payload?.u !== 'string') return;
    applyAwarenessUpdate(awareness, fromBase64(payload.u), REMOTE);
  });

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) send('update', { u: toBase64(update) });
  };
  doc.on('update', onUpdate);
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === REMOTE) return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length) send('awareness', { u: toBase64(encodeAwarenessUpdate(awareness, changed)) });
  };
  awareness.on('update', onAwareness);

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      open = true;
      send('sync', { sv: toBase64(Y.encodeStateVector(doc)) });
      send('awareness', { u: toBase64(encodeAwarenessUpdate(awareness, [doc.clientID])) });
      setTimeout(() => finish('alone'), SETTLE_MS);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      // Cannot reach the others: edit alone; the Note still saves.
      finish('alone');
    }
  });

  return {
    doc,
    awareness,
    settled,
    destroy: () => {
      removeAwarenessStates(awareness, [doc.clientID], 'local');
      doc.off('update', onUpdate);
      awareness.off('update', onAwareness);
      void supabase.removeChannel(channel);
      awareness.destroy();
      doc.destroy();
    },
  };
}
