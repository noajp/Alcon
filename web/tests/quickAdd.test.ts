import { beforeEach, describe, expect, it, vi } from 'vitest';

const createElement = vi.fn();
const assignWorkersToElement = vi.fn();
const noticeSkippedAssignees = vi.fn();
const alert = vi.fn();

vi.mock('@/hooks/useSupabase', () => ({ createElement, assignWorkersToElement, noticeSkippedAssignees }));
vi.mock('@/Function/shared/appDialogStore', () => ({ appDialog: { alert } }));

const { createQuickAddElements, toQuickAddTemplates } = await import('@/Function/shared/element/quickAdd');

beforeEach(() => {
  createElement.mockReset();
  assignWorkersToElement.mockReset().mockResolvedValue({ skipped: [] });
  noticeSkippedAssignees.mockReset();
  alert.mockReset();
});

describe('where a line lands', () => {
  const landed = async (input: Parameters<typeof createQuickAddElements>[0][number], fallback: string | null) => {
    createElement.mockResolvedValue({ id: 'e1' });
    await createQuickAddElements([input], { fallbackObjectId: fallback, userId: 'u1' });
    return createElement.mock.calls.at(-1)![0].object_id;
  };
  it('personal wins over everything', async () => {
    expect(await landed({ title: 'a', personal: true, objectId: 'o1' }, 'o2')).toBeNull();
  });
  it('the popup pick wins over the surface, including an explicit null', async () => {
    expect(await landed({ title: 'a', objectId: 'o1' }, 'o2')).toBe('o1');
    expect(await landed({ title: 'a', objectId: null }, 'o2')).toBeNull();
  });
  it('falls back to the surface when the popup named nothing', async () => {
    expect(await landed({ title: 'a' }, 'o2')).toBe('o2');
  });
});

describe('createQuickAddElements', () => {
  it('passes labels, estimate and the preset due date through', async () => {
    createElement.mockResolvedValue({ id: 'e1' });
    await createQuickAddElements(
      [{ title: 'a', objectId: 'o1', labels: ['x', 'y'], estimatedHours: 3 }],
      { fallbackObjectId: null, userId: 'u1', dueDate: '2026-11-05' },
    );
    expect(createElement).toHaveBeenCalledWith(expect.objectContaining({
      object_id: 'o1', owner_id: null, labels: ['x', 'y'], estimated_hours: 3, due_date: '2026-11-05',
    }));
  });

  it('owns a line with no Object and assigns the fallback worker when unassigned', async () => {
    createElement.mockResolvedValue({ id: 'e1' });
    await createQuickAddElements([{ title: 'a', personal: true }], { fallbackObjectId: null, userId: 'u1', fallbackAssigneeIds: ['w1'] });
    expect(createElement).toHaveBeenCalledWith(expect.objectContaining({ object_id: null, owner_id: 'u1' }));
    expect(assignWorkersToElement).toHaveBeenCalledWith('e1', ['w1']);
  });

  it('says how many lines failed when some landed', async () => {
    createElement.mockResolvedValueOnce({ id: 'e1' }).mockRejectedValueOnce(new Error('no'));
    await expect(createQuickAddElements([{ title: 'a' }, { title: 'b' }], { fallbackObjectId: 'o1', userId: null })).resolves.toBe(1);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('rejects when nothing landed so the popup keeps the text, and still says so', async () => {
    createElement.mockRejectedValue(new Error('no'));
    await expect(createQuickAddElements([{ title: 'a' }], { fallbackObjectId: 'o1', userId: null })).rejects.toThrow('no');
    expect(alert).toHaveBeenCalledTimes(1);
  });
});

describe('toQuickAddTemplates', () => {
  it('keeps only assignable workers and maps the estimate', () => {
    const [t] = toQuickAddTemplates([{
      id: 't1', name: 'T', type: null, status: null, priority: null, labels: ['x'],
      assignee_worker_ids: ['w1', 'w2'], description: null, estimated_hours: 2,
    } as never], [{ id: 'w1' }]);
    expect(t.assigneeWorkerIds).toEqual(['w1']);
    expect(t.estimatedHours).toBe(2);
  });
});
