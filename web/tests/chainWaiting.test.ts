import { describe, expect, it } from 'vitest';
import { waitsOnPerson } from '@/ActivitySpace/execution/chain/waiting';

const el = (status: string | null, action: string | null = null) => ({ status, action }) as never;

describe('waitsOnPerson', () => {
  it('marks what only a person can carry', () => {
    for (const verb of ['judge', 'decide', 'approve', 'answer']) expect(waitsOnPerson(el('todo', verb), null), verb).toBe(true);
    for (const verb of ['research', 'create', 'execute', 'verify']) expect(waitsOnPerson(el('todo', verb), null), verb).toBe(false);
  });

  it('marks a blocked Element and an AI run that stopped to ask', () => {
    expect(waitsOnPerson(el('blocked'), null)).toBe(true);
    expect(waitsOnPerson(el('in_progress', 'create'), 'awaiting_approval')).toBe(true);
    expect(waitsOnPerson(el('in_progress', 'research'), 'awaiting_input')).toBe(true);
    expect(waitsOnPerson(el('in_progress', 'research'), 'running')).toBe(false);
    expect(waitsOnPerson(el('todo'), null)).toBe(false);
  });

  it('leaves closed work alone', () => {
    expect(waitsOnPerson(el('done', 'approve'), 'awaiting_approval')).toBe(false);
    expect(waitsOnPerson(el('cancelled', 'decide'), null)).toBe(false);
  });
});
