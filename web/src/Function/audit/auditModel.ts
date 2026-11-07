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

export interface RunVerdict {
  v: 1;
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
}

const VERDICT_RESULTS: readonly string[] = ['pass', 'fail', 'unchecked'];
const VERDICT_SOURCES: readonly string[] = ['verifier', 'none'];
const VERDICT_OUTCOMES: readonly string[] = ['completed', 'partial', 'blocked'];
const VERDICT_REASONS: readonly string[] = ['revisions-exhausted', 'verify-unavailable', 'outcome-not-completed', 'external-model'];

/** Strict narrowing of the jsonb: a record that is not exactly this shape
 *  is not a verdict (null), never a partially-read one. Mirrors the
 *  server's parseRunVerdict field for field. */
export function parseRunVerdict(raw: unknown): RunVerdict | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
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
  return {
    v: 1,
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
      result: ACTION_RESULT[action.status], reason: action.summary, outside_grant: false,
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
