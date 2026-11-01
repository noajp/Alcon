import { describe, expect, it } from 'vitest';
import { latestVersions, versionChain } from '@/Function/shared/fileVersions';

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
