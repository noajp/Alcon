import { describe, expect, it } from 'vitest';
import { awaitingElementIds } from '@/hooks/awaitingAnswerData';

// The lists mark the Elements that wait on the person: the store reads
// the open tickets of runs they started and names each Element once.
describe('awaitingElementIds', () => {
  it('names each Element once, and skips a ticket that rests on none', () => {
    const rows = [{ element_id: 'e1' }, { element_id: 'e2' }, { element_id: 'e1' }, { element_id: null }];
    expect([...awaitingElementIds(rows)]).toEqual(['e1', 'e2']);
  });

  it('is empty when nothing waits', () => {
    expect(awaitingElementIds([]).size).toBe(0);
  });
});
