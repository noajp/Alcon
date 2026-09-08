import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
import { supabase } from '@/lib/supabase';
import { fetchExplorerData } from '@/Function/sync/explorerData';
import { EMPTY_EXPLORER_DATA } from '@/Function/sync/explorerPatch';

describe('new Space explorer boundary', () => {
  it('an empty active Domain neither sends an invalid UUID nor expands to every Domain', async () => {
    expect(await fetchExplorerData('')).toEqual(EMPTY_EXPLORER_DATA);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
  it('preserves the explicit all-Domains query for existing callers', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: null } as never);
    await fetchExplorerData(null);
    expect(supabase.rpc).toHaveBeenCalledWith('get_explorer_data', { p_domain_id: null });
  });
});
