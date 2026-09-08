import { describe, expect, it } from 'vitest';
import {
  type ExplorerData,
  normalizeExplorerData,
  EMPTY_EXPLORER_DATA,
  patchElementInExplorer,
  insertElementIntoExplorer,
  removeElementFromExplorer,
  upsertSubelementInExplorer,
  removeSubelementFromExplorer,
  upsertAssigneeInExplorer,
  removeAssigneeFromExplorer,
  patchWorkerInExplorer,
  patchObjectInExplorer,
  patchElementInList,
  appendElementToList,
} from '@/Function/sync/explorerPatch';
import type { ElementWithDetails, Subelement, Worker } from '@/types/database';

const el = (id: string, extra: Partial<ElementWithDetails> = {}): ElementWithDetails =>
  ({ id, title: id, object_id: 'obj-a', subelements: [], assignees: [], ...extra }) as ElementWithDetails;
const sub = (id: string, element_id: string, order_index = 0): Subelement =>
  ({ id, element_id, title: id, order_index, is_completed: false }) as Subelement;
const worker = (id: string): Worker => ({ id, name: id, type: 'human' }) as Worker;

function tree(): ExplorerData {
  return {
    objects: [
      { id: 'obj-a', name: 'A', elements: [el('e1'), el('e2')] },
      { id: 'obj-b', name: 'B', elements: [el('e3', { object_id: 'obj-b' })] },
    ] as ExplorerData['objects'],
    rootElements: [el('r1', { object_id: null })],
  };
}

describe('explorer patches keep every untouched reference', () => {
  it('patchElementInExplorer: only the changed element and its path get new identities', () => {
    const before = tree();
    const after = patchElementInExplorer(before, 'e2', { title: 'renamed' });
    expect(after).not.toBe(before);
    expect(after.objects[0].elements![1].title).toBe('renamed');
    expect(after.objects[0].elements![0]).toBe(before.objects[0].elements![0]);
    expect(after.objects[1]).toBe(before.objects[1]);
    expect(after.rootElements).toBe(before.rootElements);
  });

  it('returns the same tree when the id is absent', () => {
    const before = tree();
    expect(patchElementInExplorer(before, 'nope', { title: 'x' })).toBe(before);
    expect(removeElementFromExplorer(before, 'nope')).toBe(before);
    expect(removeSubelementFromExplorer(before, 'nope')).toBe(before);
    expect(removeAssigneeFromExplorer(before, 'nope')).toBe(before);
    expect(patchWorkerInExplorer(before, 'nope', { name: 'x' })).toBe(before);
    expect(patchObjectInExplorer(before, 'nope', { name: 'x' })).toBe(before);
  });

  it('insertElementIntoExplorer places under the parent object once', () => {
    const before = tree();
    const once = insertElementIntoExplorer(before, el('e9', { object_id: 'obj-b' }));
    const twice = insertElementIntoExplorer(once, el('e9', { object_id: 'obj-b' }));
    expect(once.objects[1].elements!.map((e) => e.id)).toEqual(['e3', 'e9']);
    expect(twice).toBe(once);
    expect(once.objects[0]).toBe(before.objects[0]);
  });

  it('subelements land on their parent, sorted by order, and leave by id alone', () => {
    const before = tree();
    const a = upsertSubelementInExplorer(before, sub('s2', 'e1', 2));
    const b = upsertSubelementInExplorer(a, sub('s1', 'e1', 1));
    expect(b.objects[0].elements![0].subelements!.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(b.objects[0].elements![1]).toBe(before.objects[0].elements![1]);
    const c = upsertSubelementInExplorer(b, sub('s1', 'e1', 1));
    expect(c.objects[0].elements![0].subelements!.length).toBe(2);
    const d = removeSubelementFromExplorer(c, 's2');
    expect(d.objects[0].elements![0].subelements!.map((s) => s.id)).toEqual(['s1']);
  });

  it('assignees upsert with their worker and a worker patch reaches every chip', () => {
    const before = tree();
    const w = worker('w1');
    const a = upsertAssigneeInExplorer(before, { id: 'as1', element_id: 'e3', worker_id: 'w1', role: null, assigned_at: null, worker: w });
    const b = upsertAssigneeInExplorer(a, { id: 'as2', element_id: 'r1', worker_id: 'w1', role: null, assigned_at: null, worker: w });
    const c = patchWorkerInExplorer(b, 'w1', { name: 'Renamed' });
    expect(c.objects[1].elements![0].assignees![0].worker!.name).toBe('Renamed');
    expect(c.rootElements[0].assignees![0].worker!.name).toBe('Renamed');
    expect(c.objects[0]).toBe(before.objects[0]);
    const d = removeAssigneeFromExplorer(c, 'as1');
    expect(d.objects[1].elements![0].assignees).toEqual([]);
    expect(d.rootElements).toBe(c.rootElements);
  });

  it('patchObjectInExplorer keeps the element list identity', () => {
    const before = tree();
    const after = patchObjectInExplorer(before, 'obj-a', { name: 'A2' });
    expect(after.objects[0].name).toBe('A2');
    expect(after.objects[0].elements).toBe(before.objects[0].elements);
  });
});

describe('plain element lists (My Elements)', () => {
  it('patches in place and de-duplicates appends', () => {
    const list = [el('m1'), el('m2')];
    const patched = patchElementInList(list, 'm2', { title: 't' });
    expect(patched[0]).toBe(list[0]);
    expect(patched[1].title).toBe('t');
    expect(appendElementToList(list, el('m1'))).toBe(list);
    expect(appendElementToList(list, el('m3')).length).toBe(3);
  });
});


describe('flat Explorer RPC normalization', () => {
  it('removes the unused Object hierarchy field without copying Element relations', () => {
    const before = tree();
    const nestedData = { ...before, objects: before.objects.map((object) => ({ ...object, children: [] })) };
    const after = normalizeExplorerData(nestedData);
    expect(after.objects.map((object) => object.id)).toEqual(['obj-a', 'obj-b']);
    expect(after.objects.every((object) => !('children' in object))).toBe(true);
    expect(after.objects[0].elements).toBe(before.objects[0].elements);
    expect(after.objects[0].elements![0].subelements).toBe(before.objects[0].elements![0].subelements);
    expect(after.objects[0].elements![0].assignees).toBe(before.objects[0].elements![0].assignees);
    expect(after.rootElements).toBe(before.rootElements);
    expect(nestedData.objects[0].children).toEqual([]);
  });

  it('retains identity for a flat snapshot and every already-flat row', () => {
    const before = tree();
    expect(normalizeExplorerData(before)).toBe(before);
    const mixed = { ...before, objects: [{ ...before.objects[0], children: [] }, before.objects[1]] };
    expect(normalizeExplorerData(mixed).objects[1]).toBe(before.objects[1]);
    expect(normalizeExplorerData(null)).toBe(EMPTY_EXPLORER_DATA);
    expect(normalizeExplorerData(undefined)).toBe(EMPTY_EXPLORER_DATA);
  });
});
