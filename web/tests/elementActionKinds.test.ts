import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ELEMENT_ACTIONS, isElementAction, isHumanAction } from '../src/Function/shared/elementActionKinds';

describe('element actions', () => {
  it('a person carries judge, decide, approve and answer; the rest are work', () => {
    expect(ELEMENT_ACTIONS.filter(isHumanAction)).toEqual(['judge', 'decide', 'approve', 'answer']);
  });
  it('reads only the known verbs', () => {
    expect(isElementAction('judge')).toBe(true);
    expect(isElementAction('think')).toBe(false);
    expect(isElementAction(null)).toBe(false);
  });
  it('the database accepts exactly the same verbs', () => {
    const sql = readFileSync(join(__dirname, '../../supabase/migrations/20261116100000_element_action.sql'), 'utf8');
    const listed = [...sql.slice(sql.indexOf('action in (')).matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(listed)).toEqual(new Set(ELEMENT_ACTIONS));
  });
});
