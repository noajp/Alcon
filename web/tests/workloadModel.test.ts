import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  reads: [] as string[],
  failures: new Set<string>(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      source.reads.push(table);
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let start = 0;
      let end = 499;
      const query = {
        select: () => query,
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query; },
        in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return query; },
        order: () => query,
        range(from: number, to: number) { start = from; end = to; return query; },
        abortSignal: () => query,
        then(resolve: (value: unknown) => unknown) {
          if (source.failures.has(table)) return Promise.resolve(resolve({ data: null, count: null, error: { message: 'read failed' } }));
          const rows = (source.tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
          return Promise.resolve(resolve({ data: rows.slice(start, Math.min(end + 1, start + 2)), count: rows.length, error: null }));
        },
      };
      return query;
    },
  },
}));

import { summarizeWorkload, workloadBar, workloadDailyHours, workloadDomainIds, workloadElementsInWindow, workloadOverDays, workloadUtilization, selectWorkloadElements, resolveWorkloadScope } from '@/Function/workload/workloadModel';
import { fetchWorkloadObject } from '@/hooks/useWorkloadData';
import { fetchSustainmentDomains } from '@/hooks/useSustainmentDomains';
import type { AlconObjectWithChildren, ElementWithDetails } from '@/types/database';

const element = (id: string, changes: Partial<ElementWithDetails> = {}): ElementWithDetails => ({
  id, title: id, start_date: null, due_date: null, estimated_hours: 6, priority: 'medium', status: 'todo', ...changes,
} as ElementWithDetails);
const object = (id: string, elements: ElementWithDetails[]) => ({ id, elements } as AlconObjectWithChildren);

describe('Workload scope', () => {
  it('resets a previous Space selection and preserves an explicit empty filter', () => {
    expect(workloadDomainIds({ contextKey: 'a', domainIds: ['old'] }, 'b', ['new'])).toEqual(['new']);
    expect(workloadDomainIds({ contextKey: 'b', domainIds: [] }, 'b', ['new'])).toEqual([]);
    expect(workloadDomainIds({ contextKey: 'b', domainIds: ['new', 'revoked'] }, 'b', ['new'])).toEqual(['new']);
    expect(workloadDomainIds({ contextKey: 'b', domainIds: null }, 'b', ['new', 'guest'])).toEqual(['new', 'guest']);
  });
  it('keeps exact invited Domain/Object tabs independent of the active Space while restricting standalone scope', () => {
    const selection = { contextKey: 'current', domainIds: ['local', 'former-space'] };
    expect(resolveWorkloadScope(selection, 'current', ['local'])).toEqual({ selectedDomainIds: ['local'], domainIds: ['local'], objectIds: [] });
    expect(resolveWorkloadScope(selection, 'current', ['local'], { domainIds: ['guest-domain'], objectIds: ['shared-object'] }))
      .toEqual({ selectedDomainIds: ['local'], domainIds: ['guest-domain'], objectIds: ['shared-object'] });
    expect(resolveWorkloadScope(selection, 'current', ['local'], {}))
      .toEqual({ selectedDomainIds: ['local'], domainIds: [], objectIds: [] });
  });

  const shared = element('shared');
  const explorers = [
    { domainId: 'a', data: { rootElements: [element('direct')], objects: [object('a1', [element('first'), shared])] } },
    { domainId: 'b', data: { rootElements: [element('outside')], objects: [object('b1', [shared, element('second')]), object('b2', [element('excluded')])] } },
  ];
  it('excludes unscoped RPC root rows and counts multi-homed Object work once', () => {
    expect(selectWorkloadElements(explorers, ['a', 'b'], []).map(row => row.id)).toEqual(['first', 'shared', 'second', 'excluded']);
  });
  it('combines Domain and explicit Object scope without broadening to a whole loaded Domain', () => {
    expect(selectWorkloadElements(explorers, ['a'], ['b1']).map(row => row.id)).toEqual(['first', 'shared', 'second']);
    expect(selectWorkloadElements(explorers, [], ['b1']).map(row => row.id)).toEqual(['shared', 'second']);
    expect(selectWorkloadElements(explorers, [], ['missing'])).toEqual([]);
    expect(selectWorkloadElements(explorers, [], [])).toEqual([]);
  });
  it('admits only explicitly selected Objects from an exact Object cache', () => {
    const exact = [{ domainId: null, data: { objects: [object('shared-object', [shared]), object('sibling', [element('unrelated')])], rootElements: [element('global-unhomed')] } }];
    expect(selectWorkloadElements(exact, ['a'], ['shared-object']).map(row => row.id)).toEqual(['shared']);
    expect(selectWorkloadElements(exact, ['a'], []).map(row => row.id)).toEqual([]);
  });
});

describe('Sustainment visibility reads', () => {
  beforeEach(() => {
    source.tables = {};
    source.reads = [];
    source.failures.clear();
  });

  it('reads all visible current-Space Domains without requiring explicit membership and exhausts server pages', async () => {
    source.tables.domains = [
      { id: 'public', activity_space_id: 'current' },
      { id: 'owned', activity_space_id: 'current' },
      { id: 'invited', activity_space_id: 'current' },
      { id: 'other-space', activity_space_id: 'other' },
    ];
    const domains = await fetchSustainmentDomains('current');
    expect(domains.map(domain => domain.id)).toEqual(['public', 'owned', 'invited']);
    expect(source.reads).toEqual(['domains', 'domains']);
  });

  it('does not perform an unscoped query when no Space is selected or hide failed reads as an empty roster', async () => {
    expect(await fetchSustainmentDomains('')).toEqual([]);
    expect(source.reads).toEqual([]);
    source.failures.add('domains');
    await expect(fetchSustainmentDomains('current')).rejects.toThrow('Unable to read Sustainment Domains');
  });

  it('reads only an explicitly visible Object even when its Domain is invisible', async () => {
    source.tables = {
      domains: [],
      objects: [{ id: 'target', domain_id: 'hidden-domain' }, { id: 'sibling', domain_id: 'hidden-domain' }, { id: 'foreign', domain_id: 'other-space-domain' }],
      elements: [
        { ...element('first'), object_id: 'target' },
        { ...element('second'), object_id: 'target' },
        { ...element('third'), object_id: 'target' },
        { ...element('linked'), object_id: 'sibling' },
        { ...element('excluded'), object_id: 'foreign' },
        { ...element('unhomed'), object_id: null },
      ],
      element_objects: [{ object_id: 'target', element_id: 'first' }, { object_id: 'target', element_id: 'linked' }, { object_id: 'foreign', element_id: 'excluded' }],
      element_assignees: [{ id: 'assigned', element_id: 'linked', worker_id: 'worker' }, { id: 'not-read', element_id: 'excluded', worker_id: 'foreign-worker' }],
      workers: [{ id: 'worker', name: 'Visible Worker' }, { id: 'foreign-worker', name: 'Outside Worker' }],
    };
    const explorer = await fetchWorkloadObject('target');
    expect(explorer.objects.map(row => row.id)).toEqual(['target']);
    expect(explorer.objects[0].elements?.map(row => row.id)).toEqual(['first', 'second', 'third', 'linked']);
    expect(explorer.objects[0].elements?.find(row => row.id === 'linked')?.assignees?.[0].worker?.name).toBe('Visible Worker');
    expect(explorer.rootElements).toEqual([]);
    expect(source.reads).not.toContain('domains');
    expect(source.reads).not.toContain('domain_members');
  });

  it('rejects an inaccessible Object before reading assignments or unrelated data', async () => {
    source.tables.objects = [{ id: 'other', domain_id: 'other-domain' }];
    await expect(fetchWorkloadObject('missing')).rejects.toThrow('no longer available');
    expect(source.reads).toEqual(['objects']);
  });
});

describe('Workload calendar arithmetic', () => {
  const days = ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'];
  it('spreads an inclusive date-only range through a DST boundary without shifting it', () => {
    const row = element('range', { start_date: days[0], due_date: days[2] });
    expect(workloadDailyHours([row, row], days, days[0])).toEqual([2, 2, 2, 0]);
    expect(workloadBar(row, days)).toEqual({ offset: 0, length: 3 });
  });
  it('uses the assignment picker rules for reversed and single-day dates', () => {
    const reversed = element('range', { start_date: days[2], due_date: days[0] });
    expect(workloadDailyHours([reversed], days, days[0])).toEqual([2, 2, 2, 0]);
    expect(workloadBar(reversed, days.slice(1))).toEqual({ offset: 0, length: 2 });
    expect(workloadDailyHours([element('due', { due_date: days[1] })], days, days[0])).toEqual([0, 6, 0, 0]);
  });
  it('frees today and future load for completed work while retaining earlier booked days', () => {
    const row = element('closed', { start_date: days[0], due_date: days[2], status: 'done' });
    expect(workloadDailyHours([row], days, days[1])).toEqual([2, 0, 0, 0]);
  });
  it('keeps unscheduled work actionable and excludes dated work outside the window', () => {
    const undated = element('undated');
    const dated = element('dated', { due_date: days[1] });
    const outside = element('outside', { due_date: '2027-01-01' });
    expect(workloadElementsInWindow([undated, outside, dated], days).map(row => row.id)).toEqual(['dated', 'undated']);
    expect(workloadDailyHours([undated], days, days[0])).toEqual([0, 0, 0, 0]);
    expect(workloadBar(undated, days)).toBeNull();
  });
});

describe('workload summary', () => {
  it('reads utilization as load over capacity, and no capacity as no reading', () => {
    expect(workloadUtilization([4, 8], [8, 8])).toBe(0.75);
    expect(workloadUtilization([4], [0])).toBeNull();
  });

  it('counts overloaded people, over days and the AI share of the hours', () => {
    expect(workloadOverDays([8, 8.005, 9], [8, 8, 8])).toBe(1);
    const summary = summarizeWorkload([
      { type: 'human', daily: [10, 4], capacity: [8, 8] },
      { type: 'ai_agent', daily: [6, 6], capacity: [16, 16] },
      { type: 'robot', daily: [30, 0], capacity: [8, 8] },
    ]);
    expect(summary.overloadedPeople).toBe(1);
    expect(summary.overDays).toBe(2);
    expect(summary.hours).toBe(56);
    expect(summary.aiShare).toBeCloseTo(12 / 56);
    expect(summary.utilization).toBeCloseTo(56 / 64);
  });
});
