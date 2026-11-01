// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { writeWorkbook } from '@/Function/office/xlsxWriter';
import { readWorkbook } from '@/Function/office/sheetLayout';

const bytes = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('xlsxWriter', () => {
  it('names columns past Z as Excel does', async () => {
    const columns = Array.from({ length: 28 }, (_, i) => ({ name: `c${i}`, type: 'number' as const }));
    const [s] = await readWorkbook(bytes(await writeWorkbook([{ name: 'wide', columns, rows: [columns.map((_, i) => i)] }])));
    expect(s.rows[1].cells[27]?.value).toBe(27);
  });

  it('writes a workbook our own reader reads back: header, text, numbers, dates, checkboxes', async () => {
    const blob = await writeWorkbook([
      { name: 'Sales/Q1', columns: [{ name: 'Name', type: 'text' }, { name: 'Amount', type: 'number' }, { name: 'Due', type: 'date' }, { name: 'Done', type: 'checkbox' }],
        rows: [['A & <B>', 1200.5, '2026-11-01', true], ['', null, 'not a date', false]] },
      { name: 'Sales/Q1', columns: [{ name: 'X', type: 'select' }], rows: [['opt']] },
    ]);
    const [s1, s2] = await readWorkbook(bytes(blob));
    expect(s1.name).toBe('Sales Q1');
    expect(s2.name).toBe('Sales Q1 2');
    const text = (r: number) => Array.from({ length: 4 }, (_, i) => s1.rows[r].cells[i]?.text ?? '');
    expect(text(0)).toEqual(['Name', 'Amount', 'Due', 'Done']);
    expect(s1.rows[0].cells[0]?.style?.bold).toBe(true);
    expect(text(1)).toEqual(['A & <B>', '1200.5', '2026-11-01', 'TRUE']);
    expect(s1.rows[1].cells[1]?.value).toBe(1200.5);
    expect(text(2)).toEqual(['', '', 'not a date', 'FALSE']);
    expect(s2.rows[1].cells[0]?.text).toBe('opt');
  });
});
