import { describe, expect, it } from 'vitest';
import { parseChartSpec, splitAnswer } from '@/AIP/ai/chartSpec';

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

describe('elements blocks', () => {
  it('draws an elements block as a list, with statuses normalised', () => {
    const parts = splitAnswer('前置き\n```elements\n[{"title":"原油見通し調査","status":"In Progress","assignees":["Claude"]},{"title":"確認","status":"In Review","assignee":"TAKA","due":"2026-11-20"}]\n```\n後書き');
    expect(parts.map((p) => p.kind)).toEqual(['text', 'elements', 'text']);
    const list = parts[1];
    if (list.kind !== 'elements') throw new Error('not a list');
    expect(list.items).toEqual([
      { title: '原油見通し調査', status: 'in_progress', assignees: ['Claude'] },
      { title: '確認', status: 'review', assignees: ['TAKA'], due: '2026-11-20' },
    ]);
  });

  it('leaves a block that is not a list as code', () => {
    const parts = splitAnswer('```elements\nnot json\n```');
    expect(parts).toEqual([{ kind: 'text', text: '```elements\nnot json\n```' }]);
  });

  it('holds a place while the block is still streaming', () => {
    expect(splitAnswer('一覧です\n```elements\n[{"title"').map((p) => p.kind)).toEqual(['text', 'pending']);
  });
});
