import { describe, expect, it } from 'vitest';
import { cellRef, diffDocs, diffWorkbooks } from '@/Function/office/officeDiff';
import type { Cell, WorkSheet } from '@/Function/office/sheetLayout';
import type { DocBlock, DocLayout, DocPara } from '@/Function/office/docLayout';

const cell = (text: string, value?: number): Cell => ({ text, numeric: value != null, style: null, colSpan: 1, rowSpan: 1, hidden: false, ...(value != null ? { value } : {}) });
const sheet = (name: string, rows: (Cell | undefined)[][]): WorkSheet => ({ name, cols: [], rows: rows.map((cells) => ({ h: 20, cells: cells as Cell[] })), gridLines: true, defaultCol: 64, defaultRow: 20, charts: [], images: [] });
const p = (text: string): DocPara => ({ kind: 'p', align: 'left', before: 0, after: 0, line: null, indent: 0, firstLine: 0, marker: null, heading: false, runs: [{ text, bold: false, italic: false, underline: false, strike: false, size: 10.5, color: null, font: null, highlight: null }] });
const doc = (blocks: DocBlock[]): DocLayout => ({ width: 800, margin: { top: 0, right: 0, bottom: 0, left: 0 }, columns: 1, blocks, header: [], footer: [], footnotes: [], fonts: [] });

describe('cellRef', () => {
  it('names cells as Excel does', () => {
    expect([cellRef(0, 0), cellRef(2, 25), cellRef(9, 26), cellRef(0, 701)]).toEqual(['A1', 'Z3', 'AA10', 'ZZ1']);
  });
});

describe('diffWorkbooks', () => {
  it('finds changed, added and emptied cells by value, not format', () => {
    const before = [sheet('S', [[cell('a'), cell('¥1,000', 1000)], [cell('x')]]), sheet('Old', [[cell('gone')]])];
    const after = [sheet('S', [[cell('a'), cell('1000', 1000), cell('new')], [undefined]]), sheet('New', [[cell('n')]])];
    const d = diffWorkbooks(before, after);
    expect(d.count).toBe(3);
    expect([...d.cells.get('S')!.entries()]).toEqual([['C1', ''], ['A2', 'x']]);
    expect([...d.cells.get('New')!.entries()]).toEqual([['A1', '']]);
  });
});

describe('diffDocs', () => {
  it('pairs changed paragraphs and does not shift the rest after an insertion', () => {
    const before = doc([p('Title'), p('One'), p('Two'), p('Three')]);
    const now = [p('Title'), p('Inserted'), p('One'), p('Two!'), p('Three')];
    const d = diffDocs(before, doc(now));
    expect(d.marks.get(now[0])).toBeUndefined();
    expect(d.marks.get(now[1])).toEqual({ kind: 'added' });
    expect(d.marks.get(now[2])).toBeUndefined();
    expect(d.marks.get(now[3])).toEqual({ kind: 'changed', before: 'Two' });
    expect(d.marks.get(now[4])).toBeUndefined();
    expect(d.removed).toBe(0);
    expect(d.count).toBe(2);
  });

  it('counts removed paragraphs and reads table cells', () => {
    const cellOf = (t: string) => ({ blocks: [p(t)], fill: null, span: 1, rowSpan: 1, skip: false, borders: true, borderColor: null });
    const before = doc([p('Keep'), p('Drop me'), { kind: 'table', cols: [1], rows: [[cellOf('cell old')]] }]);
    const inTable = p('cell new');
    const d = diffDocs(before, doc([p('Keep'), { kind: 'table', cols: [1], rows: [[{ ...cellOf(''), blocks: [inTable] }]] }]));
    expect(d.marks.get(inTable)).toEqual({ kind: 'changed', before: 'Drop me' });
    expect(d.removed).toBe(1);
  });
});
