import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/query-core';
import { applyWorkspaceDelta, type Delta } from '@/alcon/sync/deltaStream';
import type { ExplorerData } from '@/alcon/sync/explorerPatch';
import type { ElementComment, ElementWithDetails, Worker } from '@/types/database';

const el = (id: string, extra: Partial<ElementWithDetails> = {}): ElementWithDetails =>
  ({ id, title: id, object_id: 'obj-a', owner_id: null, subelements: [], assignees: [], ...extra }) as ElementWithDetails;

function seed() {
  const qc = new QueryClient();
  const explorer: ExplorerData = {
    objects: [{ id: 'obj-a', name: 'A', elements: [el('e1'), el('e2')] }] as ExplorerData['objects'],
    rootElements: [],
  };
  qc.setQueryData(['explorer', '__all__'], explorer);
  qc.setQueryData(['my-elements', 'me'], { elements: [el('e2')], workers: [{ id: 'w-me' } as Worker] });
  qc.setQueryData(['element', 'e1', 'comments'], [] as ElementComment[]);
  qc.setQueryData(['element-activity', 'e1\ne2'], {});
  return qc;
}
const ctx = { userId: 'me' };
const delta = (table: Delta['table'], type: Delta['type'], row: Record<string, unknown>, old: Record<string, unknown> = {}): Delta =>
  ({ table, type, new: row, old });

describe('applyWorkspaceDelta', () => {
  it('an elements UPDATE patches every cache that holds the row, and only that row', () => {
    const qc = seed();
    const before = qc.getQueryData<ExplorerData>(['explorer', '__all__'])!;
    applyWorkspaceDelta(qc, ctx, delta('elements', 'UPDATE', { id: 'e2', status: 'done' }));
    const after = qc.getQueryData<ExplorerData>(['explorer', '__all__'])!;
    expect(after.objects[0].elements![1].status).toBe('done');
    expect(after.objects[0].elements![0]).toBe(before.objects[0].elements![0]);
    const mine = qc.getQueryData<{ elements: ElementWithDetails[] }>(['my-elements', 'me'])!;
    expect(mine.elements[0].status).toBe('done');
  });

  it('an elements INSERT lands under its Object; a personal one lands in My Elements', () => {
    const qc = seed();
    applyWorkspaceDelta(qc, ctx, delta('elements', 'INSERT', { id: 'e3', object_id: 'obj-a', owner_id: null, title: 'new' }));
    expect(qc.getQueryData<ExplorerData>(['explorer', '__all__'])!.objects[0].elements!.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    applyWorkspaceDelta(qc, ctx, delta('elements', 'INSERT', { id: 'p1', object_id: null, owner_id: 'me', title: 'mine' }));
    expect(qc.getQueryData<{ elements: ElementWithDetails[] }>(['my-elements', 'me'])!.elements.map((e) => e.id)).toEqual(['e2', 'p1']);
    applyWorkspaceDelta(qc, ctx, delta('elements', 'INSERT', { id: 'p2', object_id: null, owner_id: 'someone-else', title: 'theirs' }));
    expect(qc.getQueryData<{ elements: ElementWithDetails[] }>(['my-elements', 'me'])!.elements.length).toBe(2);
  });

  it('an elements DELETE removes the row everywhere and drops its facet caches', () => {
    const qc = seed();
    applyWorkspaceDelta(qc, ctx, delta('elements', 'DELETE', {}, { id: 'e1' }));
    expect(qc.getQueryData<ExplorerData>(['explorer', '__all__'])!.objects[0].elements!.map((e) => e.id)).toEqual(['e2']);
    expect(qc.getQueryData(['element', 'e1', 'comments'])).toBeUndefined();
  });

  it('a subelement INSERT then DELETE round-trips on the parent', () => {
    const qc = seed();
    applyWorkspaceDelta(qc, ctx, delta('subelements', 'INSERT', { id: 's1', element_id: 'e1', title: 's', order_index: 0 }));
    expect(qc.getQueryData<ExplorerData>(['explorer', '__all__'])!.objects[0].elements![0].subelements!.length).toBe(1);
    applyWorkspaceDelta(qc, ctx, delta('subelements', 'DELETE', {}, { id: 's1' }));
    expect(qc.getQueryData<ExplorerData>(['explorer', '__all__'])!.objects[0].elements![0].subelements!.length).toBe(0);
  });

  it('an assignment resolves its worker from the caches', () => {
    const qc = seed();
    qc.setQueryData(['workers', 'scope', '__all__'], [{ id: 'w1', name: 'Wren' } as Worker]);
    applyWorkspaceDelta(qc, ctx, delta('element_assignees', 'INSERT', { id: 'as1', element_id: 'e1', worker_id: 'w1', role: null, assigned_at: null }));
    const row = qc.getQueryData<ExplorerData>(['explorer', '__all__'])!.objects[0].elements![0];
    expect(row.assignees![0].worker?.name).toBe('Wren');
    applyWorkspaceDelta(qc, ctx, delta('element_assignees', 'DELETE', {}, { id: 'as1' }));
    expect(qc.getQueryData<ExplorerData>(['explorer', '__all__'])!.objects[0].elements![0].assignees).toEqual([]);
  });

  it('a comment INSERT appends to its thread and bumps only that rollup', () => {
    const qc = seed();
    const c = { id: 'c1', element_id: 'e1', content: 'hi', created_at: '2026-09-04T00:00:00Z' };
    applyWorkspaceDelta(qc, ctx, delta('element_comments', 'INSERT', c));
    applyWorkspaceDelta(qc, ctx, delta('element_comments', 'INSERT', c)); // duplicate delivery
    expect(qc.getQueryData<ElementComment[]>(['element', 'e1', 'comments'])!.length).toBe(1);
    const activity = qc.getQueryData<Record<string, { commentCount: number; lastCommentAt: string }>>(['element-activity', 'e1\ne2'])!;
    expect(activity.e1).toEqual({ commentCount: 2, lastCommentAt: c.created_at });
    expect(activity.e2).toBeUndefined();
  });

  it('a strategy comment lands on its thread', () => {
    const qc = seed();
    qc.setQueryData(['strategy-comments', 'st1'], []);
    applyWorkspaceDelta(qc, ctx, delta('strategy_comments', 'INSERT', { id: 'sc1', strategy_id: 'st1', content: 'x' }));
    expect(qc.getQueryData<unknown[]>(['strategy-comments', 'st1'])!.length).toBe(1);
    applyWorkspaceDelta(qc, ctx, delta('strategy_comments', 'DELETE', {}, { id: 'sc1' }));
    expect(qc.getQueryData<unknown[]>(['strategy-comments', 'st1'])!.length).toBe(0);
  });
});
