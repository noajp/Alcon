import { describe, expect, it, vi } from 'vitest';
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

  it('a personal Element homed in an Object reaches both My Elements and the tree', () => {
    const qc = seed();
    applyWorkspaceDelta(qc, ctx, delta('elements', 'INSERT', { id: 'p3', object_id: 'obj-a', owner_id: 'me', title: 'both' }));
    expect(qc.getQueryData<ExplorerData>(['explorer', '__all__'])!.objects[0].elements!.map((e) => e.id)).toContain('p3');
    expect(qc.getQueryData<{ elements: ElementWithDetails[] }>(['my-elements', 'me'])!.elements.map((e) => e.id)).toContain('p3');
  });

  it('a confirmed assignment replaces the optimistic temp row for the same worker', () => {
    const qc = seed();
    const tree = qc.getQueryData<ExplorerData>(['explorer', '__all__'])!;
    const withTemp: ExplorerData = {
      ...tree,
      objects: [{ ...tree.objects[0], elements: [
        { ...tree.objects[0].elements![0], assignees: [{ id: 'temp-1', element_id: 'e1', worker_id: 'w1', role: null, assigned_at: null }] },
        tree.objects[0].elements![1],
      ] }],
    };
    qc.setQueryData(['explorer', '__all__'], withTemp);
    applyWorkspaceDelta(qc, ctx, delta('element_assignees', 'INSERT', { id: 'as-real', element_id: 'e1', worker_id: 'w1', role: null, assigned_at: null }));
    const assignees = qc.getQueryData<ExplorerData>(['explorer', '__all__'])!.objects[0].elements![0].assignees!;
    expect(assignees.map((a) => a.id)).toEqual(['as-real']);
  });
});


it('invalidates widget data after external cell writes and primary-key-only board deletes', async () => {
  vi.useFakeTimers();
  try {
    const qc = new QueryClient();
    qc.setQueryData(['widget-board', 'me', 'object-summary:a'], { revision: 2 });
    qc.setQueryData(['widget-table-data', 'table-a'], { rows: [] });
    qc.setQueryData(['data-tables'], []);
    applyWorkspaceDelta(qc, ctx, delta('table_cells', 'UPDATE', { row_id: 'r', column_id: 'c', value: 5 }));
    applyWorkspaceDelta(qc, ctx, delta('widget_boards', 'DELETE', {}, { id: 'b' }));
    await vi.advanceTimersByTimeAsync(200);
    expect(qc.getQueryState(['widget-board', 'me', 'object-summary:a'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['widget-table-data', 'table-a'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['data-tables'])?.isInvalidated).toBe(true);
    qc.clear();
  } finally { vi.useRealTimers(); }
});

it('refreshes campaign lenses after source edits and primary-key-only deletes', async () => {
  vi.useFakeTimers();
  try {
    const qc = new QueryClient();
    qc.setQueryData(['campaignRisk', 'campaign-a'], { openTotal: 3 });
    qc.setQueryData(['campaign-measures', ['campaign-a']], []);
    qc.setQueryData(['strategy-intent-bundle', 'campaign-a'], {});
    applyWorkspaceDelta(qc, ctx, delta('element_assignees', 'DELETE', {}, { id: 'seat-a' }));
    applyWorkspaceDelta(qc, ctx, delta('intents', 'UPDATE', { id: 'measure-a', actual_value: 25 }));
    await vi.advanceTimersByTimeAsync(200);
    expect(qc.getQueryState(['campaignRisk', 'campaign-a'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['campaign-measures', ['campaign-a']])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['strategy-intent-bundle', 'campaign-a'])?.isInvalidated).toBe(true);
    qc.clear();
  } finally { vi.useRealTimers(); }
});
