'use client';

import { invalidateCustomColumnLists, invalidateElementDetail } from '@/Function/sync/explorerCache';
import { selectIn } from '@/hooks/chunkedIn';
import { supabase } from '@/lib/supabase';
import type {
  CustomColumn,
  CustomColumnInsert,
  CustomColumnPlacementInsert,
  CustomColumnUpdate,
  CustomColumnValue,
  CustomColumnWithValues,
  Json,
} from '@/types/database';


// ============================================
// Custom Columns CRUD
// ============================================

// Fetch all custom columns for an object
export async function fetchCustomColumns(objectId: string): Promise<CustomColumn[]> {
  const { data, error } = await supabase
    .from('custom_columns')
    .select('*')
    .eq('object_id', objectId)
    .order('order_index');

  if (error) throw error;
  return (data || []) as CustomColumn[];
}

// Attach element-keyed values to a set of column definitions. Each column id
// only ever has values of a single scope (Element-scoped columns get
// element_id-keyed rows; Object-scoped get object_id-keyed), so we filter in
// JS rather than building a partial-index-aware query. Pass `elementId` to
// narrow the value fetch to one Element (the detail panel's case).
async function attachElementValues(
  columns: CustomColumn[],
  elementId?: string,
): Promise<CustomColumnWithValues[]> {
  if (columns.length === 0) return [];
  let query = supabase
    .from('custom_column_values')
    .select('*')
    .in('column_id', columns.map(c => c.id));
  if (elementId) query = query.eq('element_id', elementId);
  const { data: values, error } = await query;
  if (error) throw error;

  const valuesByColumn: Record<string, Record<string, CustomColumnValue>> = {};
  for (const val of (values || [])) {
    if (val.element_id == null) continue;
    if (!valuesByColumn[val.column_id]) valuesByColumn[val.column_id] = {};
    valuesByColumn[val.column_id][val.element_id] = val as CustomColumnValue;
  }
  return columns.map(col => ({
    ...col,
    values: valuesByColumn[col.id] || {},
  })) as CustomColumnWithValues[];
}

// Resolve the columns PLACED on Element lists (an Object's list, or a user's
// My Elements) via custom_column_placements — local and Space-library columns
// alike. Ordered by the column's own order_index so a library column keeps a
// stable position across lists.
async function fetchPlacedColumns(
  target: { objectId: string } | { objectIds: string[] } | { ownerUserId: string },
): Promise<CustomColumn[]> {
  let placements: { column_id: string }[];
  if ('objectIds' in target) {
    // My Elements spans every Object the reader can see, so this list grows
    // with the board.
    placements = await selectIn(target.objectIds, chunk =>
      supabase.from('custom_column_placements').select('column_id').in('object_id', chunk),
    );
  } else {
    const query = supabase.from('custom_column_placements').select('column_id');
    const { data, error: plError } = 'objectId' in target
      ? await query.eq('object_id', target.objectId)
      : await query.eq('owner_user_id', target.ownerUserId);
    if (plError) throw plError;
    placements = data ?? [];
  }

  const columnIds = Array.from(new Set(placements.map(p => p.column_id)));
  if (columnIds.length === 0) return [];

  const { data: columns, error: colError } = await supabase
    .from('custom_columns')
    .select('*')
    .in('id', columnIds)
    .eq('is_visible', true)
    .order('order_index');
  if (colError) throw colError;
  return (columns || []) as CustomColumn[];
}

// Fetch the custom columns shown on an Object's Elements list, with values
// keyed by element_id. Placement-driven: local columns AND any Space-library
// columns added to this Object.
export async function fetchCustomColumnsWithValues(objectId: string): Promise<CustomColumnWithValues[]> {
  const columns = await fetchPlacedColumns({ objectId });
  return attachElementValues(columns);
}

// Element-centric fetch for the detail panel: the union of columns placed on
// EVERY list the Element is homed in (primary object + element_objects
// junction homes), with only this Element's values attached. This is Asana's
// "the task detail shows the fields of every project it's multi-homed in" —
// which list the panel was opened from doesn't matter.
export async function fetchElementCustomColumnsWithValues(
  elementId: string,
  primaryObjectId: string | null,
): Promise<CustomColumnWithValues[]> {
  const { data: junction, error: jError } = await supabase
    .from('element_objects')
    .select('object_id')
    .eq('element_id', elementId);
  if (jError) throw jError;

  const homeIds = new Set<string>();
  if (primaryObjectId) homeIds.add(primaryObjectId);
  for (const row of junction || []) {
    if (row.object_id) homeIds.add(row.object_id);
  }
  const columns = await fetchPlacedColumns({ objectIds: Array.from(homeIds) });
  return attachElementValues(columns, elementId);
}

// Place a newly created column on its owning list.
async function placeColumn(
  columnId: string,
  target: { objectId: string } | { ownerUserId: string },
): Promise<void> {
  const row: CustomColumnPlacementInsert = 'objectId' in target
    ? { column_id: columnId, object_id: target.objectId }
    : { column_id: columnId, owner_user_id: target.ownerUserId };
  const { error } = await supabase.from('custom_column_placements').insert(row);
  if (error) throw error;
}

// Fetch Domain-scoped columns + their per-Object values. Used by the
// Domain-level Object list to tag Objects directly. `values` is keyed by
// object_id (not element_id).
export async function fetchDomainCustomColumnsWithValues(domainId: string): Promise<CustomColumnWithValues[]> {
  const { data: columns, error: colError } = await supabase
    .from('custom_columns')
    .select('*')
    .eq('domain_id', domainId)
    .eq('is_visible', true)
    .order('order_index');

  if (colError) throw colError;
  if (!columns || columns.length === 0) return [];

  const columnIds = columns.map(c => c.id);
  const { data: values, error: valError } = await supabase
    .from('custom_column_values')
    .select('*')
    .in('column_id', columnIds);

  if (valError) throw valError;

  const valuesByColumn: Record<string, Record<string, CustomColumnValue>> = {};
  for (const val of (values || [])) {
    if (val.object_id == null) continue;
    if (!valuesByColumn[val.column_id]) valuesByColumn[val.column_id] = {};
    valuesByColumn[val.column_id][val.object_id] = val as CustomColumnValue;
  }

  return columns.map(col => ({
    ...col,
    values: valuesByColumn[col.id] || {},
  })) as CustomColumnWithValues[];
}

// Create a new custom column. Either `object_id` (Element-scoped) or
// `domain_id` (Object-scoped) must be set; the DB CHECK constraint
// enforces exactly-one.
// Create a column definition and, for Element-list columns, its first
// placement. Local (object_id) and personal (owner_user_id) definitions place
// themselves; a library (activity_space_id) definition is placed where it was
// created via `placement`. Domain columns (Object-tagging axis) never place.
export async function createCustomColumn(
  column: CustomColumnInsert,
  placement?: { objectId: string } | { ownerUserId: string },
): Promise<CustomColumn> {
  const scopeQuery = supabase
    .from('custom_columns')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1);

  const { data: existing } = column.object_id
    ? await scopeQuery.eq('object_id', column.object_id)
    : column.activity_space_id
    ? await scopeQuery.eq('activity_space_id', column.activity_space_id)
    : column.owner_user_id
    ? await scopeQuery.eq('owner_user_id', column.owner_user_id)
    : await scopeQuery.eq('domain_id', column.domain_id ?? '');

  const maxIndex = existing?.[0]?.order_index ?? -1;

  const { data, error } = await supabase
    .from('custom_columns')
    .insert({
      ...column,
      order_index: maxIndex + 1,
    })
    .select()
    .single();

  if (error) throw error;
  const created = data as CustomColumn;

  const target = placement
    ?? (created.object_id ? { objectId: created.object_id }
      : created.owner_user_id ? { ownerUserId: created.owner_user_id }
      : undefined);
  if (target) {
    try {
      await placeColumn(created.id, target);
    } catch (e) {
      // Don't leave a placement-less Element column behind — it would exist
      // but show on no list, which reads as data loss.
      try { await deleteCustomColumn(created.id); } catch { /* best-effort */ }
      throw e;
    }
  }
  invalidateCustomColumnLists();
  return created;
}

// Update a custom column
export async function updateCustomColumn(id: string, updates: CustomColumnUpdate): Promise<CustomColumn> {
  const { data, error } = await supabase
    .from('custom_columns')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as CustomColumn;
}

// Delete a custom column
export async function deleteCustomColumn(id: string): Promise<void> {
  const { error } = await supabase
    .from('custom_columns')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Set a custom column value for an element. Uses partial-unique-index
// upsert via manual select/insert/update because Supabase's onConflict
// requires a real unique constraint.
export async function setCustomColumnValue(
  columnId: string,
  elementId: string,
  value: Json
): Promise<CustomColumnValue> {
  const { data: existing } = await supabase
    .from('custom_column_values')
    .select('id')
    .eq('column_id', columnId)
    .eq('element_id', elementId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('custom_column_values')
      .update({ value })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    invalidateElementDetail(elementId);
  invalidateCustomColumnLists();
  return data as CustomColumnValue;
  }

  const { data, error } = await supabase
    .from('custom_column_values')
    .insert({ column_id: columnId, element_id: elementId, value })
    .select()
    .single();
  if (error) throw error;
  invalidateElementDetail(elementId);
  invalidateCustomColumnLists();
  return data as CustomColumnValue;
}

// Set a custom column value for an Object (Domain-scoped column).
export async function setCustomColumnObjectValue(
  columnId: string,
  objectId: string,
  value: Json
): Promise<CustomColumnValue> {
  const { data: existing } = await supabase
    .from('custom_column_values')
    .select('id')
    .eq('column_id', columnId)
    .eq('object_id', objectId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('custom_column_values')
      .update({ value })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as CustomColumnValue;
  }

  const { data, error } = await supabase
    .from('custom_column_values')
    .insert({ column_id: columnId, object_id: objectId, value })
    .select()
    .single();
  if (error) throw error;
  return data as CustomColumnValue;
}

// Delete a custom column value
export async function deleteCustomColumnValue(columnId: string, elementId: string): Promise<void> {
  const { error } = await supabase
    .from('custom_column_values')
    .delete()
    .eq('column_id', columnId)
    .eq('element_id', elementId);

  if (error) throw error;
}

export async function deleteCustomColumnObjectValue(columnId: string, objectId: string): Promise<void> {
  const { error } = await supabase
    .from('custom_column_values')
    .delete()
    .eq('column_id', columnId)
    .eq('object_id', objectId);

  if (error) throw error;
}

// Reorder columns
export async function reorderCustomColumns(objectId: string, columnIds: string[]): Promise<void> {
  const updates = columnIds.map((id, index) => ({
    id,
    order_index: index,
  }));

  for (const update of updates) {
    await supabase
      .from('custom_columns')
      .update({ order_index: update.order_index })
      .eq('id', update.id);
  }
}
