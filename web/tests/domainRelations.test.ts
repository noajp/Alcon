import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { initiativesForObjects, domainsForObjects } from '@/Function/domain/domainRelations';
import { applyWorkspaceDelta, type Delta } from '@/Function/sync/deltaStream';

const initiatives = [{ id: 'i1', name: 'A', description: null, status: 'active' as const }, { id: 'i2', name: 'B', description: null, status: 'active' as const }];
const objects = [{ id: 'o1', name: 'Shared Object', domain_id: 'd1' }, { id: 'o2', name: 'Other Object', domain_id: 'd2' }];
const domains = [{ id: 'd1', name: 'A', description: null }, { id: 'd2', name: 'B', description: null }];

describe('Domain and Initiative relationships', () => {
  it('includes only visible endpoints in this Domain and deduplicates links', () => {
    expect(initiativesForObjects(['o1'], initiatives, [
      { strategy_id: 'i1', object_id: 'o1' }, { strategy_id: 'i1', object_id: 'o1' },
      { strategy_id: 'i2', object_id: 'o2' }, { strategy_id: 'hidden', object_id: 'o1' },
    ])).toEqual([{ initiative: initiatives[0], objectIds: ['o1'] }]);
    expect(initiativesForObjects([], initiatives, [{ strategy_id: 'i1', object_id: 'o1' }])).toEqual([]);
  });
  it('includes primary and secondary homes without exposing hidden Domains or duplicating Objects', () => {
    const links = [{ domain_id: 'd1', object_id: 'o1' }, { domain_id: 'd2', object_id: 'o1' }, { domain_id: 'd2', object_id: 'o1' }, { domain_id: 'hidden', object_id: 'o1' }];
    expect(domainsForObjects(objects, domains, links)).toEqual([{ domain: domains[0], objects: [objects[0]] }, { domain: domains[1], objects }]);
    expect(domainsForObjects([], domains, links)).toEqual([]);
  });
  it.each(['objects', 'object_domains', 'elements', 'strategy_objects', 'strategies', 'domain_members', 'object_members', 'activity_space_members'] as Delta['table'][])('refreshes both directions when %s changes', table => {
    vi.useFakeTimers();
    try {
      const qc = new QueryClient();
      const keys = [['domain-overview', 'u', 'd1'], ['initiative-domains', 'u', 'i1']];
      for (const key of keys) qc.setQueryData(key, {});
      applyWorkspaceDelta(qc, { userId: 'u' }, { table, type: 'DELETE', old: { id: 'deleted' }, new: {} });
      vi.advanceTimersByTime(200);
      for (const key of keys) expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
      qc.clear();
    } finally { vi.useRealTimers(); }
  });
});
