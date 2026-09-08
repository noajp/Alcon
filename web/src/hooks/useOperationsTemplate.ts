'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDomains } from '@/ActivitySpace/execution/domain/data';
import { getActiveDomainId } from '@/ActivitySpace/execution/domain/domainsStore';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { addDataTableColumns, createDataTable, deleteDataTable, DATA_TABLES_QUERY_KEY, useDataTables } from '@/ActivitySpace/sustainment/table/data';
import { OPERATIONS_FIELDS, type OperationsKind } from '@/ActivitySpace/sustainment/operations/operationsModel';

/** Domain-scoped tables stay in their Space; unscoped personal tables are portable. */
export function useOperationsTables() {
  const tables = useDataTables();
  const domains = useDomains();
  const ids = new Set(domains.data.map(domain => domain.id));
  return {
    ...tables,
    data: tables.data.filter(table => !table.domain_id || ids.has(table.domain_id)),
    loading: tables.loading || domains.loading,
    error: tables.error || domains.error,
    refetch: () => { tables.refetch(); void domains.refetch(); },
  };
}

/** Templates contain schema only. Values are supplied by the person operating the tool. */
export function useOperationsTemplate() {
  const queryClient = useQueryClient();
  const { data: domains } = useDomains();
  const lock = useRef(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(kind: OperationsKind, name: string) {
    if (lock.current) throw new Error('A table is already being created.');
    if (!name.trim()) throw new Error('Enter a table name.');
    lock.current = true;
    setCreating(true);
    setError(null);
    let tableId: string | null = null;
    try {
      const domain = domains.find(item => item.id === getActiveDomainId() && item.activity_space_id === getActiveSpaceId());
      const table = await createDataTable({ name: name.trim(), domain_id: domain?.id ?? null });
      tableId = table.id;
      const fields = OPERATIONS_FIELDS[kind];
      const columns = await addDataTableColumns(table.id, fields.map(field => ({ name: field.label, type: field.type })));
      const mapping: Record<string, string> = {};
      // INSERT RETURNING does not promise order; match the explicit persisted order.
      for (const [index, field] of fields.entries()) {
        const column = columns.find(item => item.order_index === index);
        if (!column) throw new Error('The table schema was not fully created.');
        mapping[field.key] = column.id;
      }
      return { tableId: table.id, fields: mapping };
    } catch (cause) {
      let message = cause instanceof Error ? cause.message : 'Could not create the table.';
      if (tableId) {
        try { await deleteDataTable(tableId); }
        catch { message += ' An unfinished table remains in Table; inspect it before trying again.'; }
      }
      setError(message);
      throw new Error(message);
    } finally {
      lock.current = false;
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey: DATA_TABLES_QUERY_KEY });
    }
  }

  return { create, creating, error };
}
