import { describe, expect, it } from 'vitest';

// The missing-capability reflex's deterministic half: the topic key a
// pending rule is recorded under, its parsing, the match against a
// manifest's command names, the recording tool's row, and the
// heartbeat's treatment of a landed capability (told once).

const pc = await import(new URL('../../supabase/functions/_shared/pendingCapability.ts', import.meta.url).pathname) as unknown as {
  pendingCapabilityTopicKey: (preset: string, command: string) => string | null;
  parsePendingCapabilityTopicKey: (key: string | null | undefined) => { preset: string; command: string } | null;
  matchPendingCapabilities: (rows: readonly { id: string; topic_key: string | null; title: string; created_at: string }[], preset: string | null | undefined, commandNames: readonly string[]) => { id: string; preset: string; command: string }[];
};
const tools = await import(new URL('../../supabase/functions/_shared/memoryTools.ts', import.meta.url).pathname) as unknown as {
  runMemoryTool: (db: unknown, name: string, input: Record<string, unknown>, actor: { agent: string; userId: string }) => Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }>;
  NOTE_PENDING_CAPABILITY_TOOL: { name: string };
};
const snap = await import(new URL('../../supabase/functions/_shared/heartbeatSnapshot.ts', import.meta.url).pathname) as unknown as {
  buildHeartbeatSnapshot: (signals: readonly Record<string, unknown>[], opts: { now: Date; thresholdHours: number; previousFingerprints: readonly string[] }) => {
    candidates: { signalId: string; kind: string }[];
    silenced: number;
    pending: { kind: string }[];
  };
};

describe('pendingCapabilityTopicKey / parse', () => {
  it('builds the key folded, and parses it back', () => {
    expect(pc.pendingCapabilityTopicKey('GitHub', 'delete_branch')).toBe('pending-capability:github:delete_branch');
    expect(pc.parsePendingCapabilityTopicKey('pending-capability:github:delete_branch'))
      .toEqual({ preset: 'github', command: 'delete_branch' });
  });

  it('empty halves make no key; foreign keys parse to nothing', () => {
    expect(pc.pendingCapabilityTopicKey('', 'x')).toBeNull();
    expect(pc.pendingCapabilityTopicKey('github', ' ')).toBeNull();
    expect(pc.parsePendingCapabilityTopicKey('weekly-report')).toBeNull();
    expect(pc.parsePendingCapabilityTopicKey('pending-capability:github')).toBeNull();
    expect(pc.parsePendingCapabilityTopicKey(null)).toBeNull();
  });
});

describe('matchPendingCapabilities', () => {
  const rows = [
    { id: 'm1', topic_key: 'pending-capability:github:delete_branch', title: 'GitHub の delete_branch が使えるようになったら', created_at: '2026-11-01T00:00:00Z' },
    { id: 'm2', topic_key: 'pending-capability:github:merge_pull_request', title: '…', created_at: '2026-11-01T00:00:00Z' },
    { id: 'm3', topic_key: 'pending-capability:slack:post_message', title: '…', created_at: '2026-11-01T00:00:00Z' },
    { id: 'm4', topic_key: 'something-else', title: '…', created_at: '2026-11-01T00:00:00Z' },
  ];

  it('matches only the recorded preset whose command landed', () => {
    expect(pc.matchPendingCapabilities(rows, 'github', ['list_branches', 'delete_branch']).map((r) => r.id)).toEqual(['m1']);
    expect(pc.matchPendingCapabilities(rows, 'github', ['list_branches'])).toEqual([]);
    expect(pc.matchPendingCapabilities(rows, 'slack', ['delete_branch'])).toEqual([]);
    expect(pc.matchPendingCapabilities(rows, null, ['delete_branch'])).toEqual([]);
  });
});

describe('note_pending_capability — the recording tool', () => {
  type Row = Record<string, unknown>;

  function fakeDb(existing: Row[]) {
    const inserted: Row[] = [];
    const updated: { id: unknown; patch: Row }[] = [];
    const from = () => {
      const filters = new Map<string, unknown>();
      let mode = '';
      let payload: Row = {};
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.set(k, v); return q; },
        insert: (row: Row) => { mode = 'insert'; payload = row; return q; },
        update: (row: Row) => { mode = 'update'; payload = row; return q; },
        single: async () => {
          if (mode === 'insert') {
            const row = { id: 'mem-new', ...payload };
            inserted.push(row);
            return { data: row, error: null };
          }
          return { data: null, error: null };
        },
        then: (res: (v: { data: Row[]; error: null }) => unknown, rej?: (e: unknown) => unknown) => {
          if (mode === 'update') {
            updated.push({ id: filters.get('id'), patch: payload });
            return Promise.resolve({ data: [], error: null }).then(res, rej);
          }
          const data = existing.filter((r) => [...filters.entries()].every(([k, v]) => r[k] === v));
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return q;
    };
    return { db: { from } as never, inserted, updated };
  }

  const actor = { agent: 'Athena', userId: 'user-1' };

  it('records a durable procedure under the pending-capability key, Space-scoped when a Space is named', async () => {
    const f = fakeDb([]);
    const r = await tools.runMemoryTool(f.db, 'note_pending_capability', {
      preset: 'github', command: 'delete_branch', rule: 'マージしたらブランチを消す', spaceId: 'space-1',
    }, actor);
    expect(r.ok).toBe(true);
    expect(f.inserted).toHaveLength(1);
    const row = f.inserted[0];
    expect(row.layer).toBe('durable');
    expect(row.kind).toBe('procedure');
    expect(row.scope).toBe('space');
    expect(row.activity_space_id).toBe('space-1');
    expect(row.topic_key).toBe('pending-capability:github:delete_branch');
    expect(row.origin).toBe('person');
    expect(String(row.body)).toContain('マージしたらブランチを消す');
  });

  it('without a Space the rule is the person’s own', async () => {
    const f = fakeDb([]);
    const r = await tools.runMemoryTool(f.db, 'note_pending_capability', {
      preset: 'github', command: 'delete_branch', rule: 'マージしたらブランチを消す',
    }, actor);
    expect(r.ok).toBe(true);
    expect(f.inserted[0].scope).toBe('personal');
    expect(f.inserted[0].user_id).toBe('user-1');
    expect(f.inserted[0].activity_space_id).toBeNull();
  });

  it('restating the same rule supersedes the old row instead of piling up', async () => {
    const f = fakeDb([{
      id: 'mem-old', layer: 'durable', status: 'active', scope: 'personal', activity_space_id: null,
      user_id: 'user-1', topic_key: 'pending-capability:github:delete_branch',
    }]);
    const r = await tools.runMemoryTool(f.db, 'note_pending_capability', {
      preset: 'github', command: 'delete_branch', rule: 'マージしたらブランチを消す（毎回）',
    }, actor);
    expect(r.ok).toBe(true);
    expect(f.inserted[0].supersedes_id).toBe('mem-old');
    expect(f.updated).toEqual([{ id: 'mem-old', patch: expect.objectContaining({ status: 'superseded' }) }]);
  });

  it('the tool is offered under its own name', () => {
    expect(tools.NOTE_PENDING_CAPABILITY_TOOL.name).toBe('note_pending_capability');
  });
});

describe('heartbeat: a landed capability is a signal, told once', () => {
  const signal = {
    kind: 'capability_landed', id: 'mem-1',
    since: '2026-11-05T00:00:00Z',
    label: 'GitHub の delete_branch が使えるようになったら',
    place: '会話で効かせ始められます',
  };
  const now = new Date('2026-11-08T00:00:00Z');

  it('an old-enough rule whose command landed becomes a candidate, fingerprinted by the memory', () => {
    const s = snap.buildHeartbeatSnapshot([signal], { now, thresholdHours: 24, previousFingerprints: [] });
    expect(s.candidates).toEqual([expect.objectContaining({ signalId: 'capability:mem-1', kind: 'capability_landed' })]);
  });

  it('once told, it stays quiet until the escalation line — and re-raises once there', () => {
    const younger = { ...signal, since: '2026-11-06T12:00:00Z' }; // waited 36h < 3×24h
    const told = snap.buildHeartbeatSnapshot([younger], { now, thresholdHours: 24, previousFingerprints: ['capability:mem-1'] });
    expect(told.candidates).toEqual([]);
    expect(told.silenced).toBe(1);
    expect(told.pending).toEqual([{ kind: 'capability_landed', waitedHours: 36 }]);
    // At 3× the threshold (72h waited) the one escalation re-raise fires.
    const escalated = snap.buildHeartbeatSnapshot([signal], { now, thresholdHours: 24, previousFingerprints: ['capability:mem-1'] });
    expect(escalated.candidates).toEqual([expect.objectContaining({ signalId: 'capability:mem-1:esc1', escalated: true })]);
  });
});
