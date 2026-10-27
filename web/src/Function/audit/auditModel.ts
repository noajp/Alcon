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
}

/** How a run ended, or where it stands. */
export type RunOutcome =
  | 'auto'       // finished without a person
  | 'approved'   // finished after a person approved
  | 'returned'   // a person sent it back
  | 'exception'  // the agent stopped and handed it to a person
  | 'deviation'  // the gateway blocked an operation outside the grants
  | 'stopped'    // a joint failed and the run did not finish
  | 'waiting'    // waiting for a person's approval
  | 'running';

const RUN_OUTCOMES: readonly RunOutcome[] = ['auto', 'approved', 'returned', 'exception', 'deviation', 'stopped', 'waiting', 'running'];

/** Outcomes that ask something of a person now. */
export const NEEDS_PERSON: ReadonlySet<RunOutcome> = new Set(['exception', 'deviation', 'stopped', 'waiting']);

/** Steps in chain order: the gateway's order, not the clock's. */
export function inChainOrder(steps: readonly WorkflowStepRecord[]): WorkflowStepRecord[] {
  return [...steps].sort((a, b) => a.seq - b.seq);
}

/**
 * A run's outcome, read from its steps. A blocked operation outweighs
 * everything — it is the one thing an audit must never let pass unseen —
 * then a finished run says how it finished, and an unfinished one says
 * what it is waiting on.
 */
export function runOutcome(steps: readonly WorkflowStepRecord[]): RunOutcome {
  const ordered = inChainOrder(steps);
  if (ordered.some(s => s.result === 'blocked')) return 'deviation';
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
export function exceptionReason(steps: readonly WorkflowStepRecord[]): string | null {
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
export function summarizeDeployment(runs: readonly WorkflowRunRecord[], stepsByRun: ReadonlyMap<string, readonly WorkflowStepRecord[]>): DeploymentSummary {
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
export function flowObservation(declared: readonly WorkflowTemplateStep[], steps: readonly WorkflowStepRecord[]): FlowStep[] {
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
// (workflow_step_chain in the migration). The text it hashes is fixed field
// by field; this reads it the same way, so anyone holding the rows can
// check that none was removed or altered.

const GENESIS_HASH = '0'.repeat(64);

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

function stepChainText(step: Pick<WorkflowStepRecord,
  'prev_hash' | 'seq' | 'run_id' | 'step_key' | 'kind' | 'connector' | 'operation' | 'result' | 'actor_kind' | 'actor_name' | 'reason' | 'occurred_at' | 'duration_ms'>): string {
  return [
    step.prev_hash, String(step.seq), step.run_id, step.step_key, step.kind,
    step.connector ?? '', step.operation, step.result, step.actor_kind,
    step.actor_name ?? '', step.reason ?? '', chainTimestamp(step.occurred_at),
    step.duration_ms === null ? '' : String(step.duration_ms),
  ].join('|');
}

export type ChainBreak = { seq: number; kind: 'gap' | 'link' | 'hash' };

/**
 * Where a deployment's chain breaks, given its steps and a SHA-256 hex
 * function. `gap` — a seq is missing; `link` — a step does not point at the
 * one before it; `hash` — a step's fields no longer produce its hash.
 * Checks from the first step held, so a page that starts mid-chain is read
 * from its own first link.
 */
export async function verifyChain(steps: readonly WorkflowStepRecord[], sha256Hex: (text: string) => Promise<string>): Promise<ChainBreak[]> {
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
