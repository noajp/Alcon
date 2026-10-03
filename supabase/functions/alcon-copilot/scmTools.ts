import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  addDays, compareScenario, DEFAULT_POLICY, planScm,
  type ScmInput, type ScmNode, type ScmPurchaseOrder, type ScmPlan, type ScmPolicy, type ScmPoStatus, type ScmScenario,
} from "../../../web/src/ActivitySpace/sustainment/scm/scmEngine.ts";

// SCM for the Copilot: the same planner the SCM App runs, over the caller's
// Space (RLS decides what is visible). Reading and simulating never write;
// draftOrders only ever creates drafts, which a person approves in SCM.

export const SCM_TOOLS = [{
  name: 'scmPlanner',
  description: 'Supply chain planner of a Space (SCM App). Same engine as the UI: demand forecast from the issue ledger, safety stock from the service level and observed supplier lateness, day-by-day projection with open purchase orders, proposed orders grouped by supplier and location, supplier scorecards. action=plan reads the current plan; optional focus narrows the detail (summary | exceptions | proposals | suppliers | item with sku). action=simulate compares a what-if scenario with the baseline (demandMultiplier, categoryDemand {category: multiplier}, supplierDelays {supplier name or id: extra days}, serviceLevel 0.5-0.999); nothing is written. action=draftOrders creates DRAFT purchase orders from the current proposals (optionally only for a supplier/location name) with the evidence as rationale; drafts are never placed until a person approves them in SCM › Purchase orders. Use the spaceId from the context. Pass asOf as the user\'s business date (YYYY-MM-DD). Report calculated numbers as calculations, not observed outcomes; overdue orders are assumed late, never received.',
  input_schema: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['plan', 'simulate', 'draftOrders'] },
      spaceId: { type: 'string' },
      asOf: { type: 'string', description: 'Business date YYYY-MM-DD.' },
      focus: { type: 'string', enum: ['summary', 'exceptions', 'proposals', 'suppliers', 'item'] },
      sku: { type: 'string' },
      location: { type: 'string', description: 'Location name or id to filter to.' },
      supplier: { type: 'string', description: 'Supplier name or id (draftOrders filter).' },
      scenario: {
        type: 'object', additionalProperties: false,
        properties: {
          demandMultiplier: { type: 'number', minimum: 0, maximum: 10 },
          categoryDemand: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 10 } },
          supplierDelays: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 365 } },
          serviceLevel: { type: 'number', minimum: 0.5, maximum: 0.999 },
        },
      },
    },
    required: ['action', 'spaceId', 'asOf'],
  },
}];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;
const num = (value: unknown, fallback = 0) => { const parsed = Number(value); return value === null || value === undefined || !Number.isFinite(parsed) ? fallback : parsed; };
const numOrNull = (value: unknown) => value === null || value === undefined ? null : num(value);
const round = (value: number | null, digits = 1) => value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

async function pages(label: string, run: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null; count: number | null }>, max = 50_000): Promise<Row[]> {
  const rows: Row[] = [];
  for (;;) {
    const { data, error, count } = await run(rows.length, rows.length + 999);
    if (error) throw new Error(`${label}: ${error.message}`);
    if (count === null || count > max) throw new Error(`${label}: too many rows to plan completely; no partial plan was calculated`);
    rows.push(...(data ?? []));
    if (rows.length >= count || !(data ?? []).length) {
      if (rows.length !== count) throw new Error(`${label} changed while reading; read again`);
      return rows;
    }
  }
}

async function load(db: SupabaseClient, spaceId: string, today: string): Promise<ScmInput> {
  const { data: policyRow, error } = await db.from('scm_policies').select('*').eq('activity_space_id', spaceId).maybeSingle();
  if (error) throw new Error(error.message);
  const policy: ScmPolicy = policyRow ? {
    serviceLevel: num(policyRow.service_level, 0.95), horizonDays: num(policyRow.horizon_days, 60), reviewDays: num(policyRow.review_days, 7),
    lookbackDays: num(policyRow.lookback_days, 90), orderingCost: num(policyRow.ordering_cost), holdingRate: num(policyRow.holding_rate, 0.2),
    autopilotEnabled: !!policyRow.autopilot_enabled, autoApproveLimit: num(policyRow.auto_approve_limit), monthlyBudget: numOrNull(policyRow.monthly_budget),
    currency: String(policyRow.currency ?? 'JPY'),
  } : DEFAULT_POLICY;
  const bySpace = (table: string, columns = '*', or?: string) => pages(table, (from, to) => {
    let query = db.from(table).select(columns, { count: 'exact' }).eq('activity_space_id', spaceId);
    if (or) query = query.or(or);
    return query.order('id').range(from, to) as never;
  });
  const [locations, suppliers, items, stock, orders, demand] = await Promise.all([
    bySpace('scm_locations'), bySpace('scm_suppliers'), bySpace('scm_items'),
    pages('scm_stock', (from, to) => db.from('scm_stock').select('*', { count: 'exact' }).eq('activity_space_id', spaceId).order('item_id').order('location_id').range(from, to) as never),
    bySpace('scm_purchase_orders', '*, scm_po_lines(*)', `ordered_on.gte.${addDays(today, -365)},status.in.(draft,approved,sent,partial)`),
    pages('demand history', (from, to) => db.rpc('scm_demand_history', { p_space: spaceId, p_since: addDays(today, -policy.lookbackDays) }, { count: 'exact' }).range(from, to) as never),
  ]);
  return {
    today, policy,
    locations: locations.map(row => ({ id: String(row.id), name: String(row.name), code: (row.code as string | null) ?? null })),
    suppliers: suppliers.map(row => ({ id: String(row.id), name: String(row.name), leadTimeDays: num(row.lead_time_days, 14), currency: String(row.currency) })),
    items: items.map(row => ({
      id: String(row.id), sku: String(row.sku), name: String(row.name), unit: String(row.unit), category: (row.category as string | null) || null,
      supplierId: (row.supplier_id as string | null) ?? null, unitCost: num(row.unit_cost), unitPrice: numOrNull(row.unit_price), currency: String(row.currency),
      leadTimeDays: numOrNull(row.lead_time_days), moq: num(row.moq), orderMultiple: num(row.order_multiple, 1), serviceLevel: numOrNull(row.service_level),
      baselineDailyDemand: numOrNull(row.baseline_daily_demand), active: row.active !== false,
    })),
    stock: stock.map(row => ({ itemId: String(row.item_id), locationId: String(row.location_id), onHand: num(row.on_hand) })),
    demand: demand.map(row => ({ itemId: String(row.item_id), locationId: String(row.location_id), day: String(row.day), quantity: num(row.quantity) })),
    orders: orders.map(row => ({
      id: String(row.id), number: num(row.number), supplierId: String(row.supplier_id), locationId: String(row.location_id), status: row.status as ScmPoStatus,
      orderedOn: String(row.ordered_on), expectedOn: String(row.expected_on), receivedOn: (row.received_on as string | null) ?? null, currency: String(row.currency),
      source: (row.source === 'autopilot' || row.source === 'copilot' ? row.source : 'human') as ScmPurchaseOrder['source'],
      lines: ((row.scm_po_lines as Row[] | null) ?? []).map(line => ({ id: String(line.id), itemId: String(line.item_id), quantity: num(line.quantity), unitCost: num(line.unit_cost), receivedQuantity: num(line.received_quantity) })),
    })),
  };
}

function resolve(list: { id: string; name: string }[], value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim().toLowerCase();
  const match = list.find(entry => entry.id === value) ?? list.find(entry => entry.name.toLowerCase() === text) ?? list.find(entry => entry.name.toLowerCase().includes(text));
  if (!match) throw new Error(`Unknown ${label} "${value}". Known: ${list.map(entry => entry.name).join(', ')}`);
  return match.id;
}

function nodeSummary(node: ScmNode, locations: Map<string, string>) {
  return {
    sku: node.sku, name: node.name, location: locations.get(node.locationId), health: node.health, abcXyz: node.abc ? `${node.abc}${node.xyz ?? ''}` : null,
    onHand: round(node.onHand), incoming: round(node.onOrder), inDrafts: round(node.inDraft), dailyDemand: round(node.dailyDemand, 2), demandSigma: round(node.forecast.sigma, 2),
    forecastMethod: node.forecast.method, forecastWape: round(node.forecast.wape, 2), stockoutDaysFilled: node.forecast.censoredDays ?? 0,
    leadTimeDays: round(node.leadTime), leadTimeSd: round(node.leadTimeSd), serviceLevel: node.serviceLevel,
    safetyStock: round(node.safetyStock, 0), reorderPoint: round(node.reorderPoint, 0), orderUpTo: round(node.orderUpTo, 0),
    daysOfCover: round(node.daysOfCover), stockoutDay: node.stockoutDay, earliestNewSupply: node.earliestNewSupply,
    suggestedOrder: node.suggestedQuantity, suggestedValue: Math.round(node.suggestedValue), currency: node.currency,
    unavoidableShortfall: round(node.shortfallUnits, 0), revenueAtRisk: Math.round(node.revenueAtRisk),
    transferFrom: node.transferFrom ? { location: locations.get(node.transferFrom.locationId), quantity: node.transferFrom.quantity } : null,
    overdueOrders: node.arrivals.filter(arrival => arrival.overdue).map(arrival => ({ po: `PO-${arrival.poNumber}`, quantity: arrival.quantity, assumedArrival: arrival.day })),
    signals: node.signals.map(signal => ({ code: signal.code, severity: signal.severity, ...signal.values })),
  };
}

function summary(plan: ScmPlan, nodes: ScmNode[]) {
  const counts: Record<string, number> = {};
  for (const node of nodes) counts[node.health] = (counts[node.health] ?? 0) + 1;
  return {
    asOf: plan.today, horizonEnd: plan.horizonEnd, policy: plan.policy, healthCounts: counts,
    totals: plan.totals.map(total => ({ ...total, inventoryValue: Math.round(total.inventoryValue), revenueAtRisk: Math.round(total.revenueAtRisk), suggestedSpend: Math.round(total.suggestedSpend), excessValue: Math.round(total.excessValue), onOrderValue: Math.round(total.onOrderValue), fillRate: round(total.fillRate, 3), turns: round(total.turns) })),
    briefing: plan.briefing.map(line => ({ kind: line.kind, severity: line.severity, ...line.values })),
    committedThisMonth: Math.round(plan.committedThisMonth),
  };
}

const LIMITATIONS = [
  'Calculated from the ledger, open orders and the policy at read time; forecasts and projections are estimates, not observed outcomes.',
  'Overdue purchase orders are assumed to arrive late (supplier history or 3 days), never treated as received.',
  'Unavoidable shortfall assumes every proposed order is placed on time; transfers and expediting are not assumed.',
  'Reads are paginated, not an atomic snapshot. Re-read before acting on a specific number.',
];

export async function runScmTool(db: SupabaseClient, input: Record<string, unknown>) {
  const spaceId = String(input.spaceId ?? '');
  if (!UUID.test(spaceId)) throw new Error('spaceId must be the Space uuid from the context');
  const asOf = String(input.asOf ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf) throw new Error('asOf must be YYYY-MM-DD');
  const data = await load(db, spaceId, asOf);
  if (!data.items.length) return { ok: true as const, data: { empty: true, message: 'This Space has no SCM items yet. Open SCM to load sample data or import items.' } };
  const locations = new Map(data.locations.map(location => [location.id, location.name]));
  const locationId = resolve(data.locations, input.location, 'location');
  const baseline = planScm(data);
  const inScope = (plan: ScmPlan) => plan.nodes.filter(node => !locationId || node.locationId === locationId);

  if (input.action === 'simulate') {
    const raw = (input.scenario ?? {}) as Record<string, unknown>;
    const scenario: ScmScenario = {};
    if (raw.demandMultiplier !== undefined) scenario.demandMultiplier = num(raw.demandMultiplier, 1);
    if (raw.categoryDemand) scenario.categoryDemand = Object.fromEntries(Object.entries(raw.categoryDemand as Record<string, unknown>).map(([key, value]) => [key, num(value, 1)]));
    if (raw.supplierDelays) scenario.supplierDelays = Object.fromEntries(Object.entries(raw.supplierDelays as Record<string, unknown>).map(([key, value]) => [resolve(data.suppliers, key, 'supplier')!, num(value)]));
    if (raw.serviceLevel !== undefined) scenario.serviceLevel = num(raw.serviceLevel, data.policy.serviceLevel);
    if (!Object.keys(scenario).length) throw new Error('Give at least one scenario assumption');
    const simulated = planScm({ ...data, scenario });
    const delta = compareScenario(baseline, simulated);
    return {
      ok: true as const,
      data: {
        scenario, baseline: summary(baseline, inScope(baseline)), simulated: summary(simulated, inScope(simulated)),
        newlyAtRisk: delta.newlyAtRisk.filter(entry => !locationId || entry.locationId === locationId).map(entry => nodeSummary(simulated.nodes.find(node => node.key === entry.key)!, locations)),
        resolved: delta.resolved.map(entry => ({ name: entry.name, location: locations.get(entry.locationId) })),
        proposalsUnderScenario: simulated.proposals.map(proposal => ({ supplier: proposal.supplierName, location: proposal.locationName, total: Math.round(proposal.total), lines: proposal.lines.length })),
        limitations: [...LIMITATIONS, 'A scenario changes assumptions only; no record or setting was changed.'],
      },
    };
  }

  if (input.action === 'draftOrders') {
    const supplierId = resolve(data.suppliers, input.supplier, 'supplier');
    const proposals = baseline.proposals.filter(proposal => (!supplierId || proposal.supplierId === supplierId) && (!locationId || proposal.locationId === locationId));
    const nodes = new Map(baseline.nodes.map(node => [node.key, node]));
    const created = [];
    for (const proposal of proposals) {
      const rationale = [
        `Drafted by Alcon Copilot from the SCM plan of ${asOf} (service level ${Math.round(data.policy.serviceLevel * 1000) / 10}%, review every ${data.policy.reviewDays} days). Not placed until approved.`,
        ...proposal.lines.map(line => {
          const node = nodes.get(line.nodeKey)!;
          return `- ${line.sku} ${line.name}: ${line.quantity}. On hand ${round(node.onHand)}, incoming ${round(node.onOrder + node.inDraft)}, demand ${round(node.dailyDemand)}/day, lead time ${round(node.leadTime)}d, reorder point ${round(node.reorderPoint, 0)}, order-up-to ${round(node.orderUpTo, 0)}${node.stockoutDay ? `, runs out ${node.stockoutDay}` : ''}.`;
        }),
      ].join('\n');
      const { data: order, error } = await db.from('scm_purchase_orders').insert({
        activity_space_id: spaceId, supplier_id: proposal.supplierId, location_id: proposal.locationId, status: 'draft', ordered_on: asOf,
        expected_on: proposal.expectedOn, currency: proposal.currency, source: 'copilot', rationale,
      }).select('id, number').single();
      if (error || !order) throw new Error(error?.message ?? 'Could not create the draft');
      const { error: lineError } = await db.from('scm_po_lines').insert(proposal.lines.map(line => ({ activity_space_id: spaceId, po_id: order.id, item_id: line.itemId, quantity: line.quantity, unit_cost: line.unitCost })));
      if (lineError) { await db.from('scm_purchase_orders').delete().eq('id', order.id); throw new Error(lineError.message); }
      created.push({ po: `PO-${order.number}`, supplier: proposal.supplierName, location: proposal.locationName, total: Math.round(proposal.total), currency: proposal.currency, lines: proposal.lines.length });
    }
    return { ok: true as const, data: { created, note: created.length ? 'Drafts await approval in SCM › Purchase orders › Awaiting approval.' : 'No orders are proposed right now.' } };
  }

  const focus = String(input.focus ?? 'summary');
  const nodes = inScope(baseline);
  const result: Record<string, unknown> = { summary: summary(baseline, nodes), limitations: LIMITATIONS };
  if (focus === 'exceptions' || focus === 'summary') {
    result.exceptions = nodes.filter(node => ['stockout', 'critical', 'reorder'].includes(node.health) || node.arrivals.some(arrival => arrival.overdue)).slice(0, focus === 'summary' ? 8 : 40).map(node => nodeSummary(node, locations));
  }
  if (focus === 'proposals' || focus === 'summary') {
    result.proposals = baseline.proposals.filter(proposal => !locationId || proposal.locationId === locationId).map(proposal => ({
      supplier: proposal.supplierName, location: proposal.locationName, total: Math.round(proposal.total), currency: proposal.currency, authority: proposal.authority,
      urgent: proposal.urgent, needBy: proposal.needBy, expectedOn: proposal.expectedOn,
      lines: proposal.lines.map(line => ({ sku: line.sku, name: line.name, quantity: line.quantity, value: Math.round(line.value), reason: line.reason })),
    }));
  }
  if (focus === 'suppliers' || focus === 'summary') {
    result.suppliers = baseline.suppliers.map(supplier => ({ ...supplier, onTimeRate: round(supplier.onTimeRate, 2), averageDelay: round(supplier.averageDelay), averageLeadTime: round(supplier.averageLeadTime), leadTimeSd: round(supplier.leadTimeSd), openValue: Math.round(supplier.openValue), spendLookback: Math.round(supplier.spendLookback) }));
  }
  if (focus === 'item') {
    const sku = String(input.sku ?? '').trim().toLowerCase();
    const matches = baseline.nodes.filter(node => (node.sku.toLowerCase() === sku || node.name.toLowerCase().includes(sku)) && (!locationId || node.locationId === locationId));
    if (!sku || !matches.length) throw new Error('Give the sku (or part of the name) of a planned item');
    result.items = matches.map(node => ({ ...nodeSummary(node, locations), next14DaysProjection: node.projection.slice(0, 14).map(point => ({ day: point.day, stock: point.stock, withPlan: point.planned, arrivals: point.arrivals })) }));
  }
  return { ok: true as const, data: result };
}
