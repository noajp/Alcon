import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A client that behaves as realtime-js does where it matters here:
// - `channel(topic)` hands back the channel already listed for that topic, and
//   a channel stays listed until its leave has been acknowledged
// - `subscribe()` joins only a closed channel; on any other it does nothing
// - `removeChannel()` resolves when the leave is acknowledged, not at once
const JOIN_MS = 10;
const LEAVE_MS = 200;

type Meta = { name?: unknown };
type Status = (status: string) => void;

const wire = vi.hoisted(() => ({
  channels: [] as unknown[],
  /** topic → presence key → what that member announced. */
  present: new Map<string, Map<string, { name?: unknown }[]>>(),
  made: 0,
  joins: 0,
}));

class FakeChannel {
  state: 'closed' | 'joining' | 'joined' | 'leaving' = 'closed';
  syncs: (() => void)[] = [];
  status: Status = () => {};
  readonly key: string;
  constructor(readonly topic: string, readonly params: { config?: { private?: boolean; presence?: { key?: string } } }) {
    this.key = params.config?.presence?.key ?? '';
    wire.made += 1;
  }
  on(_type: string, _filter: unknown, handler: () => void) { this.syncs.push(handler); return this; }
  subscribe(callback: Status) {
    if (this.state !== 'closed') return this;
    this.state = 'joining';
    this.status = callback;
    setTimeout(() => {
      if (this.state !== 'joining') return;
      this.state = 'joined';
      wire.joins += 1;
      callback('SUBSCRIBED');
    }, JOIN_MS);
    return this;
  }
  presenceState() { return Object.fromEntries(wire.present.get(this.topic) ?? []); }
  track(meta: Meta) {
    if (this.state !== 'joined') return Promise.resolve('error');
    announce(this.topic, this.key, meta);
    return Promise.resolve('ok');
  }
}

const listed = () => wire.channels as FakeChannel[];

function sync(topic: string) {
  for (const channel of listed()) if (channel.topic === topic && channel.state === 'joined') channel.syncs.forEach((h) => h());
}
function announce(topic: string, key: string, meta: Meta) {
  if (!wire.present.has(topic)) wire.present.set(topic, new Map());
  wire.present.get(topic)!.set(key, [meta]);
  sync(topic);
}
const announced = (topic: string, key: string) => wire.present.get(topic)?.get(key)?.[0];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel(topic: string, params: FakeChannel['params'] = {}) {
      const existing = listed().find((c) => c.topic === topic);
      if (existing) return existing;
      const made = new FakeChannel(topic, params);
      wire.channels.push(made);
      return made;
    },
    removeChannel(channel: FakeChannel) {
      channel.state = 'leaving';
      return new Promise<string>((resolve) => setTimeout(() => {
        channel.state = 'closed';
        wire.channels.splice(wire.channels.indexOf(channel), 1);
        wire.present.get(channel.topic)?.delete(channel.key);
        sync(channel.topic);
        channel.status('CLOSED');
        resolve('ok');
      }, LEAVE_MS));
    },
  },
}));

import { supabase } from '@/lib/supabase';
import { watchPresence, type Viewer } from '@/hooks/presenceRoom';

const ME = 'me-1';
const GRACE_MS = 50;
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const channelFor = (topic: string) => listed().find((c) => c.topic === topic);

let topic = '';
let seq = 0;

beforeEach(() => {
  vi.useFakeTimers();
  wire.channels.length = 0;
  wire.present.clear();
  wire.made = 0;
  wire.joins = 0;
  topic = `note:${seq += 1}`;
});

afterEach(async () => {
  await pass(GRACE_MS + LEAVE_MS + JOIN_MS + 1);
  vi.useRealTimers();
});

describe('the fake client', () => {
  it('hands back a channel that is still leaving, and joining it again does nothing', async () => {
    const first = supabase.channel(topic).subscribe(() => {});
    await pass(JOIN_MS);
    void supabase.removeChannel(first);
    const again = supabase.channel(topic);
    expect(again).toBe(first);
    again.subscribe(() => {});
    await pass(JOIN_MS);
    expect(wire.joins).toBe(1);
    expect((first as unknown as FakeChannel).state).toBe('leaving');
  });
});

describe('watching who else has something open', () => {
  it('joins privately under the person\'s id and shows their name once joined', async () => {
    const stop = watchPresence(topic, ME, 'Aoi', () => {});
    expect(channelFor(topic)!.params.config).toEqual({ private: true, presence: { key: ME } });
    expect(announced(topic, ME)).toBeUndefined();
    await pass(JOIN_MS);
    expect(announced(topic, ME)).toEqual({ name: 'Aoi' });
    stop();
  });

  it('shows "Someone" for a person without a name', async () => {
    const stop = watchPresence(topic, ME, null, () => {});
    await pass(JOIN_MS);
    expect(announced(topic, ME)).toEqual({ name: 'Someone' });
    stop();
  });

  it('reports everyone else, with names as capped plain text', async () => {
    let seen: Viewer[] = [];
    const stop = watchPresence(topic, ME, 'Aoi', (viewers) => { seen = viewers; });
    await pass(JOIN_MS);
    announce(topic, 'other-1', { name: 'x'.repeat(200) });
    announce(topic, 'other-2', { name: { toString: () => '<b>Ren</b>' } });
    announce(topic, 'other-3', {});
    expect(seen).toEqual([
      { userId: 'other-1', name: 'x'.repeat(80) },
      { userId: 'other-2', name: '<b>Ren</b>' },
      { userId: 'other-3', name: 'Someone' },
    ]);
    stop();
  });

  it('is shown again after closing and reopening while the old channel is still leaving', async () => {
    const stopFirst = watchPresence(topic, ME, 'Aoi', () => {});
    await pass(JOIN_MS);
    const old = channelFor(topic)!;
    stopFirst();
    await pass(GRACE_MS);
    expect(old.state).toBe('leaving');

    let seen: Viewer[] = [];
    const stop = watchPresence(topic, ME, 'Aoi', (viewers) => { seen = viewers; });
    await pass(LEAVE_MS / 2);
    expect(announced(topic, ME)).toEqual({ name: 'Aoi' }); // the old channel's, until its leave lands
    await pass(LEAVE_MS / 2);
    expect(announced(topic, ME)).toBeUndefined();

    await pass(JOIN_MS);
    const fresh = channelFor(topic)!;
    expect(fresh).not.toBe(old);
    expect(fresh.state).toBe('joined');
    expect(announced(topic, ME)).toEqual({ name: 'Aoi' });
    announce(topic, 'other-1', { name: 'Ren' });
    expect(seen).toEqual([{ userId: 'other-1', name: 'Ren' }]);
    stop();
  });

  it('keeps the live channel across an immediate close and reopen, and says who is there', async () => {
    const stopFirst = watchPresence(topic, ME, 'Aoi', () => {});
    await pass(JOIN_MS);
    announce(topic, 'other-1', { name: 'Ren' });
    stopFirst();

    let seen: Viewer[] | null = null;
    const stop = watchPresence(topic, ME, 'Aoi', (viewers) => { seen = viewers; });
    expect(seen).toEqual([{ userId: 'other-1', name: 'Ren' }]);
    await pass(GRACE_MS + LEAVE_MS);
    expect(wire.made).toBe(1);
    expect(wire.joins).toBe(1);
    expect(announced(topic, ME)).toEqual({ name: 'Aoi' });
    stop();
  });

  it('shares one channel between several watchers of the same thing', async () => {
    const a: Viewer[][] = [];
    const b: Viewer[][] = [];
    const stopA = watchPresence(topic, ME, 'Aoi', (viewers) => a.push(viewers));
    const stopB = watchPresence(topic, ME, 'Aoi', (viewers) => b.push(viewers));
    await pass(JOIN_MS);
    announce(topic, 'other-1', { name: 'Ren' });
    expect(wire.made).toBe(1);
    expect(a.at(-1)).toEqual([{ userId: 'other-1', name: 'Ren' }]);
    expect(b.at(-1)).toEqual([{ userId: 'other-1', name: 'Ren' }]);

    stopA();
    await pass(GRACE_MS + LEAVE_MS);
    const before = a.length;
    announce(topic, 'other-2', { name: 'Mio' });
    expect(a.length).toBe(before);
    expect(b.at(-1)).toEqual([{ userId: 'other-1', name: 'Ren' }, { userId: 'other-2', name: 'Mio' }]);
    expect(channelFor(topic)!.state).toBe('joined');
    stopB();
  });

  it('shows a name that arrives after the channel is joined', async () => {
    const stopFirst = watchPresence(topic, ME, null, () => {});
    await pass(JOIN_MS);
    expect(announced(topic, ME)).toEqual({ name: 'Someone' });
    stopFirst();
    const stop = watchPresence(topic, ME, 'Aoi', () => {});
    expect(announced(topic, ME)).toEqual({ name: 'Aoi' });
    expect(wire.joins).toBe(1);
    stop();
  });

  it('leaves once nobody is watching', async () => {
    const stop = watchPresence(topic, ME, 'Aoi', () => {});
    await pass(JOIN_MS);
    stop();
    await pass(GRACE_MS + LEAVE_MS);
    expect(channelFor(topic)).toBeUndefined();
    expect(announced(topic, ME)).toBeUndefined();
  });
});
