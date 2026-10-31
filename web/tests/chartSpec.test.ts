import { describe, expect, it } from 'vitest';
import { parseChartSpec, splitAnswer } from '@/Function/copilot/chartSpec';

describe('AI chart blocks', () => {
  it('reads a spec and keeps only finite numbers as series', () => {
    const spec = parseChartSpec('{"type":"bar","title":"t","data":[{"name":"A","v":1,"x":"no"},{"name":"B","v":2}]}');
    expect(spec).toEqual({ type: 'bar', title: 't', data: [{ name: 'A', v: 1 }, { name: 'B', v: 2 }], series: ['v'] });
  });
  it('refuses what is not a chart', () => {
    for (const raw of ['nope', '[]', '{"type":"radar","data":[{"name":"A","v":1}]}', '{"type":"bar","data":[]}', '{"type":"bar","data":[{"name":"A"}]}']) {
      expect(parseChartSpec(raw)).toBeNull();
    }
  });
  it('splits prose and charts; an unclosed block is pending; a bad block stays as text', () => {
    const ok = 'Before\n```chart\n{"type":"pie","data":[{"name":"A","n":3}]}\n```\nAfter';
    expect(splitAnswer(ok).map((p) => p.kind)).toEqual(['text', 'chart', 'text']);
    expect(splitAnswer('Lead\n```chart\n{"type":"ba').map((p) => p.kind)).toEqual(['text', 'pending']);
    const bad = splitAnswer('x\n```chart\nnot json\n```');
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ kind: 'text' });
  });
});
