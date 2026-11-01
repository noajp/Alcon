import { describe, expect, it } from 'vitest';
import { tableFromSheet } from '@/Function/office/sheetToTable';
import type { Cell, WorkSheet } from '@/Function/office/sheetLayout';

const text = (t: string): Cell => ({ text: t, numeric: false, style: null, colSpan: 1, rowSpan: 1, hidden: false });
const num = (v: number, t = String(v)): Cell => ({ text: t, numeric: true, value: v, style: null, colSpan: 1, rowSpan: 1, hidden: false });
const sheet = (rows: (Cell | undefined)[][]): WorkSheet => ({
  name: 'S', cols: [], defaultCol: 64, defaultRow: 20, gridLines: true, charts: [], images: [],
  rows: rows.map((cells) => ({ h: 20, cells: cells as Cell[] })),
});

describe('tableFromSheet', () => {
  it('finds the header under a title, keeps stored numbers and types the columns', () => {
    const t = tableFromSheet(sheet([
      [undefined, text('運用パフォーマンス')],
      [],
      [undefined, text('年'), text('残高'), text('メモ')],
      [undefined, num(2021), num(349346, '¥349,346'), text('初年度')],
      [],
      [undefined, num(2022), num(1461260, '¥1,461,260')],
    ]));
    expect(t.columns).toEqual([{ name: '年', type: 'number' }, { name: '残高', type: 'number' }, { name: 'メモ', type: 'text' }]);
    expect(t.rows).toEqual([[2021, 349346, '初年度'], [2022, 1461260, null]]);
  });

  it('names blank and repeated headers, and gives nothing for an empty sheet', () => {
    const t = tableFromSheet(sheet([[text('A'), undefined, text('A')], [text('x'), text('y'), text('z')]]));
    expect(t.columns.map((c) => c.name)).toEqual(['A', 'Column 2', 'A 2']);
    expect(tableFromSheet(sheet([]))).toEqual({ columns: [], rows: [] });
  });
});
