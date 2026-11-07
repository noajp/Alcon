import { describe, expect, it } from 'vitest';
import { chainStatusOf, emptyChain } from '@/ActivitySpace/execution/chain/ExecutionChain';
import { STATUS_ORDER } from '@/shared/designTokens';

describe('emptyChain', () => {
  it('has a column for every Status, each one empty — every column renders, empty or not', () => {
    const columns = emptyChain<string>();
    expect(Object.keys(columns)).toEqual([...STATUS_ORDER]);
    for (const s of STATUS_ORDER) expect(columns[s]).toEqual([]);
  });
});

describe('chainStatusOf', () => {
  it('passes a known Status through to its own column', () => {
    for (const s of STATUS_ORDER) expect(chainStatusOf(s)).toBe(s);
  });

  it('reads no Status, and a Status the chain does not have, as To do', () => {
    expect(chainStatusOf(null)).toBe('todo');
    expect(chainStatusOf(undefined)).toBe('todo');
    expect(chainStatusOf('doing')).toBe('todo');
  });
});
