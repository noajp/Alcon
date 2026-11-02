import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: mock, supabaseDynamicTable: mock }));
import { fetchDomainApproaches, saveDomainApproach } from '@/hooks/useDomainApproaches';
let tables: Record<string, Record<string, unknown>[]>;
let fail: string | null;
let changed: boolean;
let approachReads: number;
let writes: { table: string; values: unknown; filters: [string, unknown][] }[];
beforeEach(() => {
  fail = null; changed = false; approachReads = 0; writes = [];
  tables = { domain_approaches: [{ id: 'a', domain_id: 'd', revision: 2 }], strategies: [{ id: 's' }], intents: [{ id: 'm', strategy_id: 's', kind: 'measure' }, { id: 'x', strategy_id: 's', kind: 'assumption' }], approach_conditions: [{ id: 'c', approach_id: 'a' }, { id: 'c2', approach_id: 'a' }], approach_contributions: [], approach_reviews: [], approach_assessments: [], profiles: [] };
  mock.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  mock.from.mockReset().mockImplementation((table: string) => {
    if (table === 'domain_approaches') approachReads++;
    let rows = tables[table] ?? [];
    if (changed && table === 'domain_approaches' && approachReads > 1) rows = rows.map(r => ({ ...r, revision: 3 }));
    const filters: [string, unknown][] = [];
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { filters.push([field, value]); rows = rows.filter(r => r[field] === value); return query; },
      in: (field: string, values: unknown[]) => { rows = rows.filter(r => values.includes(r[field])); return query; },
      order: () => query,
      range: (from: number) => Promise.resolve({ data: rows.slice(from, from + 1), count: rows.length, error: fail === table ? { message: 'failed' } : null }),
      update: (values: unknown) => { writes.push({ table, values, filters }); return query; },
      insert: (values: unknown) => { writes.push({ table, values, filters }); return query; },
      single: () => Promise.resolve({ data: rows[0] ?? null, error: fail === table ? { message: 'conflict' } : null }),
    };
    return query;
  });
});
describe('Domain approach data', () => {
  it('reads all pages and uses existing measure references', async () => {
    const result = await fetchDomainApproaches('d');
    expect(result.conditions.map(c => c.id)).toEqual(['c', 'c2']);
    expect(result.measures.map(m => m.id)).toEqual(['m']);
    expect(mock.rpc).toHaveBeenCalledWith('can_edit_domain_approaches', { p_domain_id: 'd' });
  });
  it('does not display mixed revisions from concurrent writes', async () => {
    changed = true;
    await expect(fetchDomainApproaches('d')).rejects.toThrow('changed while loading');
  });
  it('keeps failed evidence reads distinct from an unassessed condition', async () => {
    fail = 'approach_assessments';
    await expect(fetchDomainApproaches('d')).rejects.toThrow('Unable to read');
  });
  it('does not assume permission when permission lookup fails', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: new Error('permission unavailable') });
    await expect(fetchDomainApproaches('d')).rejects.toThrow('permission unavailable');
  });
  it('returns a read-only surface for a reader', async () => {
    mock.rpc.mockResolvedValue({ data: false, error: null });
    expect((await fetchDomainApproaches('d')).canEdit).toBe(false);
  });
  it('compares approach revision and Domain on edits and never moves the Initiative', async () => {
    await saveDomainApproach('d', { kind: 'approach', id: 'a', revision: 2, values: { title: 'A', expected_change: 'B', hypothesis: 'C', assumptions: '', review_date: null, review_trigger: '', measure_id: null, strategy_id: 's' } });
    expect(writes[0].filters).toEqual([['domain_id', 'd'], ['id', 'a'], ['revision', 2]]);
    expect(writes[0].values).not.toHaveProperty('strategy_id');
  });
  it('uses the revision-locked transaction for editing a condition', async () => {
    const values = { title: 'Readiness', kind: 'readiness' as const, required: true, success_criteria: 'Recovery verified', review_date: null };
    await saveDomainApproach('d', { kind: 'condition', id: 'c', approachId: 'a', revision: 2, values });
    expect(mock.rpc).toHaveBeenCalledWith('edit_approach_plan_item', { p_kind: 'condition', p_id: 'c', p_revision: 2, p_patch: values });
  });
  it('disconnects with the same revision lock as plan editing', async () => {
    await saveDomainApproach('d', { kind: 'disconnect', id: 'l', revision: 2 });
    expect(mock.rpc).toHaveBeenCalledWith('edit_approach_plan_item', { p_kind: 'disconnect', p_id: 'l', p_revision: 2, p_patch: {} });
  });
  it('reports denied/competing saves rather than claiming success', async () => {
    fail = 'approach_reviews';
    await expect(saveDomainApproach('d', { kind: 'review', approachId: 'a', values: { expected_revision: 2, action: 'stop', reasoning: 'Premise refuted', changes: '', next_review_date: null } })).rejects.toEqual({ message: 'conflict' });
  });
});
