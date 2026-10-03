// Turns what a seller writes after a call — notes, a pasted email, one line —
// into a proposed deal update. The local reading is instant and works without
// the AI; the AI's reading, when it arrives, is validated by the same rules and
// replaces only the fields it actually found. Nothing is written until the
// person applies the proposal.
import { ACTIVITY_TYPES, dayIndex, shiftDate, stageKey, type CrmActivityType, type CrmDeal, type CrmStage } from './crmModel';

export interface CaptureFields {
  name?: string;
  account?: string;
  contact?: string;
  email?: string;
  stage?: string;
  amount?: number;
  currency?: string;
  probability?: number;
  closeDate?: string;
  nextActionDate?: string;
  nextStep?: string;
}

export interface CaptureProposal {
  /** An existing deal this note is about, or null for a new deal. */
  dealId: string | null;
  fields: CaptureFields;
  activity: { type: CrmActivityType; text: string };
  /** Which reader produced the proposal; shown so people know what to check. */
  source: 'local' | 'ai';
  summary?: string;
}

const CURRENCY_SYMBOLS: [RegExp, string][] = [
  [/¥|円|\bjpy\b/i, 'JPY'], [/\$|\busd\b|ドル/i, 'USD'], [/€|\beur\b|ユーロ/i, 'EUR'], [/£|\bgbp\b/i, 'GBP'],
];

const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, '千': 1e3, '万': 1e4, '億': 1e8 };

/** "¥1.2M", "$50k", "120万円", "1.5億", "50,000 USD", "3,000,000円". */
export function parseAmount(input: string): { amount: number; currency: string | null } | null {
  const pattern = /([¥$€£])?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m|b|千|万|億)?(?![a-z\d])\s*(円|ドル|ユーロ|jpy|usd|eur|gbp)?/gi;
  let best: { amount: number; currency: string | null; score: number } | null = null;
  for (const match of input.matchAll(pattern)) {
    const [whole, symbol, digits, scale, suffix] = match;
    const before = input.slice(Math.max(0, match.index! - 1), match.index!);
    const after = input.slice(match.index! + whole.length, match.index! + whole.length + 1);
    // Dates, percentages and times are not money.
    if (/[/\-:%]/.test(after) || /[/\-:]/.test(before) || (!symbol && !scale && !suffix)) continue;
    const value = Number(digits.replace(/,/g, '')) * (scale ? SCALE[scale.toLowerCase()] ?? 1 : 1);
    if (!Number.isFinite(value) || value <= 0) continue;
    const marker = `${symbol ?? ''}${suffix ?? ''}`;
    const currency = CURRENCY_SYMBOLS.find(([re]) => re.test(marker))?.[1] ?? null;
    const score = (symbol || suffix ? 2 : 0) + (scale ? 1 : 0);
    if (!best || score > best.score || (score === best.score && value > best.amount)) best = { amount: value, currency, score };
  }
  return best ? { amount: Math.round(best.amount * 100) / 100, currency: best.currency } : null;
}

const WEEKDAYS: [RegExp, number][] = [
  [/\b(sun(day)?)\b|日曜/i, 0], [/\b(mon(day)?)\b|月曜/i, 1], [/\b(tue(s(day)?)?)\b|火曜/i, 2], [/\b(wed(nesday)?)\b|水曜/i, 3],
  [/\b(thu(rs(day)?)?)\b|木曜/i, 4], [/\b(fri(day)?)\b|金曜/i, 5], [/\b(sat(urday)?)\b|土曜/i, 6],
];

const lastOfMonth = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);

interface FoundDate { date: string; index: number }

/** Every date expression with its position, resolved against today. */
export function findDates(input: string, today: string): FoundDate[] {
  const [year, month] = today.split('-').map(Number);
  const found: FoundDate[] = [];
  const push = (date: string | null, index: number) => { if (date && dayIndex(date) !== null) found.push({ date, index }); };
  for (const match of input.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    push(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`, match.index!);
  }
  for (const match of input.matchAll(/(?<![\d/.-])(\d{1,2})[/月](\d{1,2})日?(?![\d/])/g)) {
    const m = Number(match[1]); const d = Number(match[2]);
    if (m < 1 || m > 12 || d < 1 || d > 31) continue;
    let candidate = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (candidate < today) candidate = `${year + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    push(candidate, match.index!);
  }
  const relative: [RegExp, () => string][] = [
    [/\btoday\b|今日|本日/i, () => today],
    [/\btomorrow\b|明日/i, () => shiftDate(today, 1)],
    [/\bnext week\b|来週/i, () => shiftDate(today, 7)],
    [/\bend of next month\b|来月末/i, () => lastOfMonth(year, month)],
    [/\bend of (the )?month\b|今月末|(?<![来今])月末/i, () => lastOfMonth(year, month - 1)],
    [/(?<!end of )\bnext month\b|来月(?!末)/i, () => new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)],
    [/\bend of (the )?quarter\b|四半期末|期末/i, () => lastOfMonth(year, Math.floor((month - 1) / 3) * 3 + 2)],
  ];
  for (const [pattern, resolve] of relative) {
    const match = pattern.exec(input);
    if (match) push(resolve(), match.index);
  }
  const todayDay = new Date(`${today}T00:00:00Z`).getUTCDay();
  for (const [pattern, weekday] of WEEKDAYS) {
    const match = pattern.exec(input);
    if (!match) continue;
    const ahead = ((weekday - todayDay + 7) % 7) || 7;
    push(shiftDate(today, ahead), match.index);
  }
  // A phrase like "来月末" also matches "来月"; keep one date per position.
  const unique = new Map<number, FoundDate>();
  for (const item of found) if (!unique.has(item.index)) unique.set(item.index, item);
  return [...unique.values()].sort((a, b) => a.index - b.index);
}

const CLOSE_WORDS = /close|closing|sign|contract|decision|po\b|クローズ|契約|受注予定|成約予定|決裁|稟議|発注/i;
const ACTION_WORDS = /call|meet|meeting|follow|demo|visit|send|next|mtg|電話|打ち合わせ|打合せ|面談|訪問|次回|連絡|送付|デモ|フォロー|商談/i;

function nearby(input: string, index: number, pattern: RegExp): boolean {
  return pattern.test(input.slice(Math.max(0, index - 24), index + 16));
}

const STAGE_WORDS: [RegExp, string][] = [
  [/\b(won|closed won|signed)\b|受注(?!予定)|成約(?!予定)|契約締結/i, 'won'],
  [/\b(lost|closed lost)\b|失注|見送り|断られ/i, 'lost'],
  [/negotiat|交渉|値引|条件調整/i, 'negotiation'],
  [/proposal|quote|提案|見積/i, 'proposal'],
  [/qualif|ヒアリング|課題確認|予算確認/i, 'qualified'],
  [/\blead\b|リード|問い合わせ/i, 'lead'],
];

function activityType(input: string): CrmActivityType {
  if (/^(from|to|subject|件名):/im.test(input) || /\bemail\b|メール|返信/i.test(input)) return 'email';
  if (/meeting|met with|visit|demo|打ち合わせ|打合せ|面談|訪問|会議|mtg/i.test(input)) return 'meeting';
  if (/\bcall(ed)?\b|phone|電話|架電/i.test(input)) return 'call';
  return 'note';
}

/** The existing deal a note is about: the longest deal or account name it mentions. */
function matchDeal(input: string, deals: readonly CrmDeal[]): CrmDeal | null {
  const haystack = input.toLowerCase();
  let best: { deal: CrmDeal; length: number; open: boolean } | null = null;
  for (const deal of deals) {
    for (const name of [deal.name, deal.account]) {
      const needle = name?.trim().toLowerCase();
      if (!needle || needle.length < 2 || !haystack.includes(needle)) continue;
      const open = deal.outcome === 'open';
      // Prefer the deal's own name over its account, and open deals over closed ones.
      const length = needle.length + (name === deal.name ? 1000 : 0);
      if (!best || length > best.length || (length === best.length && open && !best.open)) best = { deal, length, open };
    }
  }
  return best?.deal ?? null;
}

function firstLine(input: string): string {
  return input.split('\n').map(line => line.trim()).find(line => line && !/^(from|to|cc|subject|件名|date):/i.test(line)) ?? input.trim();
}

/** The local, deterministic reading. Conservative: it proposes only what it can see. */
export function readCapture(input: string, today: string, deals: readonly CrmDeal[], stages: readonly CrmStage[]): CaptureProposal {
  const text = input.trim();
  const fields: CaptureFields = {};
  const deal = matchDeal(text, deals);
  const money = parseAmount(text);
  if (money) { fields.amount = money.amount; if (money.currency) fields.currency = money.currency; }
  const percent = /(\d{1,3})\s*%/.exec(text);
  if (percent && Number(percent[1]) <= 100) fields.probability = Number(percent[1]);
  const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(text);
  if (email) fields.email = email[0];
  for (const { date, index } of findDates(text, today)) {
    if (!fields.closeDate && nearby(text, index, CLOSE_WORDS)) fields.closeDate = date;
    else if (!fields.nextActionDate && date >= today) fields.nextActionDate = date;
  }
  const known = new Set(['won', 'lost', ...stages.map(stage => stage.id)]);
  const stage = STAGE_WORDS.find(([pattern, id]) => known.has(id) && pattern.test(text));
  if (stage) fields.stage = stage[1];
  const step = /(?:next(?: step)?|次回|ネクスト)[:：\s]+([^\n。.]+)/i.exec(text);
  if (step) fields.nextStep = step[1].trim().slice(0, 140);
  else if (fields.nextActionDate) {
    const sentence = text.split(/[\n。.!?]/).find(part => ACTION_WORDS.test(part) && findDates(part, today).length);
    if (sentence) fields.nextStep = sentence.trim().slice(0, 140);
  }
  if (!deal) fields.name = firstLine(text).slice(0, 80);
  return { dealId: deal?.id ?? null, fields, activity: { type: activityType(text), text: text.slice(0, 2000) }, source: 'local' };
}

// ── AI reading ──────────────────────────────────────────────────────────────

/** The instruction sent with a capture. The model returns JSON only. */
export function captureInstruction(input: string, today: string, deals: readonly CrmDeal[], stages: readonly CrmStage[]): string {
  const catalogue = deals.filter(deal => deal.outcome === 'open').slice(0, 60)
    .map(deal => `- id=${deal.id} | ${deal.name} | ${deal.account ?? '-'} | stage=${deal.stage?.id ?? '-'}`).join('\n');
  return [
    'You are the data-entry engine of a CRM. Do not call any tools. Reply with one JSON object and nothing else.',
    `Today is ${today}. Resolve relative dates to YYYY-MM-DD.`,
    `Allowed stage ids: ${[...stages.map(stage => stage.id), 'won', 'lost'].join(', ')}.`,
    'Open deals (pick dealId only when the note is clearly about one of them, otherwise null for a new deal):',
    catalogue || '(none)',
    'Schema: {"dealId": string|null, "summary": string, "activityType": "call"|"email"|"meeting"|"note",',
    ' "fields": {"name"?: string, "account"?: string, "contact"?: string, "email"?: string, "stage"?: string, "amount"?: number,',
    ' "currency"?: "ISO 4217 code", "probability"?: 0-100, "closeDate"?: "YYYY-MM-DD", "nextActionDate"?: "YYYY-MM-DD", "nextStep"?: string}}',
    'Include a field only when the note states or clearly implies it. Never invent numbers, names or dates.',
    'summary: one short line, in the language of the note, of what happened.',
    'nextStep: an imperative phrase in the language of the note.',
    'Note:',
    '"""', input.slice(0, 6000), '"""',
  ].join('\n');
}

/** The first balanced JSON object in a model reply, or null. */
export function extractJson(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf('{');
  if (start < 0) return null;
  let depth = 0; let inString = false; let escaped = false;
  for (let index = start; index < reply.length; index += 1) {
    const char = reply[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      try {
        const value = JSON.parse(reply.slice(start, index + 1));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
      } catch { return null; }
    }
  }
  return null;
}

const clean = (value: unknown, max = 140) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

/** Validates the AI's reading. Anything that fails a rule is dropped, never coerced. */
export function parseAiCapture(reply: string, input: string, deals: readonly CrmDeal[], stages: readonly CrmStage[]): CaptureProposal | null {
  const json = extractJson(reply);
  if (!json) return null;
  const raw = (json.fields && typeof json.fields === 'object' ? json.fields : {}) as Record<string, unknown>;
  const fields: CaptureFields = {};
  const name = clean(raw.name, 80); if (name) fields.name = name;
  const account = clean(raw.account, 80); if (account) fields.account = account;
  const contact = clean(raw.contact, 80); if (contact) fields.contact = contact;
  const email = clean(raw.email, 120); if (email && /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(email)) fields.email = email;
  const stage = stageKey(clean(raw.stage, 40));
  if (stage && (stage === 'won' || stage === 'lost' || stages.some(item => item.id === stage))) fields.stage = stage;
  if (typeof raw.amount === 'number' && Number.isFinite(raw.amount) && raw.amount >= 0) fields.amount = raw.amount;
  const currency = clean(raw.currency, 3); if (currency && /^[A-Za-z]{3}$/.test(currency)) fields.currency = currency.toUpperCase();
  if (typeof raw.probability === 'number' && raw.probability >= 0 && raw.probability <= 100) fields.probability = Math.round(raw.probability);
  for (const key of ['closeDate', 'nextActionDate'] as const) {
    const value = clean(raw[key], 10);
    if (value && dayIndex(value) !== null) fields[key] = value;
  }
  const nextStep = clean(raw.nextStep); if (nextStep) fields.nextStep = nextStep;
  const dealId = typeof json.dealId === 'string' && deals.some(deal => deal.id === json.dealId) ? json.dealId : null;
  if (!dealId && !fields.name) fields.name = firstLine(input).slice(0, 80);
  const type = clean(json.activityType, 10);
  return {
    dealId, fields, source: 'ai', summary: clean(json.summary, 200),
    activity: { type: (ACTIVITY_TYPES as readonly string[]).includes(type ?? '') ? type as CrmActivityType : activityType(input), text: input.trim().slice(0, 2000) },
  };
}

/** Field-by-field changes a proposal makes to a deal, for the review step. */
export function captureChanges(proposal: CaptureProposal, deal: CrmDeal | null): { key: keyof CaptureFields; from: string | number | null; to: string | number }[] {
  const current: Record<keyof CaptureFields, string | number | null> = {
    name: deal?.name ?? null, account: deal?.account ?? null, contact: deal?.contact ?? null, email: deal?.email ?? null,
    stage: deal?.stage?.id ?? null, amount: deal?.amount ?? null, currency: deal?.currency ?? null, probability: deal?.probability ?? null,
    closeDate: deal?.closeDate ?? null, nextActionDate: deal?.nextActionDate ?? null, nextStep: deal?.nextStep ?? null,
  };
  return (Object.keys(proposal.fields) as (keyof CaptureFields)[])
    .filter(key => proposal.fields[key] !== undefined && proposal.fields[key] !== current[key])
    .filter(key => !(deal && key === 'name'))
    .map(key => ({ key, from: current[key], to: proposal.fields[key]! }));
}
