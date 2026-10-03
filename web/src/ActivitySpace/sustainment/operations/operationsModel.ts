// Shared by the browser and Copilot. Inputs contain persisted Table values;
// this module has no browser, database, or model dependency.
type DataTableColumnType = 'text' | 'number' | 'date' | 'select' | 'checkbox';
export interface OperationsSchema {
  columns: { id: string; type: DataTableColumnType }[];
  rows: { id: string }[];
  cellsByRow: Record<string, Record<string, unknown>>;
}

export interface OperationsParams extends Record<string, unknown> {
  kind: 'crm';
  tableId: string | null;
  fields: Record<string, string>;
  horizonDays: number;
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

export const OPERATIONS_FIELDS: OperationsField[] = [
  field('name', 'Opportunity', 'text'), field('account', 'Account', 'text', false),
  field('stage', 'Stage (open / won / lost)', 'text'), field('amount', 'Amount', 'number'),
  field('probability', 'Probability (%)', 'number'), field('closeDate', 'Close date', 'date'),
  field('lastContact', 'Last contact', 'date', false), field('nextActionDate', 'Next action date', 'date', false),
  field('currency', 'Currency', 'text'),
];

const objectValue = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function bounded(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? integer ? Math.floor(value) : value : fallback;
}

/** A saved placement whose kind is not CRM maps a Table of another shape; it opens setup. */
export function normalizeOperationsParams(raw: unknown): OperationsParams {
  const value = objectValue(raw);
  const foreign = value.kind !== undefined && value.kind !== 'crm';
  const mappings = foreign ? {} : objectValue(value.fields);
  const fields: Record<string, string> = {};
  for (const definition of OPERATIONS_FIELDS) {
    const id = mappings[definition.key];
    if (typeof id === 'string' && id.trim()) fields[definition.key] = id.trim();
  }
  return {
    kind: 'crm', tableId: !foreign && typeof value.tableId === 'string' && value.tableId.trim() ? value.tableId.trim() : null,
    fields, horizonDays: bounded(value.horizonDays, 30, 1, 3650, true),
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

export interface CRMCurrencyTotals {
  currency: string;
  pipeline: number;
  weightedPipeline: number;
  forecast: number;
  won: number;
  openCount: number;
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

export type OperationsAnalysis = CRMAnalysis;

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

function rowReader(schema: OperationsSchema, params: OperationsParams, rowId: string) {
  const issues: string[] = [];
  const definitions = new Map(OPERATIONS_FIELDS.map(item => [item.key, item]));
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

function schemaIssues(schema: OperationsSchema, params: OperationsParams): string[] {
  const columns = new Map(schema.columns.map(column => [column.id, column]));
  return OPERATIONS_FIELDS.flatMap(definition => {
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

export function analyzeOperations(schema: OperationsSchema, rawParams: OperationsParams, today: string): OperationsAnalysis {
  const params = normalizeOperationsParams(rawParams);
  const day = dayNumber(today);
  if (day === null) throw new Error('Analysis date must be a valid YYYY-MM-DD date.');
  const horizonEnd = addDays(day, params.horizonDays);
  const issues = schemaIssues(schema, params);
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
