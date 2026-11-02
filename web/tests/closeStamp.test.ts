// A close made in this client reaches the lists' "Completed Elements" window
// with the optimistic patch — before the write returns — and only when the
// Element was open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const single = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ update: () => ({ eq: () => ({ select: () => ({ single }) }) }) }) },
}));

import { updateElement } from '@/hooks/elementData';
import { isClosingMove } from '@/Function/shared/completion';
import { elementStatusInExplorer, type ExplorerData } from '@/Function/sync/explorerPatch';
import { getQueryClient } from '@/lib/queryClient';
import type { ElementWithDetails } from '@/types/database';

type Times = { closedAt: Map<string, string>; truncated: boolean };
const TIMES_KEY = ['elementClosedTimes', '2026-10-03T00:00:00.000Z'];
const el = (id: string, status: string | null) => ({ id, status, subelements: [], assignees: [] }) as unknown as ElementWithDetails;
const explorer = (): ExplorerData => ({
  objects: [{ id: 'o', name: 'O', elements: [el('open', 'todo'), el('done', 'done')] }] as ExplorerData['objects'],
  rootElements: [el('root', null)],
});
const closedIds = () => [...getQueryClient().getQueryData<Times>(TIMES_KEY)!.closedAt.keys()];

describe('isClosingMove', () => {
  it('is a close only from an open status (or an unknown one) into done / cancelled', () => {
    expect(isClosingMove('todo', 'done')).toBe(true);
    expect(isClosingMove(null, 'cancelled')).toBe(true);
    expect(isClosingMove(undefined, 'done')).toBe(true);
    expect(isClosingMove('done', 'done')).toBe(false);
    expect(isClosingMove('done', 'cancelled')).toBe(false);
    expect(isClosingMove('todo', 'in_progress')).toBe(false);
    expect(isClosingMove('done', 'todo')).toBe(false);
  });
});

describe('elementStatusInExplorer', () => {
  it('reads the status from an Object or the root, and tells an absent Element from an unset status', () => {
    expect(elementStatusInExplorer(explorer(), 'done')).toBe('done');
    expect(elementStatusInExplorer(explorer(), 'root')).toBeNull();
    expect(elementStatusInExplorer(explorer(), 'missing')).toBeUndefined();
  });
});

describe('updateElement stamps a close into the cached close times', () => {
  const qc = getQueryClient();
  beforeEach(() => {
    qc.setQueryData(['explorer', 'dom'], explorer());
    qc.setQueryData<Times>(TIMES_KEY, { closedAt: new Map(), truncated: false });
  });
  afterEach(() => { qc.clear(); single.mockReset(); });

  it('stamps it before the write returns', async () => {
    let release!: (v: unknown) => void;
    single.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const pending = updateElement('open', { status: 'done' });
    expect(closedIds()).toEqual(['open']);
    release({ data: { id: 'open' }, error: null });
    await pending;
  });

  it('does not stamp an Element that was already closed', async () => {
    single.mockResolvedValueOnce({ data: { id: 'done' }, error: null });
    await updateElement('done', { status: 'done' });
    expect(closedIds()).toEqual([]);
  });

  it('does not stamp a move between open statuses', async () => {
    single.mockResolvedValueOnce({ data: { id: 'open' }, error: null });
    await updateElement('open', { status: 'in_progress' });
    expect(closedIds()).toEqual([]);
  });

  it('keeps the stamp when the write fails — the Element is open again, which the window ignores', async () => {
    single.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await expect(updateElement('open', { status: 'cancelled' })).rejects.toBeTruthy();
    expect(closedIds()).toEqual(['open']);
    expect(elementStatusInExplorer(qc.getQueryData<ExplorerData>(['explorer', 'dom'])!, 'open')).toBe('todo');
  });
});
