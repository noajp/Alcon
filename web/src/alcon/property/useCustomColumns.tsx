'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CustomColumn, CustomColumnType, CustomColumnOptions, Json } from '@/types/database';
import {
  type CustomColumnWithValues,
  createCustomColumn,
  updateCustomColumn,
  deleteCustomColumn,
  setCustomColumnValue,
  setCustomColumnObjectValue,
  fetchCustomColumnsWithValues,
  fetchDomainCustomColumnsWithValues,
  fetchOwnerCustomColumnsWithValues,
  fetchSpaceLibraryColumns,
  placeColumn,
  unplaceColumn,
} from '@/hooks/useSupabase';
import { getActiveSpaceId } from '@/alcon/space/activeSpaceStore';
import { AddColumnModal } from './AddColumnModal';

// Where a custom-column set lives. `object` and `owner` are Element lists —
// they show whatever columns are PLACED on them (local / personal columns
// plus any Space-library columns that were added), values keyed by
// element_id. `domain` columns tag the Domain's Objects (values keyed by
// object_id) — a separate axis with no placements.
export type ColumnScope =
  | { kind: 'object'; objectId: string }
  | { kind: 'domain'; domainId: string }
  | { kind: 'owner'; ownerUserId: string };

type RestoreBuiltInType = 'assignees' | 'priority' | 'status' | 'due_date';

interface UseCustomColumnsOptions {
  /** Surfaced in the picker's "Restore default columns" section. Optional —
   *  only the Object detail surface tracks hideable built-ins today. */
  deletedBuiltInColumns?: { id: string; name: string; builtinType: RestoreBuiltInType }[];
  onRestoreBuiltIn?: (builtinType: RestoreBuiltInType) => void;
}

export interface CustomColumnsController {
  customColumns: CustomColumnWithValues[];
  /** Open the property-type picker (AddColumnModal). Pass the trigger's rect
   *  so the panel anchors beside the "+" instead of centring. Wire to
   *  ListTable's `onAddColumn`. */
  openAddColumn: (anchor?: DOMRect) => void;
  /** Element-scoped value edit (object / owner columns). */
  onColumnValueChange: (columnId: string, elementId: string, value: Json) => Promise<void>;
  /** Object-scoped value edit (domain columns tagging Objects). */
  onObjectColumnValueChange: (columnId: string, objectId: string, value: Json) => Promise<void>;
  renameColumn: (columnId: string, name: string) => Promise<void>;
  /** Remove a column from this list. Library columns are unplaced (the
   *  definition and every Element's value survive); local / personal / domain
   *  columns are deleted outright. */
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
  /** The Property most recently created or added-from-library, if any — pass
   *  straight through to ListTable's `revealColumnId` so it shows up the
   *  moment it's created instead of waiting for a manual visibility toggle. */
  newColumnId: string | null;
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
  const [libraryColumns, setLibraryColumns] = useState<CustomColumn[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [addAnchor, setAddAnchor] = useState<DOMRect | null>(null);
  // The id of the Property the "+ Add Property" flow most recently created
  // or placed — callers pass this straight through to ListTable's
  // `revealColumnId` so it appears as soon as it's created instead of
  // sitting invisible behind the default-OFF rule new custom columns
  // otherwise get.
  const [newColumnId, setNewColumnId] = useState<string | null>(null);

  // Primitive identity so the effect/callbacks don't churn on the scope
  // object literal being re-created every render.
  const scopeKind = scope?.kind ?? null;
  const scopeId = scope
    ? (scope.kind === 'object' ? scope.objectId : scope.kind === 'domain' ? scope.domainId : scope.ownerUserId)
    : null;

  const refetch = useCallback(async () => {
    if (!scopeKind || !scopeId) { setCustomColumns([]); return; }
    try {
      const cols = scopeKind === 'object'
        ? await fetchCustomColumnsWithValues(scopeId)
        : scopeKind === 'owner'
        ? await fetchOwnerCustomColumnsWithValues(scopeId)
        : await fetchDomainCustomColumnsWithValues(scopeId);
      setCustomColumns(cols);
    } catch (e) {
      console.error('Failed to fetch custom columns:', e);
    }
  }, [scopeKind, scopeId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Space library ("global fields") — offered by the picker's "From library"
  // section on Element lists. Refreshed alongside the picker opening so a
  // field added elsewhere shows up without a reload.
  const refetchLibrary = useCallback(async () => {
    if (scopeKind !== 'object' && scopeKind !== 'owner') { setLibraryColumns([]); return; }
    const spaceId = getActiveSpaceId();
    if (!spaceId) { setLibraryColumns([]); return; }
    try {
      setLibraryColumns(await fetchSpaceLibraryColumns(spaceId));
    } catch (e) {
      console.error('Failed to fetch library columns:', e);
    }
  }, [scopeKind]);

  const placementTarget = useCallback((): { objectId: string } | { ownerUserId: string } | null => {
    if (scopeKind === 'object' && scopeId) return { objectId: scopeId };
    if (scopeKind === 'owner' && scopeId) return { ownerUserId: scopeId };
    return null;
  }, [scopeKind, scopeId]);

  const addColumn = useCallback(async (
    name: string,
    type: CustomColumnType,
    opts?: { toLibrary?: boolean },
  ) => {
    if (!scopeId) return;
    const colOptions: CustomColumnOptions = SELECT_TYPES.includes(type)
      ? { options: [{ value: 'Option 1' }, { value: 'Option 2' }] }
      : {};
    // Definition scope: Space library when asked (Element lists only), else
    // local to this Object / personal to this user / this Domain.
    const spaceId = opts?.toLibrary ? getActiveSpaceId() : null;
    const definition =
      spaceId && scopeKind !== 'domain' ? { activity_space_id: spaceId }
      : scopeKind === 'object' ? { object_id: scopeId }
      : scopeKind === 'owner' ? { owner_user_id: scopeId }
      : { domain_id: scopeId };
    try {
      const created = await createCustomColumn(
        { ...definition, name, column_type: type, options: colOptions },
        placementTarget() ?? undefined,
      );
      await refetch();
      setNewColumnId(created.id);
      setShowModal(false);
    } catch (e) {
      console.error('Failed to create column:', e);
    }
  }, [scopeId, scopeKind, placementTarget, refetch]);

  const addExistingColumn = useCallback(async (columnId: string) => {
    const target = placementTarget();
    if (!target) return;
    try {
      await placeColumn(columnId, target);
      await refetch();
      setNewColumnId(columnId);
      setShowModal(false);
    } catch (e) {
      console.error('Failed to add library column:', e);
    }
  }, [placementTarget, refetch]);

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
    try {
      // A library column is shared across lists — "delete" from a list means
      // unplace it here; the definition and values live on. Local / personal /
      // domain columns are owned by this list, so deleting is destructive.
      const col = customColumns.find((c) => c.id === columnId);
      const target = placementTarget();
      if (col?.activity_space_id && target) {
        await unplaceColumn(columnId, target);
      } else {
        await deleteCustomColumn(columnId);
      }
      await refetch();
    } catch (e) { console.error('Failed to delete column:', e); }
  }, [customColumns, placementTarget, refetch]);

  const updateColumn = useCallback(async (
    columnId: string,
    updates: { name?: string; options?: CustomColumnOptions },
  ) => {
    try { await updateCustomColumn(columnId, updates); await refetch(); }
    catch (e) { console.error('Failed to update column:', e); }
  }, [refetch]);

  const duplicateColumn = useCallback(async (column: CustomColumnWithValues) => {
    if (!scopeId) return;
    // Duplicates are always local to this list, whatever the source's scope —
    // duplicating a library column shouldn't mint a second library entry.
    const definition =
      scopeKind === 'object' ? { object_id: scopeId }
      : scopeKind === 'owner' ? { owner_user_id: scopeId }
      : { domain_id: scopeId };
    try {
      await createCustomColumn({
        ...definition,
        name: `${column.name} (copy)`,
        column_type: column.column_type,
        options: column.options,
      });
      await refetch();
    } catch (e) {
      console.error('Failed to duplicate column:', e);
    }
  }, [scopeId, scopeKind, refetch]);

  const placedIds = new Set(customColumns.map((c) => c.id));
  const addColumnModal = showModal && scope ? (
    <AddColumnModal
      // domain columns tag Objects (project-level palette); object/owner
      // columns tag Elements (record-level palette).
      scope={scope.kind === 'domain' ? 'object' : 'element'}
      anchor={addAnchor}
      onClose={() => setShowModal(false)}
      onAdd={addColumn}
      libraryColumns={
        scope.kind === 'domain' ? undefined : libraryColumns.filter((c) => !placedIds.has(c.id))
      }
      onAddExisting={scope.kind === 'domain' ? undefined : addExistingColumn}
      allowLibrary={scope.kind !== 'domain'}
      deletedBuiltInColumns={options.deletedBuiltInColumns}
      onRestoreBuiltIn={options.onRestoreBuiltIn}
    />
  ) : null;

  return {
    customColumns,
    openAddColumn: (anchor?: DOMRect) => {
      setAddAnchor(anchor ?? null);
      void refetchLibrary();
      setShowModal(true);
    },
    onColumnValueChange,
    onObjectColumnValueChange,
    renameColumn,
    deleteColumn,
    updateColumn,
    duplicateColumn,
    addColumnModal,
    refetch,
    newColumnId,
  };
}
