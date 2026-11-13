import { describe, expect, it } from 'vitest';
import { strategyFacts } from '@/Function/strategy/strategyFacts';

describe('Strategy list facts', () => {
  it('says nothing for a Strategy whose Objects carry nothing', () => {
    expect(strategyFacts([])).toEqual({ start: null, due: null, leadId: null });
    expect(strategyFacts([{}, { due_date: null }])).toEqual({ start: null, due: null, leadId: null });
  });

  it('begins with the earliest start and is due on the latest due date', () => {
    const facts = strategyFacts([
      { start_date: '2026-11-10', due_date: '2026-11-30' },
      { start_date: '2026-11-01', due_date: '2026-12-15' },
      { due_date: '2026-12-01' },
    ]);
    expect(facts.start).toBe('2026-11-01');
    expect(facts.due).toBe('2026-12-15');
  });

  it('is led by whoever leads the most Objects, the first met on a tie', () => {
    expect(strategyFacts([{ lead_id: 'a' }, { lead_id: 'b' }, { lead_id: 'b' }]).leadId).toBe('b');
    expect(strategyFacts([{ lead_id: 'a' }, { lead_id: 'b' }]).leadId).toBe('a');
  });
});
