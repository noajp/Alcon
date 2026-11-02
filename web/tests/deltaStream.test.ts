import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/query-core';
import { applyWorkspaceDelta, type Delta } from '@/Function/sync/deltaStream';
import type { ExplorerData } from '@/Function/sync/explorerPatch';
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
  it('keeps load warnings and every availability roster current across surfaces', () => {
    vi.useFakeTimers();
    try {
      const qc = seed();
      qc.setQueryData(['worker-availability', 'w1'], {});
      qc.setQueryData(['worker-availability', 'w1\nw2'], {});
      qc.setQueryData(['worker-commitments', 'w1'], {});
      qc.setQueryData(['team-roster', 'me', 'space-a'], []);
      qc.setQueryData(['element-detail', 'e1'], el('e1'));
      applyWorkspaceDelta(qc, ctx, delta('worker_availability', 'DELETE', {}, { id: 'absence' }));
      applyWorkspaceDelta(qc, ctx, delta('elements', 'UPDATE', { id: 'e1', estimated_hours: 16 }));
      vi.advanceTimersByTime(160);
      for (const queryKey of [
        ['worker-availability', 'w1'], ['worker-availability', 'w1\nw2'],
        ['worker-commitments', 'w1'], ['team-roster', 'me', 'space-a'], ['element-detail', 'e1'],
      ]) expect(qc.getQueryState(queryKey)?.isInvalidated).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('a new activity row asks that one Element\'s rail to look again — the trigger writes for agents, and the rail must not wait for a reopen', () => {
    vi.useFakeTimers();
    try {
      const qc = seed();
      qc.setQueryData(['elementActivity', 'e1'], []);
      qc.setQueryData(['elementActivity', 'e2'], []);
      applyWorkspaceDelta(qc, ctx, delta('element_activity', 'INSERT', { id: 'a1', element_id: 'e1', kind: 'status', detail: 'todo → done', author: 'Claude@wt' }));
      vi.advanceTimersByTime(160);
      expect(qc.getQueryState(['elementActivity', 'e1'])?.isInvalidated).toBe(true);
      expect(qc.getQueryState(['elementActivity', 'e2'])?.isInvalidated).toBe(false);
      // Append-only table: a DELETE carries only its id and must be a no-op.
      applyWorkspaceDelta(qc, ctx, delta('element_activity', 'DELETE', {}, { id: 'a1' }));
      vi.advanceTimersByTime(160);
      expect(qc.getQueryState(['elementActivity', 'e2'])?.isInvalidated).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('ignores another Space\'s Object DELETE, and a cell edit leaves the Table list alone', () => {
    vi.useFakeTimers();
    try {
      const qc = seed();
      qc.setQueryData(['data-tables'], []);
      applyWorkspaceDelta(qc, ctx, delta('objects', 'DELETE', {}, { id: 'obj-elsewhere' }));
      applyWorkspaceDelta(qc, ctx, delta('table_cells', 'UPDATE', { id: 'c1', value: 1 }));
      vi.advanceTimersByTime(160);
      expect(qc.getQueryState(['explorer', '__all__'])?.isInvalidated).toBe(false);
      expect(qc.getQueryState(['data-tables'])?.isInvalidated).toBe(false);
      applyWorkspaceDelta(qc, ctx, delta('objects', 'DELETE', {}, { id: 'obj-a' }));
      applyWorkspaceDelta(qc, ctx, delta('table_rows', 'INSERT', { id: 'r1', table_id: 't1' }));
      vi.advanceTimersByTime(160);
      expect(qc.getQueryState(['explorer', '__all__'])?.isInvalidated).toBe(true);
      expect(qc.getQueryState(['data-tables'])?.isInvalidated).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('rechecks visible scopes when Space membership changes', () => {
    vi.useFakeTimers();
    try {
      const qc = seed();
      qc.setQueryData(['domains', 'me'], []);
      qc.setQueryData(['my-space-ids', 'me'], ['space-a']);
      qc.setQueryData(['team-roster', 'me', 'space-a'], []);
      qc.setQueryData(['sustainment-domains', 'me', 'space-a'], []);
      applyWorkspaceDelta(qc, ctx, delta('activity_space_members', 'DELETE', {}, { id: 'membership' }));
      vi.advanceTimersByTime(160);
      for (const queryKey of [
        ['domains', 'me'], ['my-space-ids', 'me'], ['team-roster', 'me', 'space-a'], ['explorer', '__all__'],
        ['sustainment-domains', 'me', 'space-a'],
      ]) expect(qc.getQueryState(queryKey)?.isInvalidated).toBe(true);
    } finally { vi.useRealTimers(); }
  });

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
    qc.setQueryData(['widget-board', 'object-summary', 'a', null], { id: 'b' });
    qc.setQueryData(['widget-table-data', 'table-a'], { rows: [] });
    qc.setQueryData(['data-tables'], []);
    applyWorkspaceDelta(qc, ctx, delta('table_cells', 'UPDATE', { row_id: 'r', column_id: 'c', value: 5 }));
    applyWorkspaceDelta(qc, ctx, delta('board_placements', 'DELETE', {}, { id: 'p' }));
    qc.setQueryData(['widget-document', 'w', 'data'], {});
    applyWorkspaceDelta(qc, ctx, delta('widget_documents', 'UPDATE', { widget_id: 'w', part: 'data' }));
    await vi.advanceTimersByTimeAsync(200);
    expect(qc.getQueryState(['widget-board', 'object-summary', 'a', null])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['widget-document', 'w', 'data'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['widget-table-data', 'table-a'])?.isInvalidated).toBe(true);
    // The Table list holds Tables and their row counts; a cell edit changes neither.
    expect(qc.getQueryState(['data-tables'])?.isInvalidated).toBe(false);
    qc.clear();
  } finally { vi.useRealTimers(); }
});

it('refreshes initiative lenses after source edits and primary-key-only deletes', async () => {
  vi.useFakeTimers();
  try {
    const qc = new QueryClient();
    qc.setQueryData(['initiativeRisk', 'initiative-a'], { openTotal: 3 });
    qc.setQueryData(['initiative-measures', ['initiative-a']], []);
    qc.setQueryData(['strategy-intent-bundle', 'initiative-a'], {});
    applyWorkspaceDelta(qc, ctx, delta('element_assignees', 'DELETE', {}, { id: 'seat-a' }));
    applyWorkspaceDelta(qc, ctx, delta('intents', 'UPDATE', { id: 'measure-a', actual_value: 25 }));
    await vi.advanceTimersByTimeAsync(200);
    expect(qc.getQueryState(['initiativeRisk', 'initiative-a'])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['initiative-measures', ['initiative-a']])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(['strategy-intent-bundle', 'initiative-a'])?.isInvalidated).toBe(true);
    qc.clear();
  } finally { vi.useRealTimers(); }
});
