// A Strategy's evaluation, read off the records its finished runs left —
// for the Evaluation tab.
//
// ATTRIBUTION (load-bearing): aggregation is BY ELEMENT SET, never by
// run_outcomes.strategy_id. That column is deliberately honest-single
// (outcomeCollector's strategyIdOf): a run serving several Strategies names
// none (null) rather than picking one, so aggregating by it would silently
// undercount every multi-Strategy Object. The tab instead takes the
// Strategy's Elements — the exact set its Objects carry — and reads outcomes
// by element_id. An Element in two Strategies counts in both (the
// useInitiativeHealth rule); an Element in two Objects of THIS Strategy
// counts once in the headline and is partitioned under the first Object
// that carries it, so the per-Object rows sum to the headline.
//
// Counts are as visible to the viewer: RLS hides what it hides, and the
// rows the hook returns are all this model ever sees.
//
// DENOMINATOR DISCIPLINE: a rate renders only at n >= RATE_MIN_N in its
// denominator (the codebase's own habit — calibration speaks at pairs >= 10,
// autonomy at streaks of 5/15). Below that the counts stand alone; there is
// no numeric quality score anywhere in this model — a single number over a
// judgement call would be fake precision (design D8).
//
// DELIVERABLE SIZE (PR2): agent_artifacts carries no size column, so
// size is computed here from the content the hook reads — its length,
// and for markdown a heading count — with the per-format floors in
// artifactSizeOf. It is labelled as size everywhere it renders
// (character counts, a "Short" flag): the cheap tripwire beside the
// verifier's judgement, never merged with it into a score (D8).
// Whether a deliverable is substantial or hollow as a JUDGEMENT —
// depth classification — is PR3's verdict work, not this model's.
//
// Pure. `now` is a parameter; the caller owns the clock. The hook
// (hooks/strategyEvaluationData.ts) reads the rows and parses the runs'
// jsonb at its boundary (auditModel's parsers); this file decides what of
// them is worth a person's eye.

import type { DefinitionRevisionCandidate, DefinitionTest, VerifierCalibration } from '@/types/database';
import type { RunVerdict } from '@/Function/audit/auditModel';
import { calibrationSummaryOf, type CalibrationSummary } from '@/AIP/harness/calibrationModel';
import { readTestVerdict, testFreshness } from '@/AIP/harness/definitionTestModel';
// The data shapes live in the hook (hooks may not import this layer);
// type-only, so this model stays pure at runtime. Re-exported here so
// the panel and tests have the one import surface the design named.
import type {
  EvaluationArtifactRow, EvaluationOutcomeRow, EvaluationPeriod, EvaluationRunRow,
} from '@/hooks/strategyEvaluationData';
export type {
  EvaluationArtifactRow, EvaluationOutcomeRow, EvaluationPeriod, EvaluationRunRow,
} from '@/hooks/strategyEvaluationData';

export const EVALUATION_PERIODS: readonly EvaluationPeriod[] = ['7d', '28d', '90d', 'all'];

/** The default period: calibration's trailing window, B6's cluster window. */
export const DEFAULT_EVALUATION_PERIOD: EvaluationPeriod = '28d';

const PERIOD_DAYS: Record<Exclude<EvaluationPeriod, 'all'>, number> = { '7d': 7, '28d': 28, '90d': 90 };

/** Days the period spans, or null for All (no lower bound). */
function periodDays(period: EvaluationPeriod): number | null {
  return period === 'all' ? null : PERIOD_DAYS[period];
}

/** The period's start instant (ms). All starts at the epoch. */
function periodStartMs(period: EvaluationPeriod, now: number): number {
  const days = periodDays(period);
  return days === null ? 0 : now - days * 86_400_000;
}

/** A rate is shown only once its denominator reaches this many. */
const RATE_MIN_N = 5;

/** A rate with its denominator kept beside it: `rate` is null below
 *  RATE_MIN_N, so a surface can show the counts and withhold the rate
 *  instead of inventing precision. */
export interface Rate {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export function rateOf(numerator: number, denominator: number): Rate {
  return {
    numerator,
    denominator,
    rate: denominator >= RATE_MIN_N ? numerator / denominator : null,
  };
}

// ── Deliverable size ─────────────────────────────────────────────────

export interface ArtifactSize {
  /** Characters in the content, surrounding whitespace excluded — a
   *  whitespace-only deliverable measures 0, not its padding. */
  chars: number;
  /** Markdown heading count (lines opening with #). Null for other
   *  formats: a csv or a json has no sections to count. */
  sections: number | null;
  /** Below the format's size floor. A SIZE fact only — it renders as
   *  "Short", never as a quality word: whether a short deliverable is
   *  also a poor one is a judgement (the verifier's, PR3's depth),
   *  not this flag's. */
  short: boolean;
}

/** Size floors per format, in characters. Html carries its own markup,
 *  so its floor sits higher; csv/json are dense — each character there
 *  carries a field or a key — so theirs sit lower. An unlisted format
 *  uses the plain-text floor. */
const SHORT_BELOW_CHARS: Record<string, number> = {
  markdown: 200,
  text: 200,
  html: 500,
  csv: 100,
  json: 100,
};
const DEFAULT_SHORT_BELOW_CHARS = 200;

/** The deterministic size signal for one artifact's content, computed
 *  by code (design §5.2). No model, no judgement — length, and for
 *  markdown the heading count. */
export function artifactSizeOf(content: string, format: string): ArtifactSize {
  const trimmed = content.trim();
  const chars = trimmed.length;
  const sections = format === 'markdown'
    ? trimmed.split('\n').filter((line) => /^#{1,6}(\s|$)/.test(line)).length
    : null;
  const floor = SHORT_BELOW_CHARS[format] ?? DEFAULT_SHORT_BELOW_CHARS;
  return { chars, sections, short: chars < floor };
}

/** One deliverable with everything the tab shows about it: which
 *  Element it belongs to, its size signal, and the verifier evidence
 *  that actually names it. */
export interface DeliverableEvaluation {
  artifact: EvaluationArtifactRow;
  elementTitle: string;
  size: ArtifactSize;
  /** The producing run's verdict, ONLY when that verdict's evidence
   *  names this artifact (evidence.artifactIds): the verifier was
   *  shown this deliverable, so its result and its gaps belong on
   *  this row. Null when no verdict names it — absence is shown as
   *  absence, never inferred from the run merely having a verdict
   *  about other artifacts. */
  verifier: Pick<RunVerdict, 'result' | 'gaps'> | null;
}

/** Worst-first for deliverables, as a named definition: short-by-size
 *  first (the size tripwire), then most recently updated first; the
 *  title breaks ties so the order is a definition, not an accident. */
function compareDeliverables(a: DeliverableEvaluation, b: DeliverableEvaluation): number {
  return Number(b.size.short) - Number(a.size.short)
    || Date.parse(b.artifact.updated_at) - Date.parse(a.artifact.updated_at)
    || a.artifact.title.localeCompare(b.artifact.title);
}

export interface EvaluationObjectScope {
  id: string;
  name: string;
  elements: { id: string; title: string; display_id?: string | null }[];
}

export interface EvaluationInputs {
  objects: readonly EvaluationObjectScope[];
  outcomes: readonly EvaluationOutcomeRow[];
  runs: readonly EvaluationRunRow[];
  artifacts: readonly EvaluationArtifactRow[];
  calibrations: readonly VerifierCalibration[];
  candidates: readonly DefinitionRevisionCandidate[];
  tests: readonly DefinitionTest[];
  definitionNames: Readonly<Record<string, string>>;
  period: EvaluationPeriod;
  now: number;
}

/** The counts every level of the report shares, so the headline, an
 *  Object row and an Element row can never disagree about what a
 *  "send-back" or an "unchecked finish" is. */
export interface EvaluationTallies {
  finishes: number;
  completed: number;
  partial: number;
  blocked: number;
  pass: number;
  fail: number;
  /** Finishes nobody checked: verdict 'unchecked' or no verdict at all.
   *  Counted and named, never folded into the pass rate. */
  unchecked: number;
  accepted: number;
  rejected: number;
  rework: number;
  /** Outcomes still reading 'none' — the signal window (35 days) may
   *  still be open; absence is a value, not agreement. */
  unsignalled: number;
  revisions: number;
  costUsd: number;
  readingsApplied: number;
  readingsHeld: number;
  passRate: Rate;
  /** accepted / (accepted + rejected + rework), over signalled only. */
  agreementRate: Rate;
  /** rework / signalled. */
  sendBackRate: Rate;
  /** fail / (pass + fail). */
  failRate: Rate;
}

function tally(outcomes: readonly EvaluationOutcomeRow[]): EvaluationTallies {
  const t: Omit<EvaluationTallies, 'passRate' | 'agreementRate' | 'sendBackRate' | 'failRate'> = {
    finishes: outcomes.length, completed: 0, partial: 0, blocked: 0,
    pass: 0, fail: 0, unchecked: 0,
    accepted: 0, rejected: 0, rework: 0, unsignalled: 0,
    revisions: 0, costUsd: 0, readingsApplied: 0, readingsHeld: 0,
  };
  for (const o of outcomes) {
    if (o.outcome === 'completed') t.completed += 1;
    else if (o.outcome === 'partial') t.partial += 1;
    else if (o.outcome === 'blocked') t.blocked += 1;
    if (o.verdict_result === 'pass') t.pass += 1;
    else if (o.verdict_result === 'fail') t.fail += 1;
    else t.unchecked += 1;
    if (o.human_signal === 'accepted') t.accepted += 1;
    else if (o.human_signal === 'rejected') t.rejected += 1;
    else if (o.human_signal === 'rework') t.rework += 1;
    else t.unsignalled += 1;
    t.revisions += o.revisions || 0;
    t.costUsd += Number(o.cost_usd) || 0;
    t.readingsApplied += o.readings_applied || 0;
    t.readingsHeld += o.readings_held || 0;
  }
  const signalled = t.accepted + t.rejected + t.rework;
  return {
    ...t,
    passRate: rateOf(t.pass, t.pass + t.fail),
    agreementRate: rateOf(t.accepted, signalled),
    sendBackRate: rateOf(t.rework, signalled),
    failRate: rateOf(t.fail, t.pass + t.fail),
  };
}

export interface FailureMixEntry { failureClass: string; count: number }

/** Failure classes over a set of runs, most frequent first, class name
 *  breaking ties so the order is a definition, not an accident. */
function failureMixOf(runs: readonly EvaluationRunRow[]): FailureMixEntry[] {
  const counts = new Map<string, number>();
  for (const r of runs) {
    if (!r.failureDetail) continue;
    counts.set(r.failureDetail.failureClass, (counts.get(r.failureDetail.failureClass) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([failureClass, count]) => ({ failureClass, count }))
    .sort((a, b) => b.count - a.count || a.failureClass.localeCompare(b.failureClass));
}

export type WorstRunReason = 'verdict-fail' | 'rework' | 'failure' | 'unchecked';

export interface WorstRun {
  outcomeId: string;
  runId: string;
  elementId: string;
  finishedAt: string;
  outcome: string | null;
  verdictResult: string | null;
  humanSignal: string;
  revisions: number;
  costUsd: number;
  reasons: WorstRunReason[];
  /** The parsed run record, when the run row was readable. */
  run: EvaluationRunRow | null;
  artifacts: DeliverableEvaluation[];
}

export interface ElementEvaluation extends EvaluationTallies {
  elementId: string;
  title: string;
  displayId: string | null;
  objectId: string | null;
  lastFinishedAt: string | null;
  worstRuns: WorstRun[];
}

export interface ObjectEvaluation extends EvaluationTallies {
  objectId: string;
  name: string;
  topFailureClass: string | null;
  failureCount: number;
  lastFinishedAt: string | null;
  elements: ElementEvaluation[];
}

export interface DefinitionEvaluation {
  definitionId: string;
  name: string;
  finishes: number;
  pass: number;
  fail: number;
  unchecked: number;
  calibration: CalibrationSummary | null;
  candidate: DefinitionRevisionCandidate | null;
  tests: { total: number; passing: number; failing: number; stale: number };
}

export interface TrendBucket {
  /** Bucket start (ISO date, UTC). */
  key: string;
  startMs: number;
  finishes: number;
  pass: number;
  fail: number;
  unchecked: number;
  sendBacks: number;
}

export interface EvaluationHeadline extends EvaluationTallies {
  failureMix: FailureMixEntry[];
  topFailure: FailureMixEntry | null;
  failedFinishes: number;
  /** Total spend over finishes a person accepted; null when none was. */
  costPerAccepted: number | null;
}

export interface EvaluationReport {
  headline: EvaluationHeadline;
  objects: ObjectEvaluation[];
  definitions: DefinitionEvaluation[];
  /** The period's deliverables across the Strategy, worst-first by
   *  size signal then recency (compareDeliverables). */
  deliverables: DeliverableEvaluation[];
  trend: TrendBucket[];
  /** Outcomes in period whose element is outside the scope — should be
   *  zero from the hook's read; kept so a leak is visible, not silent. */
  outOfScope: number;
}

const WORST_RUN_CAP = 10;

function worstReasons(o: EvaluationOutcomeRow, run: EvaluationRunRow | null): WorstRunReason[] {
  const reasons: WorstRunReason[] = [];
  if (o.verdict_result === 'fail' || run?.verdict?.result === 'fail') reasons.push('verdict-fail');
  if (o.human_signal === 'rework' || o.human_signal === 'rejected') reasons.push('rework');
  if (run?.failureDetail) reasons.push('failure');
  if (reasons.length === 0 && o.verdict_result !== 'pass' && o.verdict_result !== 'fail') reasons.push('unchecked');
  return reasons;
}

function isWorst(o: EvaluationOutcomeRow, run: EvaluationRunRow | null): boolean {
  return o.verdict_result === 'fail' || run?.verdict?.result === 'fail'
    || o.human_signal === 'rework' || o.human_signal === 'rejected'
    || !!run?.failureDetail
    || (o.verdict_result !== 'pass' && o.verdict_result !== 'fail');
}

/** Worst-first, as a named definition (design D5): send-back rate, then
 *  verdict fail rate, then finishes desc. Raw rates sort (display keeps
 *  its threshold); a scope with no signal yet sorts by its fail side, not
 *  as if it had been sent back. Objects with no finishes go last. */
function compareObjectsWorstFirst(a: ObjectEvaluation, b: ObjectEvaluation): number {
  const aHas = a.finishes > 0 ? 0 : 1;
  const bHas = b.finishes > 0 ? 0 : 1;
  if (aHas !== bHas) return aHas - bHas;
  const sendBack = (x: ObjectEvaluation) => {
    const signalled = x.accepted + x.rejected + x.rework;
    return signalled > 0 ? x.rework / signalled : 0;
  };
  const fail = (x: ObjectEvaluation) => {
    const checked = x.pass + x.fail;
    return checked > 0 ? x.fail / checked : 0;
  };
  return sendBack(b) - sendBack(a)
    || fail(b) - fail(a)
    || b.finishes - a.finishes
    || a.name.localeCompare(b.name);
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Finishes per bucket: a day per bucket for 7/28 days, a week for
 *  90 days / All. For All, buckets run from the earliest finish in
 *  scope to now. Buckets are UTC days, so an edge outcome belongs to
 *  exactly one bucket. */
export function trendBuckets(
  outcomes: readonly EvaluationOutcomeRow[],
  period: EvaluationPeriod,
  now: number,
): TrendBucket[] {
  if (outcomes.length === 0) return [];
  const weekly = period === '90d' || period === 'all';
  const stepMs = (weekly ? 7 : 1) * 86_400_000;
  let startMs: number;
  if (period === 'all') {
    const earliest = Math.min(...outcomes.map((o) => Date.parse(o.finished_at)));
    startMs = Math.floor(earliest / 86_400_000) * 86_400_000;
  } else {
    // Anchor on today's UTC day start so the last bucket is today.
    const todayStart = Math.floor(now / 86_400_000) * 86_400_000;
    const days = periodDays(period)!;
    startMs = weekly
      ? todayStart - (Math.ceil(days / 7) * 7 - 1) * 86_400_000
      : todayStart - (days - 1) * 86_400_000;
  }
  const buckets: TrendBucket[] = [];
  const byStart = new Map<number, TrendBucket>();
  for (let s = startMs; s <= now; s += stepMs) {
    const bucket: TrendBucket = { key: dayKey(s), startMs: s, finishes: 0, pass: 0, fail: 0, unchecked: 0, sendBacks: 0 };
    buckets.push(bucket);
    byStart.set(s, bucket);
  }
  for (const o of outcomes) {
    const at = Date.parse(o.finished_at);
    if (!Number.isFinite(at) || at < startMs) continue;
    const start = startMs + Math.floor((at - startMs) / stepMs) * stepMs;
    const bucket = byStart.get(start);
    if (!bucket) continue;
    bucket.finishes += 1;
    if (o.verdict_result === 'pass') bucket.pass += 1;
    else if (o.verdict_result === 'fail') bucket.fail += 1;
    else bucket.unchecked += 1;
    if (o.human_signal === 'rework') bucket.sendBacks += 1;
  }
  return buckets;
}

export function buildEvaluation(input: EvaluationInputs): EvaluationReport {
  const { objects, period, now } = input;
  const startMs = periodStartMs(period, now);

  // The Strategy's element set, and each Element's home for partitioning:
  // the first Object (in scope order) that carries it.
  const elementHome = new Map<string, string>();
  const elementInfo = new Map<string, { title: string; displayId: string | null }>();
  for (const o of objects) {
    for (const e of o.elements) {
      if (!elementHome.has(e.id)) elementHome.set(e.id, o.id);
      if (!elementInfo.has(e.id)) elementInfo.set(e.id, { title: e.title, displayId: e.display_id ?? null });
    }
  }

  // Element-set attribution: only outcomes on the Strategy's Elements,
  // inside the period. An outcome naming several Strategies through a
  // shared Element counts here exactly because its element_id is in the
  // set — its (possibly null) strategy_id is never consulted.
  const scoped: EvaluationOutcomeRow[] = [];
  let outOfScope = 0;
  for (const o of input.outcomes) {
    const at = Date.parse(o.finished_at);
    if (!Number.isFinite(at) || at < startMs || at > now) continue;
    if (!o.element_id || !elementHome.has(o.element_id)) { outOfScope += 1; continue; }
    scoped.push(o);
  }

  const runById = new Map(input.runs.map((r) => [r.id, r] as const));
  // One deliverable shape for both homes it renders in — the worst-run
  // expansions and the standing Deliverables block — so its size and
  // its verifier evidence can never be computed two ways.
  const deliverableOf = (a: EvaluationArtifactRow): DeliverableEvaluation => {
    const verdict = a.run_id ? runById.get(a.run_id)?.verdict ?? null : null;
    return {
      artifact: a,
      elementTitle: elementInfo.get(a.element_id)?.title ?? a.element_id,
      size: artifactSizeOf(a.content, a.format),
      verifier: verdict && verdict.evidence.artifactIds.includes(a.id)
        ? { result: verdict.result, gaps: verdict.gaps }
        : null,
    };
  };
  const artifactsByRun = new Map<string, DeliverableEvaluation[]>();
  for (const a of input.artifacts) {
    if (!a.run_id) continue;
    const list = artifactsByRun.get(a.run_id) ?? [];
    list.push(deliverableOf(a));
    artifactsByRun.set(a.run_id, list);
  }
  const scopedRuns = scoped.map((o) => runById.get(o.run_id)).filter((r): r is EvaluationRunRow => !!r);

  const byElement = new Map<string, EvaluationOutcomeRow[]>();
  for (const o of scoped) {
    const list = byElement.get(o.element_id!) ?? [];
    list.push(o);
    byElement.set(o.element_id!, list);
  }

  const elementEval = (elementId: string): ElementEvaluation => {
    const rows = byElement.get(elementId) ?? [];
    const worstRuns: WorstRun[] = rows
      .map((o) => ({ o, run: runById.get(o.run_id) ?? null }))
      .filter(({ o, run }) => isWorst(o, run))
      .sort((a, b) => Date.parse(b.o.finished_at) - Date.parse(a.o.finished_at))
      .slice(0, WORST_RUN_CAP)
      .map(({ o, run }) => ({
        outcomeId: o.id,
        runId: o.run_id,
        elementId: o.element_id!,
        finishedAt: o.finished_at,
        outcome: o.outcome,
        verdictResult: o.verdict_result,
        humanSignal: o.human_signal,
        revisions: o.revisions,
        costUsd: Number(o.cost_usd) || 0,
        reasons: worstReasons(o, run),
        run,
        artifacts: artifactsByRun.get(o.run_id) ?? [],
      }));
    return {
      ...tally(rows),
      elementId,
      title: elementInfo.get(elementId)?.title ?? elementId,
      displayId: elementInfo.get(elementId)?.displayId ?? null,
      objectId: elementHome.get(elementId) ?? null,
      lastFinishedAt: rows.length ? rows.map((o) => o.finished_at).sort().at(-1)! : null,
      worstRuns,
    };
  };

  const objectEvals: ObjectEvaluation[] = objects.map((o) => {
    // Partition: this Object's rows are the Elements homed here, so a
    // shared Element's outcomes land on exactly one Object row.
    const homedIds = [...elementHome.entries()].filter(([, home]) => home === o.id).map(([id]) => id);
    const rows = homedIds.flatMap((id) => byElement.get(id) ?? []);
    const mix = failureMixOf(rows.map((r) => runById.get(r.run_id)).filter((r): r is EvaluationRunRow => !!r));
    return {
      ...tally(rows),
      objectId: o.id,
      name: o.name,
      topFailureClass: mix[0]?.failureClass ?? null,
      failureCount: mix.reduce((n, m) => n + m.count, 0),
      lastFinishedAt: rows.length ? rows.map((r) => r.finished_at).sort().at(-1)! : null,
      elements: [...new Set(o.elements.map((e) => e.id))].map(elementEval),
    };
  });
  objectEvals.sort(compareObjectsWorstFirst);

  // Definitions at work: the definitions the period's runs actually used.
  const byDefinition = new Map<string, EvaluationOutcomeRow[]>();
  for (const o of scoped) {
    if (!o.definition_id) continue;
    const list = byDefinition.get(o.definition_id) ?? [];
    list.push(o);
    byDefinition.set(o.definition_id, list);
  }
  const latestCalibration = new Map<string, VerifierCalibration>();
  for (const row of input.calibrations) {
    const prev = latestCalibration.get(row.definition_id);
    if (!prev || row.window_start > prev.window_start) latestCalibration.set(row.definition_id, row);
  }
  const openCandidate = new Map<string, DefinitionRevisionCandidate>();
  for (const c of input.candidates) {
    if (c.status === 'open' && !openCandidate.has(c.definition_id)) openCandidate.set(c.definition_id, c);
  }
  const testsByDefinition = new Map<string, DefinitionTest[]>();
  for (const testRow of input.tests) {
    const list = testsByDefinition.get(testRow.definition_id) ?? [];
    list.push(testRow);
    testsByDefinition.set(testRow.definition_id, list);
  }
  const nowDate = new Date(now);
  const definitions: DefinitionEvaluation[] = [...byDefinition.entries()]
    .map(([definitionId, rows]) => {
      const t = tally(rows);
      const tests = (testsByDefinition.get(definitionId) ?? []).reduce(
        (acc, testRow) => {
          acc.total += 1;
          const verdict = readTestVerdict(testRow.last_result);
          const stale = !verdict || testFreshness(testRow, null, nowDate).oldFixture;
          if (stale) acc.stale += 1;
          else if (verdict.outcome === 'pass') acc.passing += 1;
          else acc.failing += 1;
          return acc;
        },
        { total: 0, passing: 0, failing: 0, stale: 0 },
      );
      return {
        definitionId,
        name: input.definitionNames[definitionId] ?? definitionId,
        finishes: t.finishes,
        pass: t.pass,
        fail: t.fail,
        unchecked: t.unchecked,
        calibration: calibrationSummaryOf(latestCalibration.get(definitionId) ?? null),
        candidate: openCandidate.get(definitionId) ?? null,
        tests,
      };
    })
    .sort((a, b) => b.finishes - a.finishes || a.name.localeCompare(b.name));

  // The Deliverables block: the period's artifacts — those of the
  // scoped outcomes' runs, nothing the period did not produce.
  const scopedRunIds = new Set(scoped.map((o) => o.run_id));
  const deliverables = input.artifacts
    .filter((a) => a.run_id !== null && scopedRunIds.has(a.run_id))
    .map(deliverableOf)
    .sort(compareDeliverables);

  const headlineTallies = tally(scoped);
  const mix = failureMixOf(scopedRuns);
  return {
    headline: {
      ...headlineTallies,
      failureMix: mix,
      topFailure: mix[0] ?? null,
      failedFinishes: mix.reduce((n, m) => n + m.count, 0),
      costPerAccepted: headlineTallies.accepted > 0 ? headlineTallies.costUsd / headlineTallies.accepted : null,
    },
    objects: objectEvals,
    definitions,
    deliverables,
    trend: trendBuckets(scoped, period, now),
    outOfScope,
  };
}
