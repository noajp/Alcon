import { describe, expect, it } from 'vitest';
import { objectStatusOf } from '@/ActivitySpace/execution/chain/objectStatus';

describe('objectStatusOf', () => {
  it('reads an empty Object as Backlog and a closed one as Done or Cancelled', () => {
    expect(objectStatusOf([])).toBe('backlog');
    expect(objectStatusOf(['done', 'cancelled'])).toBe('done');
    expect(objectStatusOf(['cancelled'])).toBe('cancelled');
  });
  it('puts moving work first, then review, a block, partial progress, and plans', () => {
    expect(objectStatusOf(['todo', 'in_progress', 'blocked'])).toBe('in_progress');
    expect(objectStatusOf(['todo', 'review'])).toBe('review');
    expect(objectStatusOf(['todo', 'blocked'])).toBe('blocked');
    expect(objectStatusOf(['todo', 'done'])).toBe('in_progress');
    expect(objectStatusOf(['backlog', 'todo'])).toBe('todo');
    expect(objectStatusOf([null, 'backlog'])).toBe('todo');
    expect(objectStatusOf(['backlog'])).toBe('backlog');
  });
});
