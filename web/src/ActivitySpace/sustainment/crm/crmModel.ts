// The CRM App's reading of a pipeline Table. Pure: the browser, the AI layer
// and the tests share it. Validity, signals and currency totals come from the
// shared operations calculator, so Copilot and this App never disagree.
import {
  analyzeOperations, normalizeOperationsParams,
  type CRMAnalysis, type CRMRowAnalysis, type OperationsParams, type OperationsSchema,
} from '@/ActivitySpace/sustainment/operations/operationsModel';

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

/** Saved stages live beside the planner params. Anything malformed falls back
 * to the defaults rather than producing a pipeline with no columns. */
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

// ── Activity log ────────────────────────────────────────────────────────────
// One line per entry, newest first, readable in Table: "2026-10-03 · call · text".

export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note'] as const;
export type CrmActivityType = typeof ACTIVITY_TYPES[number];
export interface CrmActivity { date: string | null; type: CrmActivityType; text: string }

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

export function formatActivity(entry: CrmActivity): string {
  const text = entry.text.replace(/\s*\n+\s*/g, ' / ').trim();
  return entry.date ? `${entry.date} · ${entry.type} · ${text}` : text;
}

/** Prepends the entry. Older history is kept verbatim, including lines this
 * format does not recognise, so nothing typed directly in Table is lost. */
export function appendActivity(log: unknown, entry: CrmActivity): string {
  const previous = typeof log === 'string' ? log.trim() : '';
  return previous ? `${formatActivity(entry)}\n${previous}` : formatActivity(entry);
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
  name: string;
  account: string | null;
  contact: string | null;
  email: string | null;
  stageId: string | null;
  stage: CrmStage | null;
  outcome: 'open' | 'won' | 'lost' | null;
  amount: number | null;
  probability: number | null;
  weighted: number | null;
  currency: string | null;
  closeDate: string | null;
  lastContact: string | null;
  nextActionDate: string | null;
  nextStep: string | null;
  activity: CrmActivity[];
  activityRaw: string | null;
  createdAt: string | null;
  valid: boolean;
  issues: string[];
  health: CrmHealth;
  action: CrmAction | null;
  analysis: CRMRowAnalysis;
}

export interface CrmBoardColumn { stage: CrmStage; deals: CrmDeal[]; totals: Record<string, number>; closed: boolean }

export interface CrmWorkspace {
  today: string;
  params: OperationsParams;
  stages: CrmStage[];
  deals: CrmDeal[];
  analysis: CRMAnalysis;
  /** The currency with the largest open pipeline; headline numbers use it. */
  primaryCurrency: string | null;
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

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
  if (!deal.nextActionDate) return { code: 'action_missing', urgency: 'plan', message: 'Agree the next step and a date' };
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

type CrmSchema = Omit<OperationsSchema, 'rows'> & { rows: { id: string; created_at?: string }[] };

export function buildCrmWorkspace(schema: CrmSchema, rawParams: unknown, today: string): CrmWorkspace {
  const params = normalizeOperationsParams({ ...(rawParams as object), kind: 'crm' });
  const stages = normalizeCrmStages((rawParams as Record<string, unknown> | null)?.crmStages);
  const analysis = analyzeOperations(schema, params, today) as CRMAnalysis;
  const created = new Map(schema.rows.map(row => [row.id, row.created_at ?? null]));
  // The calculator ranks by risk; the App keeps the Table's own row order.
  const order = new Map(schema.rows.map((row, index) => [row.id, index]));
  const rows = [...analysis.rows].sort((a, b) => order.get(a.rowId)! - order.get(b.rowId)!);
  const cell = (rowId: string, key: string) => {
    const id = params.fields[key];
    return id ? schema.cellsByRow[rowId]?.[id] : undefined;
  };
  const deals = rows.map((row): CrmDeal => {
    const activityRaw = text(cell(row.rowId, 'activity'));
    const base = {
      id: row.rowId, name: row.name, account: row.account,
      contact: text(cell(row.rowId, 'contact')), email: text(cell(row.rowId, 'email')),
      stageId: row.stageId, stage: resolveStage(row.stageId, stages), outcome: row.stage,
      amount: row.amount, probability: row.probability, weighted: row.weightedAmount, currency: row.currency,
      closeDate: row.closeDate, lastContact: row.lastContact, nextActionDate: row.nextActionDate,
      nextStep: text(cell(row.rowId, 'nextStep')),
      activity: parseActivityLog(activityRaw), activityRaw,
      createdAt: created.get(row.rowId) ?? null,
      valid: row.valid, issues: row.issues, analysis: row,
    };
    return { ...base, health: health(base, today, params.followUpDays), action: nextAction(base, today, params.followUpDays) };
  });
  const primaryCurrency = [...analysis.totals].sort((a, b) => b.pipeline - a.pipeline || b.won - a.won)[0]?.currency ?? null;
  return { today, params, stages, deals, analysis, primaryCurrency };
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
  const unstaged: CrmBoardColumn = { stage: { id: '', label: 'No stage', probability: 0 }, deals: [], totals: {}, closed: false };
  const won: CrmBoardColumn = { stage: WON_STAGE, deals: [], totals: {}, closed: true };
  const lost: CrmBoardColumn = { stage: LOST_STAGE, deals: [], totals: {}, closed: true };
  for (const deal of deals) {
    let column: CrmBoardColumn;
    if (deal.outcome === 'won') column = won;
    else if (deal.outcome === 'lost') column = lost;
    else if (!deal.stage) column = unstaged;
    else {
      column = columns.get(deal.stage.id) ?? extra.find(item => item.stage.id === deal.stage!.id)
        ?? (extra.push({ stage: deal.stage, deals: [], totals: {}, closed: false }), extra[extra.length - 1]);
    }
    column.deals.push(deal);
    if (deal.amount !== null && deal.currency) column.totals[deal.currency] = (column.totals[deal.currency] ?? 0) + deal.amount;
  }
  for (const column of [...columns.values(), ...extra, unstaged, won, lost]) {
    column.deals.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || a.name.localeCompare(b.name));
  }
  return [...(unstaged.deals.length ? [unstaged] : []), ...columns.values(), ...extra, won, lost];
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

export function accountsOf(deals: readonly CrmDeal[]): CrmAccount[] {
  const accounts = new Map<string, CrmAccount>();
  for (const deal of deals) {
    const key = deal.account?.toLowerCase() ?? '';
    const account = accounts.get(key) ?? { key, name: deal.account, deals: [], openCount: 0, pipeline: {}, won: {}, lastContact: null, nextActionDate: null, worst: null };
    account.deals.push(deal);
    if (deal.outcome === 'open' && deal.valid) {
      account.openCount += 1;
      if (deal.currency && deal.amount !== null) account.pipeline[deal.currency] = (account.pipeline[deal.currency] ?? 0) + deal.amount;
      if (deal.nextActionDate && (!account.nextActionDate || deal.nextActionDate < account.nextActionDate)) account.nextActionDate = deal.nextActionDate;
    }
    if (deal.outcome === 'won' && deal.valid && deal.currency && deal.amount !== null) account.won[deal.currency] = (account.won[deal.currency] ?? 0) + deal.amount;
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
  for (let index = 0; index < months; index += 1) {
    const date = new Date(Date.UTC(year, month - 1 + index, 1));
    keys.push(date.toISOString().slice(0, 7));
  }
  const buckets = new Map(keys.map(key => [key, { month: key, weighted: 0, commit: 0, bestCase: 0, won: 0, count: 0 }]));
  const scoped = deals.filter(deal => deal.valid && deal.currency === currency && deal.amount !== null);
  let undated = 0;
  for (const deal of scoped) {
    const key = deal.closeDate?.slice(0, 7);
    if (deal.outcome === 'won') { if (key && buckets.has(key)) buckets.get(key)!.won += deal.amount!; continue; }
    if (deal.outcome !== 'open') continue;
    // Overdue open deals still count, in the current month — they are not lost yet.
    const bucket = key && key < start ? buckets.get(start) : key ? buckets.get(key) : undefined;
    if (!bucket) { if (!key) undated += 1; continue; }
    bucket.bestCase += deal.amount!;
    bucket.weighted += deal.weighted ?? 0;
    if ((deal.probability ?? 0) >= commitAt) bucket.commit += deal.amount!;
    bucket.count += 1;
  }
  const open = scoped.filter(deal => deal.outcome === 'open');
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

export type CrmList = 'at-risk' | 'closing-soon' | 'no-next-step' | 'stale' | 'won' | 'lost' | 'incomplete';

export function inList(deal: CrmDeal, list: CrmList, today: string, horizonDays: number): boolean {
  switch (list) {
    case 'at-risk': return deal.health.level === 'risk';
    case 'closing-soon': return deal.outcome === 'open' && deal.valid && !!deal.closeDate && deal.closeDate >= today && deal.closeDate <= shiftDate(today, horizonDays);
    case 'no-next-step': return deal.outcome === 'open' && deal.valid && !deal.nextActionDate;
    case 'stale': return deal.action?.code === 'contact_stale' || deal.health.reasons.some(reason => reason.message === '{n} days since last contact');
    case 'won': return deal.outcome === 'won';
    case 'lost': return deal.outcome === 'lost';
    case 'incomplete': return !deal.valid;
  }
}

export function searchDeals(deals: readonly CrmDeal[], query: string): CrmDeal[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...deals];
  return deals.filter(deal => {
    const haystack = [deal.name, deal.account, deal.contact, deal.email, deal.stage?.label, deal.nextStep].filter(Boolean).join(' ').toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}

/** Cell values for moving a deal to a stage. Probability follows the stage
 * default only when the deal is entering or leaving an outcome, or when it
 * still carries the previous stage's default — a hand-set figure survives. */
export function stageChange(deal: Pick<CrmDeal, 'probability' | 'stage'>, target: CrmStage): { stage: string; probability: number } {
  const closed = target.id === 'won' || target.id === 'lost';
  const wasDefault = deal.probability === null || deal.stage === null || deal.probability === deal.stage.probability
    || deal.stage.id === 'won' || deal.stage.id === 'lost';
  return { stage: target.id, probability: closed || wasDefault ? target.probability : deal.probability! };
}
