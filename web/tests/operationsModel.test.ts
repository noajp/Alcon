import { describe, expect, it } from 'vitest';
import type { DataTableSchema } from '@/alcon/table/data';
import type { Json } from '@/types/database';
import {
  analyzeOperations, normalizeOperationsParams, OPERATIONS_FIELDS,
  type OperationsKind, type OperationsParams,
} from '@/alcon/sustainment/operationsModel';

const today = '2026-09-07';

function fixture(kind: OperationsKind, values: Record<string, Json | null>[], overrides: Partial<OperationsParams> = {}) {
  const params = normalizeOperationsParams({ kind, tableId: 'table', fields: Object.fromEntries(OPERATIONS_FIELDS[kind].map(field => [field.key, field.key])), ...overrides });
  const schema: DataTableSchema = {
    columns: OPERATIONS_FIELDS[kind].map((field, index) => ({ id: field.key, table_id: 'table', name: field.label, type: field.type, options: null, order_index: index, created_at: '' })),
    rows: values.map((_, index) => ({ id: `row-${index}`, table_id: 'table', order_index: index, created_at: '', updated_at: '' })),
    cellsByRow: Object.fromEntries(values.map((value, index) => [`row-${index}`, value])),
  };
  return { params, schema };
}

const opportunity = (values: Record<string, Json | null> = {}) => ({
  name: 'Support renewal', account: 'Example', stage: 'open', amount: 1000,
  probability: 50, closeDate: '2026-09-20', lastContact: '2026-09-06', nextActionDate: '2026-09-10', currency: 'USD', ...values,
});

const item = (values: Record<string, Json | null> = {}) => ({
  name: 'Part A', supplier: 'Supplier A', onHand: 100, dailyDemand: 5,
  leadTimeDays: 10, safetyStock: 20, onOrder: 0, arrivalDate: null, unitCost: 2, currency: 'USD', ...values,
});

function crm(values: Record<string, Json | null>[], overrides: Partial<OperationsParams> = {}, date = today) {
  const { schema, params } = fixture('crm', values, overrides);
  const result = analyzeOperations(schema, params, date);
  if (result.kind !== 'crm') throw new Error('Wrong analysis kind');
  return result;
}

function scm(values: Record<string, Json | null>[], overrides: Partial<OperationsParams> = {}, date = today) {
  const { schema, params } = fixture('scm', values, overrides);
  const result = analyzeOperations(schema, params, date);
  if (result.kind !== 'scm') throw new Error('Wrong analysis kind');
  return result;
}

describe('operations parameter normalization', () => {
  it('rejects malformed persisted params and retains only recognized mappings', () => {
    expect(normalizeOperationsParams(null)).toEqual({ kind: 'crm', tableId: null, fields: {}, horizonDays: 30, demandMultiplier: 1, followUpDays: 14 });
    expect(normalizeOperationsParams({ kind: 'scm', tableId: ' table ', fields: { name: ' label ', onHand: 4, unknown: 'x' }, horizonDays: Infinity, demandMultiplier: -1, followUpDays: 0 }))
      .toEqual({ kind: 'scm', tableId: 'table', fields: { name: 'label' }, horizonDays: 30, demandMultiplier: 1, followUpDays: 14 });
  });

  it('allows a zero-demand scenario and normalizes day counts to whole days', () => {
    expect(normalizeOperationsParams({ demandMultiplier: 0, horizonDays: 7.9, followUpDays: 3.8 }))
      .toMatchObject({ demandMultiplier: 0, horizonDays: 7, followUpDays: 3 });
  });
});

describe('CRM analysis', () => {
  it('keeps currencies separate and includes zero and full probability without coercion', () => {
    const result = crm([
      opportunity({ amount: 200, probability: 0 }),
      opportunity({ amount: 300, probability: 100 }),
      opportunity({ amount: 10000, probability: 50, currency: 'jpy' }),
    ]);
    expect(result.totals).toEqual([
      { currency: 'JPY', pipeline: 10000, weightedPipeline: 5000, forecast: 5000, won: 0, openCount: 1 },
      { currency: 'USD', pipeline: 500, weightedPipeline: 300, forecast: 300, won: 0, openCount: 2 },
    ]);
    expect(result.rows.find(row => row.rowId === 'row-0')?.weightedAmount).toBe(0);
    expect(result.validCount).toBe(3);
  });

  it('separates won amounts and excludes closed opportunities from forecasts and follow-up risks', () => {
    const result = crm([
      opportunity({ stage: 'won', amount: 400, probability: null, closeDate: null, lastContact: null, nextActionDate: null }),
      opportunity({ stage: 'lost', amount: 500, probability: null, closeDate: null, lastContact: null, nextActionDate: null }),
    ]);
    expect(result.totals).toEqual([{ currency: 'USD', pipeline: 0, weightedPipeline: 0, forecast: 0, won: 400, openCount: 0 }]);
    expect(result.validCount).toBe(2);
    expect(result.riskCount).toBe(0);
    expect(result.rows.every(row => !row.signals.length)).toBe(true);
  });

  it('forecasts only open close dates in the inclusive analysis window', () => {
    const result = crm([
      opportunity({ closeDate: '2026-09-06' }), opportunity({ closeDate: today }),
      opportunity({ closeDate: '2026-09-14' }), opportunity({ closeDate: '2026-09-15' }),
    ], { horizonDays: 7 });
    expect(result.horizonEnd).toBe('2026-09-14');
    expect(result.totals[0]).toMatchObject({ pipeline: 4000, weightedPipeline: 2000, forecast: 1000 });
    expect(result.rows.find(row => row.rowId === 'row-0')?.signals.map(item => item.code)).toContain('close_overdue');
  });

  it('prioritizes missed commitments, missing next actions and stale contact', () => {
    const result = crm([
      opportunity(),
      opportunity({ closeDate: '2026-09-06', nextActionDate: '2026-09-01', lastContact: '2026-08-24' }),
      opportunity({ nextActionDate: null, lastContact: null }),
    ]);
    expect(result.rows[0].rowId).toBe('row-1');
    expect(result.rows[0].signals.map(item => item.code)).toEqual(['close_overdue', 'next_action_overdue', 'contact_stale']);
    expect(result.rows.find(row => row.rowId === 'row-2')?.signals.map(item => item.code)).toEqual(['next_action_missing', 'contact_missing']);
    expect(result.riskCount).toBe(2);
  });

  it.each([null, '', '500', false, -1, Number.POSITIVE_INFINITY, Number.NaN])('excludes invalid amounts %s without treating them as zero', amount => {
    const result = crm([opportunity({ amount })]);
    expect(result.excludedCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ valid: false, amount: null, weightedAmount: null });
    expect(result.rows[0].issues.length).toBeGreaterThan(0);
    expect(result.totals).toEqual([]);
  });

  it('exposes unknown stages, out-of-range probabilities, malformed dates and missing currency', () => {
    const result = crm([
      opportunity({ stage: 'negotiating' }), opportunity({ probability: 101 }),
      opportunity({ closeDate: '2026-02-30' }), opportunity({ currency: null }),
      opportunity({ lastContact: '2026-09-08' }), opportunity({ nextActionDate: '2026-9-9' }),
    ]);
    expect(result.excludedCount).toBe(6);
    expect(result.totals).toEqual([]);
    expect(result.rows.every(row => row.issues.length > 0)).toBe(true);
  });

  it('uses calendar dates across leap days and daylight-saving transitions', () => {
    const leap = crm([opportunity({ closeDate: '2028-02-29', lastContact: '2028-02-27', nextActionDate: '2028-03-01' })], { horizonDays: 1 }, '2028-02-28');
    expect(leap.horizonEnd).toBe('2028-02-29');
    expect(leap.totals[0].forecast).toBe(500);
    const dst = crm([opportunity({ closeDate: '2026-03-09', lastContact: '2026-03-07', nextActionDate: '2026-03-10' })], { horizonDays: 1 }, '2026-03-08');
    expect(dst.horizonEnd).toBe('2026-03-09');
    expect(dst.totals[0].forecast).toBe(500);
  });
});

describe('SCM analysis', () => {
  it('calculates per-item demand cover, reorder threshold and target replenishment', () => {
    const result = scm([item()]);
    expect(result.rows[0]).toMatchObject({ valid: true, effectiveDailyDemand: 5, daysCover: 20, reorderPoint: 70, targetStock: 170, projectedStock: -50, recommendedOrder: 70, orderCost: 140 });
    expect(result.totals).toEqual([{ currency: 'USD', recommendedSpend: 140, itemCount: 1 }]);
  });

  it('uses the demand scenario and covers lead time when it exceeds the selected horizon', () => {
    const result = scm([item({ leadTimeDays: 20 })], { horizonDays: 7, demandMultiplier: 2 });
    expect(result.rows[0]).toMatchObject({ effectiveDailyDemand: 10, daysCover: 10, reorderPoint: 220, targetStock: 220, projectedStock: 30, recommendedOrder: 120, orderCost: 240 });
  });

  it('handles zero demand without infinity and still respects the safety stock target', () => {
    const result = scm([item({ onHand: 10 })], { demandMultiplier: 0 });
    expect(result.rows[0]).toMatchObject({ valid: true, effectiveDailyDemand: 0, daysCover: null, reorderPoint: 20, targetStock: 20, projectedStock: 10, recommendedOrder: 10 });
    expect(result.rows[0].signals.some(item => item.code === 'zero_demand')).toBe(true);
    expect(scm([item({ dailyDemand: 0 })]).rows[0].recommendedOrder).toBe(0);
  });

  it('counts supply arriving within the horizon but preserves a stockout before arrival', () => {
    const result = scm([item({ onHand: 10, dailyDemand: 5, onOrder: 300, arrivalDate: '2026-09-17' })]);
    expect(result.rows[0]).toMatchObject({ projectedStock: 160, recommendedOrder: 0, stockoutBeforeArrival: true, shortageBeforeArrival: 40 });
    expect(result.rows[0].signals.some(item => item.code === 'stockout_before_arrival' && item.severity === 'high')).toBe(true);
    expect(result.riskCount).toBe(1);
  });

  it('does not flag a lead-time gap when inbound supply arrives before stock runs out', () => {
    const result = scm([item({ onHand: 10, onOrder: 300, arrivalDate: '2026-09-08' })]);
    expect(result.rows[0]).toMatchObject({ valid: true, stockoutBeforeArrival: false, recommendedOrder: 0 });
    expect(result.rows[0].signals).toEqual([]);
    expect(result.riskCount).toBe(0);
  });

  it('does not count overdue or post-horizon purchase orders as projected stock', () => {
    const result = scm([
      item({ onOrder: 300, arrivalDate: '2026-09-06' }),
      item({ onOrder: 300, arrivalDate: '2026-10-08' }),
    ]);
    for (const row of result.rows) expect(row).toMatchObject({ projectedStock: -50, recommendedOrder: 70 });
    expect(result.rows.find(row => row.rowId === 'row-0')?.signals.map(item => item.code)).toContain('supply_overdue');
    expect(result.rows.find(row => row.rowId === 'row-1')?.signals.map(item => item.code)).toContain('supply_after_horizon');
  });

  it('requires a valid ETA only when outstanding supply is positive', () => {
    const result = scm([item(), item({ onOrder: 20 }), item({ onOrder: 20, arrivalDate: '2026-02-29' })]);
    expect(result.validCount).toBe(1);
    expect(result.excludedCount).toBe(2);
    expect(result.rows.filter(row => !row.valid).every(row => row.recommendedOrder === null && row.issues.length > 0)).toBe(true);
  });

  it('treats arrival today and on the horizon boundary as eligible while exposing any intervening shortage', () => {
    const result = scm([
      item({ onOrder: 100, arrivalDate: today }),
      item({ onOrder: 100, arrivalDate: '2026-10-07' }),
    ]);
    expect(result.rows.find(row => row.rowId === 'row-0')).toMatchObject({ projectedStock: 50, recommendedOrder: 0, stockoutBeforeArrival: false });
    expect(result.rows.find(row => row.rowId === 'row-1')).toMatchObject({ projectedStock: 50, recommendedOrder: 0, stockoutBeforeArrival: true, shortageBeforeArrival: 50 });
  });

  it('rounds replenishment up to whole units and keeps spending separated by currency', () => {
    const result = scm([item({ onHand: 100.8 }), item({ name: 'Part B', currency: 'JPY', unitCost: 300 })]);
    expect(result.rows.find(row => row.rowId === 'row-0')?.recommendedOrder).toBe(70);
    expect(result.totals).toEqual([{ currency: 'JPY', recommendedSpend: 21000, itemCount: 1 }, { currency: 'USD', recommendedSpend: 140, itemCount: 1 }]);
    expect(result).not.toHaveProperty('totalQuantity');
  });

  it('does not buy an extra unit because decimal demand lands one floating-point step above a whole unit', () => {
    const result = scm([item({ dailyDemand: 0.14, onHand: 0, leadTimeDays: 1, safetyStock: 0, unitCost: 100 })], { horizonDays: 50 });
    expect(result.rows[0]).toMatchObject({ targetStock: 7, recommendedOrder: 7, orderCost: 700 });
    expect(result.totals[0].recommendedSpend).toBe(700);
    const covered = scm([item({ dailyDemand: 0.14, onHand: 7, leadTimeDays: 1, safetyStock: 0 })], { horizonDays: 50 });
    expect(covered.rows[0]).toMatchObject({ projectedStock: 0, recommendedOrder: 0 });
    expect(covered.rows[0].signals).toEqual([]);
  });

  it('does not invent a lead-time shortage when decimal demand exactly matches stock', () => {
    const result = scm([item({ dailyDemand: 0.14, onHand: 7, leadTimeDays: 50, safetyStock: 0 })], { horizonDays: 50 });
    expect(result.rows[0]).toMatchObject({ projectedStock: 0, recommendedOrder: 0, reorderPoint: 7 });
    expect(result.rows[0].signals.some(signal => signal.code === 'lead_time_gap')).toBe(false);
    const summed = scm([item({ dailyDemand: 0.3, onHand: 0.1, onOrder: 0.2, arrivalDate: '2026-09-07', leadTimeDays: 1, safetyStock: 0 })], { horizonDays: 1 });
    expect(summed.rows[0].signals.some(signal => signal.code === 'lead_time_gap')).toBe(false);
    expect(summed.rows[0].signals.some(signal => signal.code === 'reorder_point')).toBe(true);
  });

  it('does not flag a safety-stock gap caused only by decimal subtraction', () => {
    const result = scm([item({ dailyDemand: 0.1, onHand: 0.3, leadTimeDays: 1, safetyStock: 0.2 })], { horizonDays: 1 });
    expect(result.rows[0].recommendedOrder).toBe(0);
    expect(result.rows[0].signals.some(signal => signal.code === 'safety_stock_gap')).toBe(false);
  });

  it('still rounds meaningful fractions and tiny nonzero demand up to whole units', () => {
    const fractional = scm([item({ dailyDemand: 0.140000002, onHand: 0, leadTimeDays: 1, safetyStock: 0 })], { horizonDays: 50 });
    expect(fractional.rows[0].recommendedOrder).toBe(8);
    const residual = scm([item({ dailyDemand: 0.140000002, onHand: 7, leadTimeDays: 1, safetyStock: 0 })], { horizonDays: 50 });
    expect(residual.rows[0].recommendedOrder).toBe(1);
    const tiny = scm([item({ dailyDemand: 1e-16, onHand: 0, leadTimeDays: 1, safetyStock: 0 })], { horizonDays: 50 });
    expect(tiny.rows[0].recommendedOrder).toBe(1);
  });

  it('uses the same whole-unit tolerance for supply bridging without inventing a stockout at equality', () => {
    const exact = scm([item({ dailyDemand: 0.14, onHand: 0, leadTimeDays: 1, safetyStock: 0, onOrder: 100, arrivalDate: '2026-10-27' })], { horizonDays: 50 });
    expect(exact.rows[0].shortageBeforeArrival).toBe(7);
    expect(exact.rows[0].signals.find(item => item.code === 'stockout_before_arrival')?.message).toContain('bridge 7 units');
    const fractional = scm([item({ dailyDemand: 0.140000002, onHand: 0, leadTimeDays: 1, safetyStock: 0, onOrder: 100, arrivalDate: '2026-10-27' })], { horizonDays: 50 });
    expect(fractional.rows[0].signals.find(item => item.code === 'stockout_before_arrival')?.message).toContain('bridge 8 units');
    const covered = scm([item({ dailyDemand: 0.14, onHand: 7, leadTimeDays: 1, safetyStock: 0, onOrder: 100, arrivalDate: '2026-10-27' })], { horizonDays: 50 });
    expect(covered.rows[0]).toMatchObject({ shortageBeforeArrival: 0, stockoutBeforeArrival: false });
  });

  it.each(['onHand', 'dailyDemand', 'leadTimeDays', 'safetyStock', 'onOrder', 'unitCost'])('excludes missing or negative %s without fabricated calculations', key => {
    for (const value of [null, -1]) {
      const result = scm([item({ [key]: value })]);
      expect(result.rows[0]).toMatchObject({ valid: false, recommendedOrder: null, projectedStock: null, orderCost: null });
      expect(result.totals).toEqual([]);
    }
  });

  it('excludes numerical overflow rather than publishing infinite days of cover', () => {
    const result = scm([item({ dailyDemand: Number.MIN_VALUE, onHand: 100 })]);
    expect(result.rows[0]).toMatchObject({ valid: false, daysCover: null, orderCost: null });
    expect(result.rows[0].issues).toContain('Values are too large for a finite replenishment calculation.');
  });
});

describe('source integrity', () => {
  it('reports deleted and incompatible mappings and does not use their underlying cell values', () => {
    const { schema, params } = fixture('crm', [opportunity()]);
    schema.columns = schema.columns.filter(column => column.id !== 'amount');
    schema.columns.find(column => column.id === 'probability')!.type = 'text';
    const result = analyzeOperations(schema, params, today);
    expect(result.issues).toContain('The mapped column for Amount no longer exists.');
    expect(result.issues).toContain('Probability (%) requires a number column.');
    expect(result.excludedCount).toBe(1);
    expect(result.totals).toEqual([]);
  });

  it('accepts categorical text fields mapped to select columns', () => {
    const { schema, params } = fixture('crm', [opportunity()]);
    schema.columns.find(column => column.id === 'stage')!.type = 'select';
    expect(analyzeOperations(schema, params, today).validCount).toBe(1);
  });

  it('rejects an invalid reference date rather than reading the local clock', () => {
    const { schema, params } = fixture('crm', []);
    expect(() => analyzeOperations(schema, params, '2026-02-29')).toThrow('Analysis date must be a valid YYYY-MM-DD date.');
  });
});
