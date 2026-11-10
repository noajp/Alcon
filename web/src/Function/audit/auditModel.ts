// =============================================================
// The AI audit ledger, read (ADR 0044).
//
// A deployment is a business process (a template) running in a Space: which
// Domain it serves, which ai_agent Worker runs it. Each run handles one
// document, known only by its number and a keyed digest — never its body.
// What happened at each joint of a run (which connector, which operation,
// what came of it) arrives as step events, in the order the gateway saw
// them.
//
// A run's outcome is not stored: it is read from its steps, so the ledger
// stays append-only and the reading can change without rewriting history.
// =============================================================

import type { AgentRunMode, AgentRunStatus } from '@/types/database';

export type DeploymentState = 'trial' | 'live' | 'paused';
export type StepKind = 'start' | 'step' | 'approval' | 'exception' | 'end';
export type StepOperation = 'read' | 'draft' | 'send' | 'money' | 'none';
export type StepResult = 'ok' | 'failed' | 'blocked' | 'waiting' | 'approved' | 'returned';
export type StepActor = 'ai_agent' | 'human' | 'system';

export interface WorkflowTemplateStep {
  key: string;
  label: string;
}

export interface WorkflowTemplateRecord {
  id: string;
  key: string;
  version: number;
  name: string;
  purpose: string;
  steps: unknown;
}

export interface WorkflowDeploymentRecord {
  id: string;
  activity_space_id: string;
  template_id: string;
  name: string;
  domain_id: string | null;
  object_id: string | null;
  worker_id: string | null;
  state: DeploymentState;
  minutes_per_item: number | null;
  created_at: string;
}

export interface WorkflowRunRecord {
  id: string;
  deployment_id: string;
  external_id: string;
  template_version: number;
  subject_ref: string | null;
  subject_digest: string | null;
  started_at: string;
}

export interface WorkflowStepRecord {
  id: string;
  run_id: string;
  deployment_id: string;
  step_key: string;
  kind: StepKind;
  connector: string | null;
  operation: StepOperation;
  result: StepResult;
  actor_kind: StepActor;
  actor_name: string | null;
  reason: string | null;
  occurred_at: string;
  duration_ms: number | null;
  seq: number;
  prev_hash: string;
  hash: string;
  /** The version of the deployment's grants the gateway held (ADR 0046). */
  grants_version: number | null;
  /** The operation was outside that version: done anyway, or blocked. */
  outside_grant: boolean;
}

/** What reading a run needs of each step — what the ledger list carries.
 *  The run's own page reads the full rows. */
export type StepEvent = Pick<WorkflowStepRecord, 'seq' | 'step_key' | 'kind' | 'connector' | 'operation' | 'result' | 'reason' | 'outside_grant'>;

// ── Grants (ADR 0046) ────────────────────────────────────────────────────
// What a deployment may do: a connector and an operation per grant. The
// grants in force are rows the Space's owner adds and removes; every change
// leaves a numbered version, which the gateway is handed and its records
// name.

export const GRANT_OPERATIONS = ['read', 'draft', 'send', 'money'] as const;
export type GrantOperation = typeof GRANT_OPERATIONS[number];

export interface DeploymentGrant {
  connector: string;
  operation: GrantOperation;
}

export interface GrantVersionRecord {
  deployment_id: string;
  version: number;
  grants: DeploymentGrant[];
  changed_by: string | null;
  created_at: string;
}

// ── Approvals (ADR 0047) ─────────────────────────────────────────────────
// A gateway asks a person before an operation, bound to the hash of the
// exact content; the Space's owner decides; the gateway uses it once.

export interface WorkflowApprovalRecord {
  id: string;
  activity_space_id: string;
  deployment_id: string;
  request_id: string;
  run_external_id: string;
  connector: string;
  operation: GrantOperation;
  input_hash: string;
  summary: string;
  requested_at: string;
  expires_at: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  consumed_at: string | null;
}

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'used' | 'expired';

/** Where an approval stands now. Used outweighs expiry (it was used in
 *  time); an undecided or unused approval past its time is expired. */
export function approvalState(approval: Pick<WorkflowApprovalRecord, 'status' | 'expires_at' | 'consumed_at'>, nowMs: number): ApprovalState {
  if (approval.status === 'rejected') return 'rejected';
  if (approval.consumed_at) return 'used';
  if (Date.parse(approval.expires_at) <= nowMs) return 'expired';
  return approval.status;
}

const grantKey = (g: DeploymentGrant) => `${g.connector}\u0000${g.operation}`;

/** The connectors a deployment's grants page lists: those granted anything,
 *  then those its runs called without a grant, each once, in that order. */
export function grantConnectors(grants: readonly DeploymentGrant[], called: readonly string[]): string[] {
  const granted = [...new Set(grants.map(g => g.connector))].sort((a, b) => a.localeCompare(b));
  const rest = [...new Set(called)].filter(c => !granted.includes(c)).sort((a, b) => a.localeCompare(b));
  return [...granted, ...rest];
}

/** What a version added and removed against the one before it. */
export function grantChanges(before: readonly DeploymentGrant[], after: readonly DeploymentGrant[]): { added: DeploymentGrant[]; removed: DeploymentGrant[] } {
  const was = new Set(before.map(grantKey));
  const now = new Set(after.map(grantKey));
  return { added: after.filter(g => !was.has(grantKey(g))), removed: before.filter(g => !now.has(grantKey(g))) };
}

/** A run as the ledger list carries it: with its steps, in chain order. */
export interface LedgerRun extends WorkflowRunRecord {
  steps: StepEvent[];
}

/** How a run ended, or where it stands. */
export type RunOutcome =
  | 'auto'       // finished without a person
  | 'approved'   // finished after a person approved
  | 'returned'   // a person sent it back
  | 'exception'  // the agent stopped and handed it to a person
  | 'deviation'  // an operation outside the grants, blocked or not
  | 'stopped'    // a joint failed and the run did not finish
  | 'waiting'    // waiting for a person's approval
  | 'running';

const RUN_OUTCOMES: readonly RunOutcome[] = ['auto', 'approved', 'returned', 'exception', 'deviation', 'stopped', 'waiting', 'running'];

/** Outcomes that ask something of a person now. */
export const NEEDS_PERSON: ReadonlySet<RunOutcome> = new Set(['exception', 'deviation', 'stopped', 'waiting']);

/** Steps in chain order: the gateway's order, not the clock's. */
function inChainOrder<T extends { seq: number }>(steps: readonly T[]): T[] {
  return [...steps].sort((a, b) => a.seq - b.seq);
}

/**
 * A run's outcome, read from its steps. An operation outside the grants,
 * or one the gateway blocked, outweighs everything — it is the one thing an
 * audit must never let pass unseen —
 * then a finished run says how it finished, and an unfinished one says
 * what it is waiting on.
 */
export function runOutcome(steps: readonly StepEvent[]): RunOutcome {
  const ordered = inChainOrder(steps);
  if (ordered.some(s => s.result === 'blocked' || s.outside_grant)) return 'deviation';
  const end = ordered.find(s => s.kind === 'end');
  if (end) {
    if (end.result === 'failed') return 'stopped';
    if (ordered.some(s => s.result === 'returned')) return 'returned';
    if (ordered.some(s => s.result === 'approved')) return 'approved';
    return 'auto';
  }
  if (ordered.some(s => s.result === 'returned')) return 'returned';
  if (ordered.some(s => s.kind === 'exception')) return 'exception';
  if (ordered.some(s => s.result === 'failed')) return 'stopped';
  if (ordered[ordered.length - 1]?.result === 'waiting') return 'waiting';
  return 'running';
}

/** Why the agent handed a run to a person — the first exception's reason. */
export function exceptionReason(steps: readonly StepEvent[]): string | null {
  return inChainOrder(steps).find(s => s.kind === 'exception')?.reason ?? null;
}

/** A template's steps, keeping only well-formed entries. */
export function templateSteps(raw: unknown): WorkflowTemplateStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { key, label } = entry as Record<string, unknown>;
    if (typeof key !== 'string' || !key) return [];
    return [{ key, label: typeof label === 'string' && label ? label : key }];
  });
}

export interface DeploymentSummary {
  runs: number;
  outcomes: Record<RunOutcome, number>;
  /** Runs that finished without a person, out of the runs that finished. */
  autoRate: number | null;
  /** Runs a person sent back, out of the runs a person reviewed. */
  returnRate: number | null;
  needsPerson: number;
  /** The connectors this deployment actually called, most used first. */
  connectors: { connector: string; calls: number; failed: number; blocked: number }[];
  lastRunAt: string | null;
}

const zeroOutcomes = (): Record<RunOutcome, number> =>
  Object.fromEntries(RUN_OUTCOMES.map(o => [o, 0])) as Record<RunOutcome, number>;

/** What a deployment's runs add up to. Rates are null when nothing is in the denominator. */
export function summarizeDeployment(runs: readonly WorkflowRunRecord[], stepsByRun: ReadonlyMap<string, readonly StepEvent[]>): DeploymentSummary {
  const outcomes = zeroOutcomes();
  const connectors = new Map<string, { calls: number; failed: number; blocked: number }>();
  let lastRunAt: string | null = null;
  for (const run of runs) {
    const steps = stepsByRun.get(run.id) ?? [];
    outcomes[runOutcome(steps)] += 1;
    if (!lastRunAt || run.started_at > lastRunAt) lastRunAt = run.started_at;
    for (const step of steps) {
      if (!step.connector) continue;
      const entry = connectors.get(step.connector) ?? { calls: 0, failed: 0, blocked: 0 };
      entry.calls += 1;
      if (step.result === 'failed') entry.failed += 1;
      if (step.result === 'blocked') entry.blocked += 1;
      connectors.set(step.connector, entry);
    }
  }
  const finished = outcomes.auto + outcomes.approved + outcomes.returned;
  const reviewed = outcomes.approved + outcomes.returned;
  return {
    runs: runs.length,
    outcomes,
    autoRate: finished ? outcomes.auto / finished : null,
    returnRate: reviewed ? outcomes.returned / reviewed : null,
    needsPerson: RUN_OUTCOMES.filter(o => NEEDS_PERSON.has(o)).reduce((n, o) => n + outcomes[o], 0),
    connectors: [...connectors].map(([connector, v]) => ({ connector, ...v }))
      .sort((a, b) => b.calls - a.calls || a.connector.localeCompare(b.connector)),
    lastRunAt,
  };
}

export interface FlowStep {
  key: string;
  label: string;
  /** Declared by the template; false for a step only the gateway saw. */
  declared: boolean;
  events: number;
  failed: number;
  blocked: number;
  waiting: number;
  connectors: string[];
}

/**
 * The declared flow (the template's steps, in order) laid over the flow the
 * gateway actually saw. A step nobody passed through stays with zero
 * events; a step the template does not name is kept, after the declared
 * ones, so a route outside the design is visible rather than dropped.
 */
export function flowObservation(declared: readonly WorkflowTemplateStep[], steps: readonly StepEvent[]): FlowStep[] {
  const flow = new Map<string, FlowStep & { connectorSet: Set<string> }>();
  for (const step of declared) flow.set(step.key, { ...step, declared: true, events: 0, failed: 0, blocked: 0, waiting: 0, connectors: [], connectorSet: new Set() });
  for (const step of inChainOrder(steps)) {
    // A start or end the template names is a step like any other (receiving
    // the order); one it does not name is only the run's bracket.
    if ((step.kind === 'start' || step.kind === 'end') && !flow.has(step.step_key)) continue;
    let entry = flow.get(step.step_key);
    if (!entry) {
      entry = { key: step.step_key, label: step.step_key, declared: false, events: 0, failed: 0, blocked: 0, waiting: 0, connectors: [], connectorSet: new Set() };
      flow.set(step.step_key, entry);
    }
    entry.events += 1;
    if (step.result === 'failed') entry.failed += 1;
    if (step.result === 'blocked') entry.blocked += 1;
    if (step.result === 'waiting') entry.waiting += 1;
    if (step.connector) entry.connectorSet.add(step.connector);
  }
  return [...flow.values()].map(({ connectorSet, ...entry }) => ({ ...entry, connectors: [...connectorSet].sort() }));
}

// ── The hash chain ─────────────────────────────────────────────────────────
// The database links each step to the one before it in its deployment
// (workflow_step_chain in the migration), hashing the step together with the
// run it belongs to. Each field is written as its length in bytes, a colon
// and the value, so no two different rows read as the same text; this reads
// it the same way, so anyone holding the rows can check that none was
// removed or altered.

const GENESIS_HASH = '0'.repeat(64);

/** The run fields a step's link covers: which document it worked on. */
export type ChainRun = Pick<WorkflowRunRecord, 'external_id' | 'subject_ref' | 'subject_digest' | 'started_at'>;

/** A step with its run, as the chain check reads it. */
export type ChainStep = WorkflowStepRecord & { run: ChainRun };

/** Postgres `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` in UTC: microseconds, always six digits. */
function chainTimestamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(iso.trim());
  if (!match) throw new Error(`Not a timestamp: ${iso}`);
  const [, date, time, fraction = '', zone = 'Z'] = match;
  const micros = fraction.padEnd(6, '0');
  if (zone === 'Z' || /^[+-]00(:?00)?$/.test(zone)) return `${date}T${time}.${micros}Z`;
  // Shift to UTC on whole seconds, then put the microseconds back.
  const utc = new Date(`${date}T${time}${zone.length === 3 ? `${zone}:00` : zone}`);
  return `${utc.toISOString().slice(0, 19)}.${micros}Z`;
}

const encoder = new TextEncoder();
const field = (value: string | number | null) => {
  const text = value === null ? '' : String(value);
  return `${encoder.encode(text).length}:${text}`;
};

function stepChainText(step: ChainStep): string {
  return [
    step.prev_hash, step.seq, step.run_id, step.run.external_id, step.run.subject_ref, step.run.subject_digest,
    chainTimestamp(step.run.started_at), step.step_key, step.kind, step.connector, step.operation, step.result,
    step.actor_kind, step.actor_name, step.reason, chainTimestamp(step.occurred_at), step.duration_ms,
  ].map(field).join('');
}

/**
 * Links steps the way the database does on insert: in the order given, each
 * gets the next seq, the hash before it, and its own hash. Used for records
 * the database never held (the Audit app's sample), so they verify with the
 * same `verifyChain` as real ones.
 */
export async function sealChain(steps: readonly ChainStep[], sha256Hex: (text: string) => Promise<string>): Promise<ChainStep[]> {
  const sealed: ChainStep[] = [];
  let prev = GENESIS_HASH;
  for (const [i, step] of steps.entries()) {
    const linked = { ...step, seq: i + 1, prev_hash: prev };
    linked.hash = await sha256Hex(stepChainText(linked));
    sealed.push(linked);
    prev = linked.hash;
  }
  return sealed;
}

export type ChainBreak = { seq: number; kind: 'gap' | 'link' | 'hash' };

/**
 * Where a deployment's chain breaks, given a contiguous run of its steps (a
 * seq range) and a SHA-256 hex function. `gap` — a seq is missing; `link` —
 * a step does not point at the one before it; `hash` — a step's fields no
 * longer produce its hash. Checks from the first step held, so a range that
 * starts mid-chain is read from its own first link.
 */
export async function verifyChain(steps: readonly ChainStep[], sha256Hex: (text: string) => Promise<string>): Promise<ChainBreak[]> {
  const ordered = inChainOrder(steps);
  const breaks: ChainBreak[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const step = ordered[i];
    const prev = ordered[i - 1];
    if (prev && step.seq !== prev.seq + 1) breaks.push({ seq: step.seq, kind: 'gap' });
    else if (prev ? step.prev_hash !== prev.hash : step.seq === 1 && step.prev_hash !== GENESIS_HASH) breaks.push({ seq: step.seq, kind: 'link' });
    if (await sha256Hex(stepChainText(step)) !== step.hash) breaks.push({ seq: step.seq, kind: 'hash' });
  }
  return breaks;
}

// ── Agent runs: verdicts and readings (Phase 2) ────────────────────────
// The app's own agent work, kept apart from the ledger above: an agent run
// is a mutable application row written by the service role, never part of
// the hash chain, and nothing here borrows the chain's language for it.
// What the run itself claims is its finish (summary/result); the verdict
// below is the separate verifier's judgement of that finish, and a run's
// proposed readings are the numbers its finish offered the Strategy's
// measures. The server definitions live in
// supabase/functions/_shared/runVerdict.ts and readingsGate.ts; these are
// the web mirrors, pinned to them by agreement tests.

export type RunVerdictResult = 'pass' | 'fail' | 'unchecked';

export type RunVerdictReason =
  | 'revisions-exhausted'    // last check failed; the finish stood anyway
  | 'verify-unavailable'     // the check errored or answered unreadably
  | 'outcome-not-completed'  // partial / blocked finishes are not checked
  | 'external-model';        // runs on an external model have no verifier

/** One correction a finish was sent back with (B3; server:
 *  _shared/correctionEnvelope.ts) — the return as the agent received
 *  it: the unit, the verdict, the reasons, the evidence the check
 *  read, and the scope the correction was bounded to. */
export interface CorrectionEnvelope {
  v: 1;
  unit: { kind: 'element'; id: string; title: string };
  verdict: 'fail';
  /** Which check returned it: the mechanical claim gate, or the verifier. */
  source: 'mechanical' | 'verifier';
  /** The return's findings, as issued (≤5). */
  reason: string[];
  evidence: { verifyStepIdx: number | null; artifactIds: string[] };
  /** The line the correction was bounded by. */
  scope: string;
  /** The finish attempt that was returned (1 = the first finish). */
  attempt: number;
  /** Finish attempts a run is allowed in all. */
  maxAttempts: number;
}

/** v3: the verifier's result on ONE declared Checks item (server:
 *  _shared/runVerdict.ts). */
export type VerdictCheckResult = 'pass' | 'partial' | 'fail';

export interface VerdictCheck {
  /** The item's text as the definition declared it, verbatim. */
  item: string;
  result: VerdictCheckResult;
}

/** v3: the verifier's depth judgement on ONE artifact it was shown —
 *  substantial | thin | empty, against the definition's Output
 *  section. A judgement, not a score (D8); the code-computed size
 *  signal lives in the Evaluation model, labelled as size. */
export type VerdictDepth = 'substantial' | 'thin' | 'empty';

export interface VerdictDeliverable {
  artifactId: string;
  depth: VerdictDepth;
  /** The verifier's one-line reason for the depth it gave. */
  note: string;
}

export interface RunVerdict {
  v: 1 | 2 | 3;
  result: RunVerdictResult;
  /** Who judged. 'verifier' = the separate check; 'none' = nobody did. */
  source: 'verifier' | 'none';
  /** The model that ran the check (the verifier runs on the run's model). */
  model: string | null;
  /** What the verifier found missing (≤5, its own words). Empty on pass. */
  gaps: string[];
  /** Times the loop sent a finish back before the one that stood. */
  revisions: number;
  /** When the last check ran; null when no check ran. */
  checkedAt: string | null;
  /** The finish outcome this record judges. */
  outcome: 'completed' | 'partial' | 'blocked';
  /** Why the record is not a checked pass; null on pass. */
  reason: RunVerdictReason | null;
  /** What the check read, so a person can re-walk it. */
  evidence: {
    /** idx of the run's 検証 step (agent_run_steps.idx), null when none. */
    verifyStepIdx: number | null;
    /** The artifacts the verifier was shown. */
    artifactIds: string[];
  };
  /** v2 only: the standing finish's claim accounting, counted by code —
   *  claims made, claims carrying a source, claims stale. Absent on v1. */
  claims?: { total: number; sourced: number; stale: number };
  /** v2 only: the mechanical findings on the standing finish (≤5), kept
   *  apart from the verifier's semantic `gaps`. Absent on v1. */
  claimGaps?: string[];
  /** v2 only, optional within it: the run's verify accounting — declared
   *  writes read back (checked) and how each ended. Absent when no
   *  verify-declared write ran. */
  verify?: { checked: number; ok: number; mismatched: number; unverified: number };
  /** v2 only, optional within it (B3): the corrections this run's
   *  finishes were sent back with, in order. Absent when no finish
   *  was sent back, and on records written before envelopes existed. */
  corrections?: CorrectionEnvelope[];
  /** v2 only, optional within it (B3): the hash of the Element's
   *  inputs when this record was sealed — the standing-pass
   *  comparison the unit-return rule makes at dispatch. */
  inputsHash?: string;
  /** v2 only, optional within it (B10): the run's chain-denial
   *  accounting — how many integration calls the chain fence
   *  refused in the run's final slice. Absent when nothing was
   *  refused, and on every unscoped run. */
  chain?: { denied: number };
  /** v3 only, optional within it: the verifier's per-item results on
   *  the Checks items the run's definition declared, in declaration
   *  order — empty when it declares none. Present only when a check
   *  ran; absent on v1/v2 records and on unchecked v3 ones. */
  checks?: VerdictCheck[];
  /** v3 only, optional within it: the verifier's depth judgement per
   *  artifact it was shown, in the order shown — empty when it was
   *  shown none. Same presence rule as `checks`. */
  deliverables?: VerdictDeliverable[];
}

const VERDICT_RESULTS: readonly string[] = ['pass', 'fail', 'unchecked'];
const VERDICT_CHECK_RESULTS: readonly string[] = ['pass', 'partial', 'fail'];
const VERDICT_DEPTHS: readonly string[] = ['substantial', 'thin', 'empty'];
const VERDICT_SOURCES: readonly string[] = ['verifier', 'none'];
const VERDICT_OUTCOMES: readonly string[] = ['completed', 'partial', 'blocked'];
const VERDICT_REASONS: readonly string[] = ['revisions-exhausted', 'verify-unavailable', 'outcome-not-completed', 'external-model'];

const CORRECTION_SOURCES: readonly string[] = ['mechanical', 'verifier'];

/** Strict narrowing of one correction envelope, mirroring the server's
 *  parseCorrectionEnvelope field for field. */
function parseCorrectionEnvelope(raw: unknown): CorrectionEnvelope | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || r.verdict !== 'fail') return null;
  if (typeof r.source !== 'string' || !CORRECTION_SOURCES.includes(r.source)) return null;
  const unit = r.unit;
  if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return null;
  const u = unit as Record<string, unknown>;
  if (u.kind !== 'element' || typeof u.id !== 'string' || !u.id || typeof u.title !== 'string') return null;
  if (!Array.isArray(r.reason) || r.reason.length > 5 || !r.reason.every((g) => typeof g === 'string')) return null;
  const evidence = r.evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const ev = evidence as Record<string, unknown>;
  if (!(ev.verifyStepIdx === null || (typeof ev.verifyStepIdx === 'number' && Number.isInteger(ev.verifyStepIdx) && ev.verifyStepIdx >= 0))) return null;
  if (!Array.isArray(ev.artifactIds) || !ev.artifactIds.every((id) => typeof id === 'string')) return null;
  if (typeof r.scope !== 'string' || !r.scope) return null;
  if (typeof r.attempt !== 'number' || !Number.isInteger(r.attempt) || r.attempt < 1) return null;
  if (typeof r.maxAttempts !== 'number' || !Number.isInteger(r.maxAttempts) || r.maxAttempts < 2 || r.attempt > r.maxAttempts) return null;
  return {
    v: 1,
    unit: { kind: 'element', id: u.id as string, title: u.title as string },
    verdict: 'fail',
    source: r.source as CorrectionEnvelope['source'],
    reason: [...(r.reason as string[])],
    evidence: { verifyStepIdx: ev.verifyStepIdx as number | null, artifactIds: [...(ev.artifactIds as string[])] },
    scope: r.scope as string,
    attempt: r.attempt as number,
    maxAttempts: r.maxAttempts as number,
  };
}

/** Strict narrowing of the jsonb: a record that is not exactly this shape
 *  is not a verdict (null), never a partially-read one. Mirrors the
 *  server's parseRunVerdict field for field. */
export function parseRunVerdict(raw: unknown): RunVerdict | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 && r.v !== 2 && r.v !== 3) return null;
  if (typeof r.result !== 'string' || !VERDICT_RESULTS.includes(r.result)) return null;
  if (typeof r.source !== 'string' || !VERDICT_SOURCES.includes(r.source)) return null;
  if (!(r.model === null || typeof r.model === 'string')) return null;
  if (!Array.isArray(r.gaps) || !r.gaps.every((g) => typeof g === 'string')) return null;
  if (typeof r.revisions !== 'number' || !Number.isInteger(r.revisions) || r.revisions < 0) return null;
  if (!(r.checkedAt === null || typeof r.checkedAt === 'string')) return null;
  if (typeof r.outcome !== 'string' || !VERDICT_OUTCOMES.includes(r.outcome)) return null;
  if (!(r.reason === null || (typeof r.reason === 'string' && VERDICT_REASONS.includes(r.reason)))) return null;
  const evidence = r.evidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const e = evidence as Record<string, unknown>;
  if (!(e.verifyStepIdx === null || (typeof e.verifyStepIdx === 'number' && Number.isInteger(e.verifyStepIdx)))) return null;
  if (!Array.isArray(e.artifactIds) || !e.artifactIds.every((id) => typeof id === 'string')) return null;
  const base: RunVerdict = {
    v: r.v as 1 | 2 | 3,
    result: r.result as RunVerdictResult,
    source: r.source as RunVerdict['source'],
    model: r.model as string | null,
    gaps: [...(r.gaps as string[])],
    revisions: r.revisions as number,
    checkedAt: r.checkedAt as string | null,
    outcome: r.outcome as RunVerdict['outcome'],
    reason: r.reason as RunVerdictReason | null,
    evidence: { verifyStepIdx: e.verifyStepIdx as number | null, artifactIds: [...(e.artifactIds as string[])] },
  };
  if (r.v === 1) return base;
  // v2 and v3 must carry the claim accounting exactly, as the server writes it.
  const claims = r.claims;
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
  const c = claims as Record<string, unknown>;
  const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!count(c.total) || !count(c.sourced) || !count(c.stale)) return null;
  if ((c.sourced as number) > (c.total as number) || (c.stale as number) > (c.total as number)) return null;
  if (!Array.isArray(r.claimGaps) || !r.claimGaps.every((g) => typeof g === 'string')) return null;
  const withClaims: RunVerdict = {
    ...base,
    claims: { total: c.total as number, sourced: c.sourced as number, stale: c.stale as number },
    claimGaps: [...(r.claimGaps as string[])],
  };
  // Optional within v2, exact when present — as the server reads it.
  let out: RunVerdict = withClaims;
  if (r.verify !== undefined) {
    const verify = r.verify;
    if (!verify || typeof verify !== 'object' || Array.isArray(verify)) return null;
    const vt = verify as Record<string, unknown>;
    if (!count(vt.checked) || !count(vt.ok) || !count(vt.mismatched) || !count(vt.unverified)) return null;
    if ((vt.ok as number) + (vt.mismatched as number) + (vt.unverified as number) !== (vt.checked as number)) return null;
    out = {
      ...out,
      verify: { checked: vt.checked as number, ok: vt.ok as number, mismatched: vt.mismatched as number, unverified: vt.unverified as number },
    };
  }
  // B3's fields, the same: optional within v2, exact when present —
  // one malformed correction refuses the record.
  if (r.inputsHash !== undefined) {
    if (typeof r.inputsHash !== 'string' || !r.inputsHash) return null;
    out = { ...out, inputsHash: r.inputsHash };
  }
  if (r.corrections !== undefined) {
    if (!Array.isArray(r.corrections)) return null;
    const corrections: CorrectionEnvelope[] = [];
    for (const entry of r.corrections) {
      const parsed = parseCorrectionEnvelope(entry);
      if (!parsed) return null;
      corrections.push(parsed);
    }
    out = { ...out, corrections };
  }
  // B10's block, the same: optional within v2, exact when present —
  // one non-negative count of the fence's refusals.
  if (r.chain !== undefined) {
    const chain = r.chain;
    if (!chain || typeof chain !== 'object' || Array.isArray(chain)) return null;
    const denied = (chain as Record<string, unknown>).denied;
    if (typeof denied !== 'number' || !Number.isInteger(denied) || denied < 0) return null;
    out = { ...out, chain: { denied } };
  }
  if (r.v === 2) return out;
  // v3's scoring blocks, the same: optional within v3 (absent = the
  // finish was not checked), exact when present — a checks entry
  // names a non-empty declared item at most once; a deliverables
  // entry names one of the record's own evidence artifacts at most
  // once, with a depth from the vocabulary and its note.
  if (r.checks !== undefined) {
    if (!Array.isArray(r.checks)) return null;
    const seen = new Set<string>();
    const checks: VerdictCheck[] = [];
    for (const entry of r.checks) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const ce = entry as Record<string, unknown>;
      if (typeof ce.item !== 'string' || !ce.item || seen.has(ce.item)) return null;
      if (typeof ce.result !== 'string' || !VERDICT_CHECK_RESULTS.includes(ce.result)) return null;
      seen.add(ce.item);
      checks.push({ item: ce.item, result: ce.result as VerdictCheckResult });
    }
    out = { ...out, checks };
  }
  if (r.deliverables !== undefined) {
    if (!Array.isArray(r.deliverables)) return null;
    const shownIds = new Set(base.evidence.artifactIds);
    const seen = new Set<string>();
    const deliverables: VerdictDeliverable[] = [];
    for (const entry of r.deliverables) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const de = entry as Record<string, unknown>;
      if (typeof de.artifactId !== 'string' || !shownIds.has(de.artifactId) || seen.has(de.artifactId)) return null;
      if (typeof de.depth !== 'string' || !VERDICT_DEPTHS.includes(de.depth)) return null;
      if (typeof de.note !== 'string') return null;
      seen.add(de.artifactId);
      deliverables.push({ artifactId: de.artifactId, depth: de.depth as VerdictDepth, note: de.note });
    }
    out = { ...out, deliverables };
  }
  return out;
}

// ── Chain scopes (B10) ───────────────────────────────────────────────
// The web mirror of _shared/chainScope.ts: a chained run's scope as
// minted on its row — the allowlist of (integration, canonical
// action) pairs, the integration fence, and its depth under the
// cap. Parsed with the server's rules: absent is null (an unscoped
// root); present but malformed reads as the EMPTY scope, never as
// unscoped — a broken record must not widen on any surface either.

/** The chain cap, mirrored from the server's CHAIN_POLICY. */
const CHAIN_MAX_DEPTH = 8;

export interface ChainScope {
  v: 1;
  rootRunId: string;
  parentRunId: string;
  strategyId: string | null;
  depth: number;
  maxDepth: number;
  actions: string[];
  integrations: string[];
}

const emptyChainScope = (): ChainScope => ({
  v: 1, rootRunId: '', parentRunId: '', strategyId: null,
  depth: CHAIN_MAX_DEPTH, maxDepth: CHAIN_MAX_DEPTH, actions: [], integrations: [],
});

/** Pure. A stored chain_scope read as a scope (the server's
 *  parseChainScope, mirrored): null when absent, the empty scope
 *  when malformed, the canonical (sorted, de-duplicated) scope
 *  when well-formed. */
export function parseChainScope(value: unknown): ChainScope | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return emptyChainScope();
  const r = value as Record<string, unknown>;
  const list = (v: unknown): string[] | null =>
    Array.isArray(v) && v.every(x => typeof x === 'string') ? [...new Set(v as string[])].sort() : null;
  const actions = list(r.actions);
  const integrations = list(r.integrations);
  const valid = r.v === 1
    && typeof r.rootRunId === 'string' && r.rootRunId.length > 0
    && typeof r.parentRunId === 'string' && r.parentRunId.length > 0
    && (r.strategyId === null || typeof r.strategyId === 'string')
    && typeof r.depth === 'number' && Number.isInteger(r.depth) && r.depth >= 0
    && typeof r.maxDepth === 'number' && Number.isInteger(r.maxDepth) && r.maxDepth >= 1
    && actions !== null && integrations !== null;
  if (!valid) return emptyChainScope();
  return {
    v: 1, rootRunId: r.rootRunId as string, parentRunId: r.parentRunId as string,
    strategyId: (r.strategyId as string | null) ?? null,
    depth: r.depth as number, maxDepth: r.maxDepth as number, actions: actions!, integrations: integrations!,
  };
}

/** One fact a finish stated, typed at the source (server: finishClaims.ts). */
export interface FinishClaim {
  text: string;
  /** Where it came from: a URL, a document name, or 'run-record' — the
   *  run's own step log, for things the run itself did. */
  source: string | null;
  /** When the agent retrieved it (ISO 8601), or null when it did not say. */
  retrievedAt: string | null;
  /** The fact's data type (price / availability / org / legal / declared). */
  type: string | null;
}

/** The finish as submitted, sealed on the run (agent_runs.finish_detail). */
export interface FinishDetail {
  claims: FinishClaim[];
  /** What the agent could not confirm — a mark on the finish, never a
   *  failure of it. The run list's 未確認あり filter is these, found. */
  unconfirmed: string[];
  /** The compensation outcome of this finish's failure settle (B9),
   *  present only when the settle ran a compensation pass: what the
   *  rollback did, counted, and the names of the writes that stand
   *  uncompensated. */
  compensation?: CompensationSummary;
}

/** A failed run's compensation outcome, as finish_detail keeps it (B9):
 *  the server twin lives in supabase/functions/_shared/finishClaims.ts;
 *  the two parsers are pinned equal by tests/finishClaims.test.ts. */
export interface CompensationSummary {
  compensated: number;
  compensationFailed: number;
  declined: number;
  uncompensated: string[];
}

/** Strict narrowing of the jsonb, mirroring the server's parseFinishDetail
 *  field for field: not exactly this shape, not a finish detail. */
export function parseFinishDetail(raw: unknown): FinishDetail | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.claims) || !Array.isArray(r.unconfirmed)) return null;
  if (!r.unconfirmed.every((x) => typeof x === 'string')) return null;
  const claims: FinishClaim[] = [];
  for (const e of r.claims) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const c = e as Record<string, unknown>;
    if (typeof c.text !== 'string' || !c.text) return null;
    const nullable = (v: unknown) => v === null || typeof v === 'string';
    if (!nullable(c.source) || !nullable(c.retrievedAt) || !nullable(c.type)) return null;
    claims.push({ text: c.text, source: c.source as string | null, retrievedAt: c.retrievedAt as string | null, type: c.type as string | null });
  }
  // The compensation outcome (B9), when the settle sealed one — the
  // server parser's strict rule, mirrored.
  let compensation: CompensationSummary | undefined;
  if (r.compensation !== undefined) {
    const c = r.compensation as Record<string, unknown> | null;
    const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
    if (!c || typeof c !== 'object' || Array.isArray(c)
      || !count(c.compensated) || !count(c.compensationFailed) || !count(c.declined)
      || !Array.isArray(c.uncompensated) || !c.uncompensated.every((x) => typeof x === 'string')) return null;
    compensation = {
      compensated: c.compensated as number, compensationFailed: c.compensationFailed as number,
      declined: c.declined as number, uncompensated: [...(c.uncompensated as string[])],
    };
  }
  return { claims, unconfirmed: [...(r.unconfirmed as string[])], ...(compensation ? { compensation } : {}) };
}

/** Whether a sealed finish named things it could not confirm. */
export function hasUnconfirmed(detail: FinishDetail | null): boolean {
  return !!detail && detail.unconfirmed.length > 0;
}

/** A failure settle's own record, sealed on the run (agent_runs.
 *  failure_detail, B13): the class the failure settled under, the
 *  compensation policy and the escalation with the layer that spoke
 *  for each, the run's retry total, and the give-up that fired. The
 *  server writes it in supabase/functions/_shared/failurePolicy.ts'
 *  failureDetailOf; this parser is its strict reader. */
export interface FailureDetail {
  failureClass: string;
  compensate: { policy: string; source: string };
  escalate: { target: string; source: string } | null;
  retries: number;
  giveUp: { count: number } | null;
  at: string;
}

const FAILURE_CLASSES: readonly string[] = [
  'verify_mismatch', 'auth_failed', 'rate_limited', 'not_found', 'unavailable',
  'read_failed', 'write_failed', 'revisions_exhausted', 'stale_claims',
  'breaker_tripped', 'model_refusal', 'run_failure',
];
const FAILURE_POLICY_SOURCES: readonly string[] = ['definition', 'catalog', 'default'];
const FAILURE_COMPENSATE_POLICIES: readonly string[] = ['auto', 'ask', 'never'];
const FAILURE_ESCALATE_TARGETS: readonly string[] = ['owner', 'strategy', 'inbox'];

/** Display labels for the record's vocabulary (i18n keys). */
export const FAILURE_COMPENSATE_LABEL: Record<string, string> = {
  auto: 'Roll back automatically', ask: 'Ask before rolling back', never: 'Never roll back',
};
export const FAILURE_ESCALATE_LABEL: Record<string, string> = {
  owner: 'Space owners', strategy: 'the Strategy’s owner', inbox: 'the Inbox',
};
export const FAILURE_SOURCE_LABEL: Record<string, string> = {
  definition: 'the definition’s failure section', catalog: 'the exception catalog', default: 'the engine default',
};

/** Strict narrowing of the jsonb: not exactly this shape, not a
 *  failure detail — a record a person will judge by is not guessed at. */
export function parseFailureDetail(raw: unknown): FailureDetail | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.class !== 'string' || !FAILURE_CLASSES.includes(r.class)) return null;
  const comp = r.compensate as Record<string, unknown> | null;
  if (!comp || typeof comp !== 'object' || Array.isArray(comp)
    || typeof comp.policy !== 'string' || !FAILURE_COMPENSATE_POLICIES.includes(comp.policy)
    || typeof comp.source !== 'string' || !FAILURE_POLICY_SOURCES.includes(comp.source)) return null;
  let escalate: FailureDetail['escalate'] = null;
  if (r.escalate !== null) {
    const e = r.escalate as Record<string, unknown> | null;
    if (!e || typeof e !== 'object' || Array.isArray(e)
      || typeof e.target !== 'string' || !FAILURE_ESCALATE_TARGETS.includes(e.target)
      || typeof e.source !== 'string' || !FAILURE_POLICY_SOURCES.includes(e.source)) return null;
    escalate = { target: e.target, source: e.source };
  }
  if (typeof r.retries !== 'number' || !Number.isInteger(r.retries) || r.retries < 0) return null;
  let giveUp: FailureDetail['giveUp'] = null;
  if (r.giveUp !== null) {
    const g = r.giveUp as Record<string, unknown> | null;
    if (!g || typeof g !== 'object' || Array.isArray(g)
      || typeof g.count !== 'number' || !Number.isInteger(g.count) || g.count < 1) return null;
    giveUp = { count: g.count };
  }
  if (typeof r.at !== 'string' || !r.at) return null;
  return {
    failureClass: r.class,
    compensate: { policy: comp.policy, source: comp.source },
    escalate,
    retries: r.retries,
    giveUp,
    at: r.at,
  };
}

export type ProposedReadingHeldReason =
  | 'awaiting-acceptance'   // checked pass, manual Strategy: lands when the work is accepted
  | 'verdict-not-pass'      // fail or unchecked verdict: never lands from this run
  | 'not-bound'             // measure is not one this run serves (dropped at validation; kept for the record)
  | 'write-failed';         // the intents update failed; see the run's step

/** One reading a finish proposed for a Strategy measure, and whether it landed. */
export interface ProposedReading {
  measureId: string;
  value: number;
  applied: boolean;
  appliedAt: string | null;
  /** The person whose client wrote the intents update. */
  appliedBy: string | null;
  /** Why it did not land, when it never will or has not yet. Null once applied. */
  heldReason: ProposedReadingHeldReason | null;
}

const HELD_REASONS: readonly string[] = ['awaiting-acceptance', 'verdict-not-pass', 'not-bound', 'write-failed'];

// ── Agent runs in the audit timeline ───────────────────────────────────
// The Audit app reads two sources: the gateway's hash-chained ledger
// above, and the app's own agent runs. They are shown together but never
// blended into a fake common run: each entry keeps its own record and its
// own guarantees, and an agent run is always badged as not hash-chained.
// Agent statuses are stored, not derived — so they get their own outcome
// vocabulary rather than the ledger's, whose labels would lie about them.

/** An agent run as the audit timeline carries it: the run row (browser-safe
 *  columns, verdict parsed) plus the names a row needs to be readable. */
export interface AgentRunRecord {
  id: string;
  element_id: string;
  domain_id: string | null;
  worker_id: string | null;
  status: AgentRunStatus;             // the stored vocabulary, unmapped
  mode: AgentRunMode;
  summary: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  cost_usd: number;
  verdict: RunVerdict | null;
  /** The finish as submitted, typed (claims + unconfirmed); null pre-B1. */
  finishDetail: FinishDetail | null;
  /** The failure settle's record (B13), parsed; null for a run whose
   *  failure never settled under the failure policy — every run
   *  before B13, and every run that did not fail. */
  failureDetail: FailureDetail | null;
  /** The chain scope minted at this run's birth (B10), parsed;
   *  null for an unscoped root — a person's own start, and every
   *  run born before scopes existed. */
  chainScope: ChainScope | null;
  /** The names of this run's fenced integrations, in scope order
   *  (an id stands in for a name the read could not resolve). */
  chainIntegrationNames: string[];
  proposed_readings: ProposedReading[] | null;
  elementTitle: string;
  elementStatus: string | null;
  objectName: string | null;
  /** Pending agent_actions on this run (its approvals still waiting). */
  pendingActions: number;
}

export type AgentOutcome =
  | 'running'        // queued | running
  | 'waiting'        // awaiting_approval | awaiting_input | paused
  | 'review'         // awaiting_review — the work is done; a person judges it on the Element
  | 'passed'         // completed, verdict pass
  | 'completed'      // completed, verdict unchecked or null
  | 'unpassed'       // completed, verdict fail (ended after the revision limit)
  | 'failed'         // failed
  | 'cancelled';     // cancelled

/** One row of the merged timeline. `key` is `ledger:{id}` / `agent:{id}` —
 *  route state carries the key, so the two id spaces can never collide. */
export type AuditRunEntry =
  | { source: 'ledger'; key: string; startedAt: string; needsPerson: boolean; run: LedgerRun }
  | { source: 'agent'; key: string; startedAt: string; needsPerson: boolean; run: AgentRunRecord };

/** Where a finished or standing agent run sits, in audit language. */
export function agentRunOutcome(run: Pick<AgentRunRecord, 'status' | 'verdict' | 'pendingActions'>): AgentOutcome {
  switch (run.status) {
    case 'queued':
    case 'running': return 'running';
    case 'awaiting_input':
    case 'awaiting_approval':
    case 'paused': return 'waiting';
    case 'awaiting_review': return 'review';
    case 'completed':
      if (run.verdict?.result === 'pass') return 'passed';
      if (run.verdict?.result === 'fail') return 'unpassed';
      return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
  }
}

/**
 * The states where the record asks something of a person now (the role
 * NEEDS_PERSON plays for the ledger). Paused is not attention: a
 * session-paused run resumes on its own when its person opens the Element,
 * and an error-paused run is already counted through its Element's state.
 */
export function agentRunNeedsPerson(run: Pick<AgentRunRecord, 'status' | 'pendingActions'>): boolean {
  return run.status === 'awaiting_approval' || run.status === 'awaiting_review' || run.status === 'failed';
}

/**
 * Both sources as one timeline: newest first by when the run started
 * (an agent run that never started falls back to when it was queued),
 * stable, with ledger entries winning ties — they carry the stronger record.
 */
export function mergeAuditTimeline(ledger: readonly LedgerRun[], agent: readonly AgentRunRecord[]): AuditRunEntry[] {
  const entries: AuditRunEntry[] = [
    ...ledger.map((run): AuditRunEntry => ({
      source: 'ledger', key: `ledger:${run.id}`, startedAt: run.started_at,
      needsPerson: NEEDS_PERSON.has(runOutcome(run.steps)), run,
    })),
    ...agent.map((run): AuditRunEntry => ({
      source: 'agent', key: `agent:${run.id}`, startedAt: run.started_at ?? run.created_at,
      needsPerson: agentRunNeedsPerson(run), run,
    })),
  ];
  return entries.sort((a, b) =>
    a.startedAt !== b.startedAt ? (a.startedAt < b.startedAt ? 1 : -1)
      : a.source !== b.source ? (a.source === 'ledger' ? -1 : 1)
        : 0);
}

/** One agent_run_steps row, as the detail panel reads it. */
export interface AgentRunStepRow {
  idx: number;
  type: string;
  title: string;
  detail: string | null;
  created_at: string;
}

/** One agent_actions row, as the detail panel reads it. */
export interface AgentActionRow {
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  summary: string;
  created_at: string;
  /** Who decided: null/absent is a person; 'policy' is the Space's free
   *  approval mode, with the mode in policy_mode; 'track-record' is the
   *  action's earned autonomy (B7), also with the mode in policy_mode;
   *  'plan' is an approved plan (B8) covering the call it listed. */
  decision_source?: 'policy' | 'track-record' | 'plan' | null;
  policy_mode?: string | null;
}

const ACTION_RESULT: Record<AgentActionRow['status'], StepResult> = {
  pending: 'waiting', approved: 'approved', executed: 'approved', rejected: 'returned', failed: 'failed',
};

/**
 * A run's steps and its approvals as one event list, in the ledger panel's
 * StepEvent shape — the shape only: an agent run has no hash, no previous
 * hash, no grants version and no digest, and none is synthesised here.
 * Steps keep chain order (idx); each approval is inserted by its time
 * against the steps' times, ties keeping the step first. An approval's
 * `seq` is the step it follows (0 before the first step).
 */
export function agentRunEvents(steps: readonly AgentRunStepRow[], actions: readonly AgentActionRow[]): StepEvent[] {
  const ordered = [...steps].sort((a, b) => a.idx - b.idx);
  const byTime = [...actions].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const events: StepEvent[] = [];
  let next = 0;
  let lastIdx = 0;
  const pushAction = (action: AgentActionRow) => {
    events.push({
      seq: lastIdx, step_key: 'approval', kind: 'approval', connector: null, operation: 'none',
      result: ACTION_RESULT[action.status],
      // A policy approval is nobody's decision: the event says so, so
      // what ran unasked under the free mode never reads as approved
      // by a person who was never asked. A track-record approval says
      // the same in its own words: the action's record decided, not a
      // person and not the Space's blanket policy. A plan approval is
      // a person's decision — over the whole plan, once — and says so.
      reason: action.decision_source === 'policy' ? `ポリシー承認: ${action.summary}`
        : action.decision_source === 'track-record' ? `自動実行（実績）: ${action.summary}`
        : action.decision_source === 'plan' ? `計画により実行: ${action.summary}`
        : action.summary,
      outside_grant: false,
    });
  };
  for (const step of ordered) {
    while (next < byTime.length && byTime[next].created_at < step.created_at) pushAction(byTime[next++]);
    events.push({
      seq: step.idx, step_key: step.type, kind: step.type === 'error' ? 'exception' : 'step', connector: null,
      operation: 'none', result: step.type === 'error' ? 'failed' : 'ok', reason: step.detail, outside_grant: false,
    });
    lastIdx = step.idx;
  }
  while (next < byTime.length) pushAction(byTime[next++]);
  return events;
}

/** The sample stands in only while the Space has no AI work at all: no
 *  deployments and no agent runs a person can see. */
export function auditShowsSample(deployments: number, agentRuns: number): boolean {
  return deployments === 0 && agentRuns === 0;
}

/** Strict narrowing of the proposed_readings jsonb; one malformed entry
 *  makes the whole record unreadable rather than silently partial. */
export function parseProposedReadings(raw: unknown): ProposedReading[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ProposedReading[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.measureId !== 'string' || !e.measureId) return null;
    if (typeof e.value !== 'number' || !Number.isFinite(e.value)) return null;
    if (typeof e.applied !== 'boolean') return null;
    if (!(e.appliedAt === null || typeof e.appliedAt === 'string')) return null;
    if (!(e.appliedBy === null || typeof e.appliedBy === 'string')) return null;
    if (!(e.heldReason === null || (typeof e.heldReason === 'string' && HELD_REASONS.includes(e.heldReason)))) return null;
    out.push({
      measureId: e.measureId, value: e.value, applied: e.applied,
      appliedAt: e.appliedAt as string | null, appliedBy: e.appliedBy as string | null,
      heldReason: e.heldReason as ProposedReadingHeldReason | null,
    });
  }
  return out;
}
