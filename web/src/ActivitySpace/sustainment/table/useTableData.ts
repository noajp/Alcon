'use client';

import { useCallback } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  addDataTableColumn, addDataTableRow, createDataTable, deleteDataTable,
  fetchDataTableSchema, setDataTableCell, updateDataTable, DATA_TABLES_QUERY_KEY,
  type DataTableSchema,
} from '@/ActivitySpace/sustainment/table/data';
import type { DataTable, DataTableColumnType, Json } from '@/types/database';

const TABLE_DATA_QUERY_KEY = ['widget-table-data'] as const;
export interface TableData extends DataTableSchema { table: DataTable }

function requiredName(name: string): string {
  const value = name.trim();
  if (!value) throw new Error('Enter a name');
  return value;
}

/** One source for the Table app and every Widget referencing the same Table. */
export function useTableData(tableId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...TABLE_DATA_QUERY_KEY, tableId],
    enabled: Boolean(tableId),
    queryFn: async (): Promise<TableData> => {
      const { data: table, error } = await supabase.from('tables').select('*').eq('id', tableId!).single();
      if (error) throw error;
      const schema = await fetchDataTableSchema(tableId!);
      return { table: table as DataTable, ...schema };
    },
  });
  const invalidate = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: [...TABLE_DATA_QUERY_KEY, tableId] }),
      qc.invalidateQueries({ queryKey: DATA_TABLES_QUERY_KEY }),
    ]);
  }, [qc, tableId]);

  // Serialize writes to this Table across mounted consumers. Confirmed data
  // stays in the query cache while cells display their pending drafts; a failed
  // write cannot leave an optimistic value masquerading as saved data.
  const mutationKey = ['table-write', tableId] as const;
  const mutation = useMutation({
    mutationKey,
    scope: { id: `table:${tableId}` },
    mutationFn: (operation: () => Promise<unknown>) => operation(),
  });
  const saving = useIsMutating({ mutationKey }) > 0;
  async function write<T>(operation: () => Promise<T>): Promise<T> {
    // Capture the originating Table's invalidation in the submitted operation,
    // even when this consumer selects a different Table before it settles.
    return await mutation.mutateAsync(async () => {
      try { return await operation(); }
      finally { await invalidate(); }
    }) as T;
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
    saving,
    runWrite: write,
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
      // Scope the write to this consumer's Table, not another Table the
      // current user happens to own. setDataTableCell checks column integrity.
      const { error } = await supabase.from('table_rows').select('id')
        .eq('table_id', id()).eq('id', rowId).single();
      if (error) throw error;
      await setDataTableCell(rowId, columnId, value);
    }),
    setCells: (rowId: string, values: Record<string, Json | null>) => write(async () => {
      const entries = Object.entries(values);
      if (!entries.length) return;
      const { error: rowError } = await supabase.from('table_rows').select('id')
        .eq('table_id', id()).eq('id', rowId).single();
      if (rowError) throw rowError;
      const { data: columns, error: columnError } = await supabase.from('table_columns').select('id')
        .eq('table_id', id()).in('id', entries.map(([columnId]) => columnId));
      if (columnError) throw columnError;
      if (columns?.length !== entries.length) throw new Error('A mapped column is no longer available. Check the field mapping.');
      // One statement: a rejected cell cannot leave half the record updated.
      const { error } = await supabase.from('table_cells').upsert(
        entries.map(([column_id, value]) => ({ row_id: rowId, column_id, value, updated_at: new Date().toISOString() })),
        { onConflict: 'row_id,column_id' },
      ).select('column_id');
      if (error) throw error;
    }),
  };
}
