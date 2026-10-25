import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeOperations, normalizeOperationsParams, OPERATIONS_FIELDS } from '@/Function/operations/operationsModel';
const { runOperationsTool } = await import(new URL('../../supabase/functions/alcon-copilot/operationsTools.ts', import.meta.url).pathname);

const uuid = (n: number) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, '0')}`;
const asOf = '2026-09-07';
const opportunity = { name: 'Renewal', stage: 'open', amount: 1000, probability: 50, closeDate: '2026-09-20', lastContact: '2026-08-20', nextActionDate: '2026-09-10', currency: 'USD' };

/** Only SELECT exists: a mutation makes the test fail at the call site. */
function fixture(values: Record<string, unknown>[] = [opportunity], options: { cap?: number; denied?: string; emptyCells?: boolean; extraColumn?: boolean } = {}) {
  const fields = Object.fromEntries(OPERATIONS_FIELDS.map((field, index) => [field.key, uuid(index + 10)]));
  const params = normalizeOperationsParams({ kind: 'crm', tableId: uuid(1), fields });
  const columns = OPERATIONS_FIELDS.map(field => ({ id: fields[field.key], table_id: uuid(1), type: field.type }));
  const rows = values.map((_, index) => ({ id: uuid(index + 100), table_id: uuid(1), order_index: index }));
  const cellsByRow = Object.fromEntries(values.map((value, index) => [rows[index].id, Object.fromEntries(Object.entries(value).map(([key, val]) => [fields[key], val]))]));
  const cells = Object.entries(cellsByRow).flatMap(([row_id, cells]) => Object.entries(cells).map(([column_id, value]) => ({ row_id, column_id, value })));
  const widget = { id: uuid(5), kind: 'operations-planner', revision: 3, params };
  const tables: Record<string, Record<string, unknown>[]> = {
    widgets: [widget], tables: [{ id: uuid(1), name: 'Operational source' }], table_columns: columns,
    table_rows: rows, table_cells: cells,
  };
  if (options.extraColumn) tables.table_cells.push({ row_id: rows[0].id, column_id: uuid(99), value: 'Unmapped private notes' });
  const calls: { relation: string; filters: [string, unknown][]; start?: number }[] = [];
  const db = { from: (relation: string) => {
    const filters: [string, unknown][] = [];
    const call = { relation, filters, start: undefined as number | undefined };
    calls.push(call);
    const selected = () => tables[relation].filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      in: (key: string, value: unknown[]) => { filters.push([key, value]); return query; },
      order: () => query,
      single: async () => ({ data: options.denied === relation ? null : selected()[0], error: options.denied === relation ? { message: 'Permission denied' } : null }),
      range: async (start: number, end: number) => {
        call.start = start;
        const all = selected();
        return { data: options.emptyCells && relation === 'table_cells' ? [] : all.slice(start, Math.min(end + 1, start + (options.cap ?? 200))), count: all.length, error: options.denied === relation ? { message: 'Permission denied' } : null };
      },
    };
    return query;
  } };
  return { db, params, schema: { columns, rows, cellsByRow }, tables, calls, input: { widgetId: widget.id, asOf } };
}

describe('Copilot operations diagnosis', () => {
  it('uses the exact UI calculation for both cases and keeps source and settings intact', async () => {
    const f = fixture();
    const before = JSON.stringify(f.tables);
    const { data } = await runOperationsTool(f.db, { ...f.input, scenario: { horizonDays: 7 } });
    const baseline = analyzeOperations(f.schema, f.params, asOf);
    const scenario = analyzeOperations(f.schema, { ...f.params, horizonDays: 7 }, asOf);
    expect(data.baseline.totals).toEqual(baseline.totals);
    expect(data.scenario.totals).not.toEqual(data.baseline.totals);
    expect(data.scenario.totals).toEqual(scenario.totals);
    expect(data.rows[0]).toEqual({ rowId: uuid(100), baseline: baseline.rows[0], scenario: scenario.rows[0] });
    expect(data.source).toMatchObject({ tableId: uuid(1), revision: 3, asOf, params: f.params, rowCount: 1 });
    expect(JSON.stringify(f.tables)).toBe(before);
  });

  it('completes server-capped pages and keeps all-table totals when detail is paginated', async () => {
    const f = fixture(Array.from({ length: 53 }, (_, i) => ({ ...opportunity, currency: i % 2 ? 'JPY' : 'USD' })), { cap: 7, extraColumn: true });
    const { data } = await runOperationsTool(f.db, { ...f.input, limit: 2 });
    expect(data.source.rowCount).toBe(53);
    expect(data.rows).toHaveLength(2);
    expect(data.nextOffset).toBe(2);
    expect(data.baseline.totals).toEqual(analyzeOperations(f.schema, f.params, asOf).totals);
    expect(data.baseline.validCount).toBe(53);
    const cellCalls = f.calls.filter(call => call.relation === 'table_cells');
    expect(cellCalls.length).toBeGreaterThan(2);
    expect(cellCalls.every(call => call.filters.some(([key, value]) => key === 'row_id' && Array.isArray(value) && value.length <= 50))).toBe(true);
    expect(cellCalls.every(call => call.filters.some(([key, value]) => key === 'column_id' && Array.isArray(value) && !value.includes(uuid(99))))).toBe(true);
    expect(f.calls.filter(call => ['table_rows', 'table_columns'].includes(call.relation)).every(call => call.filters.some(([key, value]) => key === 'table_id' && value === uuid(1)))).toBe(true);
  });

  it('reports absent/invalid input separately from healthy rows, including missing mappings', async () => {
    const f = fixture([{ ...opportunity, amount: null }, { ...opportunity, currency: 'JPY' }]);
    const { data } = await runOperationsTool(f.db, f.input);
    expect(data.baseline).toMatchObject({ validCount: 1, excludedCount: 1 });
    expect(data.rows[0].baseline.issues.length).toBeGreaterThan(0);
    f.tables.table_columns = f.tables.table_columns.filter(col => col.id !== f.params.fields.amount);
    const missing = await runOperationsTool(f.db, f.input);
    expect(missing.data.baseline.issues).toContain('The mapped column for Amount no longer exists.');
    expect(missing.data.baseline.excludedCount).toBe(2);
  });

  it('refuses denied sources and incomplete reads without returning partial totals', async () => {
    for (const denied of ['widgets', 'tables', 'table_rows', 'table_columns', 'table_cells']) {
      const f = fixture([opportunity], { denied });
      await expect(runOperationsTool(f.db, f.input)).rejects.toThrow('Permission denied');
    }
    const f = fixture([opportunity], { emptyCells: true });
    await expect(runOperationsTool(f.db, f.input)).rejects.toThrow('Incomplete source');
    const large = fixture(Array.from({ length: 2001 }, () => opportunity));
    await expect(runOperationsTool(large.db, large.input)).rejects.toThrow('at most 2000');
  });

  it('rejects malformed dates, foreign scenario fields and silently-normalized assumptions', async () => {
    const f = fixture();
    for (const asOf of ['2026-02-30', 'yesterday', '', '2026-09-07T00:00:00Z']) await expect(runOperationsTool(f.db, { ...f.input, asOf })).rejects.toThrow('asOf');
    for (const scenario of [{ amount: 20 }, { tableId: uuid(2) }, { fields: {} }, { horizonDays: 1.5 }, { followUpDays: NaN }, {}]) {
      await expect(runOperationsTool(f.db, { ...f.input, scenario })).rejects.toThrow();
    }
    f.params.horizonDays = -1;
    await expect(runOperationsTool(f.db, f.input)).rejects.toThrow('Invalid saved horizonDays');
  });

  it('refuses a saved planner that is not a CRM planner', async () => {
    const f = fixture();
    delete (f.params as Record<string, unknown>).kind;
    await expect(runOperationsTool(f.db, f.input)).rejects.toThrow('Saved planner kind must be crm');
  });

  it('labels threshold changes as simulations, not observed improvement', async () => {
    const f = fixture([opportunity]);
    const { data } = await runOperationsTool(f.db, { ...f.input, scenario: { followUpDays: 30 } });
    expect(data.baseline.riskCount).toBe(1);
    expect(data.scenario.riskCount).toBe(0);
    expect(data.limitations.join(' ')).toContain('do not prove improvement');
    expect(data.rows[0].baseline.lastContact).toBe(data.rows[0].scenario.lastContact);
    expect(data.baseline.totals).toEqual(data.scenario.totals);
  });

  it('returns an empty source explicitly and rejects ambiguous saved instances', async () => {
    const f = fixture([]);
    const { data } = await runOperationsTool(f.db, f.input);
    expect(data).toMatchObject({ totalRows: 0, nextOffset: null, baseline: { validCount: 0 }, rows: [] });
    await expect(runOperationsTool(f.db, { ...f.input, widgetId: 'missing' })).rejects.toThrow('widget UUID');
    f.tables.widgets[0].kind = 'data-view';
    await expect(runOperationsTool(f.db, f.input)).rejects.toThrow('Choose one');
  });
});

describe('the model the Copilot edge function imports by path', () => {
  it('stays free of imports, which Deno could not resolve', () => {
    const source = readFileSync(new URL('../src/Function/operations/operationsModel.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
