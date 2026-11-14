'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { retainChannel } from './sharedRealtime';

export interface Viewer { userId: string; name: string }

// One presence channel per topic, shared by everything on the page that
// watches it. The channel is held through `retainChannel`, so closing and
// reopening the same thing keeps the live channel or waits for a fresh one —
// it never ends up on a channel that is still leaving.
//
// `retainChannel` keeps the first watcher's `build` and `onStatus` for the
// life of the channel, so both know only the topic and look the current
// watchers up here.

interface Watcher {
  userId: string;
  name: string | null;
  onViewers: (viewers: Viewer[]) => void;
}

interface Room {
  /** The channel most recently opened for the topic. */
  channel: RealtimeChannel | null;
  watchers: Set<Watcher>;
  /** The name sent since the channel last joined; null when none has been. */
  announced: string | null;
}

const rooms = new Map<string, Room>();

function roomOf(topic: string): Room {
  let room = rooms.get(topic);
  if (!room) {
    room = { channel: null, watchers: new Set(), announced: null };
    rooms.set(topic, room);
  }
  return room;
}

function joined(room: Room): RealtimeChannel | null {
  return room.channel && room.channel.state === 'joined' ? room.channel : null;
}

/** Everyone on the channel but this person. */
function viewersFor(channel: RealtimeChannel, userId: string): Viewer[] {
  const state = channel.presenceState<{ name?: unknown }>();
  return Object.entries(state)
    .filter(([key]) => key !== userId)
    // Names are what other members announce: shown as text, never trusted further.
    .map(([key, metas]) => ({ userId: key, name: String(metas[0]?.name || 'Someone').slice(0, 80) }));
}

/** Sends this person's name once the channel is joined, and again when the name changes. */
function announce(room: Room): void {
  const channel = joined(room);
  if (!channel || room.watchers.size === 0) return;
  let name = 'Someone';
  for (const watcher of room.watchers) if (watcher.name) name = watcher.name;
  if (name === room.announced) return;
  room.announced = name;
  void channel.track({ name });
}

function build(topic: string): (channel: RealtimeChannel) => RealtimeChannel {
  return (channel) => {
    const room = roomOf(topic);
    room.channel = channel;
    room.announced = null;
    return channel.on('presence', { event: 'sync' }, () => {
      const current = rooms.get(topic);
      if (!current || current.channel !== channel) return;
      for (const watcher of current.watchers) watcher.onViewers(viewersFor(channel, watcher.userId));
    });
  };
}

function onStatus(topic: string): (status: string) => void {
  return (status) => {
    const room = rooms.get(topic);
    if (!room) return;
    if (status === 'SUBSCRIBED') {
      // Every join starts with nothing announced, a rejoin after a drop included.
      room.announced = null;
      announce(room);
    } else if (status === 'CLOSED' && room.watchers.size === 0) {
      rooms.delete(topic);
    }
  };
}

/**
 * Joins the topic's private presence channel as `userId`, shows `name` to the
 * others there, and reports everyone else on it to `onViewers` whenever that
 * changes. Returns the function that stops watching.
 */
export function watchPresence(
  topic: string,
  userId: string,
  name: string | null,
  onViewers: (viewers: Viewer[]) => void,
): () => void {
  const room = roomOf(topic);
  const watcher: Watcher = { userId, name, onViewers };
  room.watchers.add(watcher);
  const release = retainChannel(topic, build(topic), {
    config: { private: true, presence: { key: userId } },
    onStatus: onStatus(topic),
  });
  // A channel someone else already holds open: nothing more will arrive until
  // presence next changes, so say who is there now.
  const channel = joined(room);
  if (channel) {
    announce(room);
    onViewers(viewersFor(channel, userId));
  }
  return () => {
    room.watchers.delete(watcher);
    release();
  };
}
