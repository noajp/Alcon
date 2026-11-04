import { describe, expect, it } from 'vitest';
import { implementPrompt, pickDispatchable, sessionName } from '../../.claude/ops/dispatch.mjs';

const now = Date.parse('2026-11-07T10:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: 'e1', display_id: 'ELE_FN-001', status: 'todo', priority: 'medium', labels: ['dispatch'],
  claimed_by: null, claim_expires_at: null, phase_id: null, created_at: '2026-11-01T00:00:00Z',
  runners: ['claude-code'], ...over,
});

describe('pickDispatchable', () => {
  it('starts only labelled work handed to a Claude Code runner', () => {
    const rows = [
      row({ id: 'ok' }),
      row({ id: 'no-label', labels: [] }),
      row({ id: 'other-runner', runners: [] }),
      row({ id: 'done', status: 'done' }),
      row({ id: 'proposal', status: 'backlog' }),
    ];
    expect(pickDispatchable(rows, { running: new Set(), slots: 5, now }).map((r) => r.id)).toEqual(['ok']);
  });

  it('leaves work someone holds, unless the lease has lapsed', () => {
    const rows = [
      row({ id: 'held', claimed_by: 'agent-x', claim_expires_at: '2026-11-07T10:30:00Z' }),
      row({ id: 'lapsed', claimed_by: 'agent-y', claim_expires_at: '2026-11-07T09:00:00Z' }),
    ];
    expect(pickDispatchable(rows, { running: new Set(), slots: 5, now }).map((r) => r.id)).toEqual(['lapsed']);
  });

  it('skips what it is already running and respects the free slots', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
    expect(pickDispatchable(rows, { running: new Set(['a']), slots: 1, now }).map((r) => r.id)).toEqual(['b']);
    expect(pickDispatchable(rows, { running: new Set(), slots: 0, now })).toEqual([]);
  });

  it('takes sprint work first, then priority, then the oldest', () => {
    const rows = [
      row({ id: 'old-low', priority: 'low', created_at: '2026-10-01T00:00:00Z' }),
      row({ id: 'urgent', priority: 'urgent' }),
      row({ id: 'sprint', phase_id: 'p1', priority: 'low' }),
      row({ id: 'old-medium', created_at: '2026-10-01T00:00:00Z' }),
      row({ id: 'new-medium', created_at: '2026-11-05T00:00:00Z' }),
    ];
    expect(pickDispatchable(rows, { running: new Set(), slots: 5, now }).map((r) => r.id))
      .toEqual(['sprint', 'urgent', 'old-medium', 'new-medium', 'old-low']);
  });
});

describe('sessionName', () => {
  it('names the worktree after the Element, with the prefix sync cleans up', () => {
    expect(sessionName({ id: 'x', display_id: 'ELE_FN-001' })).toBe('agent-ele-fn-001');
    expect(sessionName({ id: 'abc', display_id: null })).toBe('agent-abc');
  });
});

describe('implementPrompt', () => {
  it('fills in the Element', () => {
    expect(implementPrompt({ id: 'u1', display_id: 'ELE_FN-001', title: '検索' }, '{{display_id}} {{title}} {{element_id}} {{display_id}}'))
      .toBe('ELE_FN-001 検索 u1 ELE_FN-001');
  });
});
