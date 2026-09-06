import { describe, it, expect } from 'vitest';
import { computeInitiativeHealth } from '../src/alcon/element/actions/initiativeHealthModel';
import type { RiskElement } from '../src/alcon/element/actions/initiativeRiskModel';

const NOW = Date.parse('2026-09-06T12:00:00Z');
const el = (o: Partial<RiskElement> & { id: string }): RiskElement => ({
  display_id: null, title: o.id, status: 'todo', due_date: null, updated_at: null,
  objectIds: ['obj-a'], assignees: [], lastProgressAt: null, ...o,
});

describe('computeInitiativeHealth', () => {
  it('measures progress over non-cancelled Elements in scope only', () => {
    const h = computeInitiativeHealth(['obj-a'], [
      el({ id: '1', status: 'done' }),
      el({ id: '2', status: 'todo' }),
      el({ id: '3', status: 'cancelled' }),
      el({ id: '4', status: 'done', objectIds: ['obj-elsewhere'] }),
    ], NOW);
    expect(h.total).toBe(2);
    expect(h.done).toBe(1);
    expect(h.progressPct).toBe(50);
  });

  it('has no percentage for an empty Initiative rather than a fake 0', () => {
    expect(computeInitiativeHealth(['obj-a'], [], NOW).progressPct).toBeNull();
  });

  it('takes the newest signal as last activity, preferring progress comments', () => {
    const h = computeInitiativeHealth(['obj-a'], [
      el({ id: '1', updated_at: '2026-09-06T09:00:00Z' }),
      el({ id: '2', updated_at: '2026-09-05T09:00:00Z', lastProgressAt: Date.parse('2026-09-06T11:30:00Z') }),
    ], NOW);
    expect(h.lastActivityAt).toBe(Date.parse('2026-09-06T11:30:00Z'));
  });

  it('reports null activity when nothing has ever reported', () => {
    expect(computeInitiativeHealth(['obj-a'], [el({ id: '1' })], NOW).lastActivityAt).toBeNull();
  });

  it("says the schedule is unmeasured when no open Element has a date — 0 overdue is not 'on time'", () => {
    const h = computeInitiativeHealth(['obj-a'], [el({ id: '1', status: 'in_progress' })], NOW);
    expect(h.risk.overdue).toBe(0);
    expect(h.scheduleMeasured).toBe(false);
  });

  it('counts overdue / stalled / blocked with the risk model’s own predicates', () => {
    const h = computeInitiativeHealth(['obj-a'], [
      el({ id: 'late', status: 'todo', due_date: '2026-09-01' }),
      el({ id: 'stuck', status: 'in_progress', lastProgressAt: NOW - 60 * 60_000 }),
      el({ id: 'wall', status: 'blocked' }),
      el({ id: 'fine', status: 'in_progress', due_date: '2026-12-01', lastProgressAt: NOW - 60_000 }),
    ], NOW);
    expect(h.risk.overdue).toBe(1);
    expect(h.risk.stalled).toBe(1);
    expect(h.risk.blocked).toBe(1);
    expect(h.scheduleMeasured).toBe(true);
  });
});
