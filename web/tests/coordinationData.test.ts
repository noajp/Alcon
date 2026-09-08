import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/lib/queryClient', () => ({ getQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/Function/sync/explorerCache', () => ({ invalidateElementDetail: vi.fn() }));
import { supabase } from '@/lib/supabase';
import { checkInElement, CoordinationError, fetchNowWork, setElementDependency } from '@/hooks/coordinationData';

async function normalizeNowWorkData(value: unknown) {
  vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: value, error: null } as never);
  return fetchNowWork('space');
}

const complete = () => ({ elements: [], objects: [], workers: [], edges: [], readAt: '2026-09-01T00:00:00Z' });

describe('Now complete response contract', () => {
  it('rejects partial results or invalid timestamps rather than constructing empty success', async () => {
    for (const value of [null, {}, { ...complete(), edges: undefined }, { ...complete(), readAt: 'invalid' }]) {
      await expect(normalizeNowWorkData(value)).rejects.toThrow(CoordinationError);
    }
  });
  it('retains opaque dependencies, unspecified status, and unassigned elements', async () => {
    const row = await normalizeNowWorkData({ ...complete(), elements: [{ id: 'element', status: null, assignees: [], direction: null }],
      edges: [{ id: 'edge', from_element: 'outside', to_element: 'element', edge_type: 'depends_on', attributes: {}, created_by: null, created_at: null }] });
    expect(row.elements[0].status).toBeNull();
    expect(row.elements[0].assignees).toEqual([]);
    expect(row.edges[0].from_element).toBe('outside');
  });
  it('rejects duplicate rows and malformed dependencies', async () => {
    await expect(normalizeNowWorkData({ ...complete(), elements: [{ id: 'same' }, { id: 'same' }] })).rejects.toThrow();
    await expect(normalizeNowWorkData({ ...complete(), edges: [{ from_element: 'upstream', edge_type: 'depends_on' }] })).rejects.toThrow();
  });
  it('surfaces server read errors without returning an empty board', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { code: '54000', message: 'Read limit exceeded' } } as never);
    await expect(fetchNowWork('space')).rejects.toMatchObject({ code: '54000' });
  });
});

describe('coordination mutations', () => {
  it('preserves optional patch keys and request identity for retries', async () => {
    const output = { element: { id: 'element' }, comment: { id: 'request' }, replayed: true };
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: output, error: null } as never);
    await expect(checkInElement({ elementId: 'element', expectedUpdatedAt: null, requestId: 'request', patch: { next: null } })).resolves.toEqual(output);
    expect(supabase.rpc).toHaveBeenLastCalledWith('check_in_element', {
      p_element_id: 'element', p_expected_updated_at: null, p_request_id: 'request', p_patch: { next: null }, p_note: '',
    });
  });
  it('retains conflict and edited/deleted receipt errors for draft recovery', async () => {
    for (const code of ['40001', 'P0002']) {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { code, message: 'Review before retrying' } } as never);
      await expect(checkInElement({ elementId: 'element', expectedUpdatedAt: 'stamp', requestId: 'request', patch: {}, note: 'Update' })).rejects.toMatchObject({ code });
    }
  });
  it('uses from=prerequisite and to=waiting element', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: null } as never);
    await setElementDependency({ spaceId: 'space', upstreamId: 'prerequisite', downstreamId: 'waiting', remove: true });
    expect(supabase.rpc).toHaveBeenLastCalledWith('set_element_dependency', {
      p_space_id: 'space', p_upstream_id: 'prerequisite', p_downstream_id: 'waiting', p_remove: true,
    });
  });
});
