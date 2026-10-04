import { describe, expect, it } from 'vitest';
import {
  addDays, compareScenario, DEFAULT_POLICY, forecastDemand, inverseNormal, planScm, uncensor,
  type ScmInput, type ScmItem, type ScmPurchaseOrder,
} from '../src/ActivitySpace/sustainment/scm/scmEngine';
import { generateScmSample } from '../src/ActivitySpace/sustainment/scm/scmSample';

const TODAY = '2026-10-03';

/** The sample as the planner would read it back from the database. */
function sampleInput(): ScmInput {
  const sample = generateScmSample(TODAY);
  const stock = new Map<string, number>();
  const demand = new Map<string, number>();
  for (const movement of sample.movements) {
    const key = `${movement.itemKey}:${movement.locationKey}`;
    stock.set(key, (stock.get(key) ?? 0) + movement.quantity);
    if (movement.kind === 'issue') {
      const day = `${key}:${movement.occurredOn}`;
      demand.set(day, (demand.get(day) ?? 0) - movement.quantity);
    }
  }
  return {
    today: TODAY,
    policy: DEFAULT_POLICY,
    locations: sample.locations.map(location => ({ id: location.key, name: location.name, code: location.code })),
    suppliers: sample.suppliers.map(supplier => ({ id: supplier.key, name: supplier.name, leadTimeDays: supplier.leadTimeDays, currency: supplier.currency })),
    items: sample.items.map(item => ({
      id: item.key, sku: item.sku, name: item.name, unit: item.unit, category: item.category, supplierId: item.supplierKey,
      unitCost: item.unitCost, unitPrice: item.unitPrice, currency: 'JPY', leadTimeDays: null, moq: item.moq,
      orderMultiple: item.orderMultiple, serviceLevel: null, baselineDailyDemand: null, active: true,
      createdAt: `${addDays(TODAY, -120)}T00:00:00Z`,
    })),
    stock: [...stock.entries()].map(([key, onHand]) => { const [itemId, locationId] = key.split(':'); return { itemId, locationId, onHand }; }),
    demand: [...demand.entries()].map(([key, quantity]) => { const [itemId, locationId, day] = key.split(':'); return { itemId, locationId, day, quantity }; }),
    orders: sample.orders.map((order, index) => ({
      id: order.key, number: index + 1, supplierId: order.supplierKey, locationId: order.locationKey, status: order.status,
      orderedOn: order.orderedOn, expectedOn: order.expectedOn, receivedOn: order.receivedOn, currency: 'JPY', source: 'human',
      lines: order.lines.map((line, lineIndex) => ({ id: `${order.key}-${lineIndex}`, itemId: line.itemKey, quantity: line.quantity, unitCost: line.unitCost, receivedQuantity: line.receivedQuantity })),
    })),
  };
}

function item(overrides: Partial<ScmItem> = {}): ScmItem {
  return {
    id: 'i', sku: 'SKU', name: 'Item', unit: 'pcs', category: null, supplierId: 's', unitCost: 100, unitPrice: 200,
    currency: 'JPY', leadTimeDays: null, moq: 0, orderMultiple: 1, serviceLevel: null, baselineDailyDemand: null, active: true, ...overrides,
  };
}

function flatInput(onHand: number, dailyDemand: number, orders: ScmPurchaseOrder[] = [], extra: Partial<ScmItem> = {}): ScmInput {
  const days = 56;
  return {
    today: TODAY, policy: { ...DEFAULT_POLICY, horizonDays: 30 },
    locations: [{ id: 'l', name: 'DC', code: null }],
    suppliers: [{ id: 's', name: 'Supplier', leadTimeDays: 10, currency: 'JPY' }],
    items: [item(extra)],
    stock: [{ itemId: 'i', locationId: 'l', onHand }],
    demand: Array.from({ length: days }, (_, index) => ({ itemId: 'i', locationId: 'l', day: addDays(TODAY, index - days), quantity: dailyDemand })),
    orders,
  };
}

describe('statistics', () => {
  it('inverts the standard normal', () => {
    expect(inverseNormal(0.5)).toBeCloseTo(0, 6);
    expect(inverseNormal(0.95)).toBeCloseTo(1.6449, 3);
    expect(inverseNormal(0.99)).toBeCloseTo(2.3263, 3);
    expect(inverseNormal(0.01)).toBeCloseTo(-2.3263, 3);
  });

  it('forecasts a flat series flat and with no error', () => {
    const forecast = forecastDemand(new Array(60).fill(10), TODAY, 14);
    expect(forecast.average).toBeCloseTo(10, 5);
    expect(forecast.sigma).toBeCloseTo(0, 5);
    expect(forecast.wape).toBeCloseTo(0, 5);
  });

  it('learns a weekly pattern', () => {
    // Weekends at double demand.
    const start = new Date(`${TODAY}T00:00:00Z`).getTime() / 86_400_000 - 84;
    const series = Array.from({ length: 84 }, (_, index) => {
      const weekday = new Date((start + index) * 86_400_000).getUTCDay();
      return weekday === 0 || weekday === 6 ? 20 : 10;
    });
    const forecast = forecastDemand(series, TODAY, 7);
    expect(forecast.method).toBe('holt_weekly');
    const high = Math.max(...forecast.daily);
    const low = Math.min(...forecast.daily);
    expect(high / low).toBeGreaterThan(1.7);
  });

  it('reads a regular seller\'s zero days as stockouts, not lost interest', () => {
    const series = Array.from({ length: 60 }, (_, index) => index >= 50 && index < 53 ? 0 : 10);
    const result = uncensor(series);
    expect(result.censoredDays).toBe(3);
    expect(result.series[51]).toBe(10);
    const intermittent = Array.from({ length: 60 }, (_, index) => index % 3 === 0 ? 6 : 0);
    expect(uncensor(intermittent).censoredDays).toBe(0);
  });

  it('falls back to a stated baseline when there is no history', () => {
    const forecast = forecastDemand(new Array(30).fill(0), TODAY, 10, 4);
    expect(forecast.method).toBe('baseline');
    expect(forecast.average).toBe(4);
  });
});

describe('planning a node', () => {
  it('orders up to the target when position falls to the reorder point', () => {
    const plan = planScm(flatInput(50, 10));
    const node = plan.nodes[0];
    // Flat demand: no safety stock beyond zero variance. Periodic review: the
    // reorder point covers lead time + one review, the order one review more.
    expect(node.reorderPoint).toBeCloseTo(170, 0);
    expect(node.orderUpTo).toBeCloseTo(240, 0);
    expect(node.suggestedQuantity).toBe(190);
    expect(node.health).toBe('critical');
    expect(node.stockoutDay).toBe(addDays(TODAY, 5));
    expect(plan.proposals).toHaveLength(1);
  });

  it('respects MOQ and order multiples', () => {
    const plan = planScm(flatInput(50, 10, [], { moq: 200, orderMultiple: 24 }));
    expect(plan.nodes[0].suggestedQuantity).toBe(216);
    const multiple = planScm(flatInput(50, 10, [], { orderMultiple: 24 }));
    expect(multiple.nodes[0].suggestedQuantity).toBe(192);
  });

  it('counts confirmed supply and does not order twice', () => {
    const order: ScmPurchaseOrder = {
      id: 'po', number: 1, supplierId: 's', locationId: 'l', status: 'sent', orderedOn: addDays(TODAY, -2), expectedOn: addDays(TODAY, 3),
      receivedOn: null, currency: 'JPY', source: 'human', lines: [{ id: 'x', itemId: 'i', quantity: 200, unitCost: 100, receivedQuantity: 0 }],
    };
    const plan = planScm(flatInput(50, 10, [order]));
    const node = plan.nodes[0];
    expect(node.onOrder).toBe(200);
    expect(node.suggestedQuantity).toBe(0);
    expect(node.health).toBe('healthy');
    expect(node.projection[3].arrivals).toBe(200);
  });

  it('never treats an overdue order as received', () => {
    const order: ScmPurchaseOrder = {
      id: 'po', number: 7, supplierId: 's', locationId: 'l', status: 'sent', orderedOn: addDays(TODAY, -20), expectedOn: addDays(TODAY, -5),
      receivedOn: null, currency: 'JPY', source: 'human', lines: [{ id: 'x', itemId: 'i', quantity: 200, unitCost: 100, receivedQuantity: 0 }],
    };
    const node = planScm(flatInput(20, 10, [order])).nodes[0];
    expect(node.arrivals[0].overdue).toBe(true);
    expect(node.arrivals[0].day > TODAY).toBe(true);
    expect(node.signals.map(signal => signal.code)).toContain('overdue_order');
    expect(node.stockoutDay).toBe(addDays(TODAY, 2));
  });

  it('keeps drafts out of the projection but inside the position', () => {
    const order: ScmPurchaseOrder = {
      id: 'po', number: 2, supplierId: 's', locationId: 'l', status: 'draft', orderedOn: TODAY, expectedOn: addDays(TODAY, 10),
      receivedOn: null, currency: 'JPY', source: 'autopilot', lines: [{ id: 'x', itemId: 'i', quantity: 300, unitCost: 100, receivedQuantity: 0 }],
    };
    const node = planScm(flatInput(50, 10, [order])).nodes[0];
    expect(node.inDraft).toBe(300);
    expect(node.suggestedQuantity).toBe(0);
    expect(node.stockoutDay).not.toBeNull();
  });

  it('following the plan leaves no shortfall for a fast mover with a short lead time', () => {
    // 2-day lead time, weekly review: the plan must not manufacture stockouts.
    const input = flatInput(300, 100, [], { leadTimeDays: 2 });
    const node = planScm(input).nodes[0];
    expect(node.shortfallUnits).toBe(0);
    expect(planScm(input).totals[0].fillRate).toBe(1);
  });

  it('does not hold a standing extra review of stock in steady state', () => {
    const input = flatInput(300, 10);
    const node = planScm({ ...input, policy: { ...input.policy, horizonDays: 120 } }).nodes[0];
    // Safety stock is zero for flat demand; following the plan, stock must
    // reach well below one review of demand between orders.
    const steady = node.projection.slice(40).map(point => point.planned);
    expect(Math.min(...steady)).toBeLessThan(10 * 7);
    expect(node.shortfallUnits).toBe(0);
  });

  it('does not call a newly set-up item dead stock', () => {
    const input = flatInput(80, 0, [], { createdAt: `${TODAY}T09:00:00Z` });
    const node = planScm({ ...input, demand: [] }).nodes[0];
    expect(node.health).toBe('no_demand');
    expect(node.signals.map(signal => signal.code)).toContain('no_history');
    const old = planScm({ ...flatInput(80, 0, [], { createdAt: '2025-01-01T00:00:00Z' }), demand: [] }).nodes[0];
    expect(old.health).toBe('dead');
  });

  it('reports excess per currency', () => {
    const base = flatInput(0, 0);
    const input = { ...base, demand: [],
      items: [item({ id: 'a', currency: 'JPY', unitCost: 1000 }), item({ id: 'b', sku: 'B', currency: 'USD', unitCost: 10 })],
      stock: [{ itemId: 'a', locationId: 'l', onHand: 5 }, { itemId: 'b', locationId: 'l', onHand: 7 }] };
    const line = planScm(input).briefing.find(entry => entry.kind === 'excess')!;
    expect(line.values.amount).toBe('JPY 5,000 + USD 70');
  });

  it('applies a demand scenario without touching the inputs', () => {
    const input = flatInput(400, 10);
    const base = planScm(input);
    const shocked = planScm({ ...input, scenario: { demandMultiplier: 5 } });
    expect(base.nodes[0].health).toBe('healthy');
    expect(shocked.nodes[0].health).toBe('critical');
    const delta = compareScenario(base, shocked);
    expect(delta.newlyAtRisk).toHaveLength(1);
    expect(input.scenario).toBeUndefined();
  });

  it('classifies proposals against the approval authority and budget', () => {
    const input = flatInput(50, 10);
    expect(planScm({ ...input, policy: { ...input.policy, autoApproveLimit: 20_000 } }).proposals[0].authority).toBe('auto');
    expect(planScm({ ...input, policy: { ...input.policy, autoApproveLimit: 1_000 } }).proposals[0].authority).toBe('approval');
    expect(planScm({ ...input, policy: { ...input.policy, autoApproveLimit: 20_000, monthlyBudget: 5_000 } }).proposals[0].authority).toBe('over_budget');
    // A zero limit grants nothing, even to an order with no value.
    const free = flatInput(50, 10, [], { unitCost: 0 });
    expect(planScm({ ...free, policy: { ...free.policy, autoApproveLimit: 0 } }).proposals[0].authority).toBe('approval');
  });

  it('counts only the policy currency against the monthly budget', () => {
    const input = flatInput(50, 10);
    const usd: ScmPurchaseOrder = {
      id: 'usd', number: 9, supplierId: 's', locationId: 'l', status: 'received', orderedOn: TODAY, expectedOn: TODAY, receivedOn: TODAY,
      currency: 'USD', source: 'human', lines: [{ id: 'u', itemId: 'i', quantity: 1, unitCost: 1_000_000, receivedQuantity: 1 }],
    };
    const plan = planScm({ ...input, orders: [usd], policy: { ...input.policy, autoApproveLimit: 20_000, monthlyBudget: 50_000 } });
    expect(plan.committedThisMonth).toBe(0);
    expect(plan.proposals[0].authority).toBe('auto');
  });
});

describe('the sample supply chain', () => {
  const sample = generateScmSample(TODAY);
  const plan = planScm(sampleInput());

  it('is deterministic and internally consistent', () => {
    expect(generateScmSample(TODAY)).toEqual(sample);
    for (const order of sample.orders) {
      for (const line of order.lines) {
        expect(line.receivedQuantity).toBe(order.status === 'received' ? line.quantity : 0);
      }
    }
    const stock = new Map<string, number>();
    for (const movement of sample.movements) {
      const key = `${movement.itemKey}:${movement.locationKey}`;
      stock.set(key, (stock.get(key) ?? 0) + movement.quantity);
      expect(stock.get(key)!).toBeGreaterThanOrEqual(0);
    }
  });

  it('shows every kind of situation the planner handles', () => {
    const codes = new Set(plan.nodes.flatMap(node => node.signals.map(signal => signal.code)));
    expect(codes).toContain('overdue_order');
    expect(codes).toContain('transfer_available');
    expect(codes).toContain('dead_stock');
    expect(codes).toContain('demand_rising');
    expect(codes).toContain('unreliable_supplier');
    expect(plan.counts.critical + plan.counts.stockout).toBeGreaterThan(0);
    expect(plan.counts.healthy).toBeGreaterThan(5);
    expect(plan.proposals.length).toBeGreaterThan(0);
    const late = plan.suppliers.find(supplier => supplier.supplierId === 'pack')!;
    expect(late.onTimeRate!).toBeLessThan(0.5);
    expect(plan.nodes.find(node => node.key === 'dec:osa')!.transferFrom?.locationId).toBe('tky');
    expect(plan.briefing[0].severity).toBe('high');
    expect(plan.nodes.some(node => node.abc === 'A')).toBe(true);
  });

  it('plans late suppliers at their observed lead time', () => {
    const cups = plan.nodes.find(node => node.key === 'c12:tky')!;
    expect(cups.leadTime).toBeGreaterThan(12);
  });
});
