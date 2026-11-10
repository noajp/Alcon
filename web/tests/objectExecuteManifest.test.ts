// The Object execute manifest (card hover-execute, PR2, design §6.1):
// each Element's disposition is the FIRST match in a precedence order,
// the startable set is the only thing Execute starts, a person's own
// task is never pulled into an AI run (D4), and the startable group
// reads in dependency order. These tests pin the precedence and the
// ordering, because the failure mode is the popup saying one thing and
// the start loop doing another.

import { describe, expect, it } from 'vitest';
import {
  objectExecuteManifest,
  startableDependencyOrder,
  type ManifestEdgeRow,
  type ManifestElementRow,
  type ManifestRunRow,
  type ManifestWaiting,
} from '@/Function/shared/element/objectExecuteManifest';
import type { DependencyEdgeRow } from '@/Function/shared/element/dependencyReadiness';

const el = (id: string, over: Partial<ManifestElementRow> = {}): ManifestElementRow => ({
  id, title: `Element ${id}`, display_id: null, status: 'todo', assignee: null, assigneeName: null, ...over,
});
const dep = (from_element: string, to_element: string): ManifestEdgeRow => ({ from_element, to_element, edge_type: 'depends_on' });
const run = (element_id: string, status: string, created_at = '2026-11-10T00:00:00Z'): ManifestRunRow => ({ element_id, status, created_at });
const waiting = (kind: ManifestWaiting['kind'], over: Partial<ManifestWaiting> = {}): ManifestWaiting => ({ kind, needsPerson: true, ...over });

const kinds = (m: ReturnType<typeof objectExecuteManifest>) => m.rows.map((r) => [r.element.id, r.disposition.kind]);

describe('objectExecuteManifest — disposition precedence (§6.1)', () => {
  it('done beats an open run, and cancelled beats an open run', () => {
    const m = objectExecuteManifest({
      elements: [el('a', { status: 'done' }), el('b', { status: 'cancelled' })],
      edges: [], runs: [run('a', 'running'), run('b', 'running')],
    });
    expect(kinds(m)).toEqual([['a', 'done'], ['b', 'cancelled']]);
    expect(m.toStart).toBe(0);
  });

  it('an open run beats unresolved upstreams, and carries its resting status', () => {
    const m = objectExecuteManifest({
      elements: [el('a'), el('b')],
      edges: [dep('b', 'a')],
      runs: [run('a', 'awaiting_approval')],
      upstreams: [el('a'), el('b', { status: 'in_progress' })],
    });
    const rowA = m.rows.find((r) => r.element.id === 'a')!;
    expect(rowA.disposition).toEqual({ kind: 'running', runStatus: 'awaiting_approval' });
    expect(rowA.starts).toBe(false);
  });

  it('the latest open run wins when several runs are listed; a finished run is not an open run', () => {
    const m = objectExecuteManifest({
      elements: [el('a'), el('b')],
      edges: [],
      runs: [
        run('a', 'running', '2026-11-10T00:00:00Z'),
        run('a', 'paused', '2026-11-10T01:00:00Z'),
        run('b', 'completed'),
      ],
    });
    expect(m.rows.find((r) => r.element.id === 'a')!.disposition).toEqual({ kind: 'running', runStatus: 'paused' });
    expect(m.rows.find((r) => r.element.id === 'b')!.disposition).toEqual({ kind: 'will-start' });
  });

  it('a run awaiting an answer is already going (disposition 3), not startable', () => {
    const m = objectExecuteManifest({ elements: [el('a')], edges: [], runs: [run('a', 'awaiting_input')] });
    expect(m.rows[0].disposition).toEqual({ kind: 'running', runStatus: 'awaiting_input' });
    expect(m.toStart).toBe(0);
  });

  it('unresolved upstreams block, naming every blocker in edge order; upstreams outside the Object count too', () => {
    const m = objectExecuteManifest({
      elements: [el('a')],
      edges: [dep('x', 'a'), dep('y', 'a'), dep('z', 'a')],
      runs: [],
      upstreams: [
        el('x', { title: 'First', display_id: 'ELE_PH1-001', status: 'in_progress' }),
        el('y', { title: 'Second', status: 'todo' }),
        el('z', { title: 'Finished', status: 'done' }),
      ],
    });
    const d = m.rows[0].disposition;
    expect(d.kind).toBe('blocked');
    if (d.kind === 'blocked') {
      expect(d.blockers.map((b) => b.title)).toEqual(['First', 'Second']);
      expect(d.blockers[0].display_id).toBe('ELE_PH1-001');
    }
    expect(m.rows[0].starts).toBe(false);
  });

  it('blocked beats waiting-on-a-person and beats a human assignee', () => {
    const m = objectExecuteManifest({
      elements: [el('a', { assignee: 'human', assigneeName: 'Hina' })],
      edges: [dep('x', 'a')],
      runs: [],
      upstreams: [el('x', { status: 'todo' })],
      waiting: new Map([['a', waiting('review')]]),
    });
    expect(m.rows[0].disposition.kind).toBe('blocked');
  });

  it('waiting on a person beats a human assignee; a dependency waiting (not a person) does not block the start', () => {
    const m = objectExecuteManifest({
      elements: [el('a', { assignee: 'human', assigneeName: 'Hina' }), el('b')],
      edges: [], runs: [],
      waiting: new Map<string, ManifestWaiting | null>([
        ['a', waiting('review')],
        ['b', { kind: 'dependency', needsPerson: false }],
      ]),
    });
    expect(m.rows.find((r) => r.element.id === 'a')!.disposition).toEqual({ kind: 'waiting', waiting: waiting('review') });
    expect(m.rows.find((r) => r.element.id === 'b')!.disposition).toEqual({ kind: 'will-start' });
  });

  it('a human-assigned Element is skipped with the person’s name (D4); an AI assignee or nobody starts', () => {
    const m = objectExecuteManifest({
      elements: [
        el('a', { assignee: 'human', assigneeName: 'Hina' }),
        el('b', { assignee: 'human', assigneeName: null }),
        el('c', { assignee: 'ai', assigneeName: 'Athena' }),
        el('d'),
      ],
      edges: [], runs: [],
    });
    expect(m.rows.find((r) => r.element.id === 'a')!.disposition).toEqual({ kind: 'with-person', name: 'Hina' });
    expect(m.rows.find((r) => r.element.id === 'b')!.disposition).toEqual({ kind: 'with-person', name: null });
    expect(m.startable.map((r) => r.element.id)).toEqual(['c', 'd']);
    expect(m.skipped).toBe(2);
  });
});

describe('objectExecuteManifest — row order (§6.1)', () => {
  it('startable first, then running, blocked, waiting, with a person, done, cancelled — each group in Object order', () => {
    const m = objectExecuteManifest({
      elements: [
        el('cancelled', { status: 'cancelled' }),
        el('done', { status: 'done' }),
        el('person', { assignee: 'human', assigneeName: 'Hina' }),
        el('wait', { status: 'review' }),
        el('block'),
        el('run1'),
        el('start2'),
        el('start1'),
        el('run2'),
      ],
      edges: [dep('up', 'block')],
      runs: [run('run1', 'running'), run('run2', 'queued')],
      upstreams: [el('up', { status: 'todo' })],
      waiting: new Map([['wait', waiting('review')]]),
    });
    expect(m.rows.map((r) => r.element.id)).toEqual([
      'start2', 'start1', 'run1', 'run2', 'block', 'wait', 'person', 'done', 'cancelled',
    ]);
    expect(m.rows.map((r) => r.disposition.kind)).toEqual([
      'will-start', 'will-start', 'running', 'running', 'blocked', 'waiting', 'with-person', 'done', 'cancelled',
    ]);
    expect(m.toStart).toBe(2);
    expect(m.skipped).toBe(7);
  });

  it('dependency order: an Element whose upstream is done starts; one whose upstream is itself starting waits (§6.3 — no chaining)', () => {
    // a is done, so b can start; c waits on b, and this action does NOT
    // start c when b's run finishes — c is 'blocked', not startable.
    // (Within the startable group itself an internal edge cannot
    // survive the blocker rule — a startable Element's upstreams are
    // done by construction — so the group's dependency ordering is the
    // Object's own order, which the row-order test above pins.)
    const m = objectExecuteManifest({
      elements: [el('c'), el('b'), el('a', { status: 'done' })],
      edges: [dep('a', 'b'), dep('b', 'c')],
      runs: [],
    });
    expect(m.startable.map((r) => r.element.id)).toEqual(['b']);
    expect(m.rows.find((r) => r.element.id === 'c')!.disposition.kind).toBe('blocked');
  });

  it('startableDependencyOrder: upstreams before downstreams, the given order kept where edges say nothing', () => {
    const depRow = (from_element: string, to_element: string, edge_type = 'depends_on'): DependencyEdgeRow => ({ from_element, to_element, edge_type });
    const els = [el('c'), el('a'), el('b'), el('free')];
    // a → b → c, 'free' unconstrained: it keeps its given place among
    // the ready, and the chain reads a, b, c.
    expect(startableDependencyOrder(els, [depRow('a', 'b'), depRow('b', 'c')]).map((e) => e.id))
      .toEqual(['a', 'b', 'c', 'free']);
    // Non-depends_on edges and edges leaving the set say nothing.
    expect(startableDependencyOrder(els, [depRow('a', 'b', 'spawns'), depRow('outside', 'c')]).map((e) => e.id))
      .toEqual(['c', 'a', 'b', 'free']);
    // A cycle falls back to the given order rather than dropping rows.
    expect(startableDependencyOrder([el('x'), el('y')], [depRow('x', 'y'), depRow('y', 'x')]).map((e) => e.id))
      .toEqual(['x', 'y']);
  });

  it('an Object with no Elements is an empty manifest with a zero footer', () => {
    const m = objectExecuteManifest({ elements: [], edges: [], runs: [] });
    expect(m.rows).toEqual([]);
    expect(m.startable).toEqual([]);
    expect(m.toStart).toBe(0);
    expect(m.skipped).toBe(0);
  });
});
