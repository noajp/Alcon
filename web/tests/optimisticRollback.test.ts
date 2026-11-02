// Optimistic writes patch every cached explorer query first and restore the
// snapshot when the write fails. These pin the delete + rollback path and the
// reorder patch (which rows move, which lists are left alone).
import { afterEach, describe, expect, it } from 'vitest';
import { applyOptimisticExplorerPatch } from '@/Function/sync/explorerCache';
import {
  type ExplorerData,
  removeElementFromExplorer,
  reorderElementsInExplorer,
  reorderObjectsInExplorer,
} from '@/Function/sync/explorerPatch';
import { reorderWithinSections } from '@/Function/shared/listTable/rowReorder';
import { getQueryClient } from '@/lib/queryClient';
import type { ElementWithDetails } from '@/types/database';

const el = (id: string, order_index: number, extra: Partial<ElementWithDetails> = {}): ElementWithDetails =>
  ({ id, title: id, object_id: 'obj-a', order_index, subelements: [], assignees: [], ...extra }) as ElementWithDetails;

function tree(): ExplorerData {
  return {
    objects: [
      { id: 'obj-a', name: 'A', order_index: 1, elements: [el('e1', 1), el('e2', 2), el('e3', 3)] },
      { id: 'obj-b', name: 'B', order_index: 2, elements: [el('e4', 1, { object_id: 'obj-b' })] },
      // e1 multi-homed into C as well.
      { id: 'obj-c', name: 'C', order_index: 3, elements: [el('e1', 1)] },
    ] as ExplorerData['objects'],
    rootElements: [el('r1', 1, { object_id: null }), el('r2', 2, { object_id: null })],
  };
}

const ids = (els: { id: string }[] | undefined) => (els ?? []).map((e) => e.id);

describe('applyOptimisticExplorerPatch — delete and roll back', () => {
  const qc = getQueryClient();
  afterEach(() => qc.clear());

  it('removes the Element from every explorer cache, and the rollback restores each snapshot as it was', () => {
    const d1 = tree();
    const d2 = tree();
    qc.setQueryData(['explorer', 'dom-1'], d1);
    qc.setQueryData(['explorer', 'dom-2'], d2);
    const other = { untouched: true };
    qc.setQueryData(['workers'], other);

    const rollback = applyOptimisticExplorerPatch((data) => removeElementFromExplorer(data, 'e1'));

    for (const key of [['explorer', 'dom-1'], ['explorer', 'dom-2']]) {
      const now = qc.getQueryData<ExplorerData>(key)!;
      expect(ids(now.objects[0].elements)).toEqual(['e2', 'e3']);
      expect(ids(now.objects[2].elements)).toEqual([]);
    }
    expect(qc.getQueryData(['workers'])).toBe(other);

    rollback();
    // setQueryData shares structure, so compare by value with a fresh tree.
    expect(qc.getQueryData(['explorer', 'dom-1'])).toStrictEqual(tree());
    expect(qc.getQueryData(['explorer', 'dom-2'])).toStrictEqual(tree());
    expect(ids(d1.objects[0].elements)).toEqual(['e1', 'e2', 'e3']);
  });

  it('skips a query with no data yet and leaves it empty after rollback', () => {
    qc.setQueryData(['explorer', 'loaded'], tree());
    qc.getQueryCache().build(qc, { queryKey: ['explorer', 'pending'] });
    const rollback = applyOptimisticExplorerPatch((data) => removeElementFromExplorer(data, 'e2'));
    expect(qc.getQueryData(['explorer', 'pending'])).toBeUndefined();
    rollback();
    expect(qc.getQueryData(['explorer', 'pending'])).toBeUndefined();
  });

  it('rolls back to the pre-patch snapshot even after a later write landed', () => {
    const before = tree();
    qc.setQueryData(['explorer', 'dom'], before);
    const rollback = applyOptimisticExplorerPatch((data) => removeElementFromExplorer(data, 'r1'));
    expect(ids(qc.getQueryData<ExplorerData>(['explorer', 'dom'])!.rootElements)).toEqual(['r2']);
    qc.setQueryData(['explorer', 'dom'], { objects: [], rootElements: [] });
    rollback();
    expect(qc.getQueryData(['explorer', 'dom'])).toStrictEqual(tree());
  });

  it('a delete of an id the cache does not hold is a no-op', () => {
    const before = tree();
    qc.setQueryData(['explorer', 'dom'], before);
    applyOptimisticExplorerPatch((data) => removeElementFromExplorer(data, 'missing'));
    expect(qc.getQueryData(['explorer', 'dom'])).toBe(before);
  });
});

describe('reorderElementsInExplorer', () => {
  it('moves the listed Elements and re-sorts only the lists that changed', () => {
    const before = tree();
    const after = reorderElementsInExplorer(before, [
      { id: 'e1', order_index: 3 },
      { id: 'e2', order_index: 1 },
      { id: 'e3', order_index: 2 },
    ]);
    expect(ids(after.objects[0].elements)).toEqual(['e2', 'e3', 'e1']);
    expect(after.objects[1]).toBe(before.objects[1]);
    expect(after.rootElements).toBe(before.rootElements);
  });

  it('applies to every list a multi-homed Element sits in', () => {
    const after = reorderElementsInExplorer(tree(), [{ id: 'e1', order_index: 9 }]);
    expect(after.objects[2].elements?.[0].order_index).toBe(9);
    expect(ids(after.objects[0].elements)).toEqual(['e2', 'e3', 'e1']);
  });

  it('filters out unchanged rows: an order_index already in place leaves the list identity alone', () => {
    const before = tree();
    const after = reorderElementsInExplorer(before, [
      { id: 'e1', order_index: 1 },
      { id: 'e2', order_index: 2 },
      { id: 'unknown', order_index: 7 },
    ]);
    after.objects.forEach((o, i) => expect(o).toBe(before.objects[i]));
    expect(after.rootElements).toBe(before.rootElements);
  });

  it('keeps unchanged Elements as the same objects when the list re-sorts', () => {
    const before = tree();
    const after = reorderElementsInExplorer(before, [{ id: 'e3', order_index: 0 }]);
    expect(ids(after.objects[0].elements)).toEqual(['e3', 'e1', 'e2']);
    expect(after.objects[0].elements?.[1]).toBe(before.objects[0].elements?.[0]);
    expect(before.objects[0].elements?.[2].order_index).toBe(3);
  });

  it('reorders root Elements too', () => {
    const after = reorderElementsInExplorer(tree(), [{ id: 'r1', order_index: 5 }]);
    expect(ids(after.rootElements)).toEqual(['r2', 'r1']);
  });

  it('sorts a null order_index as 0', () => {
    const data: ExplorerData = { objects: [], rootElements: [el('a', 2), el('b', null as unknown as number)] };
    const after = reorderElementsInExplorer(data, [{ id: 'a', order_index: 1 }]);
    expect(ids(after.rootElements)).toEqual(['b', 'a']);
  });
});

describe('reorderObjectsInExplorer', () => {
  it('moves and re-sorts the Objects, keeping each one’s element list', () => {
    const before = tree();
    const after = reorderObjectsInExplorer(before, [{ id: 'obj-a', order_index: 4 }]);
    expect(ids(after.objects)).toEqual(['obj-b', 'obj-c', 'obj-a']);
    expect(after.objects[2].elements).toBe(before.objects[0].elements);
    expect(after.rootElements).toBe(before.rootElements);
  });

  it('returns the same data when nothing actually moves', () => {
    const before = tree();
    expect(reorderObjectsInExplorer(before, [{ id: 'obj-a', order_index: 1 }, { id: 'nope', order_index: 2 }])).toBe(before);
    expect(reorderObjectsInExplorer(before, [])).toBe(before);
  });
});

describe('reorderWithinSections (drag-end)', () => {
  const rows = (...xs: string[]) => xs.map((id) => ({ id }));

  it('numbers the section holding both rows from 1 in displayed order', () => {
    const sections = [rows('a', 'b'), rows('c', 'd', 'e')];
    expect(reorderWithinSections(sections, 'e', 'c')).toEqual([
      { id: 'e', order_index: 1 },
      { id: 'c', order_index: 2 },
      { id: 'd', order_index: 3 },
    ]);
    expect(reorderWithinSections(sections, 'a', 'b')).toEqual([
      { id: 'b', order_index: 1 },
      { id: 'a', order_index: 2 },
    ]);
  });

  it('refuses a drop across sections or onto an unknown row', () => {
    const sections = [rows('a', 'b'), rows('c')];
    expect(reorderWithinSections(sections, 'a', 'c')).toBeNull();
    expect(reorderWithinSections(sections, 'a', 'zzz')).toBeNull();
    expect(reorderWithinSections([], 'a', 'b')).toBeNull();
  });

  it('uses the first section that holds both (a multi-homed row) and leaves the input alone', () => {
    const first = rows('x', 'y');
    const sections = [first, rows('y', 'x', 'z')];
    expect(reorderWithinSections(sections, 'x', 'y')).toEqual([
      { id: 'y', order_index: 1 },
      { id: 'x', order_index: 2 },
    ]);
    expect(ids(first)).toEqual(['x', 'y']);
  });
});
