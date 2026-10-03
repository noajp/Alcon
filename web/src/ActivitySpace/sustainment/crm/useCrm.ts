'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useBoard } from '@/Function/widget';
import { CRM_BOARD } from '@/Function/widget/defaults';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { useOperationsTables } from '@/hooks/useOperationsTemplate';
import { useWidgetTableData } from '@/hooks/useWidgetTableData';
import { addDataTableColumns } from '@/ActivitySpace/sustainment/table/data';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import { normalizeOperationsParams, OPERATIONS_FIELDS, type OperationsParams } from '@/ActivitySpace/sustainment/operations/operationsModel';
import { appendActivity, buildCrmWorkspace, normalizeCrmStages, type CrmActivity, type CrmDeal, type CrmStage } from './crmModel';

export type CrmFieldKey = typeof OPERATIONS_FIELDS.crm[number]['key'];
export type CrmValues = Partial<Record<string, Json | null>>;

/** The CRM App's single source: the saved pipeline settings (the CRM board's
 * planner placement, per user and Space) and the Table they point at. The
 * sidebar and the main pane both read it; React Query shares the requests. */
export function useCrm({ restore = false }: { restore?: boolean } = {}) {
  const spaceId = useActiveSpaceId();
  const board = useBoard('crm', CRM_BOARD, spaceId ?? 'me');
  const instance = useMemo(() => {
    for (const zone of ['main', 'band', 'rail'] as const) {
      const found = board.layout[zone]?.find(item => item.type === 'operations-planner' && normalizeOperationsParams(item.params).kind === 'crm');
      if (found) return found;
    }
    return null;
  }, [board.layout]);
  // A board whose planner was removed gets one back: the App cannot exist
  // without it. Only the main pane restores, so two readers never add two.
  const restored = useRef(false);
  useEffect(() => {
    if (restore && !board.loading && !board.error && !instance && !restored.current) { restored.current = true; board.addWidget('main', 'operations-planner'); }
  }, [restore, board, instance]);

  const rawParams = useMemo(() => (instance?.params ?? {}) as Record<string, unknown>, [instance]);
  const params = useMemo(() => normalizeOperationsParams({ ...rawParams, kind: 'crm' }), [rawParams]);
  const stages = useMemo(() => normalizeCrmStages(rawParams.crmStages), [rawParams]);
  const tables = useOperationsTables();
  const eligible = !!params.tableId && tables.data.some(table => table.id === params.tableId);
  const source = useWidgetTableData(!tables.loading && !tables.error && eligible ? params.tableId : null);
  const data = source.data;
  const today = toDateOnlyString(new Date());
  const ready = !!data && OPERATIONS_FIELDS.crm.every(field => !field.required || data.columns.some(column => column.id === params.fields[field.key] && field.allowedTypes.includes(column.type)));
  const workspace = useMemo(() => data && ready ? buildCrmWorkspace(data, rawParams, today) : null, [data, ready, rawParams, today]);

  const instanceId = instance?.id ?? null;
  const setParams = useCallback((patch: Partial<OperationsParams> & { crmStages?: CrmStage[] }) => {
    if (instanceId) board.setParams(instanceId, current => ({ ...current, ...patch, kind: 'crm' }));
  }, [board, instanceId]);

  const columnFor = useCallback((key: string) => {
    const id = params.fields[key];
    return id && data?.columns.some(column => column.id === id) ? id : null;
  }, [params.fields, data]);

  /** Writes field values to a deal (or a new one) in one statement. Fields
   * with no connected column are skipped, never written somewhere else. */
  const saveDeal = useCallback(async (dealId: string | null, values: CrmValues): Promise<string> => {
    const cells: Record<string, Json | null> = {};
    for (const [key, value] of Object.entries(values)) {
      const column = columnFor(key);
      if (column && value !== undefined) cells[column] = value;
    }
    if (dealId) { await source.setCells(dealId, cells); return dealId; }
    // A new deal is a row plus its cells; if the cells fail, do not leave an empty "Row N" behind.
    const { id } = await source.createRow();
    try { await source.setCells(id, cells); }
    catch (cause) { await source.deleteRow(id).catch(() => {}); throw cause; }
    return id;
  }, [columnFor, source]);

  /** Logs a touchpoint. A call, email or meeting also becomes the last contact. */
  const logActivity = useCallback(async (deal: CrmDeal, entry: CrmActivity, extra: CrmValues = {}) => {
    const values: CrmValues = { ...extra };
    const column = columnFor('activity');
    if (column) {
      // Append to the log as stored now, not as this screen last loaded it, so
      // a line a teammate or the Table app just added is kept.
      const { data: current, error } = await supabase.from('table_cells').select('value').eq('row_id', deal.id).eq('column_id', column).maybeSingle();
      if (error) throw error;
      values.activity = appendActivity(current ? current.value : deal.activityRaw, entry);
    }
    if (entry.type !== 'note' && entry.date && entry.date <= today && (!deal.lastContact || entry.date > deal.lastContact)) values.lastContact = entry.date;
    await saveDeal(deal.id, values);
  }, [columnFor, saveDeal, today]);

  const missingColumns = OPERATIONS_FIELDS.crm.filter(field => !field.required && !columnFor(field.key));
  /** Adds the optional CRM columns an older pipeline Table lacks, and connects them. */
  const addMissingColumns = useCallback(async () => {
    if (!params.tableId || !data || !missingColumns.length) return;
    const start = data.columns.reduce((max, column) => Math.max(max, column.order_index + 1), 0);
    const created = await source.runWrite(() => addDataTableColumns(params.tableId!, missingColumns.map(field => ({ name: field.label, type: field.type })), start));
    const fields = { ...params.fields };
    missingColumns.forEach((field, index) => {
      const column = created.find(item => item.order_index === start + index);
      if (column) fields[field.key] = column.id;
    });
    setParams({ fields });
  }, [params, data, missingColumns, source, setParams]);

  return {
    today, board, params, rawParams, stages, setParams, tables, eligible, source, data, ready, workspace,
    hasField: (key: string) => !!columnFor(key), saveDeal, logActivity, missingColumns, addMissingColumns,
    deleteDeal: (dealId: string) => source.deleteRow(dealId),
    loading: board.loading || tables.loading || source.loading,
    error: tables.error ?? source.error ?? null,
  };
}

export type Crm = ReturnType<typeof useCrm>;
