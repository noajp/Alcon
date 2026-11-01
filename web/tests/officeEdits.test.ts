// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { applyOfficeEdits, withEdit, type OfficeEdit } from '@/Function/office/officeEdits';
import { readWorkbook } from '@/Function/office/sheetLayout';
import { readDocLayout, type DocPara } from '@/Function/office/docLayout';
import { googleSheetsWorkbook, wordDocument } from './fixtures/officeFixtures';

const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const paras = async (bytes: ArrayBuffer) => (await readDocLayout(bytes)).blocks.filter((b): b is DocPara => b.kind === 'p');
const textOf = (p: DocPara) => p.runs.map((r) => r.text).join('');

describe('withEdit', () => {
  it('keeps what the file first held, and drops an edit back to it', () => {
    const a = withEdit(new Map(), { kind: 'cell', sheet: 'S', ref: 'a1', from: '1', to: '2' });
    const b = withEdit(a, { kind: 'cell', sheet: 'S', ref: 'A1', from: '2', to: '3' });
    expect([...b.values()]).toEqual([{ kind: 'cell', sheet: 'S', ref: 'A1', from: '1', to: '3' }]);
    expect(withEdit(b, { kind: 'cell', sheet: 'S', ref: 'A1', from: '3', to: '1' }).size).toBe(0);
  });
});

describe('applyOfficeEdits — workbook', () => {
  it('writes numbers and text into cells, adds missing cells, and keeps the rest', async () => {
    const before = await googleSheetsWorkbook();
    const edits: OfficeEdit[] = [
      { kind: 'cell', sheet: 'サマリ', ref: 'C3', from: '807', to: '900' },
      { kind: 'cell', sheet: 'サマリ', ref: 'B4', from: '9月', to: '九月 ' },
      { kind: 'cell', sheet: 'データ', ref: 'C2', from: '', to: 'memo' },
    ];
    const out = await applyOfficeEdits(before, edits);
    expect(out.conflicts).toEqual([]);
    const [summary, data] = await readWorkbook(buf(out.bytes));
    expect(summary.rows[2].cells[2]).toMatchObject({ value: 900, numeric: true });
    expect(summary.rows[3].cells[1].text).toBe('九月 ');
    // Untouched cells keep their style and value.
    expect(summary.rows[3].cells[2]).toMatchObject({ value: -7996, style: { color: 'var(--sheet-negative)' } });
    expect(data.rows[1].cells[2].text).toBe('memo');
    const wb = await (await JSZip.loadAsync(out.bytes)).file('xl/workbook.xml')!.async('string');
    expect(wb).toContain('fullCalcOnLoad="1"');
  });

  it('reports a cell that changed since the edit was made, and still writes it', async () => {
    const out = await applyOfficeEdits(await googleSheetsWorkbook(), [{ kind: 'cell', sheet: 'サマリ', ref: 'C3', from: '1', to: '2' }]);
    expect(out.conflicts).toHaveLength(1);
    expect((await readWorkbook(buf(out.bytes)))[0].rows[2].cells[2].value).toBe(2);
  });

  it('drops the calculation chain when a formula is overwritten', async () => {
    const zip = await JSZip.loadAsync(await googleSheetsWorkbook());
    const sheet = (await zip.file('xl/worksheets/sheet2.xml')!.async('string')).replace('<c r="B4"><v>342157</v></c>', '<c r="B4"><f>B3-7996</f><v>342157</v></c>');
    zip.file('xl/worksheets/sheet2.xml', sheet);
    zip.file('xl/calcChain.xml', '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B4" i="2"/></calcChain>');
    const before = await zip.generateAsync({ type: 'arraybuffer' });
    expect((await readWorkbook(before))[1].rows[3].cells[1].formula).toBe(true);
    const out = await applyOfficeEdits(before, [{ kind: 'cell', sheet: 'データ', ref: 'B4', from: '342157', to: '1' }]);
    const after = await JSZip.loadAsync(out.bytes);
    expect(after.file('xl/calcChain.xml')).toBeNull();
    const cell = (await readWorkbook(buf(out.bytes)))[1].rows[3].cells[1];
    expect(cell).toMatchObject({ value: 1 });
    expect(cell.formula).toBeUndefined();
  });
});

describe('applyOfficeEdits — Word', () => {
  it('rewrites a paragraph in its own runs and keeps its look', async () => {
    const before = await wordDocument();
    const ps = await paras(before);
    const target = ps.find((p) => textOf(p) === '価格は仮です。')!;
    expect(target.src).toBeTypeOf('number');
    // The page break paragraph is not plain text, so it cannot be edited.
    expect(ps.some((p) => p.src === undefined)).toBe(true);
    const out = await applyOfficeEdits(before, [{ kind: 'para', index: target.src!, from: '価格は仮です。', to: '価格は確定です。' }]);
    expect(out.conflicts).toEqual([]);
    const after = (await paras(buf(out.bytes))).find((p) => textOf(p) === '価格は確定です。')!;
    expect(after).toMatchObject({ align: 'right', runs: [{ highlight: '#ffff00' }] });
  });

  it('keeps each run\'s look: shared start and end stay in their runs', async () => {
    const zip = await JSZip.loadAsync(await wordDocument());
    const xml = (await zip.file('word/document.xml')!.async('string')).replace('<w:body>',
      '<w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>world</w:t></w:r><w:r><w:t>!</w:t></w:r></w:p>');
    zip.file('word/document.xml', xml);
    const out = await applyOfficeEdits(await zip.generateAsync({ type: 'arraybuffer' }), [{ kind: 'para', index: 0, from: 'Hello world!', to: 'Hello big world!' }]);
    const [p] = await paras(buf(out.bytes));
    expect(p.runs.map((r) => [r.text, r.bold, r.italic])).toEqual([['Hello big ', true, false], ['world', false, true], ['!', false, false]]);
  });

  it('finds a paragraph that moved, and skips one that is gone', async () => {
    const before = await wordDocument();
    const out = await applyOfficeEdits(before, [
      { kind: 'para', index: 0, from: '決定事項', to: '決まったこと' },
      { kind: 'para', index: 999, from: 'nowhere', to: 'x' },
    ]);
    expect(out.skipped).toHaveLength(1);
    expect((await paras(buf(out.bytes))).map(textOf)).toContain('決まったこと');
    expect((await paras(buf(out.bytes))).map(textOf)).toContain('議事録');
  });
});
