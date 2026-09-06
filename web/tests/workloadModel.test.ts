import { describe, expect, it } from 'vitest';
import { workloadBar, workloadDailyHours, workloadDomainIds, workloadElementsInWindow, selectWorkloadElements } from '@/alcon/team/workloadModel';
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

  const shared = element('shared');
  const explorers = [
    { domainId: 'a', data: { rootElements: [element('direct')], objects: [object('a1', [element('first'), shared])] } },
    { domainId: 'b', data: { rootElements: [element('outside')], objects: [object('b1', [shared, element('second')]), object('b2', [element('excluded')])] } },
  ];
  it('includes Domain-direct work and counts multi-homed work once', () => {
    expect(selectWorkloadElements(explorers, ['a', 'b'], []).map(row => row.id)).toEqual(['direct', 'first', 'shared', 'outside', 'second', 'excluded']);
  });
  it('combines Domain and explicit Object scope without broadening to a whole loaded Domain', () => {
    expect(selectWorkloadElements(explorers, ['a'], ['b1']).map(row => row.id)).toEqual(['direct', 'first', 'shared', 'second']);
    expect(selectWorkloadElements(explorers, [], ['b1']).map(row => row.id)).toEqual(['shared', 'second']);
    expect(selectWorkloadElements(explorers, [], ['missing'])).toEqual([]);
    expect(selectWorkloadElements(explorers, [], [])).toEqual([]);
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
