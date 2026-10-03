import { describe, expect, it } from 'vitest';
import { planScm } from '@/ActivitySpace/sustainment/scm/scmEngine';
import { generateScmSample } from '@/ActivitySpace/sustainment/scm/scmSample';
const { runScmTool } = await import(new URL('../../supabase/functions/alcon-copilot/scmTools.ts', import.meta.url).pathname);

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
const asOf = '2026-10-03';

/** The sample as scm_* rows, behind a fake PostgREST client that records writes. */
function fixture() {
  const sample = generateScmSample(asOf);
  const id = (key: string) => key;
  const stock = new Map<string, number>();
  const demand = new Map<string, number>();
  for (const movement of sample.movements) {
    const key = `${movement.itemKey}|${movement.locationKey}`;
    stock.set(key, (stock.get(key) ?? 0) + movement.quantity);
    if (movement.kind === 'issue') demand.set(`${key}|${movement.occurredOn}`, (demand.get(`${key}|${movement.occurredOn}`) ?? 0) - movement.quantity);
  }
  const tables: Record<string, Record<string, unknown>[]> = {
    scm_policies: [],
    scm_locations: sample.locations.map(location => ({ id: id(location.key), activity_space_id: SPACE, name: location.name, code: location.code })),
    scm_suppliers: sample.suppliers.map(supplier => ({ id: id(supplier.key), activity_space_id: SPACE, name: supplier.name, lead_time_days: supplier.leadTimeDays, currency: 'JPY' })),
    scm_items: sample.items.map(item => ({ id: id(item.key), activity_space_id: SPACE, sku: item.sku, name: item.name, unit: item.unit, category: item.category, supplier_id: item.supplierKey, unit_cost: item.unitCost, unit_price: item.unitPrice, currency: 'JPY', lead_time_days: null, moq: item.moq, order_multiple: item.orderMultiple, service_level: null, baseline_daily_demand: null, active: true })),
    scm_stock: [...stock.entries()].map(([key, on_hand]) => { const [item_id, location_id] = key.split('|'); return { activity_space_id: SPACE, item_id, location_id, on_hand }; }),
    scm_purchase_orders: sample.orders.map((order, index) => ({
      id: order.key, activity_space_id: SPACE, number: index + 1, supplier_id: order.supplierKey, location_id: order.locationKey, status: order.status,
      ordered_on: order.orderedOn, expected_on: order.expectedOn, received_on: order.receivedOn, currency: 'JPY', source: 'human',
      scm_po_lines: order.lines.map((line, lineIndex) => ({ id: `${order.key}-${lineIndex}`, item_id: line.itemKey, quantity: line.quantity, unit_cost: line.unitCost, received_quantity: line.receivedQuantity })),
    })),
    scm_po_lines: [],
  };
  const history = [...demand.entries()].map(([key, quantity]) => { const [item_id, location_id, day] = key.split('|'); return { item_id, location_id, day, quantity }; });
  const writes: { table: string; rows: unknown }[] = [];
  const page = (rows: Record<string, unknown>[]) => ({ range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), count: rows.length, error: null }) });
  const db = {
    from: (table: string) => {
      let rows = tables[table];
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
        or: () => query,
        order: () => query,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        range: page(rows).range,
        insert: (value: unknown) => {
          writes.push({ table, rows: value });
          return { select: () => ({ single: async () => ({ data: { id: `new-${writes.length}`, number: 900 + writes.length }, error: null }) }), then: (resolve: (value: unknown) => void) => resolve({ error: null }) };
        },
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
      return query;
    },
    rpc: () => page(history),
  };
  return { db, writes, tables };
}

describe('Copilot SCM planner', () => {
  it('reads the same plan the App shows, without writing', async () => {
    const f = fixture();
    const { data } = await runScmTool(f.db, { action: 'plan', spaceId: SPACE, asOf });
    expect(f.writes).toHaveLength(0);
    expect(data.summary.healthCounts.critical + (data.summary.healthCounts.stockout ?? 0)).toBeGreaterThan(0);
    expect(data.exceptions.length).toBeGreaterThan(0);
    expect(data.exceptions[0]).toHaveProperty('reorderPoint');
    expect(data.limitations.length).toBeGreaterThan(0);
  });

  it('simulates a supplier delay by name and reports what newly breaks', async () => {
    const f = fixture();
    const { data } = await runScmTool(f.db, { action: 'simulate', spaceId: SPACE, asOf, scenario: { supplierDelays: { 'ブルーマウンテン貿易': 21 } } });
    expect(f.writes).toHaveLength(0);
    expect(data.newlyAtRisk.length).toBeGreaterThan(0);
    expect(data.scenario.supplierDelays).toEqual({ bean: 21 });
  });

  it('only ever creates drafts', async () => {
    const f = fixture();
    const { data } = await runScmTool(f.db, { action: 'draftOrders', spaceId: SPACE, asOf });
    const orders = f.writes.filter(write => write.table === 'scm_purchase_orders').map(write => write.rows as Record<string, unknown>);
    expect(orders.length).toBe(data.created.length);
    expect(orders.every(order => order.status === 'draft' && order.source === 'autopilot')).toBe(true);
  });

  it('rejects a missing Space and unknown names', async () => {
    const f = fixture();
    await expect(runScmTool(f.db, { action: 'plan', spaceId: 'nope', asOf })).rejects.toThrow('spaceId');
    await expect(runScmTool(f.db, { action: 'plan', spaceId: SPACE, asOf, location: 'Paris' })).rejects.toThrow('Unknown location');
    expect(planScm).toBeTypeOf('function');
  });
});
