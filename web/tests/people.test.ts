import { describe, expect, it } from 'vitest';
import { assignmentHistory, evidenceCandidates, parseSkillName, skillIndex, skillKey } from '@/ActivitySpace/sustainment/team/people';
import type { TeamElement } from '@/ActivitySpace/sustainment/team/teamRoster';
import type { WorkerSkill } from '@/types/database';

const element = (id: string, overrides: Partial<TeamElement> = {}): TeamElement => ({
  id, title: id, display_id: null, status: 'todo', due_date: null, object_id: 'a',
  start_date: null, created_at: null, updated_at: null, ...overrides,
});
const skill = (id: string, workerId: string, name: string, level: WorkerSkill['level']): WorkerSkill => ({
  id, worker_id: workerId, name, level, created_by: null, created_at: '', updated_at: '',
});

describe('assignment history', () => {
  it('counts done and open per Object and spans start to due, most recent first', () => {
    const rows = assignmentHistory([
      element('1', { object_id: 'a', status: 'done', start_date: '2026-03-01T00:00:00Z', due_date: '2026-03-10' }),
      element('2', { object_id: 'a', status: 'in_progress', created_at: '2026-02-20T09:00:00Z', due_date: '2026-04-01' }),
      element('3', { object_id: 'a', status: 'cancelled', due_date: '2026-05-01' }),
      element('4', { object_id: 'b', status: 'done', start_date: '2026-06-01', updated_at: '2026-06-03T10:00:00Z' }),
      element('5', { object_id: null }),
    ], new Map([['a', 'Alpha']]));
    expect(rows).toEqual([
      { objectId: 'b', objectName: null, total: 1, done: 1, open: 0, first: '2026-06-01', last: '2026-06-03' },
      { objectId: 'a', objectName: 'Alpha', total: 3, done: 1, open: 1, first: '2026-02-20', last: '2026-05-01' },
    ]);
  });
});

describe('skill evidence candidates', () => {
  it('offers only done work that is not attached yet, newest first', () => {
    const elements = [
      element('old', { status: 'done', updated_at: '2026-01-01' }),
      element('new', { status: 'done', updated_at: '2026-02-01' }),
      element('open'),
      element('linked', { status: 'done' }),
    ];
    expect(evidenceCandidates({ elements }, new Set(['linked'])).map((row) => row.id)).toEqual(['new', 'old']);
  });
});

describe('skill names', () => {
  it('normalises spacing and case for identity', () => {
    expect(parseSkillName('  Incident   command ')).toBe('Incident command');
    expect(skillKey(' React ')).toBe(skillKey('react'));
    expect(() => parseSkillName('   ')).toThrow('Enter a skill name.');
    expect(() => parseSkillName('x'.repeat(61))).toThrow('60 characters');
  });
});

describe('skill index', () => {
  it('groups spellings, ranks holders by level then evidence, and stays inside the roster', () => {
    const index = skillIndex([
      skill('s1', 'ann', 'React', 2),
      skill('s2', 'bob', 'react', 2),
      skill('s3', 'cat', 'React', 4),
      skill('s4', 'ann', 'Triage', 3),
      skill('s5', 'outsider', 'Triage', 4),
    ], [
      { skill_id: 's2', element_id: 'e1', created_at: '' },
      { skill_id: 's2', element_id: 'e2', created_at: '' },
      { skill_id: 's1', element_id: 'e3', created_at: '' },
    ], new Set(['ann', 'bob', 'cat']));
    expect(index.map((row) => [row.name, row.holders.map((holder) => holder.workerId)])).toEqual([
      ['React', ['cat', 'bob', 'ann']],
      ['Triage', ['ann']],
    ]);
  });
});
