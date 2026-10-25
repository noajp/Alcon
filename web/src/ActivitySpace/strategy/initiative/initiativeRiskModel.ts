// =============================================================
// Initiative risk — the cross-section, computed.
//
// A Initiative's burn-up answers "will we make it". This answers the question
// that comes next and is the only one a commander can act on: *what is hurting,
// and where does the next person go*. Every number here is chosen so that
// reading it moves somebody. A number that cannot move anybody is decoration,
// and is either dropped or reported as unmeasurable — never rendered as a
// confident zero (see `scheduled` below).
//
// Pure on purpose: no React, no Supabase, no clock of its own. `now` is an
// argument so the thresholds are testable and so a test does not have to wait
// twenty-five minutes to see a stall.
// =============================================================

import { isOpenStatus } from '@/Function/shared/completion';
import { translate } from '@/Function/i18n/I18nProvider';

/** The newest progress signal for one Element, already resolved by the caller. */
export interface RiskElement {
  id: string;
  display_id: string | null;
  title: string;
  status: string | null;
  due_date: string | null;
  updated_at: string | null;
  /** Every Object this Element is homed in (multi-homing is normal). */
  objectIds: string[];
  assignees: { id: string; name: string }[];
  /** ms epoch of the newest progress comment, or null when it has never been
   *  reported on. Kept separate from `updated_at` deliberately — see below. */
  lastProgressAt: number | null;
}

export interface RiskObject {
  id: string;
  name: string;
  /** Carried so a finding can be opened; the computation never reads it. */
  domainId?: string | null;
  /** This Object's Domain's own thresholds (Settings > Elements > SLAs),
   *  already parsed by the caller. Only stallMinutes / idleHours /
   *  dueSoonDays are honoured here — they are judgements about one Object's
   *  work. concentrationThreshold measures one Worker's share of the whole
   *  Initiative and stays on `options`. */
  thresholds?: InitiativeRiskOptions;
}

export type RiskReason = 'overdue' | 'stalled' | 'blocked' | 'due_soon' | 'idle';

export interface ObjectRisk {
  object: RiskObject;
  open: number;
  inFlight: number;
  overdue: number;
  blocked: number;
  stalled: number;
  /** Open, due inside the horizon, and nobody has started it. */
  dueSoon: number;
  /** The nearest due date among this Object's `dueSoon` Elements. */
  dueSoonBy: string | null;
  /** ms since the newest signal anywhere in this Object; null when it has none. */
  quietForMs: number | null;
  /** ms of silence on the *longest-silent stalled Element*, which is not the
   *  same as `quietForMs`: a neighbouring Element being edited refreshes the
   *  Object's clock while the stopped one stays stopped. Reporting the Object's
   *  figure on a stalled row would understate the outage that matters. */
  stalledQuietMs: number | null;
  reason: RiskReason;
}

export interface WorkerLoad {
  workerId: string;
  name: string;
  open: number;
  /** 0..1 of all assignment slots on open Elements in the Initiative. */
  share: number;
}

export interface InitiativeRiskReport {
  /** Open = not done, not cancelled. The denominator for everything else. */
  openTotal: number;
  overdue: number;
  /** Open, due inside the horizon, and not started by anyone.
   *
   *  Overdue alone is a post-mortem instrument: by the time it moves, the date
   *  is already missed and no reassignment can undo it. This is the same
   *  measurement taken early enough to act on, and on a real Initiative it is
   *  the one that fires — measured on a live board, 0 Elements were overdue
   *  while 4 were due inside three days with nobody started on them. */
  dueSoon: number;
  stalled: number;
  blocked: number;
  /** Open Elements with nobody on them. */
  unstaffed: number;
  /** Open Elements carrying a due date. When this is 0 the schedule is not
   *  late — it is *unmeasured*, and the UI must say so rather than show
   *  `overdue: 0` as if the Initiative were on time. */
  scheduled: number;
  /** Only the Objects that fire, worst first. */
  objects: ObjectRisk[];
  /** Every Worker holding open work, heaviest first. */
  load: WorkerLoad[];
  /** Set when one Worker holds more than `concentrationThreshold` of the
   *  Initiative's open work — the Initiative is single-threaded through them. */
  concentration: WorkerLoad | null;
}

export interface InitiativeRiskOptions {
  /** Minutes of silence that make an in_progress Element stalled.
   *  Same default as `ops/stall-check.mjs --warn-minutes`. */
  stallMinutes?: number;
  /** Hours of silence that make an Object with open-but-unstarted work idle. */
  idleHours?: number;
  /** Days ahead that count as "due soon". */
  dueSoonDays?: number;
  /** Share of open work on one Worker that counts as single-threaded. */
  concentrationThreshold?: number;
}

export const DEFAULT_STALL_MINUTES = 25;
export const DEFAULT_IDLE_HOURS = 24;
export const DEFAULT_DUE_SOON_DAYS = 3;
export const DEFAULT_CONCENTRATION = 0.5;

/** The defaults keyed the way `domains.risk_thresholds` stores them, so the
 *  Settings surface can show "what you get if you leave this blank" without
 *  keeping its own copy of the numbers. */
export const RISK_THRESHOLD_DEFAULTS = {
  due_soon_days: DEFAULT_DUE_SOON_DAYS,
  stall_minutes: DEFAULT_STALL_MINUTES,
  idle_hours: DEFAULT_IDLE_HOURS,
} as const;

// Upper bounds well past any sane SLA policy (10 years / roughly a year of
// continuous silence), not just "finite". `due_soon_days` in particular has
// to stay far inside `Date`'s safe arithmetic range: `dateKeyPlus` calls
// `setDate(getDate() + days)`, and an extreme value (a stray extra zero) can
// push the `Date` out of range, turning every `dateKey` it produces into the
// string "NaN-NaN-NaN" — which then compares as *greater than* any real
// date string, so `isDueSoon`'s horizon check silently flags every open,
// dated Element in the Domain as due soon instead of erroring.
export const RISK_THRESHOLD_MAX = {
  due_soon_days: 3650,
  stall_minutes: 525_600, // 1 year
  idle_hours: 8_760, // 1 year
} as const;

function boundedPositiveNumber(v: unknown, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : undefined;
}

/** Reads a Domain's stored thresholds (`domains.risk_thresholds`, jsonb —
 *  snake_case keys, every one optional) into the model's options. jsonb can
 *  hold anything, so a missing, non-numeric, zero, negative, or absurdly
 *  large value falls back to the default rather than poisoning a report. */
export function parseRiskThresholds(raw: unknown): InitiativeRiskOptions {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: InitiativeRiskOptions = {};
  const due = boundedPositiveNumber(r.due_soon_days, RISK_THRESHOLD_MAX.due_soon_days);
  const stall = boundedPositiveNumber(r.stall_minutes, RISK_THRESHOLD_MAX.stall_minutes);
  const idle = boundedPositiveNumber(r.idle_hours, RISK_THRESHOLD_MAX.idle_hours);
  if (due !== undefined) out.dueSoonDays = due;
  if (stall !== undefined) out.stallMinutes = stall;
  if (idle !== undefined) out.idleHours = idle;
  return out;
}

/** Statuses that mean nobody has picked the work up yet. */
const UNSTARTED = new Set(['backlog', 'todo']);

/** Not done, not cancelled — the work still on the Initiative's plate. */
export function isOpen(el: RiskElement): boolean {
  return isOpenStatus(el.status);
}

/** Local-calendar `YYYY-MM-DD` for a timestamp. Due dates are calendar dates,
 *  so comparing them against a UTC instant would make work "overdue" for the
 *  last hours of the day in every timezone west of UTC. */
export function dateKey(now: number): string {
  const d = new Date(now);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * The newest moment this Element said anything. The progress comment is the
 * heartbeat, not `updated_at`: an edit — a title fix, a label, a re-parent —
 * moves the row's timestamp without anybody working, so `updated_at` cannot
 * tell a stopped agent from healthy work. `updated_at` is only the fallback
 * for an Element that was moved into `in_progress` and never claimed, which is
 * exactly how `ops/stall-check.mjs` reads it.
 */
export function lastSignalAt(el: RiskElement): number | null {
  if (el.lastProgressAt !== null) return el.lastProgressAt;
  if (!el.updated_at) return null;
  const t = Date.parse(el.updated_at);
  return Number.isNaN(t) ? null : t;
}

/**
 * Stalled, defined once. This is `ops/stall-check.mjs`'s predicate and must
 * stay it: in_progress, and no progress report for longer than the threshold.
 * If the loop's watcher and this pane disagreed about what "stalled" means,
 * the board and the screen would be reporting two different Initiatives.
 */
export function isStalled(el: RiskElement, now: number, stallMinutes = DEFAULT_STALL_MINUTES): boolean {
  if (el.status !== 'in_progress') return false;
  const signal = lastSignalAt(el);
  // No signal at all is not a stall — it is an absence of measurement, and
  // claiming a stall on it would fire on every freshly imported row.
  if (signal === null) return false;
  return now - signal > stallMinutes * 60_000;
}

/** `YYYY-MM-DD` a whole number of days after a timestamp's local calendar day. */
export function dateKeyPlus(now: number, days: number): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return dateKey(d.getTime());
}

export function isOverdue(el: RiskElement, today: string): boolean {
  return isOpen(el) && el.due_date !== null && el.due_date < today;
}

/**
 * Due inside the horizon and nobody has started. `in_progress` and `review`
 * are excluded on purpose: work that is moving toward a near date is the
 * normal, healthy shape of a Initiative, and counting it would bury the rows
 * that actually need somebody under the ones that already have somebody.
 */
export function isDueSoon(el: RiskElement, today: string, horizon: string): boolean {
  if (!isOpen(el) || el.due_date === null) return false;
  if (!UNSTARTED.has(el.status ?? '')) return false;
  return el.due_date >= today && el.due_date <= horizon;
}

// Ordered by how soon the reader has to act, not by how bad it sounds.
const REASON_RANK: Record<RiskReason, number> = {
  overdue: 0,
  stalled: 1,
  blocked: 2,
  due_soon: 3,
  idle: 4,
};

/**
 * The whole cross-section in one pass.
 *
 * `objects` is the Initiative's Object scope; `elements` is every Element homed
 * in any of them. Elements homed in none of the scoped Objects are ignored, so
 * the caller may pass a wider fetch without skewing the counts.
 */
export function computeInitiativeRisk(
  objects: RiskObject[],
  elements: RiskElement[],
  now: number,
  options: InitiativeRiskOptions = {},
): InitiativeRiskReport {
  const stallMinutes = options.stallMinutes ?? DEFAULT_STALL_MINUTES;
  const idleHours = options.idleHours ?? DEFAULT_IDLE_HOURS;
  const dueSoonDays = options.dueSoonDays ?? DEFAULT_DUE_SOON_DAYS;
  const concentrationThreshold = options.concentrationThreshold ?? DEFAULT_CONCENTRATION;
  const today = dateKey(now);

  const scope = new Set(objects.map((o) => o.id));
  const scoped = elements.filter((el) => el.objectIds.some((id) => scope.has(id)));

  const open = scoped.filter(isOpen);

  let overdue = 0;
  let blocked = 0;
  let unstaffed = 0;
  let scheduled = 0;
  for (const el of open) {
    if (el.due_date !== null) scheduled += 1;
    if (isOverdue(el, today)) overdue += 1;
    if (el.status === 'blocked') blocked += 1;
    if (el.assignees.length === 0) unstaffed += 1;
  }

  // ---- per-Object roll-up ------------------------------------------------
  // Distinct illnesses, each with its own medicine. Collapsing them into one
  // "unhealthy Object" count would name the symptom and hide the remedy:
  //   overdue  — a date is already missed. Escalate; reassignment cannot undo it.
  //   stalled  — somebody started and stopped. Go find out why.
  //   blocked  — something outside the Object is holding it. Clear it.
  //   due_soon — a near date and nobody has started. Put the next person here.
  //   idle     — open work, nothing started, and gone quiet. Staff it.
  // An Object reports only its worst one; the counts for the others ride along
  // so a row can say more than its headline.
  //
  // Stalled / due-soon / idle are judged with the thresholds of the Object
  // being assessed — its Domain's own idea of "too quiet" and "too close"
  // (Settings > Elements > SLAs) — falling back to the Initiative-level
  // options, then the defaults. The Initiative totals are the union across
  // Objects: a multi-homed Element counts once, and counts if any home flags
  // it. With no per-Object thresholds this is the same arithmetic as one
  // global pass.
  const stalledSet = new Set<string>();
  const dueSoonSet = new Set<string>();
  const risks: ObjectRisk[] = [];
  for (const object of objects) {
    const own = scoped.filter((el) => el.objectIds.includes(object.id));
    if (own.length === 0) continue;
    const t = object.thresholds ?? {};
    const ownStallMinutes = t.stallMinutes ?? stallMinutes;
    const ownIdleMs = (t.idleHours ?? idleHours) * 3_600_000;
    const ownHorizon = dateKeyPlus(now, t.dueSoonDays ?? dueSoonDays);

    const ownOpen = own.filter(isOpen);
    const inFlight = own.filter((el) => el.status === 'in_progress').length;
    const ownOverdue = ownOpen.filter((el) => isOverdue(el, today)).length;
    const ownBlocked = ownOpen.filter((el) => el.status === 'blocked').length;
    const stalledOwn = own.filter((el) => isStalled(el, now, ownStallMinutes));
    for (const el of stalledOwn) stalledSet.add(el.id);
    const ownStalled = stalledOwn.length;
    const stalledSignals = stalledOwn.map(lastSignalAt).filter((t): t is number => t !== null);
    const stalledQuietMs = stalledSignals.length > 0 ? now - Math.min(...stalledSignals) : null;
    const soon = ownOpen.filter((el) => isDueSoon(el, today, ownHorizon));
    for (const el of soon) dueSoonSet.add(el.id);
    const dueSoonBy = soon.reduce<string | null>(
      (min, el) => (min === null || (el.due_date !== null && el.due_date < min) ? el.due_date : min),
      null,
    );

    const signals = own.map(lastSignalAt).filter((t): t is number => t !== null);
    const quietForMs = signals.length > 0 ? now - Math.max(...signals) : null;

    let reason: RiskReason | null = null;
    if (ownOverdue > 0) reason = 'overdue';
    else if (ownStalled > 0) reason = 'stalled';
    else if (ownBlocked > 0) reason = 'blocked';
    else if (soon.length > 0) reason = 'due_soon';
    else if (ownOpen.length > 0 && inFlight === 0 && quietForMs !== null && quietForMs > ownIdleMs) reason = 'idle';
    if (reason === null) continue;

    risks.push({
      object,
      open: ownOpen.length,
      inFlight,
      overdue: ownOverdue,
      blocked: ownBlocked,
      stalled: ownStalled,
      dueSoon: soon.length,
      dueSoonBy,
      quietForMs,
      stalledQuietMs,
      reason,
    });
  }
  risks.sort((a, b) => {
    const r = REASON_RANK[a.reason] - REASON_RANK[b.reason];
    if (r !== 0) return r;
    // Deadlines sort by the clock they are racing, not by how long they have
    // been quiet — the nearest date is the one that decides who moves first.
    if (a.reason === 'due_soon' && a.dueSoonBy !== null && b.dueSoonBy !== null) {
      const d = a.dueSoonBy.localeCompare(b.dueSoonBy);
      if (d !== 0) return d;
      if (a.dueSoon !== b.dueSoon) return b.dueSoon - a.dueSoon;
    }
    // Otherwise the one that has been wrong longest goes first; ties fall back
    // to the bigger pile of open work.
    if (a.reason === 'stalled') {
      const s = (b.stalledQuietMs ?? 0) - (a.stalledQuietMs ?? 0);
      if (s !== 0) return s;
    }
    const q = (b.quietForMs ?? 0) - (a.quietForMs ?? 0);
    if (q !== 0) return q;
    return b.open - a.open;
  });

  // ---- load --------------------------------------------------------------
  // Counted from `element_assignees` — the same edge the Workload surface
  // aggregates. Deliberately a headcount of open Elements rather than the
  // hour model Workload draws: that one spreads estimated hours across
  // start/due dates, and on a board where almost nothing carries dates it
  // would render every Worker flat at zero.
  const byWorker = new Map<string, WorkerLoad>();
  let slots = 0;
  for (const el of open) {
    for (const a of el.assignees) {
      slots += 1;
      const row = byWorker.get(a.id);
      if (row) row.open += 1;
      else byWorker.set(a.id, { workerId: a.id, name: a.name, open: 1, share: 0 });
    }
  }
  const load = Array.from(byWorker.values());
  for (const row of load) row.share = slots > 0 ? row.open / slots : 0;
  load.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));

  const top = load[0] ?? null;
  const concentration = top && load.length > 0 && top.share > concentrationThreshold ? top : null;

  return {
    openTotal: open.length,
    overdue,
    dueSoon: dueSoonSet.size,
    stalled: stalledSet.size,
    blocked,
    unstaffed,
    scheduled,
    objects: risks,
    load,
    concentration,
  };
}

/** "27h" / "3d" / "12m" — the coarse age of a silence. */
export function formatQuiet(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return translate('{n}m', { n: Math.max(minutes, 1) });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return translate('{n}h', { n: hours });
  return translate('{n}d', { n: Math.floor(hours / 24) });
}
