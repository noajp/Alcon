// The CRM App's reading of a Space's customer records. Pure: the browser, the
// AI layer and the tests share it. Records come from the crm_* tables; the
// next step of a deal is an Element, so Execution and the CRM read one truth.

/** A UI message key plus the values it interpolates. Translated at render. */
export interface CrmText { message: string; values?: Record<string, string | number> }

export interface CrmStage { id: string; label: string; probability: number }

export const DEFAULT_CRM_STAGES: readonly CrmStage[] = [
  { id: 'lead', label: 'Lead', probability: 10 },
  { id: 'qualified', label: 'Qualified', probability: 25 },
  { id: 'proposal', label: 'Proposal', probability: 50 },
  { id: 'negotiation', label: 'Negotiation', probability: 75 },
];
export const WON_STAGE: CrmStage = { id: 'won', label: 'Won', probability: 100 };
export const LOST_STAGE: CrmStage = { id: 'lost', label: 'Lost', probability: 0 };

export const stageKey = (value: string | null | undefined) => value?.trim().toLowerCase() ?? '';

/** A pipeline's stored stages. Anything malformed falls back to the defaults
 * rather than producing a pipeline with no columns. */
export function normalizeCrmStages(raw: unknown): CrmStage[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CRM_STAGES];
  const seen = new Set<string>(['won', 'lost']);
  const stages: CrmStage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, label, probability } = item as Record<string, unknown>;
    const key = typeof id === 'string' ? stageKey(id) : '';
    if (!key || seen.has(key) || key.length > 40) continue;
    seen.add(key);
    stages.push({
      id: key,
      label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 40) : key,
      probability: typeof probability === 'number' && Number.isFinite(probability) ? Math.min(100, Math.max(0, Math.round(probability))) : 50,
    });
  }
  return stages.length ? stages.slice(0, 12) : [...DEFAULT_CRM_STAGES];
}

export const stageSlug = (label: string) => label.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);

// ── Stored records ──────────────────────────────────────────────────────────

export type CrmMetric = 'won_quarter' | 'won_year' | 'won_total' | 'weighted' | 'open' | 'won_count_quarter' | 'won_count_year' | 'won_count_total';

/** Amount metrics report money in the pipeline's currency; count metrics report how many deals. */
export const metricKind = (metric: CrmMetric): 'amount' | 'count' => metric.startsWith('won_count') ? 'count' : 'amount';

const SYMBOLS: [RegExp, string][] = [[/^(円|¥|JPY)$/, 'JPY'], [/^(\$|US\$|ドル|USD)$/, 'USD'], [/^(€|ユーロ|EUR)$/, 'EUR'], [/^(£|ポンド|GBP)$/, 'GBP'], [/^(元|CNY|RMB)$/, 'CNY'], [/^(₩|ウォン|KRW)$/, 'KRW']];
const SCALES: [string, number][] = [['百万', 1e6], ['千', 1e3], ['万', 1e4], ['億', 1e8]];
const ISO = (() => {
  try { return new Set((Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('currency') ?? []); } catch { return new Set<string>(); }
})();

/** Reads a success condition's unit: money (in which currency, at what scale),
 * a count, a rate or per-period figure, or something it cannot tell. Only a
 * plain unit (社, 件, 人, pcs) is a count; a unit that mentions money or a
 * scale without being fully understood is "unknown" and is never written. */
export function readUnit(unit: string | null | undefined): { kind: 'any' } | { kind: 'money'; currency: string; scale: number } | { kind: 'count' } | { kind: 'rate' } | { kind: 'unknown' } {
  const value = (unit ?? '').normalize('NFKC').trim();
  if (!value) return { kind: 'any' };
  if (/[%‰/]|毎|per\b|率/i.test(value)) return { kind: 'rate' };
  let rest = value;
  let scale = 1;
  for (const [prefix, factor] of SCALES) if (rest.startsWith(prefix) && rest.length > prefix.length) { scale = factor; rest = rest.slice(prefix.length); break; }
  const symbol = SYMBOLS.find(([pattern]) => pattern.test(rest) || pattern.test(rest.toUpperCase()));
  if (symbol) return { kind: 'money', currency: symbol[1], scale };
  // ISO codes only as written in capitals: "cup" is a word, "CUP" a currency.
  if (/^[A-Z]{3}$/.test(rest) && (ISO.size ? ISO.has(rest) : ['JPY', 'USD', 'EUR', 'GBP', 'CNY', 'KRW', 'AUD', 'CAD', 'CHF', 'SGD', 'HKD', 'TWD', 'INR'].includes(rest))) return { kind: 'money', currency: rest, scale };
  const mentionsMoney = /円|¥|\$|€|£|₩|ドル|ユーロ|ポンド|ウォン|元|yen|dollar|euro|pound/i.test(value) || /\b[A-Z]{3}\b/.test(value);
  const mentionsScale = /[十百千万億兆]|\d|^[kmb]$/i.test(value);
  return mentionsMoney || mentionsScale || scale !== 1 ? { kind: 'unknown' } : { kind: 'count' };
}

/** Whether a figure may be written into a success condition, and the value to
 * write: money only into the pipeline's own currency (scaled to 万円 etc.),
 * counts only into count units. Anything else is not written. */
export function measureValue(unit: string | null | undefined, metric: CrmMetric, currency: string, value: number): number | null {
  const read = readUnit(unit);
  if (read.kind === 'any') return value;
  if (metricKind(metric) === 'count') return read.kind === 'count' ? value : null;
  if (read.kind !== 'money' || read.currency !== currency.toUpperCase()) return null;
  return Math.round(value / read.scale * 100) / 100;
}

export interface CrmPipelineRecord {
  id: string;
  name: string;
  stages: unknown;
  currency: string;
  horizon_days: number;
  follow_up_days: number;
  object_id: string | null;
  measure_intent_id: string | null;
  measure_metric: CrmMetric | null;
  /** What this organisation calls a deal here (案件, Opportunity…); null = "Deal". */
  record_label: string | null;
  order_index: number;
}
export interface CrmCompanyRecord {
  id: string; name: string; domain: string | null; industry: string | null; owner_worker_id: string | null;
  notes: string | null; custom: Record<string, unknown>; created_at: string;
}
export interface CrmContactRecord {
  id: string; company_id: string | null; name: string; title: string | null; email: string | null; phone: string | null;
  owner_worker_id: string | null; custom: Record<string, unknown>; created_at: string;
}
export interface CrmDealRecord {
  id: string; pipeline_id: string; number: number; name: string; company_id: string | null; contact_id: string | null;
  owner_worker_id: string | null; stage: string; amount: number | string | null; currency: string; probability: number | null;
  close_date: string | null; last_contact_on: string | null; next_step: string | null; next_step_on: string | null;
  next_element_id: string | null; initiative_id: string | null; source: string | null; lost_reason: string | null;
  closed_on: string | null; custom: Record<string, unknown>; created_at: string;
}
export type CrmActivityKind = 'call' | 'email' | 'meeting' | 'note' | 'stage';
export interface CrmActivityRecord {
  id: string; deal_id: string | null; company_id: string | null; contact_id: string | null; kind: CrmActivityKind;
  body: string; occurred_on: string; created_by: string | null; author_name: string | null; created_at: string;
}
export interface CrmFieldRecord {
  id: string; entity: 'deal' | 'company' | 'contact'; key: string; label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox'; options: unknown; order_index: number;
}
/** The Element that is a deal's next step, as far as the CRM needs it. */
export interface CrmNextElement { id: string; title: string; status: string; due_date: string | null; display_id: string | null }
export interface CrmPerson { id: string; name: string; type: string; user_id: string | null }

export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note'] as const;
export type CrmActivityType = typeof ACTIVITY_TYPES[number];
export interface CrmActivity { id?: string; date: string | null; type: CrmActivityType | 'stage'; text: string; author?: string | null }

// A Table-era activity log line: "2026-10-03 · call · text". Read when importing.
const ACTIVITY_LINE = /^(\d{4}-\d{2}-\d{2})\s*[·|]\s*([a-z]+)\s*[·|]\s*(.*)$/i;
export function parseActivityLog(value: unknown): CrmActivity[] {
  if (typeof value !== 'string') return [];
  return value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const match = ACTIVITY_LINE.exec(line);
    if (!match) return { date: null, type: 'note' as const, text: line };
    const type = match[2].toLowerCase();
    return { date: match[1], type: (ACTIVITY_TYPES as readonly string[]).includes(type) ? type as CrmActivityType : 'note', text: match[3].trim() };
  });
}

// ── Dates ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
export function dayIndex(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time / DAY_MS : null;
}
export function shiftDate(value: string, days: number): string {
  return new Date((dayIndex(value)! + days) * DAY_MS).toISOString().slice(0, 10);
}
const daysBetween = (from: string, to: string) => dayIndex(to)! - dayIndex(from)!;

// ── Deals ───────────────────────────────────────────────────────────────────

export type CrmHealthLevel = 'healthy' | 'watch' | 'risk' | 'closed' | 'incomplete';
export interface CrmHealth { score: number | null; level: CrmHealthLevel; reasons: (CrmText & { impact: number })[] }

export type CrmUrgency = 'overdue' | 'today' | 'soon' | 'plan';
export interface CrmAction extends CrmText { urgency: CrmUrgency; code: string }

export interface CrmDeal {
  id: string;
  number: number;
  pipelineId: string;
  name: string;
  companyId: string | null;
  account: string | null;
  contactId: string | null;
  contact: string | null;
  email: string | null;
  ownerId: string | null;
  ownerName: string | null;
  stageId: string | null;
  stage: CrmStage | null;
  outcome: 'open' | 'won' | 'lost' | null;
  amount: number | null;
  probability: number | null;
  weighted: number | null;
  currency: string | null;
  closeDate: string | null;
  closedOn: string | null;
  lastContact: string | null;
  /** The next action's date and words: the linked Element's when there is one. */
  nextActionDate: string | null;
  nextStep: string | null;
  nextElement: CrmNextElement | null;
  initiativeId: string | null;
  source: string | null;
  lostReason: string | null;
  custom: Record<string, unknown>;
  activity: CrmActivity[];
  createdAt: string | null;
  valid: boolean;
  issues: CrmText[];
  health: CrmHealth;
  action: CrmAction | null;
}

export interface CrmBoardColumn { stage: CrmStage; deals: CrmDeal[]; totals: Record<string, number>; closed: boolean }

export interface CrmSettings { horizonDays: number; followUpDays: number }

export interface CrmWorkspace {
  today: string;
  pipeline: CrmPipelineRecord;
  params: CrmSettings;
  stages: CrmStage[];
  deals: CrmDeal[];
  /** The currency with the largest open pipeline; headline numbers use it. */
  primaryCurrency: string | null;
  totals: { currency: string; pipeline: number; weightedPipeline: number; forecast: number; won: number; openCount: number }[];
}

export interface CrmRecords {
  pipeline: CrmPipelineRecord;
  deals: readonly CrmDealRecord[];
  companies: readonly CrmCompanyRecord[];
  contacts: readonly CrmContactRecord[];
  activities: readonly CrmActivityRecord[];
  elements: readonly CrmNextElement[];
  people: readonly CrmPerson[];
}

const DONE_STATUSES = new Set(['done', 'cancelled']);

function health(deal: Omit<CrmDeal, 'health' | 'action'>, today: string, followUpDays: number): CrmHealth {
  if (!deal.valid) return { score: null, level: 'incomplete', reasons: [] };
  if (deal.outcome !== 'open') return { score: null, level: 'closed', reasons: [] };
  const reasons: CrmHealth['reasons'] = [];
  if (deal.closeDate && deal.closeDate < today) reasons.push({ message: 'Close date {date} has passed', values: { date: deal.closeDate }, impact: 35 });
  if (!deal.nextActionDate) reasons.push({ message: 'No next action scheduled', impact: 20 });
  else if (deal.nextActionDate < today) reasons.push({ message: 'Next action overdue by {n} days', values: { n: daysBetween(deal.nextActionDate, today) }, impact: Math.min(35, 20 + daysBetween(deal.nextActionDate, today)) });
  if (!deal.lastContact) reasons.push({ message: 'No contact recorded', impact: 15 });
  else {
    const quiet = daysBetween(deal.lastContact, today);
    if (quiet >= followUpDays) reasons.push({ message: '{n} days since last contact', values: { n: quiet }, impact: Math.min(30, 10 + quiet - followUpDays) });
  }
  if (deal.closeDate && deal.closeDate >= today && daysBetween(today, deal.closeDate) <= 14 && (deal.probability ?? 0) < 50) {
    reasons.push({ message: 'Closing within 14 days at {p}% likelihood', values: { p: deal.probability ?? 0 }, impact: 10 });
  }
  const score = Math.max(0, 100 - reasons.reduce((sum, reason) => sum + reason.impact, 0));
  reasons.sort((a, b) => b.impact - a.impact);
  return { score, level: score >= 70 ? 'healthy' : score >= 40 ? 'watch' : 'risk', reasons };
}

/** The one thing to do next for an open deal, if anything is due. */
function nextAction(deal: Omit<CrmDeal, 'health' | 'action'>, today: string, followUpDays: number): CrmAction | null {
  if (!deal.valid || deal.outcome !== 'open') return null;
  const step = deal.nextStep ?? null;
  if (deal.closeDate && deal.closeDate < today) return { code: 'close_overdue', urgency: 'overdue', message: 'Confirm the outcome or move the close date' };
  if (deal.nextActionDate && deal.nextActionDate < today) {
    return step ? { code: 'action_overdue', urgency: 'overdue', message: 'Overdue: {step}', values: { step } } : { code: 'action_overdue', urgency: 'overdue', message: 'Follow up — due {date}', values: { date: deal.nextActionDate } };
  }
  if (deal.nextActionDate === today) return step ? { code: 'action_today', urgency: 'today', message: 'Today: {step}', values: { step } } : { code: 'action_today', urgency: 'today', message: 'Follow up today' };
  if (!deal.nextActionDate) {
    return deal.nextElement && DONE_STATUSES.has(deal.nextElement.status)
      ? { code: 'step_done', urgency: 'plan', message: 'Next step done — plan the one after' }
      : { code: 'action_missing', urgency: 'plan', message: 'Agree the next step and a date' };
  }
  if (deal.lastContact && daysBetween(deal.lastContact, today) >= followUpDays) {
    return { code: 'contact_stale', urgency: 'soon', message: 'Check in — {n} days since last contact', values: { n: daysBetween(deal.lastContact, today) } };
  }
  if (!deal.lastContact) return { code: 'contact_missing', urgency: 'plan', message: 'Log the last conversation' };
  if (deal.closeDate && daysBetween(today, deal.closeDate) <= 7) return { code: 'closing_soon', urgency: 'soon', message: 'Closes {date} — secure the decision', values: { date: deal.closeDate } };
  return null;
}

export function resolveStage(stageId: string | null, stages: readonly CrmStage[]): CrmStage | null {
  const key = stageKey(stageId);
  if (!key) return null;
  if (key === 'won') return WON_STAGE;
  if (key === 'lost') return LOST_STAGE;
  return stages.find(stage => stage.id === key || stageKey(stage.label) === key)
    ?? { id: key, label: stageId!.trim(), probability: 50 };
}

const toNumber = (value: number | string | null) => value === null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;

export function buildCrmWorkspace(records: CrmRecords, today: string): CrmWorkspace {
  const { pipeline } = records;
  const stages = normalizeCrmStages(pipeline.stages);
  const params: CrmSettings = { horizonDays: pipeline.horizon_days, followUpDays: pipeline.follow_up_days };
  const companies = new Map(records.companies.map(company => [company.id, company]));
  const contacts = new Map(records.contacts.map(contact => [contact.id, contact]));
  const people = new Map(records.people.map(person => [person.id, person]));
  const elements = new Map(records.elements.map(element => [element.id, element]));
  const history = new Map<string, CrmActivity[]>();
  for (const entry of [...records.activities].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at))) {
    if (!entry.deal_id) continue;
    const list = history.get(entry.deal_id) ?? [];
    list.push({ id: entry.id, date: entry.occurred_on, type: entry.kind, text: entry.body, author: entry.author_name });
    history.set(entry.deal_id, list);
  }
  const deals = records.deals.filter(deal => deal.pipeline_id === pipeline.id).map((row): CrmDeal => {
    const stage = resolveStage(row.stage, stages);
    const outcome: CrmDeal['outcome'] = stage ? stage.id === 'won' ? 'won' : stage.id === 'lost' ? 'lost' : 'open' : null;
    const amount = toNumber(row.amount);
    const probability = outcome === 'won' ? 100 : outcome === 'lost' ? 0 : row.probability ?? stage?.probability ?? null;
    const issues: CrmText[] = [];
    if (outcome === 'open' && amount === null) issues.push({ message: 'Add the amount' });
    if (outcome === 'open' && !row.close_date) issues.push({ message: 'Add the expected close date' });
    const element = row.next_element_id ? elements.get(row.next_element_id) ?? null : null;
    // A live Element is the next step; a finished one leaves the deal waiting for the next plan.
    const elementOpen = element && !DONE_STATUSES.has(element.status);
    const company = row.company_id ? companies.get(row.company_id) : undefined;
    const contact = row.contact_id ? contacts.get(row.contact_id) : undefined;
    const base = {
      id: row.id, number: row.number, pipelineId: row.pipeline_id, name: row.name,
      companyId: row.company_id, account: company?.name ?? null,
      contactId: row.contact_id, contact: contact?.name ?? null, email: contact?.email ?? null,
      ownerId: row.owner_worker_id, ownerName: row.owner_worker_id ? people.get(row.owner_worker_id)?.name ?? null : null,
      stageId: row.stage, stage, outcome, amount, probability,
      weighted: outcome === 'open' && amount !== null && probability !== null ? amount * probability / 100 : null,
      currency: row.currency, closeDate: row.close_date, closedOn: row.closed_on, lastContact: row.last_contact_on,
      nextActionDate: element ? elementOpen ? element.due_date : null : row.next_step_on,
      nextStep: element ? elementOpen ? element.title : null : row.next_step,
      nextElement: element, initiativeId: row.initiative_id, source: row.source, lostReason: row.lost_reason,
      custom: row.custom ?? {}, activity: history.get(row.id) ?? [], createdAt: row.created_at,
      valid: issues.length === 0, issues,
    };
    return { ...base, health: health(base, today, params.followUpDays), action: nextAction(base, today, params.followUpDays) };
  });
  const totals = new Map<string, CrmWorkspace['totals'][number]>();
  const horizonEnd = shiftDate(today, params.horizonDays);
  for (const deal of deals) {
    if (!deal.valid || !deal.currency || deal.amount === null || deal.outcome === 'lost' || !deal.outcome) continue;
    const total = totals.get(deal.currency) ?? { currency: deal.currency, pipeline: 0, weightedPipeline: 0, forecast: 0, won: 0, openCount: 0 };
    if (deal.outcome === 'won') total.won += deal.amount;
    else {
      total.pipeline += deal.amount;
      total.weightedPipeline += deal.weighted ?? 0;
      total.openCount += 1;
      if (deal.closeDate && deal.closeDate >= today && deal.closeDate <= horizonEnd) total.forecast += deal.weighted ?? 0;
    }
    totals.set(deal.currency, total);
  }
  const list = [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  const primaryCurrency = [...list].sort((a, b) => b.pipeline - a.pipeline || b.won - a.won)[0]?.currency ?? pipeline.currency;
  return { today, pipeline, params, stages, deals, primaryCurrency, totals: list };
}

// ── Views over the workspace ────────────────────────────────────────────────

const URGENCY_ORDER: Record<CrmUrgency, number> = { overdue: 0, today: 1, soon: 2, plan: 3 };

/** What to do today: overdue first, then due today, then the rest — larger
 * weighted value breaks ties, so the biggest risk is always on top. */
export function todayQueue(deals: readonly CrmDeal[]): CrmDeal[] {
  return deals.filter(deal => deal.action).sort((a, b) =>
    URGENCY_ORDER[a.action!.urgency] - URGENCY_ORDER[b.action!.urgency]
    || (b.weighted ?? 0) - (a.weighted ?? 0)
    || a.name.localeCompare(b.name));
}

/** Open deals with a next action in the coming days, in date order. */
export function upcoming(deals: readonly CrmDeal[], today: string, days = 7): CrmDeal[] {
  const end = shiftDate(today, days);
  return deals.filter(deal => deal.outcome === 'open' && deal.valid && deal.nextActionDate && deal.nextActionDate > today && deal.nextActionDate <= end)
    .sort((a, b) => a.nextActionDate!.localeCompare(b.nextActionDate!));
}

export function pipelineColumns(workspace: Pick<CrmWorkspace, 'stages' | 'deals'>, deals: readonly CrmDeal[] = workspace.deals): CrmBoardColumn[] {
  const columns = new Map<string, CrmBoardColumn>();
  for (const stage of workspace.stages) columns.set(stage.id, { stage, deals: [], totals: {}, closed: false });
  const extra: CrmBoardColumn[] = [];
  const won: CrmBoardColumn = { stage: WON_STAGE, deals: [], totals: {}, closed: true };
  const lost: CrmBoardColumn = { stage: LOST_STAGE, deals: [], totals: {}, closed: true };
  for (const deal of deals) {
    let column: CrmBoardColumn;
    if (deal.outcome === 'won') column = won;
    else if (deal.outcome === 'lost') column = lost;
    else {
      const stage = deal.stage!;
      column = columns.get(stage.id) ?? extra.find(item => item.stage.id === stage.id)
        ?? (extra.push({ stage, deals: [], totals: {}, closed: false }), extra[extra.length - 1]);
    }
    column.deals.push(deal);
    if (deal.amount !== null && deal.currency) column.totals[deal.currency] = (column.totals[deal.currency] ?? 0) + deal.amount;
  }
  for (const column of [...columns.values(), ...extra, won, lost]) {
    column.deals.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || a.name.localeCompare(b.name));
  }
  return [...columns.values(), ...extra, won, lost];
}

export interface CrmAccount {
  key: string;
  name: string | null;
  deals: CrmDeal[];
  openCount: number;
  pipeline: Record<string, number>;
  won: Record<string, number>;
  lastContact: string | null;
  nextActionDate: string | null;
  worst: CrmHealthLevel | null;
}

const LEVEL_ORDER: Record<CrmHealthLevel, number> = { risk: 0, watch: 1, healthy: 2, incomplete: 3, closed: 4 };

/** Deals rolled up by company (key = company id, '' for none). */
export function accountsOf(deals: readonly CrmDeal[]): CrmAccount[] {
  const accounts = new Map<string, CrmAccount>();
  for (const deal of deals) {
    const key = deal.companyId ?? '';
    const account = accounts.get(key) ?? { key, name: deal.account, deals: [], openCount: 0, pipeline: {}, won: {}, lastContact: null, nextActionDate: null, worst: null };
    account.deals.push(deal);
    if (deal.outcome === 'open' && deal.valid) {
      account.openCount += 1;
      if (deal.currency && deal.amount !== null) account.pipeline[deal.currency] = (account.pipeline[deal.currency] ?? 0) + deal.amount;
      if (deal.nextActionDate && (!account.nextActionDate || deal.nextActionDate < account.nextActionDate)) account.nextActionDate = deal.nextActionDate;
    }
    if (deal.outcome === 'won' && deal.currency && deal.amount !== null) account.won[deal.currency] = (account.won[deal.currency] ?? 0) + deal.amount;
    if (deal.lastContact && (!account.lastContact || deal.lastContact > account.lastContact)) account.lastContact = deal.lastContact;
    if (!account.worst || LEVEL_ORDER[deal.health.level] < LEVEL_ORDER[account.worst]) account.worst = deal.health.level;
    accounts.set(key, account);
  }
  const total = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0);
  return [...accounts.values()].sort((a, b) => (a.key === '' ? 1 : 0) - (b.key === '' ? 1 : 0)
    || total(b.pipeline) - total(a.pipeline) || total(b.won) - total(a.won) || (a.name ?? '').localeCompare(b.name ?? ''));
}

export interface CrmForecastMonth { month: string; weighted: number; commit: number; bestCase: number; won: number; count: number }
export interface CrmForecast {
  currency: string | null;
  months: CrmForecastMonth[];
  undated: number;
  openPipeline: number;
  weightedPipeline: number;
  wonTotal: number;
  winRate: number | null;
  averageWon: number | null;
  averageOpen: number | null;
}

/** Monthly view for one currency. Commit = open deals at or above the commit
 * likelihood; best case = every open amount. Currencies are never summed. */
export function forecastFor(deals: readonly CrmDeal[], currency: string | null, today: string, months = 6, commitAt = 70): CrmForecast {
  const start = today.slice(0, 7);
  const keys: string[] = [];
  const [year, month] = start.split('-').map(Number);
  for (let index = 0; index < months; index += 1) keys.push(new Date(Date.UTC(year, month - 1 + index, 1)).toISOString().slice(0, 7));
  const buckets = new Map(keys.map(key => [key, { month: key, weighted: 0, commit: 0, bestCase: 0, won: 0, count: 0 }]));
  const scoped = deals.filter(deal => deal.currency === currency && deal.amount !== null);
  let undated = 0;
  for (const deal of scoped) {
    if (deal.outcome === 'won') { const key = (deal.closedOn ?? deal.closeDate)?.slice(0, 7); if (key && buckets.has(key)) buckets.get(key)!.won += deal.amount!; continue; }
    if (deal.outcome !== 'open' || !deal.valid) continue;
    const key = deal.closeDate?.slice(0, 7);
    // Overdue open deals still count, in the current month — they are not lost yet.
    const bucket = key && key < start ? buckets.get(start) : key ? buckets.get(key) : undefined;
    if (!bucket) { if (!key) undated += 1; continue; }
    bucket.bestCase += deal.amount!;
    bucket.weighted += deal.weighted ?? 0;
    if ((deal.probability ?? 0) >= commitAt) bucket.commit += deal.amount!;
    bucket.count += 1;
  }
  const open = scoped.filter(deal => deal.outcome === 'open' && deal.valid);
  const won = scoped.filter(deal => deal.outcome === 'won');
  const lost = scoped.filter(deal => deal.outcome === 'lost');
  const sum = (items: CrmDeal[], pick: (deal: CrmDeal) => number) => items.reduce((total, deal) => total + pick(deal), 0);
  return {
    currency, months: [...buckets.values()], undated,
    openPipeline: sum(open, deal => deal.amount!), weightedPipeline: sum(open, deal => deal.weighted ?? 0), wonTotal: sum(won, deal => deal.amount!),
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    averageWon: won.length ? sum(won, deal => deal.amount!) / won.length : null,
    averageOpen: open.length ? sum(open, deal => deal.amount!) / open.length : null,
  };
}

/** The figure a pipeline reports into its Initiative's success condition. */
export function metricValue(deals: readonly CrmDeal[], metric: CrmMetric, currency: string, today: string): number {
  const year = today.slice(0, 4);
  const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const inQuarter = (date: string | null) => !!date && date.slice(0, 4) === year && Math.floor((Number(date.slice(5, 7)) - 1) / 3) === quarter;
  const scoped = deals.filter(deal => deal.currency === currency && deal.amount !== null);
  const sum = (items: CrmDeal[], pick: (deal: CrmDeal) => number) => Math.round(items.reduce((total, deal) => total + pick(deal), 0) * 100) / 100;
  const won = scoped.filter(deal => deal.outcome === 'won');
  // Counts include won deals in every currency and with no amount: a customer won is a customer won.
  const wonAll = deals.filter(deal => deal.outcome === 'won');
  const closed = (deal: CrmDeal) => deal.closedOn ?? deal.closeDate;
  switch (metric) {
    case 'won_count_total': return wonAll.length;
    case 'won_count_year': return wonAll.filter(deal => closed(deal)?.slice(0, 4) === year).length;
    case 'won_count_quarter': return wonAll.filter(deal => inQuarter(closed(deal))).length;
    case 'won_total': return sum(won, deal => deal.amount!);
    case 'won_year': return sum(won.filter(deal => (deal.closedOn ?? deal.closeDate)?.slice(0, 4) === year), deal => deal.amount!);
    case 'won_quarter': return sum(won.filter(deal => inQuarter(deal.closedOn ?? deal.closeDate)), deal => deal.amount!);
    case 'weighted': return sum(scoped.filter(deal => deal.outcome === 'open'), deal => deal.weighted ?? 0);
    case 'open': return sum(scoped.filter(deal => deal.outcome === 'open'), deal => deal.amount!);
  }
}

export type CrmList = 'mine' | 'at-risk' | 'closing-soon' | 'no-next-step' | 'stale' | 'won' | 'lost' | 'incomplete';

export function inList(deal: CrmDeal, list: CrmList, today: string, horizonDays: number, me: string | null = null): boolean {
  switch (list) {
    case 'mine': return !!me && deal.ownerId === me && deal.outcome === 'open';
    case 'at-risk': return deal.health.level === 'risk';
    case 'closing-soon': return deal.outcome === 'open' && deal.valid && !!deal.closeDate && deal.closeDate >= today && deal.closeDate <= shiftDate(today, horizonDays);
    case 'no-next-step': return deal.outcome === 'open' && !deal.nextActionDate;
    case 'stale': return deal.health.reasons.some(reason => reason.message === '{n} days since last contact');
    case 'won': return deal.outcome === 'won';
    case 'lost': return deal.outcome === 'lost';
    case 'incomplete': return deal.outcome === 'open' && !deal.valid;
  }
}

export function searchDeals(deals: readonly CrmDeal[], query: string): CrmDeal[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...deals];
  return deals.filter(deal => {
    const haystack = [deal.name, `d-${deal.number}`, deal.account, deal.contact, deal.email, deal.ownerName, deal.stage?.label, deal.nextStep, deal.source,
      ...Object.values(deal.custom).map(value => typeof value === 'string' || typeof value === 'number' ? String(value) : '')].filter(Boolean).join(' ').toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}

/** Values for moving a deal to a stage. Probability follows the stage
 * default only when the deal is entering or leaving an outcome, or when it
 * still carries the previous stage's default — a hand-set figure survives. */
export function stageChange(deal: Pick<CrmDeal, 'probability' | 'stage'>, target: CrmStage): { stage: string; probability: number } {
  const closed = target.id === 'won' || target.id === 'lost';
  const wasDefault = deal.probability === null || deal.stage === null || deal.probability === deal.stage.probability
    || deal.stage.id === 'won' || deal.stage.id === 'lost';
  return { stage: target.id, probability: closed || wasDefault ? target.probability : deal.probability! };
}

/** Custom field definitions as typed choices; malformed options are dropped. */
export function fieldOptions(field: Pick<CrmFieldRecord, 'options'>): string[] {
  return Array.isArray(field.options) ? field.options.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 50) : [];
}

export function fieldKey(label: string, taken: readonly string[]): string {
  const base = label.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'field';
  let key = base; let index = 2;
  while (taken.includes(key)) key = `${base}_${index++}`.slice(0, 40);
  return key;
}
