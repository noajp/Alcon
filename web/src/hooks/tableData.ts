'use client';

import { selectIn } from '@/hooks/chunkedIn';
import { getCurrentUserId, supabase } from '@/lib/supabase';
import type {
  DataTable,
  DataTableCell,
  DataTableColumn,
  DataTableColumnType,
  DataTableInsert,
  DataTableRow,
  DataTableUpdate,
  Json,
} from '@/types/database';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';


// =====================================================
// Data Tables (user-managed Notion-DB-like tables)
// =====================================================

// One row per (table, column, row) is heavy if we fetch each independently —
// the detail view hydrates table_columns + table_rows + table_cells in
// parallel, then stitches a `{ rowId → { columnId → value } }` map on the
// client. Schema CRUD is unsurprising: each public.<x> table maps to a hook
// that wraps a single supabase call with the type cast it deserves.

export interface DataTableWithRowCount extends DataTable {
  rowCount: number;
}

async function fetchDataTablesWithCounts(): Promise<DataTableWithRowCount[]> {
  const tableRows: DataTable[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from('tables').select('*')
      .order('order_index', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }).order('id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as DataTable[];
    tableRows.push(...page);
    if (page.length < pageSize) break;
  }
  // Counted in the database (table_row_counts), not by fetching every row.
  const counts: Record<string, number> = {};
  const tally = await selectIn(tableRows.map((t) => t.id), async chunk =>
    supabase.rpc('table_row_counts', { p_table_ids: chunk }));
  for (const row of tally as { table_id: string; row_count: number }[]) counts[row.table_id] = Number(row.row_count);
  return tableRows.map((t) => ({ ...t, rowCount: counts[t.id] ?? 0 }));
}

export const DATA_TABLES_QUERY_KEY = ['data-tables'] as const;
const EMPTY_DATA_TABLES: DataTableWithRowCount[] = [];

export function useDataTables() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: DATA_TABLES_QUERY_KEY, queryFn: fetchDataTablesWithCounts });
  const refetch = useCallback(() => { void qc.invalidateQueries({ queryKey: DATA_TABLES_QUERY_KEY }); }, [qc]);
  return {
    data: query.data ?? EMPTY_DATA_TABLES,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
}

export async function createDataTable(input: DataTableInsert): Promise<DataTable> {
  // RLS requires created_by = auth.uid(). Stamp it automatically so callers
  // (and forms) don't have to thread the user id through.
  const creatorId = await getCurrentUserId();
  if (!creatorId) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('tables')
    .insert({ ...input, created_by: input.created_by ?? creatorId })
    .select()
    .single();
  if (error) throw error;
  return data as DataTable;
}

export async function updateDataTable(id: string, updates: DataTableUpdate): Promise<DataTable> {
  const { data, error } = await supabase
    .from('tables')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as DataTable;
}

export async function deleteDataTable(id: string): Promise<void> {
  const { error } = await supabase.from('tables').delete().eq('id', id).select('id').single();
  if (error) throw error;
}

// Schema + rows fetched together. The detail view almost always wants both.
export interface DataTableSchema {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  // cells indexed by row_id → column_id → value (JSON)
  cellsByRow: Record<string, Record<string, Json | null>>;
}

export async function fetchDataTableSchema(tableId: string): Promise<DataTableSchema> {
  const fetchPage = async <T,>(relation: 'table_columns' | 'table_rows'): Promise<T[]> => {
    const result: T[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from(relation).select('*')
        .eq('table_id', tableId).order('order_index', { ascending: true })
        .order('id', { ascending: true }).range(from, from + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as T[];
      result.push(...page);
      if (page.length < pageSize) return result;
    }
  };
  const [columns, rows] = await Promise.all([
    fetchPage<DataTableColumn>('table_columns'), fetchPage<DataTableRow>('table_rows'),
  ]);
  const cellsByRow: Record<string, Record<string, Json | null>> = {};
  // Two separate limits meet here. The row_id list is a query-string budget,
  // so it is chunked; each chunk's response is capped at 1000 rows by
  // PostgREST, so it is paged through `.range()` until exhausted rather than
  // taking a silent truncation (300 rows × 8 columns is already 2400 cells).
  const CELL_PAGE = 1000;
  const cells = await selectIn(rows.map((r) => r.id), async chunk => {
    const page: DataTableCell[] = [];
    for (let from = 0; ; from += CELL_PAGE) {
      const { data, error } = await supabase
        .from('table_cells')
        .select('*')
        .in('row_id', chunk)
        .order('row_id').order('column_id')
        .range(from, from + CELL_PAGE - 1);
      if (error) return { data: null, error };
      const got = (data || []) as DataTableCell[];
      page.push(...got);
      if (got.length < CELL_PAGE) break;
    }
    return { data: page, error: null };
  });
  for (const c of cells) {
    if (!cellsByRow[c.row_id]) cellsByRow[c.row_id] = {};
    cellsByRow[c.row_id][c.column_id] = c.value;
  }
  return { columns, rows, cellsByRow };
}

export async function addDataTableColumn(
  tableId: string,
  name: string,
  type: DataTableColumnType,
  orderIndex?: number,
): Promise<DataTableColumn> {
  // Auto-append at the end if no order_index is given so callers don't have to
  // compute the next slot themselves.
  let nextOrder = orderIndex;
  if (nextOrder == null) {
    const { data: tail, error: tailError } = await supabase
      .from('table_columns')
      .select('order_index')
      .eq('table_id', tableId)
      .order('order_index', { ascending: false })
      .limit(1);
    if (tailError) throw tailError;
    nextOrder = ((tail?.[0]?.order_index ?? -1) as number) + 1;
  }
  const { data, error } = await supabase
    .from('table_columns')
    .insert({ table_id: tableId, name, type, order_index: nextOrder })
    .select()
    .single();
  if (error) throw error;
  return data as DataTableColumn;
}

export async function addDataTableRow(tableId: string): Promise<DataTableRow> {
  const { data: tail, error: tailError } = await supabase
    .from('table_rows')
    .select('order_index')
    .eq('table_id', tableId)
    .order('order_index', { ascending: false })
    .limit(1);
  if (tailError) throw tailError;
  const nextOrder = ((tail?.[0]?.order_index ?? -1) as number) + 1;
  const { data, error } = await supabase
    .from('table_rows')
    .insert({ table_id: tableId, order_index: nextOrder })
    .select()
    .single();
  if (error) throw error;
  return data as DataTableRow;
}

export async function setDataTableCell(
  rowId: string,
  columnId: string,
  value: Json | null,
): Promise<void> {
  const [row, column] = await Promise.all([
    supabase.from('table_rows').select('table_id').eq('id', rowId).single(),
    supabase.from('table_columns').select('table_id').eq('id', columnId).single(),
  ]);
  if (row.error) throw row.error;
  if (column.error) throw column.error;
  if (row.data.table_id !== column.data.table_id) throw new Error('Row and column must belong to the same Table');
  const { error } = await supabase
    .from('table_cells')
    .upsert({ row_id: rowId, column_id: columnId, value, updated_at: new Date().toISOString() }, { onConflict: 'row_id,column_id' })
    .select('row_id,column_id').single();
  if (error) throw error;
}

// Bulk-create a column set in one round-trip; used by CSV import to seed the
// schema before piping in rows. Preserves the caller's order via order_index.
export async function addDataTableColumns(
  tableId: string,
  defs: { name: string; type: DataTableColumnType }[],
  startOrder = 0,
): Promise<DataTableColumn[]> {
  if (defs.length === 0) return [];
  const rows = defs.map((d, i) => ({
    table_id: tableId,
    name: d.name,
    type: d.type,
    order_index: startOrder + i,
  }));
  const { data, error } = await supabase.from('table_columns').insert(rows).select();
  if (error) throw error;
  return (data || []) as DataTableColumn[];
}

// Bulk-create row records + their cells. Used by CSV import — `values` is one
// entry per row, each a record of columnId → cell value. Rows + cells go in
// two trips (rows must exist before cells can FK them); cells are chunked at
// 1000 inserts/round-trip to stay under the PostgREST default cap.
export async function bulkInsertDataTableRows(
  tableId: string,
  values: Record<string, Json | null>[],
  startOrder = 0,
): Promise<{ rows: DataTableRow[] }> {
  if (values.length === 0) return { rows: [] };
  const rowInserts = values.map((_, i) => ({ table_id: tableId, order_index: startOrder + i }));
  // Insert in 1000-row chunks too (defensive: PostgREST request body cap).
  const ROW_CHUNK = 1000;
  const createdRows: DataTableRow[] = [];
  try {
    for (let i = 0; i < rowInserts.length; i += ROW_CHUNK) {
      const slice = rowInserts.slice(i, i + ROW_CHUNK);
      const { data, error } = await supabase.from('table_rows').insert(slice).select();
      if (error) throw error;
      createdRows.push(...((data || []) as DataTableRow[]));
    }
    // Sort by order_index to align with the original `values` order — Supabase
    // doesn't guarantee returning rows in insert order across chunks.
    createdRows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

    const cellInserts: { row_id: string; column_id: string; value: Json | null }[] = [];
    for (let i = 0; i < createdRows.length; i++) {
      const row = createdRows[i];
      const vals = values[i] ?? {};
      for (const [columnId, val] of Object.entries(vals)) {
        cellInserts.push({ row_id: row.id, column_id: columnId, value: val });
      }
    }
    const CELL_CHUNK = 1000;
    for (let i = 0; i < cellInserts.length; i += CELL_CHUNK) {
      const chunk = cellInserts.slice(i, i + CELL_CHUNK);
      const { error } = await supabase.from('table_cells').insert(chunk);
      if (error) throw error;
    }
  } catch (error) {
    // Take back the rows this call made (their cells go with them), so a
    // failed import does not leave blank rows behind. A failed clean-up must
    // not hide why the import failed.
    if (createdRows.length > 0) {
      await selectIn(createdRows.map((r) => r.id), (ids) => supabase.from('table_rows').delete().in('id', ids).select('id'))
        .catch((cleanup) => console.error('Could not remove the rows of a failed import:', cleanup));
    }
    throw error;
  }
  return { rows: createdRows };
}

/** Creates a Table from imported columns and rows (a sheet of a workbook)
 *  and returns its id. */
export async function importDataTable(
  name: string,
  columns: { name: string; type: DataTableColumnType }[],
  rows: (string | number | null)[][],
): Promise<string> {
  const table = await createDataTable({ name });
  try {
    const created = await addDataTableColumns(table.id, columns);
    const byOrder = [...created].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    await bulkInsertDataTableRows(table.id, rows.map((row) => Object.fromEntries(byOrder.map((col, k) => [col.id, row[k] ?? null]))));
  } catch (error) {
    // A half-imported Table is worse than none: remove it and report.
    const { error: cleanup } = await supabase.from('tables').delete().eq('id', table.id);
    if (cleanup) console.error('Could not remove the half-imported Table:', cleanup);
    throw error;
  }
  return table.id;
}
