'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CustomColumnType, CustomColumnOptions, Json } from '@/types/database';
import {
  type CustomColumnWithValues,
  createCustomColumn,
  updateCustomColumn,
  deleteCustomColumn,
  setCustomColumnValue,
  setCustomColumnObjectValue,
  fetchCustomColumnsWithValues,
  fetchDomainCustomColumnsWithValues,
} from '@/hooks/useSupabase';
import { AddColumnModal } from './AddColumnModal';

// Where a custom-column set lives. `object` columns tag the Object's Elements
// (values keyed by element_id); `domain` columns tag the Domain's Objects
// (values keyed by object_id). An `owner` scope (personal Element columns for
// My Elements) is added in a later phase once the DB carries owner_id.
export type ColumnScope =
  | { kind: 'object'; objectId: string }
  | { kind: 'domain'; domainId: string };

type RestoreBuiltInType = 'assignees' | 'priority' | 'status' | 'due_date';

interface UseCustomColumnsOptions {
  /** Surfaced in the picker's "Restore default columns" section. Optional —
   *  only the Object detail surface tracks hideable built-ins today. */
  deletedBuiltInColumns?: { id: string; name: string; builtinType: RestoreBuiltInType }[];
  onRestoreBuiltIn?: (builtinType: RestoreBuiltInType) => void;
}

export interface CustomColumnsController {
  customColumns: CustomColumnWithValues[];
  /** Open the property-type picker (AddColumnModal). Wire to ListTable's
   *  `onAddColumn` so the header "+" opens the picker instead of the built-in
   *  show/hide toggle. */
  openAddColumn: () => void;
  /** Element-scoped value edit (object / owner columns). */
  onColumnValueChange: (columnId: string, elementId: string, value: Json) => Promise<void>;
  /** Object-scoped value edit (domain columns tagging Objects). */
  onObjectColumnValueChange: (columnId: string, objectId: string, value: Json) => Promise<void>;
  renameColumn: (columnId: string, name: string) => Promise<void>;
  deleteColumn: (columnId: string) => Promise<void>;
  updateColumn: (
    columnId: string,
    updates: { name?: string; options?: CustomColumnOptions },
  ) => Promise<void>;
  duplicateColumn: (column: CustomColumnWithValues) => Promise<void>;
  /** Render this wherever the host view mounts overlays — it's null unless the
   *  picker is open. */
  addColumnModal: ReactNode;
  refetch: () => Promise<void>;
}

const SELECT_TYPES: CustomColumnType[] = ['select', 'multi_select', 'status'];

/**
 * Single source of truth for a list's custom (Property) columns: fetch + create /
 * rename / delete / duplicate / value-edit + the AddColumnModal. Every Element
 * list (Object detail, Domain Elements, My Elements) calls this with its own
 * scope so the "+" picker and column behaviour stay identical across views —
 * the column logic lives here, not duplicated per view.
 */
export function useCustomColumns(
  scope: ColumnScope | null,
  options: UseCustomColumnsOptions = {},
): CustomColumnsController {
  const [customColumns, setCustomColumns] = useState<CustomColumnWithValues[]>([]);
  const [showModal, setShowModal] = useState(false);

  // Primitive identity so the effect/callbacks don't churn on the scope
  // object literal being re-created every render.
  const scopeKind = scope?.kind ?? null;
  const scopeId = scope ? (scope.kind === 'object' ? scope.objectId : scope.domainId) : null;

  const refetch = useCallback(async () => {
    if (!scopeKind || !scopeId) { setCustomColumns([]); return; }
    try {
      const cols = scopeKind === 'object'
        ? await fetchCustomColumnsWithValues(scopeId)
        : await fetchDomainCustomColumnsWithValues(scopeId);
      setCustomColumns(cols);
    } catch (e) {
      console.error('Failed to fetch custom columns:', e);
    }
  }, [scopeKind, scopeId]);

  useEffect(() => { void refetch(); }, [refetch]);

  const scopeInsert = useCallback((): { object_id?: string; domain_id?: string } => {
    if (scopeKind === 'object' && scopeId) return { object_id: scopeId };
    if (scopeKind === 'domain' && scopeId) return { domain_id: scopeId };
    return {};
  }, [scopeKind, scopeId]);

  const addColumn = useCallback(async (name: string, type: CustomColumnType) => {
    if (!scopeId) return;
    const colOptions: CustomColumnOptions = SELECT_TYPES.includes(type)
      ? { options: [{ value: 'Option 1' }, { value: 'Option 2' }] }
      : {};
    try {
      await createCustomColumn({ ...scopeInsert(), name, column_type: type, options: colOptions });
      await refetch();
      setShowModal(false);
    } catch (e) {
      console.error('Failed to create column:', e);
    }
  }, [scopeId, scopeInsert, refetch]);

  const onColumnValueChange = useCallback(async (columnId: string, elementId: string, value: Json) => {
    try { await setCustomColumnValue(columnId, elementId, value); await refetch(); }
    catch (e) { console.error('Failed to update column value:', e); }
  }, [refetch]);

  const onObjectColumnValueChange = useCallback(async (columnId: string, objectId: string, value: Json) => {
    try { await setCustomColumnObjectValue(columnId, objectId, value); await refetch(); }
    catch (e) { console.error('Failed to update column value:', e); }
  }, [refetch]);

  const renameColumn = useCallback(async (columnId: string, name: string) => {
    try { await updateCustomColumn(columnId, { name }); await refetch(); }
    catch (e) { console.error('Failed to rename column:', e); }
  }, [refetch]);

  const deleteColumn = useCallback(async (columnId: string) => {
    try { await deleteCustomColumn(columnId); await refetch(); }
    catch (e) { console.error('Failed to delete column:', e); }
  }, [refetch]);

  const updateColumn = useCallback(async (
    columnId: string,
    updates: { name?: string; options?: CustomColumnOptions },
  ) => {
    try { await updateCustomColumn(columnId, updates); await refetch(); }
    catch (e) { console.error('Failed to update column:', e); }
  }, [refetch]);

  const duplicateColumn = useCallback(async (column: CustomColumnWithValues) => {
    if (!scopeId) return;
    try {
      await createCustomColumn({
        ...scopeInsert(),
        name: `${column.name} (copy)`,
        column_type: column.column_type,
        options: column.options,
      });
      await refetch();
    } catch (e) {
      console.error('Failed to duplicate column:', e);
    }
  }, [scopeId, scopeInsert, refetch]);

  const addColumnModal = showModal && scope ? (
    <AddColumnModal
      // domain columns tag Objects (project-level palette); object/owner
      // columns tag Elements (record-level palette).
      scope={scope.kind === 'domain' ? 'object' : 'element'}
      onClose={() => setShowModal(false)}
      onAdd={addColumn}
      deletedBuiltInColumns={options.deletedBuiltInColumns}
      onRestoreBuiltIn={options.onRestoreBuiltIn}
    />
  ) : null;

  return {
    customColumns,
    openAddColumn: () => setShowModal(true),
    onColumnValueChange,
    onObjectColumnValueChange,
    renameColumn,
    deleteColumn,
    updateColumn,
    duplicateColumn,
    addColumnModal,
    refetch,
  };
}
