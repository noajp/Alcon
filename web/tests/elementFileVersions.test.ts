import { describe, expect, it } from 'vitest';
import { latestVersions, versionChain, versionsPastKeeping } from '@/Function/shared/fileVersions';

const row = (id: string, previous_id: string | null = null) => ({ id, previous_id });

describe('element file versions', () => {
  const rows = [row('a'), row('b', 'a'), row('c', 'b'), row('x')];
  it('lists each file once, as its latest version', () => {
    expect(latestVersions(rows).map((r) => r.id)).toEqual(['c', 'x']);
  });
  it('reads a file\'s history newest first from any of its versions', () => {
    expect(versionChain(rows, 'a').map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(versionChain(rows, 'c').map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(versionChain(rows, 'x').map((r) => r.id)).toEqual(['x']);
    expect(versionChain(rows, 'missing')).toEqual([]);
  });
  it('stops on a broken chain instead of looping', () => {
    const loop = [row('p', 'q'), row('q', 'p')];
    expect(versionChain(loop, 'p').length).toBeLessThanOrEqual(2);
  });
});

describe('versionsPastKeeping', () => {
  const day = 86_400_000;
  const now = Date.UTC(2027, 0, 1);
  const v = (i: number, ageDays: number) => ({ id: `v${i}`, previous_id: i ? `v${i - 1}` : null, created_at: new Date(now - ageDays * day).toISOString() });
  it('keeps every version for 90 days and the newest 10 after that', () => {
    // v0 (oldest) … v14 (latest): ages 140 → 0 days.
    const rows = Array.from({ length: 15 }, (_, i) => v(i, (14 - i) * 10));
    // Newest 10 are v14…v5; of v4…v0 those older than 90 days go: v4 is 100 days old.
    expect(versionsPastKeeping(rows, now).map((r) => r.id).sort()).toEqual(['v0', 'v1', 'v2', 'v3', 'v4']);
    const young = Array.from({ length: 15 }, (_, i) => v(i, 14 - i));
    expect(versionsPastKeeping(young, now)).toEqual([]);
  });
});
