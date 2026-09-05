'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  addDataTableColumn, addDataTableRow, createDataTable, deleteDataTable,
  fetchDataTableSchema, setDataTableCell, updateDataTable, DATA_TABLES_QUERY_KEY,
  type DataTableSchema,
} from '@/alcon/table/data';
import type { DataTable, DataTableColumnType, Json } from '@/types/database';

const WIDGET_TABLE_QUERY_KEY = ['widget-table-data'] as const;
export interface WidgetTableData extends DataTableSchema { table: DataTable }

function requiredName(name: string): string {
  const value = name.trim();
  if (!value) throw new Error('Enter a name');
  return value;
}

/** Each placement references a Table; its rows and schema remain ordinary Table data. */
export function useWidgetTableData(tableId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...WIDGET_TABLE_QUERY_KEY, tableId],
    enabled: Boolean(tableId),
    queryFn: async (): Promise<WidgetTableData> => {
      const { data: table, error } = await supabase.from('tables').select('*').eq('id', tableId!).single();
      if (error) throw error;
      const schema = await fetchDataTableSchema(tableId!);
      return { table: table as DataTable, ...schema };
    },
  });
  const invalidate = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: [...WIDGET_TABLE_QUERY_KEY, tableId] }),
      qc.invalidateQueries({ queryKey: DATA_TABLES_QUERY_KEY }),
    ]);
  }, [qc, tableId]);

  // Invalidate even when a multi-request operation fails, so any confirmed
  // partial work is represented when the caller displays the error.
  async function write<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } finally { await invalidate(); }
  }
  function id(): string {
    if (!tableId) throw new Error('Choose a Table first');
    return tableId;
  }
  async function updateOrder(relation: 'table_rows' | 'table_columns', rowId: string, orderIndex: number) {
    if (!Number.isSafeInteger(orderIndex) || orderIndex < 0) throw new Error('Invalid position');
    const { error } = await supabase.from(relation).update({ order_index: orderIndex })
      .eq('table_id', id()).eq('id', rowId).select('id').single();
    if (error) throw error;
  }

  return {
    data: query.data,
    loading: Boolean(tableId) && query.isPending,
    error: query.error,
    refetch: invalidate,
    createTable: (name: string) => write(() => createDataTable({ name: requiredName(name) })),
    renameTable: (name: string) => write(() => updateDataTable(id(), { name: requiredName(name) })),
    deleteTable: () => write(() => deleteDataTable(id())),
    createColumn: (name: string, type: DataTableColumnType) => write(() => addDataTableColumn(id(), requiredName(name), type)),
    renameColumn: (columnId: string, name: string) => write(async () => {
      const { error } = await supabase.from('table_columns').update({ name: requiredName(name) })
        .eq('table_id', id()).eq('id', columnId).select('id').single();
      if (error) throw error;
    }),
    deleteColumn: (columnId: string) => write(async () => {
      const { error } = await supabase.from('table_columns').delete()
        .eq('table_id', id()).eq('id', columnId).select('id').single();
      if (error) throw error;
    }),
    reorderColumn: (columnId: string, orderIndex: number) => write(() => updateOrder('table_columns', columnId, orderIndex)),
    createRow: () => write(() => addDataTableRow(id())),
    deleteRow: (rowId: string) => write(async () => {
      const { error } = await supabase.from('table_rows').delete()
        .eq('table_id', id()).eq('id', rowId).select('id').single();
      if (error) throw error;
    }),
    reorderRow: (rowId: string, orderIndex: number) => write(() => updateOrder('table_rows', rowId, orderIndex)),
    setCell: (rowId: string, columnId: string, value: Json | null) => write(async () => {
      // Scope the write to this placement's Table, not another Table the
      // current user happens to own. setDataTableCell checks column integrity.
      const { error } = await supabase.from('table_rows').select('id')
        .eq('table_id', id()).eq('id', rowId).single();
      if (error) throw error;
      await setDataTableCell(rowId, columnId, value);
    }),
  };
}
