import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: mock }));
import { fetchDomainOverview, fetchInitiativeDomains } from '@/hooks/useDomainOverview';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let fail: string | null;
let reads: string[];
beforeEach(() => {
  fail = null; reads = [];
  tables = {
    domains: [{ id: 'd1', name: 'Domain A' }, { id: 'd2', name: 'Domain B' }],
    objects: [{ id: 'o1', name: 'One', domain_id: 'd1' }, { id: 'o2', name: 'Two', domain_id: 'd1' }],
    object_domains: [{ object_id: 'o1', domain_id: 'd2' }],
    strategies: [{ id: 'i1', name: 'First' }, { id: 'i2', name: 'Second' }],
    strategy_objects: [{ strategy_id: 'i1', object_id: 'o1' }, { strategy_id: 'i1', object_id: 'o2' }, { strategy_id: 'i2', object_id: 'o2' }],
  };
  mock.rpc.mockReset().mockResolvedValue({ data: { objects: tables.objects.map(row => ({ ...row, elements: [] })), rootElements: [] }, error: null });
  mock.from.mockReset().mockImplementation((table: string) => {
    reads.push(table);
    let rows = [...(tables[table] ?? [])];
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { rows = rows.filter(row => row[field] === value); return query; },
      in: (field: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[field])); return query; },
      order: () => query,
      // Emulate a server cap below the requested page size.
      range: (from: number) => Promise.resolve({ data: rows.slice(from, from + 1), count: rows.length, error: fail === table ? { message: 'read failed' } : null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: fail === table || !rows.length ? { message: 'unavailable' } : null }),
    };
    return query;
  });
});

describe('Domain overview data reads', () => {
  it('passes the exact Domain scope to the RPC and reads every relationship page', async () => {
    const data = await fetchDomainOverview('d1');
    expect(mock.rpc).toHaveBeenCalledWith('get_explorer_data', { p_domain_id: 'd1' });
    expect(data.initiatives.map(row => row.objectIds)).toEqual([['o1', 'o2'], ['o2']]);
  });
  it('reads all Initiative Objects and includes their secondary Domains', async () => {
    const data = await fetchInitiativeDomains('i1');
    expect(data.map(row => [row.domain.id, row.objects.map(object => object.id)])).toEqual([['d1', ['o1', 'o2']], ['d2', ['o1']]]);
  });
  it('does not query every Initiative when the Domain is empty', async () => {
    mock.rpc.mockResolvedValue({ data: { objects: [], rootElements: [] }, error: null });
    expect((await fetchDomainOverview('d2')).initiatives).toEqual([]);
    expect(reads).toEqual(['domains']);
  });
  it('fails explicitly instead of presenting a partial or unavailable relation as empty', async () => {
    fail = 'strategies';
    await expect(fetchDomainOverview('d1')).rejects.toThrow('read failed');
    await expect(fetchInitiativeDomains('i1')).rejects.toEqual({ message: 'unavailable' });
  });
  it('never falls back to an all-Domain query for a missing scope', async () => {
    await expect(fetchDomainOverview('')).rejects.toThrow('Choose a Domain');
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
