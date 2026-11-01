import type { WorkSheet } from './sheetLayout';

// One sheet of a workbook as a table to import: its header row and the rows
// under it, each column typed number when every value in it is a number.
// A number keeps its stored value, not its formatted text, so the table
// can sum and chart it.

export interface ImportedTable {
  columns: { name: string; type: 'text' | 'number' }[];
  rows: (string | number | null)[][];
}

/** Pure. The table in a sheet: the first row holding text in two or more
 *  cells (or the only filled row) is the header; every non-empty row below
 *  it is data, over the header's span of columns. */
export function tableFromSheet(sheet: WorkSheet): ImportedTable {
  const filled = (r: number) => (sheet.rows[r]?.cells ?? []).map((c, i) => (c && !c.hidden && c.text.trim() ? i : -1)).filter((i) => i >= 0);
  let header = -1;
  for (let r = 0; r < sheet.rows.length && header < 0; r++) {
    const cols = filled(r);
    if (cols.length >= 2 && cols.every((c) => !sheet.rows[r].cells[c].numeric)) header = r;
  }
  if (header < 0) header = sheet.rows.findIndex((_, r) => filled(r).length > 0);
  if (header < 0) return { columns: [], rows: [] };

  const span = filled(header);
  const first = Math.min(...span), last = Math.max(...span);
  const seen = new Map<string, number>();
  const names: string[] = [];
  for (let c = first; c <= last; c++) {
    const raw = sheet.rows[header].cells[c]?.text.trim() || `Column ${c - first + 1}`;
    const n = (seen.get(raw) ?? 0) + 1;
    seen.set(raw, n);
    names.push(n > 1 ? `${raw} ${n}` : raw);
  }

  const rows: (string | number | null)[][] = [];
  for (let r = header + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r]?.cells ?? [];
    const row = names.map((_, k) => {
      const cell = cells[first + k];
      if (!cell || cell.hidden || !cell.text.trim()) return null;
      return typeof cell.value === 'number' ? cell.value : cell.text;
    });
    if (row.some((v) => v !== null)) rows.push(row);
  }
  const columns = names.map((name, k) => {
    const values = rows.map((row) => row[k]).filter((v) => v !== null);
    return { name, type: values.length > 0 && values.every((v) => typeof v === 'number') ? 'number' as const : 'text' as const };
  });
  return { columns, rows };
}
