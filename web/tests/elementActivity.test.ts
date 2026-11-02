import { describe, it, expect } from 'vitest';
import { mergeActivity, noteElementClosed } from '@/hooks/elementActivity';
import { getQueryClient } from '@/lib/queryClient';
import type { ElementActivity as ActivityEntry } from '../src/types/database';

const e = (o: Partial<ActivityEntry> & { id: string; created_at: string }): ActivityEntry => ({
  element_id: 'el', kind: 'status', detail: 'todo → done', author: 'Claude', actor_id: null, ...o,
});

describe('mergeActivity', () => {
  it('adds the creation as a row and orders newest first', () => {
    const rows = mergeActivity(
      [e({ id: 'a', created_at: '2026-09-06T10:00:00Z' }), e({ id: 'b', created_at: '2026-09-07T10:00:00Z', kind: 'priority', detail: 'Priority → High' })],
      { created_at: '2026-09-01T00:00:00Z', title: 'T' },
    );
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'created']);
    expect(rows[2]).toMatchObject({ kind: 'created', author: 'System', detail: 'Created “T”' });
  });

  it('has no creation row when the Element carries no created_at', () => {
    expect(mergeActivity([], { created_at: null, title: 'T' })).toEqual([]);
  });

  it('keeps the persisted author — a trigger-written status row names the lease holder', () => {
    const [row] = mergeActivity([e({ id: 'a', created_at: '2026-09-06T10:00:00Z', author: 'Claude@wt' })], { created_at: null, title: 'T' });
    expect(row.author).toBe('Claude@wt');
    expect(row.kind).toBe('status');
  });
});

describe('noteElementClosed — a close this client made reaches the window before the read', () => {
  type Times = { closedAt: Map<string, string>; truncated: boolean };

  it('adds the Element to every cached close-time map without touching the rest', () => {
    const qc = getQueryClient();
    const a = ['elementClosedTimes', '2026-10-03T00:00:00.000Z'];
    const b = ['elementClosedTimes', '2026-10-04T00:00:00.000Z'];
    qc.setQueryData<Times>(a, { closedAt: new Map([['old', '2026-10-20T00:00:00Z']]), truncated: false });
    qc.setQueryData<Times>(b, { closedAt: new Map(), truncated: true });
    noteElementClosed('el', '2026-11-02T12:00:00Z');
    expect(Object.fromEntries(qc.getQueryData<Times>(a)!.closedAt)).toEqual({ old: '2026-10-20T00:00:00Z', el: '2026-11-02T12:00:00Z' });
    expect(qc.getQueryData<Times>(b)).toEqual({ closedAt: new Map([['el', '2026-11-02T12:00:00Z']]), truncated: true });
    qc.removeQueries({ queryKey: ['elementClosedTimes'] });
  });

  it('leaves an unread key unread', () => {
    const qc = getQueryClient();
    noteElementClosed('el', '2026-11-02T12:00:00Z');
    expect(qc.getQueriesData({ queryKey: ['elementClosedTimes'] }).every(([, data]) => data === undefined)).toBe(true);
  });
});
