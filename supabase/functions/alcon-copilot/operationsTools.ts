import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  analyzeOperations, normalizeOperationsParams, OPERATIONS_FIELDS,
  type OperationsAnalysis, type OperationsParams, type OperationsSchema,
} from "../../../web/src/alcon/sustainment/operationsModel.ts";

export const OPERATIONS_TOOLS = [{
  name: 'analyzeOperations',
  description: 'Read-only diagnosis and what-if comparison using the same CRM/SCM calculator as the UI. First discover a saved operations-planner with widgetBoard list/get. Supply its boardKey, widgetId and the user business date asOf. Reads the saved field mappings and all source rows under caller RLS; never guesses mappings or writes data. Optional scenario changes only calculation assumptions, not records or saved settings. Totals cover all loaded rows; detail rows are paginated by risk priority. Report missing data, source and limitations. A forecast, lower warning count or changed threshold is not an observed improvement. No persistent trial, automatic execution or outcome tracking is performed.',
  input_schema: {
    type: 'object', additionalProperties: false,
    properties: {
      boardKey: { type: 'string' }, widgetId: { type: 'string' },
      asOf: { type: 'string', description: 'Business date YYYY-MM-DD; explicit to match the user timezone.' },
      scenario: {
        type: 'object', additionalProperties: false,
        properties: {
          horizonDays: { type: 'integer', minimum: 1, maximum: 3650 },
          demandMultiplier: { type: 'number', minimum: 0, maximum: 100 },
          followUpDays: { type: 'integer', minimum: 1, maximum: 3650 },
        },
      },
      offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['boardKey', 'widgetId', 'asOf'],
  },
}];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 200;
const MAX_ROWS = 2000;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error('Invalid integer');
  return Number(value);
}

function checkedParams(raw: unknown): OperationsParams {
  const value = record(raw);
  if (!['crm', 'scm'].includes(String(value.kind))) throw new Error('Saved planner kind must be crm or scm');
  if (typeof value.tableId !== 'string' || !UUID.test(value.tableId)) throw new Error('Connect a Table in the planner first');
  const params = normalizeOperationsParams(value);
  // Do not silently turn corrupt saved settings into a different scenario.
  for (const key of ['horizonDays', 'demandMultiplier', 'followUpDays']) {
    if (value[key] !== undefined && value[key] !== params[key]) throw new Error(`Invalid saved ${key}; repair the planner settings first`);
  }
  for (const field of OPERATIONS_FIELDS[params.kind]) {
    const id = params.fields[field.key];
    if (field.required && !id || id && !UUID.test(id)) throw new Error(`Map a valid column for ${field.label} first`);
  }
  return params;
}

function scenarioParams(base: OperationsParams, raw: unknown): OperationsParams | null {
  if (raw === undefined) return null;
  const patch = record(raw);
  const allowed = ['horizonDays', base.kind === 'crm' ? 'followUpDays' : 'demandMultiplier'];
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('Scenario must contain applicable calculation settings only');
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'demandMultiplier') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new Error('Demand multiplier must be from 0 to 100');
    } else integer(value, 1, 3650);
  }
  return { ...base, ...patch };
}

/** Exact counts keep a server response cap from silently becoming a full-table total. */
async function allPages<T>(page: (offset: number) => PromiseLike<{
  data: unknown[] | null; error: { message: string } | null; count: number | null;
}>, max: number): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | undefined;
  for (;;) {
    const { data, error, count } = await page(rows.length);
    if (error) throw new Error(error.message);
    if (count === null || count > max) throw new Error(`Analysis requires a complete source of at most ${max} records; no partial totals were calculated`);
    if (expected !== undefined && count !== expected) throw new Error('Source changed during analysis; read again');
    expected = count;
    if (!data || (!data.length && rows.length !== count) || rows.length + data.length > count) throw new Error('Incomplete source; no partial totals were calculated');
    rows.push(...data as T[]);
    if (rows.length === count) return rows;
  }
}

function summary(analysis: OperationsAnalysis) {
  const { rows: _rows, ...value } = analysis;
  return value;
}

export async function runOperationsTool(db: SupabaseClient, input: Record<string, unknown>) {
  const boardKey = input.boardKey;
  const widgetId = input.widgetId;
  if (typeof boardKey !== 'string' || !boardKey || boardKey.length > 160 || typeof widgetId !== 'string' || !widgetId || widgetId.length > 200) throw new Error('boardKey and widgetId are required');
  const asOf = input.asOf;
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) throw new Error('asOf must be a valid YYYY-MM-DD date');
  const offset = integer(input.offset ?? 0, 0, MAX_ROWS);
  const limit = integer(input.limit ?? 20, 1, 50);
  // The client is the existing per-request caller-JWT client. Never use service_role.
  const { data: board, error: boardError } = await db.from('widget_boards').select('board_key,revision,layout').eq('board_key', boardKey).single();
  if (boardError || !board) throw new Error(boardError?.message ?? 'Saved board unavailable');
  const layout = record(board.layout);
  if (layout.version !== 2) throw new Error('Unsupported saved layout version');
  const zones = record(layout.zones);
  const matches = ['band', 'main', 'rail'].flatMap(zone => Array.isArray(zones[zone]) ? zones[zone] as unknown[] : [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).id === widgetId);
  if (matches.length !== 1 || matches[0].type !== 'operations-planner') throw new Error('Choose one saved operations-planner instance');
  const base = checkedParams(matches[0].params);
  const candidate = scenarioParams(base, input.scenario);
  const { data: table, error: tableError } = await db.from('tables').select('id,name').eq('id', base.tableId).single();
  if (tableError || !table) throw new Error(tableError?.message ?? 'Source Table unavailable');
  const mappedIds = [...new Set(Object.values(base.fields))];
  const columns = await allPages<OperationsSchema['columns'][number]>(from => db.from('table_columns')
    .select('id,type', { count: 'exact' }).eq('table_id', table.id).in('id', mappedIds).order('id').range(from, from + PAGE - 1), mappedIds.length);
  const rows = await allPages<{ id: string }>(from => db.from('table_rows')
    .select('id', { count: 'exact' }).eq('table_id', table.id).order('order_index').order('id').range(from, from + PAGE - 1), MAX_ROWS);
  const schema: OperationsSchema = { columns, rows, cellsByRow: {} };
  // Bound both query-string size and response size. Only mapped cells are read.
  for (let index = 0; index < rows.length; index += 50) {
    const ids = rows.slice(index, index + 50).map(row => row.id);
    const cells = await allPages<{ row_id: string; column_id: string; value: unknown }>(from => db.from('table_cells')
      .select('row_id,column_id,value', { count: 'exact' }).in('row_id', ids).in('column_id', mappedIds)
      .order('row_id').order('column_id').range(from, from + PAGE - 1), ids.length * mappedIds.length);
    for (const cell of cells) (schema.cellsByRow[cell.row_id] ??= {})[cell.column_id] = cell.value;
  }
  const baseline = analyzeOperations(schema, base, asOf);
  const scenario = candidate ? analyzeOperations(schema, candidate, asOf) : null;
  const ranked = scenario?.rows ?? baseline.rows;
  const baseRows = new Map(baseline.rows.map(row => [row.rowId, row]));
  const scenarioRows = new Map(scenario?.rows.map(row => [row.rowId, row]) ?? []);
  const page = ranked.slice(offset, offset + limit);
  return {
    ok: true as const,
    data: {
      source: { boardKey, widgetId, revision: board.revision, tableId: table.id, tableName: table.name, asOf, readAt: new Date().toISOString(), rowCount: rows.length, params: base },
      baseline: summary(baseline),
      scenario: scenario ? { params: candidate, ...summary(scenario) } : null,
      rows: page.map(row => ({ rowId: row.rowId, baseline: baseRows.get(row.rowId), scenario: scenarioRows.get(row.rowId) ?? null })),
      nextOffset: offset + page.length < ranked.length ? offset + page.length : null,
      totalRows: ranked.length,
      limitations: [
        'Read-only calculation of one saved planner and its caller-visible Table; no settings, records or Elements were changed.',
        'Scenarios change assumptions on the same input, not observed outcomes. Fewer warnings after relaxing a threshold do not prove improvement.',
        'Reads are paginated, not an atomic database snapshot. Concurrent edits may affect results; reread before acting. Missing or invalid rows are not healthy rows.',
        'Amounts are grouped by currency. Forecasts and replenishment estimates are conditional; execution, real outcomes and costs require separate verification.',
      ],
    },
  };
}
