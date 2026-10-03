// The SCM planner. Shared by the browser and Copilot (Deno), so it has no
// browser, database, framework or path-alias dependency: inputs are plain
// records read from the scm_* tables, outputs are plain data.
//
// One planning node is an Item at a Location. For each node the planner
// forecasts demand from the issue ledger, sizes safety stock from the service
// level and the demand / lead-time variability it observed, projects stock day
// by day with the open purchase orders, and proposes what to order. Proposals
// are grouped into purchase orders per supplier and location and classified
// against the Space's policy: within the autopilot's authority, or needing a
// person's approval.

export type ScmPoStatus = 'draft' | 'approved' | 'sent' | 'partial' | 'received' | 'cancelled';
export type ScmMovementKind = 'receipt' | 'issue' | 'adjust' | 'transfer_in' | 'transfer_out';

export interface ScmLocation { id: string; name: string; code: string | null }
export interface ScmSupplier { id: string; name: string; leadTimeDays: number; currency: string }
export interface ScmItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  supplierId: string | null;
  unitCost: number;
  unitPrice: number | null;
  currency: string;
  leadTimeDays: number | null;
  moq: number;
  orderMultiple: number;
  serviceLevel: number | null;
  baselineDailyDemand: number | null;
  active: boolean;
  /** When the item was set up; an item younger than the history window cannot be dead stock. */
  createdAt?: string | null;
}
export interface ScmStock { itemId: string; locationId: string; onHand: number }
/** Outflow per item, location and day: issues and transfers out, as a positive quantity. */
export interface ScmDemandPoint { itemId: string; locationId: string; day: string; quantity: number }
export interface ScmPoLine { id: string; itemId: string; quantity: number; unitCost: number; receivedQuantity: number }
export interface ScmPurchaseOrder {
  id: string;
  number: number;
  supplierId: string;
  locationId: string;
  status: ScmPoStatus;
  orderedOn: string;
  expectedOn: string;
  receivedOn: string | null;
  currency: string;
  source: 'human' | 'autopilot' | 'copilot';
  lines: ScmPoLine[];
}
export interface ScmPolicy {
  serviceLevel: number;
  horizonDays: number;
  reviewDays: number;
  lookbackDays: number;
  orderingCost: number;
  holdingRate: number;
  autopilotEnabled: boolean;
  autoApproveLimit: number;
  monthlyBudget: number | null;
  currency: string;
}

export const DEFAULT_POLICY: ScmPolicy = {
  serviceLevel: 0.95, horizonDays: 60, reviewDays: 7, lookbackDays: 90,
  orderingCost: 0, holdingRate: 0.2, autopilotEnabled: false, autoApproveLimit: 0,
  monthlyBudget: null, currency: 'JPY',
};

/** What-if assumptions. They change the calculation only, never the records. */
export interface ScmScenario {
  /** Multiplies every forecast. 1 = as forecast. */
  demandMultiplier?: number;
  /** Per-category demand multipliers, applied on top of demandMultiplier. */
  categoryDemand?: Record<string, number>;
  /** Extra days added to a supplier's lead time and to its open orders' arrival. */
  supplierDelays?: Record<string, number>;
  /** Service level override for every item. */
  serviceLevel?: number;
}

export interface ScmInput {
  today: string;
  policy: ScmPolicy;
  locations: ScmLocation[];
  suppliers: ScmSupplier[];
  items: ScmItem[];
  stock: ScmStock[];
  demand: ScmDemandPoint[];
  orders: ScmPurchaseOrder[];
  scenario?: ScmScenario;
}

// ---------------------------------------------------------------------------
// Dates — UTC date-only arithmetic, so neither DST nor the viewer's timezone
// moves a day.

const DAY_MS = 86_400_000;
export function dayNumber(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time)) throw new Error(`Invalid date: ${value}`);
  return Math.round(time / DAY_MS);
}
function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}
export function addDays(value: string, days: number): string {
  return dayString(dayNumber(value) + days);
}
/** 0 = Sunday … 6 = Saturday. */
function weekday(day: number): number {
  return ((day % 7) + 7 + 4) % 7;
}

// ---------------------------------------------------------------------------
// Statistics

/** Inverse of the standard normal CDF (Acklam), accurate to ~1e-9. */
export function inverseNormal(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error('Probability must be between 0 and 1');
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}
const round2 = (value: number) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// Forecasting

export type ForecastMethod = 'holt_weekly' | 'holt' | 'baseline' | 'none';
export interface DemandForecast {
  method: ForecastMethod;
  /** Forecast for day 1 … n after today. */
  daily: number[];
  /** Mean of the forecast over the requested window. */
  average: number;
  /** Day-to-day forecast error (RMSE of one-step-ahead errors). */
  sigma: number;
  /** Change in level per day (damped). */
  trendPerDay: number;
  weekdayFactors: number[];
  /** Weighted absolute percentage error of a 14-day holdout, when history allows. */
  wape: number | null;
  /** Demand over the history window. */
  historyTotal: number;
  historyDays: number;
  /** Days in the history with no demand, as a share. */
  zeroShare: number;
  /** Zero-sale days of a regular seller, read as stockouts and filled in. */
  censoredDays?: number;
}

const ALPHA = 0.3;
const BETA = 0.08;
const PHI = 0.9;

interface FittedModel { level: number; trend: number; factors: number[]; residuals: number[]; seasonal: boolean }

function fit(series: number[], firstDay: number): FittedModel {
  const n = series.length;
  const overall = mean(series);
  const factors = [1, 1, 1, 1, 1, 1, 1];
  const seasonal = n >= 28 && overall > 0;
  if (seasonal) {
    const sums = [0, 0, 0, 0, 0, 0, 0];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    series.forEach((value, index) => { const w = weekday(firstDay + index); sums[w] += value; counts[w] += 1; });
    // Shrink toward flat when history is short; a few weeks cannot prove a pattern.
    const weight = Math.min(1, n / 84);
    for (let w = 0; w < 7; w++) factors[w] = 1 + weight * ((counts[w] ? sums[w] / counts[w] / overall : 1) - 1);
    const norm = mean(factors);
    for (let w = 0; w < 7; w++) factors[w] = norm > 0 ? factors[w] / norm : 1;
  }
  const deseason = series.map((value, index) => {
    const factor = factors[weekday(firstDay + index)];
    return factor > 0 ? value / factor : value;
  });
  let level = mean(deseason.slice(0, Math.min(7, n)));
  let trend = 0;
  const residuals: number[] = [];
  for (let index = 0; index < n; index++) {
    const factor = factors[weekday(firstDay + index)];
    const predicted = Math.max(0, (level + PHI * trend) * factor);
    if (index >= 7) residuals.push(series[index] - predicted);
    const previous = level;
    level = ALPHA * deseason[index] + (1 - ALPHA) * (previous + PHI * trend);
    trend = BETA * (level - previous) + (1 - BETA) * PHI * trend;
  }
  return { level: Math.max(0, level), trend, factors, residuals, seasonal };
}

function project(model: FittedModel, startDay: number, days: number): number[] {
  const out: number[] = [];
  let damp = 0;
  for (let h = 1; h <= days; h++) {
    damp += PHI ** h;
    out.push(Math.max(0, (model.level + model.trend * damp) * model.factors[weekday(startDay + h)]));
  }
  return out;
}

/**
 * Forecast `days` ahead from a daily history ending yesterday (series[n-1] is
 * the day before `today`). With no history, a stated baseline is used as-is.
 */
export function forecastDemand(series: number[], today: string, days: number, baseline: number | null = null): DemandForecast {
  const todayNumber = dayNumber(today);
  const firstDay = todayNumber - series.length;
  const historyTotal = series.reduce((sum, value) => sum + value, 0);
  const zeroShare = series.length ? series.filter(value => value <= 0).length / series.length : 1;
  if (historyTotal <= 0 || series.length < 7) {
    if (baseline !== null && baseline > 0) {
      const daily = Array.from({ length: days }, () => baseline);
      return { method: 'baseline', daily, average: baseline, sigma: Math.sqrt(baseline), trendPerDay: 0, weekdayFactors: [1, 1, 1, 1, 1, 1, 1], wape: null, historyTotal, historyDays: series.length, zeroShare };
    }
    const average = series.length ? historyTotal / series.length : 0;
    const daily = Array.from({ length: days }, () => average);
    return { method: 'none', daily, average, sigma: standardDeviation(series), trendPerDay: 0, weekdayFactors: [1, 1, 1, 1, 1, 1, 1], wape: null, historyTotal, historyDays: series.length, zeroShare };
  }
  const model = fit(series, firstDay);
  const daily = project(model, todayNumber - 1, days);
  const residualSigma = Math.sqrt(mean(model.residuals.map(value => value * value)));
  // Never claim less variability than the history itself shows for sparse data.
  const sigma = Math.max(residualSigma, zeroShare > 0.5 ? standardDeviation(series) : 0);
  let wape: number | null = null;
  if (series.length >= 42) {
    const train = series.slice(0, -14);
    const actual = series.slice(-14);
    const holdout = project(fit(train, firstDay), firstDay + train.length - 1, 14);
    const total = actual.reduce((sum, value) => sum + value, 0);
    if (total > 0) wape = actual.reduce((sum, value, index) => sum + Math.abs(value - holdout[index]), 0) / total;
  }
  return {
    method: model.seasonal ? 'holt_weekly' : 'holt', daily, average: mean(daily), sigma, trendPerDay: model.trend,
    weekdayFactors: model.factors, wape, historyTotal, historyDays: series.length, zeroShare,
  };
}

/**
 * A product that sells almost every day and then shows a few zero days was
 * most likely out of stock, not unwanted. Those days are filled with the
 * surrounding demand so a stockout does not teach the forecast to order less.
 * Intermittent sellers (many zero days) are left as they are.
 */
export function uncensor(series: number[]): { series: number[]; censoredDays: number } {
  if (series.length < 28) return { series, censoredDays: 0 };
  const zeros = series.filter(value => value <= 0).length;
  if (zeros === 0 || zeros / series.length >= 0.15) return { series, censoredDays: 0 };
  const filled = series.map((value, index) => {
    if (value > 0) return value;
    const window = series.slice(Math.max(0, index - 7), index + 8).filter(entry => entry > 0);
    return window.length ? mean(window) : 0;
  });
  return { series: filled, censoredDays: zeros };
}

// ---------------------------------------------------------------------------
// Supplier performance

export interface SupplierPerformance {
  supplierId: string;
  name: string;
  promisedLeadTime: number;
  /** Received orders with a receipt date. */
  samples: number;
  onTimeRate: number | null;
  averageDelay: number | null;
  /** Lead time actually observed (ordered → received). */
  averageLeadTime: number | null;
  leadTimeSd: number;
  openOrders: number;
  overdueOrders: number;
  openValue: number;
  spendLookback: number;
  itemCount: number;
  currency: string;
  /** 0–100: delivery reliability first, then lead-time consistency. */
  score: number | null;
}

function supplierPerformance(input: ScmInput): Map<string, SupplierPerformance> {
  const today = dayNumber(input.today);
  const since = today - input.policy.lookbackDays;
  const result = new Map<string, SupplierPerformance>();
  for (const supplier of input.suppliers) {
    const orders = input.orders.filter(order => order.supplierId === supplier.id);
    const received = orders.filter(order => order.status === 'received' && order.receivedOn);
    const delays = received.map(order => dayNumber(order.receivedOn!) - dayNumber(order.expectedOn));
    const leadTimes = received.map(order => dayNumber(order.receivedOn!) - dayNumber(order.orderedOn));
    const open = orders.filter(order => ['approved', 'sent', 'partial'].includes(order.status));
    const value = (order: ScmPurchaseOrder, remainingOnly: boolean) => order.lines.reduce((sum, line) =>
      sum + (remainingOnly ? Math.max(0, line.quantity - line.receivedQuantity) : line.quantity) * line.unitCost, 0);
    const onTimeRate = received.length ? delays.filter(delay => delay <= 0).length / received.length : null;
    const leadTimeSd = received.length >= 3 ? standardDeviation(delays) : 0;
    let score: number | null = null;
    if (onTimeRate !== null) {
      const consistency = Math.max(0, 1 - leadTimeSd / Math.max(7, supplier.leadTimeDays));
      score = Math.round(100 * (0.7 * onTimeRate + 0.3 * consistency));
    }
    result.set(supplier.id, {
      supplierId: supplier.id, name: supplier.name, promisedLeadTime: supplier.leadTimeDays,
      samples: received.length, onTimeRate,
      averageDelay: received.length ? mean(delays) : null,
      averageLeadTime: received.length ? mean(leadTimes) : null,
      leadTimeSd,
      openOrders: open.length,
      overdueOrders: open.filter(order => dayNumber(order.expectedOn) < today).length,
      openValue: open.reduce((sum, order) => sum + value(order, true), 0),
      spendLookback: orders.filter(order => order.status !== 'cancelled' && order.status !== 'draft' && dayNumber(order.orderedOn) >= since)
        .reduce((sum, order) => sum + value(order, false), 0),
      itemCount: input.items.filter(item => item.supplierId === supplier.id && item.active).length,
      currency: supplier.currency,
      score,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Planning nodes

export type ScmHealth = 'stockout' | 'critical' | 'reorder' | 'healthy' | 'excess' | 'dead' | 'no_demand';
export type ScmSignalCode =
  | 'out_of_stock' | 'stockout_before_supply' | 'stockout_in_horizon' | 'below_reorder_point'
  | 'overdue_order' | 'draft_pending' | 'excess_stock' | 'dead_stock' | 'unreliable_supplier'
  | 'single_source' | 'transfer_available' | 'demand_rising' | 'no_supplier' | 'negative_stock' | 'no_history';
export interface ScmSignal {
  code: ScmSignalCode;
  severity: 'high' | 'medium' | 'low';
  values: Record<string, string | number>;
}

export interface ScmArrival { poId: string; poNumber: number; day: string; quantity: number; status: ScmPoStatus; overdue: boolean }

export interface ScmProjectionPoint {
  day: string;
  /** Projected on hand at end of day with confirmed supply. */
  stock: number;
  /** Same, if the proposed order is placed today. */
  planned: number;
  demand: number;
  arrivals: number;
}

export interface ScmNode {
  key: string;
  itemId: string;
  locationId: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  supplierId: string | null;
  currency: string;
  unitCost: number;
  onHand: number;
  forecast: DemandForecast;
  /** Forecast average daily demand over lead time + review period, scenario applied. */
  dailyDemand: number;
  leadTime: number;
  leadTimeSd: number;
  serviceLevel: number;
  safetyStock: number;
  reorderPoint: number;
  orderUpTo: number;
  eoq: number | null;
  /** Approved, sent and partly received supply still to arrive. */
  onOrder: number;
  /** Supply in draft orders awaiting approval. */
  inDraft: number;
  inventoryPosition: number;
  daysOfCover: number | null;
  stockoutDay: string | null;
  /** Earliest day new supply could arrive if ordered today. */
  earliestNewSupply: string;
  /** Demand the plan cannot serve even if every proposed order is placed on time. */
  shortfallUnits: number;
  /** Demand left unserved if no further order is placed. */
  idleShortfallUnits: number;
  revenueAtRisk: number;
  excessUnits: number;
  excessValue: number;
  inventoryValue: number;
  suggestedQuantity: number;
  suggestedValue: number;
  needBy: string | null;
  arrivals: ScmArrival[];
  projection: ScmProjectionPoint[];
  health: ScmHealth;
  signals: ScmSignal[];
  priority: number;
  abc: 'A' | 'B' | 'C' | null;
  xyz: 'X' | 'Y' | 'Z' | null;
  transferFrom: { locationId: string; quantity: number } | null;
}

/** Overdue orders are assumed to land this many days from today, unless the
 * supplier's history says it runs later. Never treated as already received. */
const OVERDUE_ASSUMPTION_DAYS = 3;

function roundOrder(quantity: number, moq: number, multiple: number): number {
  if (quantity <= 0) return 0;
  const base = Math.max(quantity, moq);
  const step = multiple > 0 ? multiple : 1;
  return Math.ceil(base / step - 1e-9) * step;
}

function severityScore(signals: ScmSignal[]): number {
  return signals.reduce((sum, item) => sum + (item.severity === 'high' ? 100 : item.severity === 'medium' ? 10 : 1), 0);
}

export interface ScmPlan {
  today: string;
  horizonEnd: string;
  policy: ScmPolicy;
  scenario: ScmScenario | null;
  nodes: ScmNode[];
  suppliers: SupplierPerformance[];
  proposals: ScmProposal[];
  totals: ScmTotals[];
  counts: Record<ScmHealth, number>;
  briefing: ScmBriefingLine[];
  committedThisMonth: number;
}

export interface ScmTotals {
  currency: string;
  inventoryValue: number;
  revenueAtRisk: number;
  suggestedSpend: number;
  excessValue: number;
  onOrderValue: number;
  /** Forecast demand the projected stock can serve over the horizon. */
  fillRate: number | null;
  /** Annualised cost of forecast demand ÷ inventory value. */
  turns: number | null;
}

export interface ScmProposalLine { itemId: string; sku: string; name: string; quantity: number; unitCost: number; value: number; nodeKey: string; reason: ScmHealth }
export type ScmAuthority = 'auto' | 'approval' | 'over_budget';
export interface ScmProposal {
  key: string;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  currency: string;
  lines: ScmProposalLine[];
  total: number;
  orderOn: string;
  expectedOn: string;
  needBy: string | null;
  urgent: boolean;
  authority: ScmAuthority;
}

export type ScmBriefingKind = 'stockouts' | 'critical' | 'overdue' | 'proposals' | 'excess' | 'supplier' | 'healthy' | 'demand';
export interface ScmBriefingLine { kind: ScmBriefingKind; severity: 'high' | 'medium' | 'low'; values: Record<string, string | number>; nodeKeys: string[] }

export function planScm(input: ScmInput): ScmPlan {
  const policy = input.policy;
  const scenario = input.scenario ?? null;
  const today = dayNumber(input.today);
  const horizon = policy.horizonDays;
  const review = policy.reviewDays;
  const lookback = policy.lookbackDays;
  const historyStart = today - lookback;
  const suppliers = new Map(input.suppliers.map(supplier => [supplier.id, supplier]));
  const locations = new Map(input.locations.map(location => [location.id, location]));
  const performance = supplierPerformance(input);
  const demandMultiplier = scenario?.demandMultiplier ?? 1;

  // History by node.
  const history = new Map<string, number[]>();
  for (const point of input.demand) {
    const day = dayNumber(point.day);
    if (day < historyStart || day >= today) continue;
    const key = `${point.itemId}:${point.locationId}`;
    let series = history.get(key);
    if (!series) { series = new Array(lookback).fill(0); history.set(key, series); }
    series[day - historyStart] += point.quantity;
  }

  // Nodes are every stocked item-location, every one with history, and every
  // one with an open order.
  const keys = new Set<string>();
  const onHand = new Map<string, number>();
  for (const row of input.stock) { const key = `${row.itemId}:${row.locationId}`; keys.add(key); onHand.set(key, row.onHand); }
  for (const key of history.keys()) keys.add(key);
  const openOrders = input.orders.filter(order => ['draft', 'approved', 'sent', 'partial'].includes(order.status));
  for (const order of openOrders) for (const line of order.lines) keys.add(`${line.itemId}:${order.locationId}`);
  const items = new Map(input.items.map(item => [item.id, item]));

  const nodes: ScmNode[] = [];
  for (const key of keys) {
    const [itemId, locationId] = key.split(':');
    const item = items.get(itemId);
    if (!item || !item.active || !locations.has(locationId)) continue;
    const supplier = item.supplierId ? suppliers.get(item.supplierId) ?? null : null;
    const stats = supplier ? performance.get(supplier.id) ?? null : null;
    const supplierDelay = supplier ? Math.max(0, scenario?.supplierDelays?.[supplier.id] ?? 0) : 0;
    const promised = item.leadTimeDays ?? supplier?.leadTimeDays ?? 14;
    // A supplier that habitually delivers late is planned at its real lead time.
    const lateness = stats && stats.samples >= 3 && stats.averageDelay !== null ? Math.max(0, stats.averageDelay) : 0;
    const leadTime = promised + lateness + supplierDelay;
    const leadTimeSd = stats && stats.samples >= 3 ? stats.leadTimeSd : 0;
    const serviceLevel = scenario?.serviceLevel ?? item.serviceLevel ?? policy.serviceLevel;
    const z = inverseNormal(serviceLevel);
    const fullSeries = history.get(key) ?? new Array(lookback).fill(0);
    // An item that started selling inside the window has no history before
    // its first demand, not a run of zero-demand days.
    const firstDemand = fullSeries.findIndex(value => value > 0);
    const { series, censoredDays } = uncensor(firstDemand >= 7 ? fullSeries.slice(firstDemand) : fullSeries);
    const window = Math.max(horizon, Math.ceil(leadTime + review) + 1);
    const forecast = { ...forecastDemand(series, input.today, window, item.baselineDailyDemand), censoredDays };
    const multiplier = demandMultiplier * (item.category && scenario?.categoryDemand?.[item.category] !== undefined ? scenario.categoryDemand[item.category] : 1);
    const daily = forecast.daily.map(value => value * multiplier);
    const sigma = forecast.sigma * multiplier;
    const coverWindow = Math.ceil(leadTime + review);
    const dailyDemand = mean(daily.slice(0, Math.max(1, coverWindow)));
    // Periodic review (R, s, S): orders are placed only at reviews, so an order
    // placed now must carry the item until the next order can arrive — one
    // lead time plus one review period. That is the reorder point; the order
    // brings the position up to one more review period beyond it.
    const safetyStock = z * Math.sqrt((leadTime + review) * sigma ** 2 + dailyDemand ** 2 * leadTimeSd ** 2);
    const reorderPoint = dailyDemand * (leadTime + review) + safetyStock;
    const orderUpTo = reorderPoint + dailyDemand * review;
    const annualDemand = dailyDemand * 365;
    const eoq = policy.orderingCost > 0 && item.unitCost > 0 && policy.holdingRate > 0 && annualDemand > 0
      ? Math.sqrt((2 * annualDemand * policy.orderingCost) / (policy.holdingRate * item.unitCost)) : null;

    const stockNow = onHand.get(key) ?? 0;
    const arrivals: ScmArrival[] = [];
    let inDraft = 0;
    for (const order of openOrders) {
      if (order.locationId !== locationId) continue;
      for (const line of order.lines) {
        if (line.itemId !== itemId) continue;
        const remaining = Math.max(0, line.quantity - line.receivedQuantity);
        if (remaining <= 0) continue;
        if (order.status === 'draft') { inDraft += remaining; continue; }
        const delay = Math.max(0, scenario?.supplierDelays?.[order.supplierId] ?? 0);
        const expected = dayNumber(order.expectedOn) + delay;
        const overdue = dayNumber(order.expectedOn) < today;
        const orderStats = performance.get(order.supplierId);
        const assumed = overdue ? today + Math.max(OVERDUE_ASSUMPTION_DAYS, Math.ceil(orderStats?.averageDelay ?? 0)) + delay : expected;
        arrivals.push({ poId: order.id, poNumber: order.number, day: dayString(Math.max(assumed, today + 1)), quantity: remaining, status: order.status, overdue });
      }
    }
    arrivals.sort((a, b) => a.day.localeCompare(b.day));
    const onOrder = arrivals.reduce((sum, arrival) => sum + arrival.quantity, 0);
    const inventoryPosition = stockNow + onOrder + inDraft;

    let suggested = 0;
    if (dailyDemand > 0 || stockNow < safetyStock) {
      if (inventoryPosition <= reorderPoint) {
        let quantity = orderUpTo - inventoryPosition;
        if (eoq !== null) quantity = Math.max(quantity, Math.min(eoq, dailyDemand * 120));
        suggested = roundOrder(quantity, item.moq, item.orderMultiple);
      }
    }
    const earliestNewSupply = today + Math.max(1, Math.ceil(leadTime));

    // Day-by-day projection, lost sales: stock never goes below zero and
    // unmet demand is counted as shortfall. Two paths:
    // - confirmed: only the orders already placed (what happens if nobody acts)
    // - planned: the policy is followed — drafts approved and an order placed
    //   at every review where the position falls to the reorder point. Its
    //   shortfall is what ordering alone cannot prevent.
    const projection: ScmProjectionPoint[] = [];
    const leadDays = Math.max(1, Math.ceil(leadTime));
    const pipeline = new Map<number, number>();
    for (const arrival of arrivals) { const day = dayNumber(arrival.day); pipeline.set(day, (pipeline.get(day) ?? 0) + arrival.quantity); }
    if (inDraft > 0) pipeline.set(earliestNewSupply, (pipeline.get(earliestNewSupply) ?? 0) + inDraft);
    let stock = Math.max(0, stockNow);
    let planned = stock;
    let stockout: number | null = null;
    let idleShortfall = 0;
    let shortfall = 0;
    // daily[0] is today's demand; stock on hand is what today starts with.
    for (let h = 0; h < horizon; h++) {
      const day = today + h;
      const dayDemand = daily[h] ?? dailyDemand;
      if (h % review === 0) {
        let incoming = 0;
        for (const [arrivalDay, quantity] of pipeline) if (arrivalDay > day) incoming += quantity;
        const position = planned + incoming;
        if (h === 0 && suggested > 0) pipeline.set(earliestNewSupply, (pipeline.get(earliestNewSupply) ?? 0) + suggested);
        else if (h > 0 && dailyDemand > 0 && position <= reorderPoint) {
          let quantity = orderUpTo - position;
          if (eoq !== null) quantity = Math.max(quantity, Math.min(eoq, dailyDemand * 120));
          const rounded = roundOrder(quantity, item.moq, item.orderMultiple);
          if (rounded > 0) pipeline.set(day + leadDays, (pipeline.get(day + leadDays) ?? 0) + rounded);
        }
      }
      const dayArrivals = arrivals.filter(arrival => dayNumber(arrival.day) === day).reduce((sum, arrival) => sum + arrival.quantity, 0);
      const next = stock + dayArrivals - dayDemand;
      if (next < 0) { idleShortfall += -next; if (stockout === null) stockout = day; }
      stock = Math.max(0, next);
      const plannedNext = planned + (pipeline.get(day) ?? 0) - dayDemand;
      if (plannedNext < 0) shortfall += -plannedNext;
      planned = Math.max(0, plannedNext);
      projection.push({ day: dayString(day), stock: round2(stock), planned: round2(planned), demand: round2(dayDemand), arrivals: dayArrivals });
    }
    // Days until stock runs out, counting only what is on hand.
    let daysOfCover: number | null = null;
    if (dailyDemand > 0) {
      let remaining = Math.max(0, stockNow);
      daysOfCover = 0;
      for (let h = 0; h < daily.length && remaining > 0; h++) {
        const need = daily[h];
        if (need >= remaining) { daysOfCover += need > 0 ? remaining / need : 0; remaining = 0; break; }
        remaining -= need;
        daysOfCover += 1;
      }
      if (remaining > 0) daysOfCover += remaining / dailyDemand;
    }

    const lookbackOutflow = forecast.historyTotal;
    const excessThreshold = orderUpTo + dailyDemand * 60;
    // Only an item that has been around for the whole history window can be
    // judged dead; a new one simply has no history yet.
    const established = !item.createdAt || dayNumber(item.createdAt.slice(0, 10)) <= historyStart;
    const dead = established && stockNow > 0 && lookbackOutflow <= 0 && (item.baselineDailyDemand ?? 0) <= 0;
    const excessUnits = dead ? stockNow : dailyDemand > 0 ? Math.max(0, inventoryPosition - excessThreshold) : 0;

    const signals: ScmSignal[] = [];
    if (stockNow < 0) signals.push({ code: 'negative_stock', severity: 'high', values: { onHand: round2(stockNow) } });
    if (stockNow <= 0 && dailyDemand > 0) signals.push({ code: 'out_of_stock', severity: 'high', values: { dailyDemand: round2(dailyDemand) } });
    else if (stockout !== null && stockout < earliestNewSupply) {
      // If an order already placed lands before a new one could, pulling it
      // forward is the cheapest fix; name it.
      const rescue = arrivals.find(arrival => dayNumber(arrival.day) > stockout! && dayNumber(arrival.day) < earliestNewSupply);
      signals.push(rescue
        ? { code: 'stockout_before_supply', severity: 'high', values: { day: dayString(stockout), earliest: dayString(earliestNewSupply), units: Math.ceil(Math.max(shortfall, 1)), po: rescue.poNumber, poDay: rescue.day, days: dayNumber(rescue.day) - stockout } }
        : { code: 'stockout_before_supply', severity: 'high', values: { day: dayString(stockout), earliest: dayString(earliestNewSupply), units: Math.ceil(Math.max(shortfall, 1)) } });
    } else if (stockout !== null && suggested > 0) {
      // Later stockouts are what the normal ordering cycle prevents; only an
      // order due now makes one worth flagging.
      signals.push({ code: 'stockout_in_horizon', severity: 'medium', values: { day: dayString(stockout), units: Math.ceil(idleShortfall) } });
    }
    if (suggested > 0 && inventoryPosition <= reorderPoint) signals.push({ code: 'below_reorder_point', severity: 'medium', values: { position: round2(inventoryPosition), reorderPoint: round2(reorderPoint), quantity: suggested } });
    for (const arrival of arrivals.filter(item => item.overdue)) signals.push({ code: 'overdue_order', severity: 'high', values: { po: arrival.poNumber, quantity: arrival.quantity, assumed: arrival.day } });
    if (inDraft > 0) signals.push({ code: 'draft_pending', severity: 'low', values: { quantity: inDraft } });
    if (dead) signals.push({ code: 'dead_stock', severity: 'low', values: { onHand: stockNow, value: Math.round(stockNow * item.unitCost), days: lookback } });
    else if (excessUnits > 0) signals.push({ code: 'excess_stock', severity: 'low', values: { units: Math.round(excessUnits), value: Math.round(excessUnits * item.unitCost), cover: daysOfCover === null ? 0 : Math.round(daysOfCover) } });
    if (!established && lookbackOutflow <= 0 && dailyDemand <= 0) signals.push({ code: 'no_history', severity: 'low', values: {} });
    if (!supplier) signals.push({ code: 'no_supplier', severity: dailyDemand > 0 ? 'medium' : 'low', values: {} });
    if (stats && stats.onTimeRate !== null && stats.samples >= 3 && stats.onTimeRate < 0.8 && dailyDemand > 0 && (suggested > 0 || (stockout !== null && stockout < earliestNewSupply) || arrivals.some(arrival => arrival.overdue))) {
      signals.push({ code: 'unreliable_supplier', severity: 'medium', values: { supplier: stats.name, onTime: Math.round(stats.onTimeRate * 100), delay: Math.round((stats.averageDelay ?? 0) * 10) / 10 } });
    }
    if (forecast.historyDays >= 28 && forecast.trendPerDay > 0 && forecast.average > 0) {
      const recent = mean(series.slice(-14));
      const prior = mean(series.slice(-56, -14));
      if (prior > 0 && recent / prior >= 1.25) signals.push({ code: 'demand_rising', severity: 'medium', values: { change: Math.round((recent / prior - 1) * 100) } });
    }

    let health: ScmHealth;
    if (stockNow <= 0 && dailyDemand > 0) health = 'stockout';
    else if (stockout !== null && stockout < earliestNewSupply) health = 'critical';
    else if (suggested > 0) health = 'reorder';
    else if (dead) health = 'dead';
    else if (excessUnits > 0) health = 'excess';
    else if (dailyDemand <= 0) health = 'no_demand';
    else health = 'healthy';

    const price = item.unitPrice ?? item.unitCost;
    nodes.push({
      key, itemId, locationId, sku: item.sku, name: item.name, unit: item.unit, category: item.category,
      supplierId: item.supplierId, currency: item.currency, unitCost: item.unitCost,
      onHand: stockNow, forecast: { ...forecast, daily: daily.slice(0, horizon) }, dailyDemand,
      leadTime, leadTimeSd, serviceLevel, safetyStock, reorderPoint, orderUpTo, eoq,
      onOrder, inDraft, inventoryPosition, daysOfCover,
      stockoutDay: stockout === null ? null : dayString(stockout), earliestNewSupply: dayString(earliestNewSupply),
      shortfallUnits: shortfall, idleShortfallUnits: idleShortfall, revenueAtRisk: shortfall * price,
      excessUnits, excessValue: excessUnits * item.unitCost, inventoryValue: Math.max(0, stockNow) * item.unitCost,
      suggestedQuantity: suggested, suggestedValue: suggested * item.unitCost,
      needBy: stockout === null ? null : dayString(stockout),
      arrivals, projection, health, signals, priority: 0, abc: null, xyz: null, transferFrom: null,
    });
  }

  // Lateral transfers: another location's stock above what it needs through
  // its own lead time can cover a gap that a new order cannot reach in time.
  for (const node of nodes) {
    if (node.health !== 'critical' && node.health !== 'stockout') continue;
    const need = Math.ceil(Math.max(node.shortfallUnits, node.safetyStock - Math.max(0, node.onHand)));
    if (need <= 0) continue;
    let best: { locationId: string; quantity: number } | null = null;
    for (const other of nodes) {
      if (other.itemId !== node.itemId || other.key === node.key) continue;
      const spare = Math.floor(other.onHand - other.reorderPoint);
      if (spare > 0 && (!best || spare > best.quantity)) best = { locationId: other.locationId, quantity: Math.min(spare, need) };
    }
    if (best) {
      node.transferFrom = best;
      node.signals.push({ code: 'transfer_available', severity: 'medium', values: { location: locations.get(best.locationId)?.name ?? '', quantity: best.quantity } });
    }
  }

  // ABC by annual consumption value, XYZ by weekly demand variability, per item.
  const byItem = new Map<string, { value: number; weekly: number[] }>();
  for (const node of nodes) {
    const entry = byItem.get(node.itemId) ?? { value: 0, weekly: [] };
    entry.value += node.dailyDemand * 365 * node.unitCost;
    const series = history.get(node.key) ?? [];
    const weeks = Math.floor(series.length / 7);
    for (let w = 0; w < weeks; w++) {
      const start = series.length - (w + 1) * 7;
      entry.weekly[w] = (entry.weekly[w] ?? 0) + series.slice(start, start + 7).reduce((sum, value) => sum + value, 0);
    }
    byItem.set(node.itemId, entry);
  }
  const ranked = [...byItem.entries()].filter(([, entry]) => entry.value > 0).sort((a, b) => b[1].value - a[1].value);
  const totalValue = ranked.reduce((sum, [, entry]) => sum + entry.value, 0);
  const abc = new Map<string, 'A' | 'B' | 'C'>();
  let cumulative = 0;
  for (const [itemId, entry] of ranked) {
    const before = cumulative / totalValue;
    cumulative += entry.value;
    abc.set(itemId, before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C');
  }
  const xyz = new Map<string, 'X' | 'Y' | 'Z'>();
  for (const [itemId, entry] of byItem) {
    const weekly = entry.weekly.filter(value => value !== undefined);
    const average = mean(weekly);
    if (weekly.length < 4 || average <= 0) continue;
    const cv = standardDeviation(weekly) / average;
    xyz.set(itemId, cv < 0.5 ? 'X' : cv < 1 ? 'Y' : 'Z');
  }
  for (const node of nodes) {
    node.abc = abc.get(node.itemId) ?? null;
    node.xyz = xyz.get(node.itemId) ?? null;
    const supplierCount = node.supplierId ? 1 : 0;
    if (node.abc === 'A' && supplierCount === 1 && node.supplierId && ['stockout', 'critical', 'reorder'].includes(node.health)) {
      const stats = performance.get(node.supplierId);
      if (stats && stats.onTimeRate !== null && stats.onTimeRate < 0.9) {
        node.signals.push({ code: 'single_source', severity: 'low', values: { supplier: stats.name } });
      }
    }
    // A-class items weigh more within the same severity.
    node.priority = severityScore(node.signals) * (node.abc === 'A' ? 1.5 : node.abc === 'B' ? 1.2 : 1) + node.revenueAtRisk / 1e9;
  }
  nodes.sort((a, b) => b.priority - a.priority || a.sku.localeCompare(b.sku));

  // Group proposals into purchase orders per supplier and location.
  const monthStart = dayString(today - (new Date(today * DAY_MS).getUTCDate() - 1));
  const committedThisMonth = input.orders
    .filter(order => order.currency === policy.currency && !['draft', 'cancelled'].includes(order.status) && order.orderedOn >= monthStart && order.orderedOn <= input.today)
    .reduce((sum, order) => sum + order.lines.reduce((total, line) => total + line.quantity * line.unitCost, 0), 0);
  const groups = new Map<string, ScmProposal>();
  for (const node of nodes) {
    if (node.suggestedQuantity <= 0 || !node.supplierId) continue;
    const supplier = suppliers.get(node.supplierId);
    if (!supplier) continue;
    const key = `${supplier.id}:${node.locationId}`;
    const group = groups.get(key) ?? {
      key, supplierId: supplier.id, supplierName: supplier.name, locationId: node.locationId,
      locationName: locations.get(node.locationId)?.name ?? '', currency: node.currency, lines: [], total: 0,
      orderOn: input.today, expectedOn: input.today, needBy: null, urgent: false, authority: 'approval' as ScmAuthority,
    };
    group.lines.push({ itemId: node.itemId, sku: node.sku, name: node.name, quantity: node.suggestedQuantity, unitCost: node.unitCost, value: node.suggestedValue, nodeKey: node.key, reason: node.health });
    group.total += node.suggestedValue;
    if (node.earliestNewSupply > group.expectedOn) group.expectedOn = node.earliestNewSupply;
    if (node.needBy && (!group.needBy || node.needBy < group.needBy)) group.needBy = node.needBy;
    group.urgent ||= node.health === 'critical' || node.health === 'stockout';
    groups.set(key, group);
  }
  const proposals = [...groups.values()].sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.needBy ?? '9999').localeCompare(b.needBy ?? '9999') || b.total - a.total);
  let budgetUsed = committedThisMonth;
  for (const proposal of proposals) {
    const withinBudget = policy.monthlyBudget === null || proposal.currency !== policy.currency || budgetUsed + proposal.total <= policy.monthlyBudget;
    if (!withinBudget) proposal.authority = 'over_budget';
    // A limit of zero grants no authority, and an order with no value is never "within" it.
    else if (proposal.currency === policy.currency && policy.autoApproveLimit > 0 && proposal.total > 0 && proposal.total <= policy.autoApproveLimit) proposal.authority = 'auto';
    else proposal.authority = 'approval';
    if (withinBudget && proposal.currency === policy.currency) budgetUsed += proposal.total;
  }

  const totalList = summarizeNodes(nodes);

  const counts = countHealth(nodes);

  const plan: ScmPlan = {
    today: input.today, horizonEnd: dayString(today + horizon - 1), policy, scenario, nodes,
    suppliers: [...performance.values()].sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.name.localeCompare(b.name)),
    proposals, totals: totalList, counts, briefing: [], committedThisMonth,
  };
  plan.briefing = briefing(plan);
  return plan;
}

/** Totals per currency over any subset of nodes (e.g. one location). */
export function summarizeNodes(nodes: ScmNode[]): ScmTotals[] {
  const totals = new Map<string, ScmTotals & { demand: number; served: number; annualCost: number }>();
  for (const node of nodes) {
    const total = totals.get(node.currency) ?? { currency: node.currency, inventoryValue: 0, revenueAtRisk: 0, suggestedSpend: 0, excessValue: 0, onOrderValue: 0, fillRate: null, turns: null, demand: 0, served: 0, annualCost: 0 };
    total.inventoryValue += node.inventoryValue;
    total.revenueAtRisk += node.revenueAtRisk;
    total.suggestedSpend += node.suggestedValue;
    total.excessValue += node.excessValue;
    total.onOrderValue += node.onOrder * node.unitCost;
    const demand = node.projection.reduce((sum, point) => sum + point.demand, 0);
    total.demand += demand;
    total.served += Math.max(0, demand - node.shortfallUnits);
    total.annualCost += node.dailyDemand * 365 * node.unitCost;
    totals.set(node.currency, total);
  }
  return [...totals.values()].map(({ demand, served, annualCost, ...total }) => ({
    ...total,
    fillRate: demand > 0 ? served / demand : null,
    turns: total.inventoryValue > 0 ? annualCost / total.inventoryValue : null,
  })).sort((a, b) => a.currency.localeCompare(b.currency));
}

export function countHealth(nodes: ScmNode[]): Record<ScmHealth, number> {
  const counts: Record<ScmHealth, number> = { stockout: 0, critical: 0, reorder: 0, healthy: 0, excess: 0, dead: 0, no_demand: 0 };
  for (const node of nodes) counts[node.health] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Briefing — the few things a planner should know this morning, with the
// nodes behind each line so the reader can open the evidence.

function briefing(plan: ScmPlan): ScmBriefingLine[] {
  const lines: ScmBriefingLine[] = [];
  const of = (health: ScmHealth) => plan.nodes.filter(node => node.health === health);
  const stockouts = of('stockout');
  const critical = of('critical');
  if (stockouts.length) lines.push({ kind: 'stockouts', severity: 'high', values: { count: stockouts.length, first: stockouts[0].name }, nodeKeys: stockouts.map(node => node.key) });
  if (critical.length) {
    const first = [...critical].sort((a, b) => (a.stockoutDay ?? '').localeCompare(b.stockoutDay ?? ''))[0];
    const transfers = critical.filter(node => node.transferFrom).length;
    lines.push({ kind: 'critical', severity: 'high', values: { count: critical.length, first: first.name, day: first.stockoutDay ?? '', transfers }, nodeKeys: critical.map(node => node.key) });
  }
  const overdue = plan.suppliers.filter(supplier => supplier.overdueOrders > 0);
  if (overdue.length) lines.push({ kind: 'overdue', severity: 'high', values: { count: overdue.reduce((sum, supplier) => sum + supplier.overdueOrders, 0), suppliers: overdue.map(supplier => supplier.name).join(', ') }, nodeKeys: plan.nodes.filter(node => node.arrivals.some(arrival => arrival.overdue)).map(node => node.key) });
  if (plan.proposals.length) {
    const byCurrency = new Map<string, number>();
    for (const proposal of plan.proposals) byCurrency.set(proposal.currency, (byCurrency.get(proposal.currency) ?? 0) + proposal.total);
    const auto = plan.proposals.filter(proposal => proposal.authority === 'auto').length;
    lines.push({ kind: 'proposals', severity: 'medium', values: { count: plan.proposals.length, lines: plan.proposals.reduce((sum, proposal) => sum + proposal.lines.length, 0), amount: [...byCurrency.entries()].map(([currency, value]) => `${currency} ${Math.round(value).toLocaleString('en-US')}`).join(' + '), auto, approval: plan.proposals.length - auto }, nodeKeys: plan.proposals.flatMap(proposal => proposal.lines.map(line => line.nodeKey)) });
  }
  const rising = plan.nodes.filter(node => node.signals.some(signal => signal.code === 'demand_rising'));
  if (rising.length) lines.push({ kind: 'demand', severity: 'medium', values: { count: rising.length, first: rising[0].name }, nodeKeys: rising.map(node => node.key) });
  const unreliable = plan.suppliers.filter(supplier => supplier.samples >= 3 && supplier.onTimeRate !== null && supplier.onTimeRate < 0.8);
  if (unreliable.length) lines.push({ kind: 'supplier', severity: 'medium', values: { name: unreliable[0].name, onTime: Math.round((unreliable[0].onTimeRate ?? 0) * 100), delay: Math.round((unreliable[0].averageDelay ?? 0) * 10) / 10, count: unreliable.length }, nodeKeys: plan.nodes.filter(node => unreliable.some(supplier => supplier.supplierId === node.supplierId)).map(node => node.key) });
  const excess = plan.nodes.filter(node => node.health === 'excess' || node.health === 'dead');
  if (excess.length) {
    const byCurrency = new Map<string, number>();
    for (const node of excess) byCurrency.set(node.currency, (byCurrency.get(node.currency) ?? 0) + node.excessValue);
    const amount = [...byCurrency.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([currency, value]) => `${currency} ${Math.round(value).toLocaleString('en-US')}`).join(' + ');
    lines.push({ kind: 'excess', severity: 'low', values: { count: excess.length, amount }, nodeKeys: excess.map(node => node.key) });
  }
  if (!lines.some(line => line.severity === 'high') && plan.nodes.length) {
    lines.unshift({ kind: 'healthy', severity: 'low', values: { count: plan.counts.healthy, total: plan.nodes.length }, nodeKeys: [] });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Scenario comparison

export interface ScmScenarioDelta {
  newlyAtRisk: { key: string; name: string; locationId: string; stockoutDay: string | null }[];
  resolved: { key: string; name: string; locationId: string }[];
  baseline: { atRisk: number; revenueAtRisk: Record<string, number>; suggestedSpend: Record<string, number>; fillRate: Record<string, number | null> };
  scenario: { atRisk: number; revenueAtRisk: Record<string, number>; suggestedSpend: Record<string, number>; fillRate: Record<string, number | null> };
}

const atRisk = (node: ScmNode) => node.health === 'stockout' || node.health === 'critical';

export function compareScenario(baseline: ScmPlan, scenario: ScmPlan): ScmScenarioDelta {
  const before = new Map(baseline.nodes.map(node => [node.key, node]));
  const after = new Map(scenario.nodes.map(node => [node.key, node]));
  const summarize = (plan: ScmPlan) => ({
    atRisk: plan.nodes.filter(atRisk).length,
    revenueAtRisk: Object.fromEntries(plan.totals.map(total => [total.currency, Math.round(total.revenueAtRisk)])),
    suggestedSpend: Object.fromEntries(plan.totals.map(total => [total.currency, Math.round(total.suggestedSpend)])),
    fillRate: Object.fromEntries(plan.totals.map(total => [total.currency, total.fillRate])),
  });
  return {
    newlyAtRisk: scenario.nodes.filter(node => atRisk(node) && !atRisk(before.get(node.key) ?? node))
      .map(node => ({ key: node.key, name: node.name, locationId: node.locationId, stockoutDay: node.stockoutDay })),
    resolved: baseline.nodes.filter(node => atRisk(node) && after.get(node.key) && !atRisk(after.get(node.key)!))
      .map(node => ({ key: node.key, name: node.name, locationId: node.locationId })),
    baseline: summarize(baseline),
    scenario: summarize(scenario),
  };
}
