import { describe, expect, it } from 'vitest';
import { asDependencyKind, dependencyConflicts, endsOfKind, kindOfEnds, linkWouldLoop } from '@/Function/shared/objectDependencyModel';
import { linkRoute, roundedPath } from '@/ActivitySpace/execution/element/gantt/ganttRange';

describe('linkWouldLoop', () => {
  const links = [{ blocker: 'a', blocked: 'b' }, { blocker: 'b', blocked: 'c' }];
  it('refuses an Object waiting for itself', () => {
    expect(linkWouldLoop([], 'a', 'a')).toBe(true);
  });
  it('refuses the reverse of an existing link, direct or through others', () => {
    expect(linkWouldLoop(links, 'b', 'a')).toBe(true);
    expect(linkWouldLoop(links, 'c', 'a')).toBe(true);
  });
  it('allows a link that closes no loop', () => {
    expect(linkWouldLoop(links, 'a', 'c')).toBe(false);
    expect(linkWouldLoop(links, 'd', 'a')).toBe(false);
  });
});

describe('dependency kinds', () => {
  it('reads an unknown or missing kind as finish to start', () => {
    expect(asDependencyKind(undefined)).toBe('fs');
    expect(asDependencyKind('zz')).toBe('fs');
    expect(asDependencyKind('ss')).toBe('ss');
  });

  it('names the kind a line between two ends makes, and back', () => {
    expect(kindOfEnds('finish', 'start')).toBe('fs');
    expect(kindOfEnds('start', 'start')).toBe('ss');
    expect(kindOfEnds('finish', 'finish')).toBe('ff');
    expect(kindOfEnds('start', 'finish')).toBe('sf');
    expect(endsOfKind('sf')).toEqual({ from: 'start', to: 'finish' });
  });
});

describe('dependencyConflicts', () => {
  const a = { start: '2026-11-10', due: '2026-11-20' };
  it('finish to start: the waiting one starting on or before the other is due breaks it', () => {
    expect(dependencyConflicts('fs', a, { start: '2026-11-20' })).toBe(true);
    expect(dependencyConflicts('fs', a, { start: '2026-11-10T00:00:00+00:00' })).toBe(true);
    expect(dependencyConflicts('fs', a, { start: '2026-11-21' })).toBe(false);
  });

  it('start to start: starting before the other starts breaks it; the same day does not', () => {
    expect(dependencyConflicts('ss', a, { start: '2026-11-09' })).toBe(true);
    expect(dependencyConflicts('ss', a, { start: '2026-11-10' })).toBe(false);
  });

  it('finish to finish: finishing before the other is due breaks it', () => {
    expect(dependencyConflicts('ff', a, { due: '2026-11-19' })).toBe(true);
    expect(dependencyConflicts('ff', a, { due: '2026-11-20' })).toBe(false);
  });

  it('start to finish: finishing before the other starts breaks it', () => {
    expect(dependencyConflicts('sf', a, { due: '2026-11-09' })).toBe(true);
    expect(dependencyConflicts('sf', a, { due: '2026-11-12' })).toBe(false);
  });

  it('cannot judge an end without its date', () => {
    expect(dependencyConflicts('fs', { due: null }, { start: '2026-11-21' })).toBe(false);
    expect(dependencyConflicts('ff', a, { start: '2026-11-01' })).toBe(false);
  });
});

describe('linkRoute', () => {
  it('runs straight across on one vertical when the ends face each other', () => {
    const r = linkRoute(100, 10, 1, 300, 50, 1, 40, 20);
    expect(r.points).toEqual([[100, 10], [200, 10], [200, 50], [300, 50]]);
    expect(r.mark).toEqual([200, 30]);
  });

  it('doubles back between the rows when the second bar starts too early', () => {
    const r = linkRoute(300, 10, 1, 100, 50, 1, 40, 20);
    expect(r.points.length).toBe(6);
    expect(r.points[1]).toEqual([320, 10]);
    expect(r.points[4]).toEqual([80, 50]);
  });

  it('goes round the outside when both ends are starts or both finishes', () => {
    // start to start: out left, in from the left — the vertical left of both
    expect(linkRoute(100, 10, -1, 200, 50, 1, 40, 20).points[1][0]).toBe(80);
    // finish to finish: out right, in from the right — the vertical right of both
    expect(linkRoute(300, 10, 1, 200, 50, -1, 40, 20).points[1][0]).toBe(320);
  });

  it('draws a route as a path that starts and ends at the bars', () => {
    const d = roundedPath([[0, 0], [10, 0], [10, 10], [20, 10]], 4);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('L 20 10')).toBe(true);
  });
});
