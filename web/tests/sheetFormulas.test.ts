import { describe, expect, it } from 'vitest';
import { needsRecalc, recalcMissing, type FormulaSheets } from '@/Function/office/sheetFormulas';

const sheet = (cells: Record<string, { value: string | number | null; formula?: string }>) => new Map(Object.entries(cells));

describe('recalcMissing', () => {
  it('works out formulas saved without results, across sheets', async () => {
    const sheets: FormulaSheets = new Map([
      ['Data', sheet({ A1: { value: 2 }, A2: { value: 3 }, A3: { value: 5 } })],
      ['Summary', sheet({
        B1: { value: null, formula: "SUM('Data'!A1:A3)" },
        B2: { value: '', formula: 'B1*2' },
        B3: { value: null, formula: 'PRODUCT(1+Data!A1:A2)-1' },
        B4: { value: null, formula: 'LOOKUP(10^10, Data!A1:A3)' },
        B5: { value: 7, formula: 'B1' },
      })],
    ]);
    expect(needsRecalc(sheets)).toBe(true);
    await recalcMissing(sheets);
    const s = sheets.get('Summary')!;
    expect(s.get('B1')!.value).toBe(10);
    expect(s.get('B2')!.value).toBe(20);
    expect(s.get('B3')!.value).toBe(11);
    expect(s.get('B4')!.value).toBe(5);
    // A saved result is kept as saved.
    expect(s.get('B5')!.value).toBe(7);
  });

  it('shows an error where a formula cannot be worked out', async () => {
    const sheets: FormulaSheets = new Map([['S', sheet({ A1: { value: 'x' }, A2: { value: null, formula: 'A1*2' } })]]);
    await recalcMissing(sheets);
    expect(String(sheets.get('S')!.get('A2')!.value)).toMatch(/^#/);
  });

  it('needs nothing when every formula has its result', () => {
    expect(needsRecalc(new Map([['S', sheet({ A1: { value: 1, formula: '1' } })]]))).toBe(false);
  });
});
