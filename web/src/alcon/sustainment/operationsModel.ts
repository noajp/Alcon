import type { DataTableSchema } from '@/alcon/table/data';
import type { DataTableColumnType } from '@/types/database';

export type OperationsKind = 'crm' | 'scm';
export interface OperationsParams extends Record<string, unknown> {
  kind: OperationsKind;
  tableId: string | null;
  fields: Record<string, string>;
  horizonDays: number;
  demandMultiplier: number;
  followUpDays: number;
}

export interface OperationsField {
  key: string;
  label: string;
  type: DataTableColumnType;
  allowedTypes: DataTableColumnType[];
  required: boolean;
}

const field = (key: string, label: string, type: DataTableColumnType, required = true): OperationsField => ({
  key, label, type, required, allowedTypes: type === 'text' ? ['text', 'select'] : [type],
});

export const OPERATIONS_FIELDS: Record<OperationsKind, OperationsField[]> = {
  crm: [
    field('name', 'Opportunity', 'text'), field('account', 'Account', 'text', false),
    field('stage', 'Stage (open / won / lost)', 'text'), field('amount', 'Amount', 'number'),
    field('probability', 'Probability (%)', 'number'), field('closeDate', 'Close date', 'date'),
    field('lastContact', 'Last contact', 'date', false), field('nextActionDate', 'Next action date', 'date', false),
    field('currency', 'Currency', 'text'),
  ],
  scm: [
    field('name', 'Item / SKU', 'text'), field('supplier', 'Supplier', 'text', false),
    field('onHand', 'On hand', 'number'), field('dailyDemand', 'Daily demand', 'number'),
    field('leadTimeDays', 'Lead time (days)', 'number'), field('safetyStock', 'Safety stock', 'number'),
    field('onOrder', 'On order', 'number'), field('arrivalDate', 'Expected arrival', 'date', false),
    field('unitCost', 'Unit cost', 'number'), field('currency', 'Currency', 'text'),
  ],
};

const objectValue = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function bounded(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? integer ? Math.floor(value) : value : fallback;
}

export function normalizeOperationsParams(raw: unknown): OperationsParams {
  const value = objectValue(raw);
  const kind: OperationsKind = value.kind === 'scm' ? 'scm' : 'crm';
  const mappings = objectValue(value.fields);
  const fields: Record<string, string> = {};
  for (const definition of OPERATIONS_FIELDS[kind]) {
    const id = mappings[definition.key];
    if (typeof id === 'string' && id.trim()) fields[definition.key] = id.trim();
  }
  return {
    kind, tableId: typeof value.tableId === 'string' && value.tableId.trim() ? value.tableId.trim() : null,
    fields, horizonDays: bounded(value.horizonDays, 30, 1, 3650, true),
    demandMultiplier: bounded(value.demandMultiplier, 1, 0, 100),
    followUpDays: bounded(value.followUpDays, 14, 1, 3650, true),
  };
}

export interface OperationsSignal {
  code: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
}

interface OperationsRow {
  rowId: string;
  name: string;
  valid: boolean;
  issues: string[];
  signals: OperationsSignal[];
  priority: number;
}

export interface CRMRowAnalysis extends OperationsRow {
  account: string | null;
  stage: 'open' | 'won' | 'lost' | null;
  amount: number | null;
  probability: number | null;
  weightedAmount: number | null;
  currency: string | null;
  closeDate: string | null;
  lastContact: string | null;
  nextActionDate: string | null;
}

export interface SCMRowAnalysis extends OperationsRow {
  supplier: string | null;
  onHand: number | null;
  dailyDemand: number | null;
  effectiveDailyDemand: number | null;
  leadTimeDays: number | null;
  safetyStock: number | null;
  onOrder: number | null;
  arrivalDate: string | null;
  unitCost: number | null;
  currency: string | null;
  daysCover: number | null;
  reorderPoint: number | null;
  targetStock: number | null;
  projectedStock: number | null;
  recommendedOrder: number | null;
  orderCost: number | null;
  stockoutBeforeArrival: boolean;
  shortageBeforeArrival: number | null;
}

export interface CRMCurrencyTotals {
  currency: string;
  pipeline: number;
  weightedPipeline: number;
  forecast: number;
  won: number;
  openCount: number;
}

export interface SCMCurrencyTotals {
  currency: string;
  recommendedSpend: number;
  itemCount: number;
}

interface AnalysisSummary {
  today: string;
  horizonEnd: string;
  issues: string[];
  validCount: number;
  excludedCount: number;
  riskCount: number;
}

export interface CRMAnalysis extends AnalysisSummary {
  kind: 'crm';
  rows: CRMRowAnalysis[];
  totals: CRMCurrencyTotals[];
}

export interface SCMAnalysis extends AnalysisSummary {
  kind: 'scm';
  rows: SCMRowAnalysis[];
  totals: SCMCurrencyTotals[];
}

export type OperationsAnalysis = CRMAnalysis | SCMAnalysis;

const DAY_MS = 86_400_000;
/** UTC date-only arithmetic avoids daylight-saving and viewer-timezone drift. */
function dayNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / DAY_MS : null;
}

function addDays(day: number, days: number): string {
  return new Date((day + days) * DAY_MS).toISOString().slice(0, 10);
}

function signal(code: string, severity: OperationsSignal['severity'], message: string): OperationsSignal {
  return { code, severity, message };
}

function priority(signals: OperationsSignal[], valid: boolean): number {
  if (!valid) return 1000;
  return signals.reduce((score, item) => score + (item.severity === 'high' ? 100 : item.severity === 'medium' ? 10 : 1), 0);
}

function rowReader(schema: DataTableSchema, params: OperationsParams, rowId: string) {
  const issues: string[] = [];
  const definitions = new Map(OPERATIONS_FIELDS[params.kind].map(item => [item.key, item]));
  const columns = new Map(schema.columns.map(column => [column.id, column]));
  const label = (key: string) => definitions.get(key)?.label ?? key;
  const value = (key: string) => {
    const id = params.fields[key];
    const column = columns.get(id);
    const definition = definitions.get(key);
    return column && definition?.allowedTypes.includes(column.type) ? schema.cellsByRow[rowId]?.[id] : undefined;
  };
  const missing = (input: unknown) => input === null || input === undefined || (typeof input === 'string' && !input.trim());
  const text = (key: string, required = true): string | null => {
    const input = value(key);
    if (missing(input)) { if (required) issues.push(`${label(key)} is missing.`); return null; }
    if (typeof input !== 'string') { issues.push(`${label(key)} must be text.`); return null; }
    return input.trim();
  };
  const number = (key: string, required = true, maximum = Number.MAX_SAFE_INTEGER): number | null => {
    const input = value(key);
    if (missing(input)) { if (required) issues.push(`${label(key)} is missing.`); return null; }
    // Number(''), Number(null), booleans, and numeric-looking text are deliberately rejected.
    if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > maximum) {
      issues.push(`${label(key)} must be a finite number from 0 to ${maximum}.`); return null;
    }
    return input;
  };
  const date = (key: string, required = false): string | null => {
    const input = value(key);
    if (missing(input)) { if (required) issues.push(`${label(key)} is missing.`); return null; }
    if (dayNumber(input) === null) { issues.push(`${label(key)} must be a valid YYYY-MM-DD date.`); return null; }
    return input as string;
  };
  const currency = (): string | null => {
    const input = text('currency');
    if (!input) return null;
    if (!/^[A-Za-z]{3}$/.test(input)) { issues.push('Currency must be a three-letter code, such as USD or JPY.'); return null; }
    return input.toUpperCase();
  };
  return { issues, text, number, date, currency };
}

function schemaIssues(schema: DataTableSchema, params: OperationsParams): string[] {
  const columns = new Map(schema.columns.map(column => [column.id, column]));
  return OPERATIONS_FIELDS[params.kind].flatMap(definition => {
    const id = params.fields[definition.key];
    if (!id) return definition.required ? [`Map a column for ${definition.label}.`] : [];
    const column = columns.get(id);
    if (!column) return [`The mapped column for ${definition.label} no longer exists.`];
    return definition.allowedTypes.includes(column.type) ? [] : [`${definition.label} requires a ${definition.allowedTypes.join(' or ')} column.`];
  });
}

function summary(rows: OperationsRow[], today: string, horizonEnd: string, issues: string[]): AnalysisSummary {
  return {
    today, horizonEnd, issues,
    validCount: rows.filter(row => row.valid).length,
    excludedCount: rows.filter(row => !row.valid).length,
    riskCount: rows.filter(row => row.valid && row.signals.some(item => item.severity !== 'low')).length,
  };
}

export function analyzeOperations(schema: DataTableSchema, rawParams: OperationsParams, today: string): OperationsAnalysis {
  const params = normalizeOperationsParams(rawParams);
  const day = dayNumber(today);
  if (day === null) throw new Error('Analysis date must be a valid YYYY-MM-DD date.');
  const horizonEnd = addDays(day, params.horizonDays);
  const issues = schemaIssues(schema, params);
  if (params.kind === 'crm') {
    const rows = schema.rows.map((row, index): CRMRowAnalysis => {
      const read = rowReader(schema, params, row.id);
      const name = read.text('name') ?? `Row ${index + 1}`;
      const account = read.text('account', false);
      const stageValue = read.text('stage');
      const stage = stageValue === 'open' || stageValue === 'won' || stageValue === 'lost' ? stageValue : null;
      if (stageValue && !stage) read.issues.push('Stage must be open, won, or lost.');
      const amount = read.number('amount');
      const probability = read.number('probability', stage === 'open', 100);
      const currency = read.currency();
      const closeDate = read.date('closeDate', stage === 'open');
      const lastContact = read.date('lastContact');
      const nextActionDate = read.date('nextActionDate');
      if (lastContact && dayNumber(lastContact)! > day) read.issues.push('Last contact cannot be in the future.');
      const valid = read.issues.length === 0;
      const signals: OperationsSignal[] = [];
      const weightedAmount = valid && stage === 'open' && amount !== null && probability !== null ? amount * (probability / 100) : null;
      if (valid && stage === 'open') {
        if (closeDate && dayNumber(closeDate)! < day) signals.push(signal('close_overdue', 'high', `Close date ${closeDate} has passed; confirm the outcome or revise the date.`));
        if (!nextActionDate) signals.push(signal('next_action_missing', 'medium', 'No next action is scheduled; agree the next contact and date.'));
        else if (dayNumber(nextActionDate)! < day) signals.push(signal('next_action_overdue', 'high', `Next action was due ${nextActionDate}; follow up and update the plan.`));
        else if (nextActionDate === today) signals.push(signal('next_action_today', 'medium', 'Next action is due today.'));
        if (!lastContact) signals.push(signal('contact_missing', 'medium', 'Last contact is missing; verify the relationship status.'));
        else if (day - dayNumber(lastContact)! >= params.followUpDays) signals.push(signal('contact_stale', 'medium', `${day - dayNumber(lastContact)!} days since contact (threshold ${params.followUpDays}); confirm progress.`));
      }
      return { rowId: row.id, name, account, stage, amount, probability, weightedAmount, currency, closeDate, lastContact, nextActionDate, valid, issues: read.issues, signals, priority: priority(signals, valid) };
    });
    const totals = new Map<string, CRMCurrencyTotals>();
    for (const row of rows) {
      if (!row.valid || !row.currency || row.amount === null || row.stage === 'lost') continue;
      const total = totals.get(row.currency) ?? { currency: row.currency, pipeline: 0, weightedPipeline: 0, forecast: 0, won: 0, openCount: 0 };
      if (row.stage === 'won') total.won += row.amount;
      if (row.stage === 'open' && row.weightedAmount !== null) {
        total.pipeline += row.amount;
        total.weightedPipeline += row.weightedAmount;
        total.openCount += 1;
        if (row.closeDate && row.closeDate >= today && row.closeDate <= horizonEnd) total.forecast += row.weightedAmount;
      }
      totals.set(row.currency, total);
    }
    rows.sort((a, b) => b.priority - a.priority);
    return { kind: 'crm', rows, totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)), ...summary(rows, today, horizonEnd, issues) };
  }

  const rows = schema.rows.map((row, index): SCMRowAnalysis => {
    const read = rowReader(schema, params, row.id);
    const name = read.text('name') ?? `Row ${index + 1}`;
    const supplier = read.text('supplier', false);
    const onHand = read.number('onHand');
    const dailyDemand = read.number('dailyDemand');
    const leadTimeDays = read.number('leadTimeDays');
    const safetyStock = read.number('safetyStock');
    const onOrder = read.number('onOrder');
    const arrivalDate = read.date('arrivalDate', onOrder !== null && onOrder > 0);
    const unitCost = read.number('unitCost');
    const currency = read.currency();
    let effectiveDailyDemand: number | null = null;
    let daysCover: number | null = null;
    let reorderPoint: number | null = null;
    let targetStock: number | null = null;
    let projectedStock: number | null = null;
    let recommendedOrder: number | null = null;
    let orderCost: number | null = null;
    let stockoutBeforeArrival = false;
    let shortageBeforeArrival: number | null = null;
    const signals: OperationsSignal[] = [];
    if (!read.issues.length && onHand !== null && dailyDemand !== null && leadTimeDays !== null && safetyStock !== null && onOrder !== null && unitCost !== null) {
      effectiveDailyDemand = dailyDemand * params.demandMultiplier;
      daysCover = effectiveDailyDemand > 0 ? onHand / effectiveDailyDemand : null;
      reorderPoint = effectiveDailyDemand * leadTimeDays + safetyStock;
      const targetDays = Math.max(params.horizonDays, leadTimeDays);
      targetStock = effectiveDailyDemand * targetDays + safetyStock;
      const arrivalDays = arrivalDate ? dayNumber(arrivalDate)! - day : null;
      // Unreceived overdue orders are not available stock. Future supply only counts
      // in the relevant window, and the pre-arrival gap is assessed independently.
      const incomingInWindow = (days: number) => arrivalDays !== null && arrivalDays >= 0 && arrivalDays <= days ? onOrder : 0;
      const stockDuringLeadTime = onHand + incomingInWindow(leadTimeDays);
      projectedStock = onHand + incomingInWindow(params.horizonDays) - effectiveDailyDemand * params.horizonDays;
      recommendedOrder = Math.ceil(Math.max(0, targetStock - onHand - incomingInWindow(targetDays)));
      orderCost = recommendedOrder * unitCost;
      if (onOrder > 0 && arrivalDays !== null) {
        if (arrivalDays < 0) signals.push(signal('supply_overdue', 'high', `Expected arrival ${arrivalDate} has passed. The ${onOrder} unreceived units are excluded from available supply.`));
        else {
          shortageBeforeArrival = Math.max(0, effectiveDailyDemand * arrivalDays - onHand);
          stockoutBeforeArrival = shortageBeforeArrival > 0;
          if (stockoutBeforeArrival) signals.push(signal('stockout_before_arrival', 'high', `Current stock runs out before arrival ${arrivalDate}; expedite or bridge ${Math.ceil(shortageBeforeArrival)} units of demand.`));
        }
        if (arrivalDays > params.horizonDays) signals.push(signal('supply_after_horizon', 'medium', `Arrival ${arrivalDate} is outside the ${params.horizonDays}-day horizon and is excluded from projected stock.`));
      }
      if (effectiveDailyDemand === 0) signals.push(signal('zero_demand', 'low', 'Scenario demand is zero; days of cover has no finite value. Replenishment only covers the safety stock target.'));
      if (stockDuringLeadTime < effectiveDailyDemand * leadTimeDays) signals.push(signal('lead_time_gap', 'high', `Current stock and supply arriving within ${leadTimeDays} lead-time days cannot cover demand; arrange an expedited order or reduce demand.`));
      else if (stockDuringLeadTime <= reorderPoint && effectiveDailyDemand > 0) signals.push(signal('reorder_point', 'medium', `Current stock plus supply arriving within lead time (${stockDuringLeadTime}) is at or below reorder point ${reorderPoint} (scenario daily demand × lead time + safety stock).`));
      if (projectedStock < 0) signals.push(signal('horizon_shortage', 'high', `Projected stock is ${projectedStock} after ${params.horizonDays} days; timely replenishment is required.`));
      else if (projectedStock < safetyStock) signals.push(signal('safety_stock_gap', 'medium', `Projected stock ${projectedStock} is below safety stock ${safetyStock}.`));
      if (recommendedOrder > 0) signals.push(signal('replenish', 'medium', `Plan ${recommendedOrder} units to cover ${targetDays} days plus safety stock, less current stock and supply arriving within that window.`));
      const computed = [effectiveDailyDemand, daysCover, reorderPoint, targetStock, projectedStock, recommendedOrder, orderCost, shortageBeforeArrival];
      if (computed.some(value => value !== null && !Number.isFinite(value))) read.issues.push('Values are too large for a finite replenishment calculation.');
    }
    const valid = read.issues.length === 0;
    if (!valid) {
      effectiveDailyDemand = daysCover = reorderPoint = targetStock = projectedStock = recommendedOrder = orderCost = shortageBeforeArrival = null;
      stockoutBeforeArrival = false;
      signals.length = 0;
    }
    return { rowId: row.id, name, supplier, onHand, dailyDemand, effectiveDailyDemand, leadTimeDays, safetyStock, onOrder, arrivalDate, unitCost, currency, daysCover, reorderPoint, targetStock, projectedStock, recommendedOrder, orderCost, stockoutBeforeArrival, shortageBeforeArrival, valid, issues: read.issues, signals, priority: priority(signals, valid) };
  });
  const totals = new Map<string, SCMCurrencyTotals>();
  for (const row of rows) {
    if (!row.valid || !row.currency || row.orderCost === null || row.recommendedOrder === null || row.recommendedOrder <= 0) continue;
    const total = totals.get(row.currency) ?? { currency: row.currency, recommendedSpend: 0, itemCount: 0 };
    total.recommendedSpend += row.orderCost;
    total.itemCount += 1;
    totals.set(row.currency, total);
  }
  rows.sort((a, b) => b.priority - a.priority);
  return { kind: 'scm', rows, totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)), ...summary(rows, today, horizonEnd, issues) };
}
