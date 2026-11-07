import { describe, expect, it } from 'vitest';
import { collapsedColumns, emptyChain, type ChainStatus } from '@/ActivitySpace/execution/chain/ExecutionChain';

describe('collapsedColumns', () => {
  it('collapses every empty column a person has not expanded', () => {
    const columns = emptyChain<string>();
    columns.todo = ['a'];
    const collapsed = collapsedColumns(columns, new Set());
    expect(collapsed.has('todo')).toBe(false);
    for (const s of ['backlog', 'in_progress', 'review', 'done', 'cancelled', 'blocked'] as ChainStatus[]) {
      expect(collapsed.has(s), s).toBe(true);
    }
  });

  it('keeps an expanded empty column full-size', () => {
    const columns = emptyChain<string>();
    const collapsed = collapsedColumns(columns, new Set<ChainStatus>(['done', 'blocked']));
    expect(collapsed.has('done')).toBe(false);
    expect(collapsed.has('blocked')).toBe(false);
    expect(collapsed.has('review')).toBe(true);
  });

  it('never collapses a column with cards, expanded or not', () => {
    const columns = emptyChain<string>();
    columns.review = ['a', 'b'];
    expect(collapsedColumns(columns, new Set()).has('review')).toBe(false);
    expect(collapsedColumns(columns, new Set<ChainStatus>(['review'])).has('review')).toBe(false);
  });
});
