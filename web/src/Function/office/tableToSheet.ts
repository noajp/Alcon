import type { DataTableColumn, DataTableRow, Json } from '@/types/database';
import type { SheetToWrite, SheetValue } from './xlsxWriter';

// A Table as a sheet to write: its columns in order, one row per Table row,
// each value as the cell holds it (an object or list, which a cell should not
// hold, is written as its JSON).

const valueOf = (v: Json | null | undefined): SheetValue =>
  v === null || v === undefined ? null : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v);

/** Pure. */
export function sheetFromTable(name: string, columns: DataTableColumn[], rows: DataTableRow[], cellsByRow: Record<string, Record<string, Json | null>>): SheetToWrite {
  return {
    name,
    columns: columns.map((c) => ({ name: c.name, type: c.type })),
    rows: rows.map((r) => columns.map((c) => valueOf(cellsByRow[r.id]?.[c.id]))),
  };
}
