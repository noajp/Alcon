import { operationsQueues } from '@/ActivitySpace/sustainment/operations/operationsQueues';
import { describe, expect, it } from 'vitest';
import type { DataTableSchema } from '@/ActivitySpace/sustainment/table/data';
import type { Json } from '@/types/database';
import {
  analyzeOperations, normalizeOperationsParams, OPERATIONS_FIELDS, type OperationsParams,
} from '@/ActivitySpace/sustainment/operations/operationsModel';

const today = '2026-09-07';

function fixture(values: Record<string, Json | null>[], overrides: Partial<OperationsParams> = {}) {
  const params = normalizeOperationsParams({ kind: 'crm', tableId: 'table', fields: Object.fromEntries(OPERATIONS_FIELDS.map(field => [field.key, field.key])), ...overrides });
  const schema: DataTableSchema = {
    columns: OPERATIONS_FIELDS.map((field, index) => ({ id: field.key, table_id: 'table', name: field.label, type: field.type, options: null, order_index: index, created_at: '' })),
    rows: values.map((_, index) => ({ id: `row-${index}`, table_id: 'table', order_index: index, created_at: '', updated_at: '' })),
    cellsByRow: Object.fromEntries(values.map((value, index) => [`row-${index}`, value])),
  };
  return { params, schema };
}

const opportunity = (values: Record<string, Json | null> = {}) => ({
  name: 'Support renewal', account: 'Example', stage: 'open', amount: 1000,
  probability: 50, closeDate: '2026-09-20', lastContact: '2026-09-06', nextActionDate: '2026-09-10', currency: 'USD', ...values,
});

function crm(values: Record<string, Json | null>[], overrides: Partial<OperationsParams> = {}, date = today) {
  const { schema, params } = fixture(values, overrides);
  return analyzeOperations(schema, params, date);
}

describe('operations parameter normalization', () => {
  it('rejects malformed persisted params and retains only recognized mappings', () => {
    expect(normalizeOperationsParams(null)).toEqual({ kind: 'crm', tableId: null, fields: {}, horizonDays: 30, followUpDays: 14 });
    expect(normalizeOperationsParams({ kind: 'crm', tableId: ' table ', fields: { name: ' label ', amount: 4, unknown: 'x' }, horizonDays: Infinity, followUpDays: 0 }))
      .toEqual({ kind: 'crm', tableId: 'table', fields: { name: 'label' }, horizonDays: 30, followUpDays: 14 });
  });

  it('opens setup for a placement saved with another kind instead of reading its Table as a pipeline', () => {
    expect(normalizeOperationsParams({ kind: 'other', tableId: 'table', fields: { name: 'label' }, horizonDays: 60 }))
      .toEqual({ kind: 'crm', tableId: null, fields: {}, horizonDays: 60, followUpDays: 14 });
  });

  it('normalizes day counts to whole days', () => {
    expect(normalizeOperationsParams({ horizonDays: 7.9, followUpDays: 3.8 }))
      .toMatchObject({ horizonDays: 7, followUpDays: 3 });
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

  it('treats every pipeline stage except won and lost as open', () => {
    const result = crm([opportunity({ stage: 'negotiation' }), opportunity({ stage: 'Won' }), opportunity({ stage: ' LOST ' })]);
    expect(result.rows.map(row => [row.stageId, row.stage])).toEqual([['negotiation', 'open'], ['Won', 'won'], ['LOST', 'lost']]);
    expect(result.excludedCount).toBe(0);
  });

  it('exposes out-of-range probabilities, malformed dates and missing currency', () => {
    const result = crm([
      opportunity({ probability: 101 }),
      opportunity({ closeDate: '2026-02-30' }), opportunity({ currency: null }),
      opportunity({ lastContact: '2026-09-08' }), opportunity({ nextActionDate: '2026-9-9' }),
    ]);
    expect(result.excludedCount).toBe(5);
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

describe('source integrity', () => {
  it('reports deleted and incompatible mappings and does not use their underlying cell values', () => {
    const { schema, params } = fixture([opportunity()]);
    schema.columns = schema.columns.filter(column => column.id !== 'amount');
    schema.columns.find(column => column.id === 'probability')!.type = 'text';
    const result = analyzeOperations(schema, params, today);
    expect(result.issues).toContain('The mapped column for Amount no longer exists.');
    expect(result.issues).toContain('Probability (%) requires a number column.');
    expect(result.excludedCount).toBe(1);
    expect(result.totals).toEqual([]);
  });

  it('accepts categorical text fields mapped to select columns', () => {
    const { schema, params } = fixture([opportunity()]);
    schema.columns.find(column => column.id === 'stage')!.type = 'select';
    expect(analyzeOperations(schema, params, today).validCount).toBe(1);
  });

  it('rejects an invalid reference date rather than reading the local clock', () => {
    const { schema, params } = fixture([]);
    expect(() => analyzeOperations(schema, params, '2026-02-29')).toThrow('Analysis date must be a valid YYYY-MM-DD date.');
  });
});

describe('operations queues', () => {
  it('keeps invalid opportunities out of actionable work, and closed deals out of follow-ups', () => {
    const analysis = crm([
      opportunity({ nextActionDate: '2026-09-01' }),
      opportunity({ amount: null, nextActionDate: '2026-09-01' }),
      opportunity({ stage: 'won', nextActionDate: '2026-09-01' }),
      opportunity(),
    ]);
    const queues = operationsQueues(analysis);
    expect(queues.attention.map(row => row.rowId)).toEqual(['row-0']);
    expect(queues.incomplete.map(row => row.rowId)).toEqual(['row-1']);
  });

  it('reclassifies corrected inputs and responds to the follow-up threshold', () => {
    const incomplete = operationsQueues(crm([opportunity({ amount: null })]));
    expect(incomplete.attention).toHaveLength(0);
    expect(incomplete.incomplete).toHaveLength(1);
    const corrected = operationsQueues(crm([opportunity({ lastContact: '2026-08-31' })]));
    expect(corrected.attention).toHaveLength(0);
    expect(corrected.incomplete).toHaveLength(0);
    const shorterThreshold = operationsQueues(crm([opportunity({ lastContact: '2026-08-31' })], { followUpDays: 7 }));
    expect(shorterThreshold.attention).toHaveLength(1);
    expect(shorterThreshold.incomplete).toHaveLength(0);
  });
});
