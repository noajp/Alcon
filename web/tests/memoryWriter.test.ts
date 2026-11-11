import { describe, expect, it } from 'vitest';

// The one writer of a durable memory at a person's word
// (_shared/memoryTools.ts writeDurableMemory): the remember tool, the
// pending-capability note, and the engine's keeping of a standing
// answer all go through it. One topic holds one fact per home, and
// the slot's unique index admits a single active durable — so the
// order of a replacement is the contract: the old fact is set aside,
// the new one is written pointing back at it, and a failed write puts
// the old fact back. A fact the person may not set aside is not
// replaced. These tests pin that order against a recording client.
const tools = await import(new URL('../../supabase/functions/_shared/memoryTools.ts', import.meta.url).pathname);

interface Op { op: 'select' | 'update' | 'insert'; values?: Record<string, unknown>; filters: [string, unknown][] }
type Existing = { id: string; layer: string; status: string; scope: string; activity_space_id: string | null; user_id: string | null; topic_key: string | null };

function recordingDb(opts: { existing?: Existing[]; asideRows?: number; insertError?: string } = {}) {
  const log: Op[] = [];
  const resultOf = (e: Op) => {
    if (e.op === 'select') return { data: opts.existing ?? [], error: null };
    if (e.op === 'insert') return opts.insertError ? { data: null, error: { message: opts.insertError } } : { data: { id: 'new' }, error: null };
    if (e.values?.status === 'superseded') return { data: Array.from({ length: opts.asideRows ?? 1 }, () => ({ id: 'old' })), error: null };
    return { data: null, error: null };
  };
  const db = {
    from: () => {
      const entry: Op = { op: 'select', filters: [] };
      log.push(entry);
      const b = {
        select: () => b,
        update: (v: Record<string, unknown>) => { entry.op = 'update'; entry.values = v; return b; },
        insert: (v: Record<string, unknown>) => { entry.op = 'insert'; entry.values = v; return b; },
        eq: (c: string, v: unknown) => { entry.filters.push([c, v]); return b; },
        single: () => Promise.resolve(resultOf(entry)),
        then: (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => Promise.resolve(resultOf(entry)).then(ok, no),
      };
      return b;
    },
  };
  return { db, log };
}

const fact = { kind: 'fact', topic: '担当：クレーム', title: '担当：クレーム', gist: '担当：クレーム：TAKA', body: '答え：TAKA' };
const standingInSpace: Existing = { id: 'old', layer: 'durable', status: 'active', scope: 'space', activity_space_id: 'space-1', user_id: null, topic_key: '担当:クレーム' };

describe('writeDurableMemory', () => {
  it('writes a Space fact as the person, keyed by its topic and without a fingerprint', async () => {
    const { db, log } = recordingDb();
    const r = await tools.writeDurableMemory(db, fact, { scope: 'space', spaceId: 'space-1' }, 'user-1');
    expect(r).toEqual({ ok: true, id: 'new', replaced: null });
    expect(log.map((o) => o.op)).toEqual(['select', 'insert']);
    expect(log[0].filters).toEqual(expect.arrayContaining([['scope', 'space'], ['activity_space_id', 'space-1'], ['status', 'active']]));
    expect(log[1].values).toMatchObject({
      layer: 'durable', kind: 'fact', status: 'active', scope: 'space', activity_space_id: 'space-1', user_id: null,
      topic_key: '担当:クレーム', fingerprint: null, origin: 'person', created_by: 'user-1', supersedes_id: null,
    });
  });

  it('keeps a personal fact under the person, and a keyless one carries its fingerprint', async () => {
    const { db, log } = recordingDb();
    await tools.writeDurableMemory(db, { ...fact, topic: null }, { scope: 'personal' }, 'user-1');
    expect(log[0].filters).toEqual(expect.arrayContaining([['scope', 'personal'], ['user_id', 'user-1']]));
    expect(log[1].values).toMatchObject({ scope: 'personal', user_id: 'user-1', activity_space_id: null, topic_key: null });
    expect(typeof log[1].values?.fingerprint).toBe('string');
  });

  it('replaces the fact standing under the topic: set aside first, then written pointing back', async () => {
    const { db, log } = recordingDb({ existing: [standingInSpace] });
    const r = await tools.writeDurableMemory(db, fact, { scope: 'space', spaceId: 'space-1' }, 'user-1');
    expect(r).toEqual({ ok: true, id: 'new', replaced: 'old' });
    expect(log.map((o) => o.op)).toEqual(['select', 'update', 'insert']);
    expect(log[1].values).toMatchObject({ status: 'superseded' });
    expect(log[1].filters).toEqual(expect.arrayContaining([['id', 'old'], ['status', 'active']]));
    expect(log[2].values).toMatchObject({ supersedes_id: 'old' });
  });

  it('does not write when the person may not set the standing fact aside', async () => {
    const { db, log } = recordingDb({ existing: [standingInSpace], asideRows: 0 });
    const r = await tools.writeDurableMemory(db, fact, { scope: 'space', spaceId: 'space-1' }, 'user-2');
    expect(r.ok).toBe(false);
    expect(log.map((o) => o.op)).toEqual(['select', 'update']);
  });

  it('puts the old fact back when the new one cannot be written', async () => {
    const { db, log } = recordingDb({ existing: [standingInSpace], insertError: 'boom' });
    const r = await tools.writeDurableMemory(db, fact, { scope: 'space', spaceId: 'space-1' }, 'user-1');
    expect(r).toEqual({ ok: false, error: 'boom' });
    expect(log.map((o) => o.op)).toEqual(['select', 'update', 'insert', 'update']);
    expect(log[3].values).toMatchObject({ status: 'active' });
    expect(log[3].filters).toEqual(expect.arrayContaining([['id', 'old'], ['status', 'superseded']]));
  });

  it('leaves another topic, another Space and another person’s facts standing', async () => {
    const others: Existing[] = [
      { ...standingInSpace, id: 'other-topic', topic_key: '担当:料金' },
      { ...standingInSpace, id: 'other-space', activity_space_id: 'space-2' },
      { ...standingInSpace, id: 'personal', scope: 'personal', activity_space_id: null, user_id: 'user-1' },
    ];
    const { db, log } = recordingDb({ existing: others });
    const r = await tools.writeDurableMemory(db, fact, { scope: 'space', spaceId: 'space-1' }, 'user-1');
    expect(r).toEqual({ ok: true, id: 'new', replaced: null });
    expect(log.map((o) => o.op)).toEqual(['select', 'insert']);
  });

  it('refuses a memory that carries a credential, before anything is touched', async () => {
    const { db, log } = recordingDb();
    const r = await tools.writeDurableMemory(db, { ...fact, body: '答え：password: hunter2hunter2' }, { scope: 'space', spaceId: 'space-1' }, 'user-1');
    expect(r.ok).toBe(false);
    expect(log).toEqual([]);
  });
});
