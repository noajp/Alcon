import { describe, expect, it } from 'vitest';
import { buildNowItems, validWorkDate } from '../src/alcon/element/now/nowModel';
import type { ElementWithDetails, ElementEdge } from '../src/types/database';

const element = (id: string, patch: Partial<ElementWithDetails> = {}): ElementWithDetails => ({
  id, title: id, status: 'todo', owner_id: 'me', due_date: null, start_date: null,
  priority: 'medium', ...patch,
} as ElementWithDetails);
const edge = (from_element: string, to_element: string) => ({ from_element, to_element, edge_type: 'depends_on' } as ElementEdge);
const queue = (elements: ElementWithDetails[], edges: ElementEdge[] = []) => buildNowItems(elements, edges, 'me', 'mine', '2026-09-07');

describe('Now operational queue', () => {
  it('offers ordinary work without requiring a dependency graph or estimate', () => {
    const row = queue([element('a')])[0];
    expect(row.lane).toBe('ready'); expect(row.reason).toBe('No dependency recorded'); expect(row.overdue).toBe(false);
  });
  it('does not hide team prerequisites when filtering my work', () => {
    const rows = queue([element('mine'), element('theirs', { owner_id: 'other' })], [edge('theirs', 'mine')]);
    expect(rows).toHaveLength(1); expect(rows[0].blockers[0].id).toBe('theirs'); expect(rows[0].lane).toBe('waiting');
  });
  it('a completion releases the dependent without another report', () => {
    const links = [edge('a', 'b')];
    expect(queue([element('a'), element('b')], links).find(r => r.element.id === 'a')?.unlocks.map(e => e.id)).toEqual(['b']);
    const rows = queue([element('a', { status: 'done' }), element('b')], links);
    expect(rows).toHaveLength(1); expect(rows[0].lane).toBe('ready'); expect(rows[0].reason).toContain('prerequisites');
  });
  it('does not claim an immediate unlock while another prerequisite remains', () => {
    const rows = queue(['a', 'b', 'c'].map(id => element(id)), [edge('a', 'c'), edge('b', 'c')]);
    expect(rows.find(r => r.element.id === 'a')?.unlocks).toEqual([]);
  });
  it('missing and cancelled prerequisites cannot silently make work ready', () => {
    const rows = queue([element('cancelled', { status: 'cancelled' }), element('a'), element('b')], [edge('missing', 'a'), edge('cancelled', 'b')]);
    expect(rows.find(r => r.element.id === 'a')?.unknownDependency).toBe(true);
    expect(rows.every(r => r.lane === 'waiting')).toBe(true);
  });
  it('duplicate relations collapse and nondependency relations do not block', () => {
    const rows = queue([element('a'), element('b')], [edge('a', 'b'), edge('a', 'b'), { ...edge('b', 'a'), edge_type: 'references' }]);
    expect(rows.find(r => r.element.id === 'b')?.blockers).toHaveLength(1);
    expect(rows.find(r => r.element.id === 'a')?.lane).toBe('ready');
  });
  it('cycles and malformed self dependencies remain waiting', () => {
    const rows = queue(['a', 'b', 'c'].map(id => element(id)), [edge('a', 'b'), edge('b', 'a'), edge('c', 'c')]);
    expect(rows.every(r => r.lane === 'waiting')).toBe(true);
    expect(rows.find(r => r.element.id === 'c')?.unlocks).toEqual([]);
  });
  it('does not treat backlog or future starts as today commitments', () => {
    const rows = queue([element('a', { status: 'backlog' }), element('b', { start_date: '2026-09-08' })]);
    expect(rows.every(r => r.lane === 'later')).toBe(true);
  });
  it('does not infer that the assignee is the approver', () => {
    const row = queue([element('a', { is_approval: true, approval_state: 'pending' })])[0];
    expect(row.lane).toBe('attention'); expect(row.reason).toBe('Approval pending — confirm who can decide');
  });
  it('preserves manual blocked and unknown status without inventing lateness', () => {
    const rows = queue([element('a', { status: 'blocked' }), element('b', { status: null })]);
    expect(rows.find(r => r.element.id === 'a')?.lane).toBe('waiting');
    expect(rows.find(r => r.element.id === 'b')?.lane).toBe('attention');
    expect(rows.every(r => !r.overdue)).toBe(true);
  });
  it('uses actual calendar dates and keeps due-today inside its working day', () => {
    expect(validWorkDate('2026-02-30')).toBeNull(); expect(validWorkDate('09/07/2026')).toBeNull();
    expect(validWorkDate('2028-02-29')).toBe('2028-02-29');
    const rows = queue([element('today', { due_date: '2026-09-07' }), element('late', { due_date: '2026-09-06' })]);
    expect(rows[0].element.id).toBe('late'); expect(rows.find(r => r.element.id === 'today')?.overdue).toBe(false);
  });
  it('counts one multi-homed Element once and keeps collaborator-only work out of mine', () => {
    const row = element('a', { owner_id: null, assignees: [{ worker: { user_id: 'me' }, role: 'collaborator' }] as ElementWithDetails['assignees'] });
    expect(queue([row])).toEqual([]);
    expect(buildNowItems([row, row], [], 'me', 'team', '2026-09-07')).toHaveLength(1);
  });
});
