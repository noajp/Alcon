// The pure half of audit-intake (ADR 0045): what a gateway's batch must look
// like, how each event's digest is computed, and how the signature is
// checked. index.ts does the HTTP and the database; the gateway computes the
// same digest with the same field order, so this file is its reference.

export const MAX_BODY_BYTES = 1_000_000;
export const MAX_RECORDS = 1000;
export const GENESIS_DIGEST = "0".repeat(64);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
// One spelling per instant: UTC, microseconds, Z — the form the ledger's own
// chain hashes (workflow_step_chain), so the digest never depends on how a
// timestamp happened to be written.
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ID = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_INT = 2_147_483_647;
// Text the database cannot hold as jsonb: NUL, and a surrogate without its pair.
const UNSTORABLE = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** A STAMP that names a real instant (no 24:00, :60 or 30 February), so the
 * database stores the same text the digest was computed over. */
function isStamp(value: string): boolean {
  if (!STAMP.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
}

const KINDS = new Set(["start", "step", "approval", "exception", "end"]);
const OPERATIONS = new Set(["read", "draft", "send", "money", "none"]);
const RESULTS = new Set(["ok", "failed", "blocked", "waiting", "approved", "returned"]);
const ACTORS = new Set(["ai_agent", "human", "system"]);

export interface IntakeRun {
  deployment_id: string;
  external_id: string;
  template_version: number;
  subject_ref: string | null;
  subject_digest: string | null;
  started_at: string;
}

export interface IntakeStep {
  deployment_id: string;
  event_id: string;
  run_external_id: string;
  step_key: string;
  kind: string;
  connector: string | null;
  operation: string;
  result: string;
  actor_kind: string;
  actor_name: string | null;
  reason: string | null;
  occurred_at: string;
  duration_ms: number | null;
  /** The version of the deployment's grants (ADR 0046) the gateway held when
   * it decided this event's operation; null when it held none. */
  grants_version: number | null;
  prev_digest: string;
  digest: string;
}

export interface IntakeBatch {
  batch_id: string;
  runs: IntakeRun[];
  steps: IntakeStep[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(o: Record<string, unknown>, k: string, max = 500): string | undefined {
  const v = o[k];
  return typeof v === "string" && v.length > 0 && v.length <= max && !UNSTORABLE.test(v) ? v : undefined;
}

function optionalText(o: Record<string, unknown>, k: string, max = 500): string | null | undefined {
  const v = o[k];
  if (v === undefined || v === null) return null;
  return typeof v === "string" && v.length <= max && !UNSTORABLE.test(v) ? v : undefined;
}

function parseRun(raw: unknown, i: number): Parsed<IntakeRun> {
  const at = `runs[${i}]`;
  if (!isRecord(raw)) return { ok: false, error: `${at} is not an object` };
  const deployment_id = text(raw, "deployment_id");
  const external_id = text(raw, "external_id");
  const started_at = text(raw, "started_at");
  const subject_ref = optionalText(raw, "subject_ref");
  const subject_digest = optionalText(raw, "subject_digest");
  const template_version = raw.template_version;
  if (!deployment_id || !UUID.test(deployment_id)) return { ok: false, error: `${at}.deployment_id is not a uuid` };
  if (!external_id || !ID.test(external_id)) return { ok: false, error: `${at}.external_id is missing or malformed` };
  if (!Number.isInteger(template_version) || (template_version as number) < 1 || (template_version as number) > MAX_INT) return { ok: false, error: `${at}.template_version is not a positive integer` };
  if (!started_at || !isStamp(started_at)) return { ok: false, error: `${at}.started_at is not YYYY-MM-DDTHH:MM:SS.ffffffZ` };
  if (subject_ref === undefined || subject_digest === undefined) return { ok: false, error: `${at} subject fields are malformed` };
  return { ok: true, value: { deployment_id, external_id, template_version: template_version as number, subject_ref, subject_digest, started_at } };
}

function parseStep(raw: unknown, i: number): Parsed<IntakeStep> {
  const at = `steps[${i}]`;
  if (!isRecord(raw)) return { ok: false, error: `${at} is not an object` };
  const deployment_id = text(raw, "deployment_id");
  const event_id = text(raw, "event_id");
  const run_external_id = text(raw, "run_external_id");
  const step_key = text(raw, "step_key", 200);
  const kind = text(raw, "kind");
  const operation = text(raw, "operation") ?? "none";
  const result = text(raw, "result");
  const actor_kind = text(raw, "actor_kind");
  const occurred_at = text(raw, "occurred_at");
  const prev_digest = text(raw, "prev_digest");
  const digest = text(raw, "digest");
  const connector = optionalText(raw, "connector", 200);
  const actor_name = optionalText(raw, "actor_name", 200);
  const reason = optionalText(raw, "reason", 2000);
  const duration = raw.duration_ms;
  const grants = raw.grants_version;
  if (!deployment_id || !UUID.test(deployment_id)) return { ok: false, error: `${at}.deployment_id is not a uuid` };
  if (!event_id || !ID.test(event_id)) return { ok: false, error: `${at}.event_id is missing or malformed` };
  if (!run_external_id || !ID.test(run_external_id)) return { ok: false, error: `${at}.run_external_id is missing or malformed` };
  if (!step_key) return { ok: false, error: `${at}.step_key is missing` };
  if (!kind || !KINDS.has(kind)) return { ok: false, error: `${at}.kind is not one of ${[...KINDS].join(", ")}` };
  if (!OPERATIONS.has(operation)) return { ok: false, error: `${at}.operation is not one of ${[...OPERATIONS].join(", ")}` };
  if (!result || !RESULTS.has(result)) return { ok: false, error: `${at}.result is not one of ${[...RESULTS].join(", ")}` };
  if (!actor_kind || !ACTORS.has(actor_kind)) return { ok: false, error: `${at}.actor_kind is not one of ${[...ACTORS].join(", ")}` };
  if (!occurred_at || !isStamp(occurred_at)) return { ok: false, error: `${at}.occurred_at is not YYYY-MM-DDTHH:MM:SS.ffffffZ` };
  if (!prev_digest || !HEX64.test(prev_digest)) return { ok: false, error: `${at}.prev_digest is not 64 lowercase hex` };
  if (!digest || !HEX64.test(digest)) return { ok: false, error: `${at}.digest is not 64 lowercase hex` };
  if (connector === undefined || actor_name === undefined || reason === undefined) return { ok: false, error: `${at} optional text fields are malformed` };
  if (duration !== undefined && duration !== null && !(Number.isInteger(duration) && (duration as number) >= 0 && (duration as number) <= MAX_INT)) {
    return { ok: false, error: `${at}.duration_ms is not a non-negative integer` };
  }
  if (grants !== undefined && grants !== null && !(Number.isInteger(grants) && (grants as number) >= 0 && (grants as number) <= MAX_INT)) {
    return { ok: false, error: `${at}.grants_version is not a non-negative integer` };
  }
  return {
    ok: true,
    value: {
      deployment_id, event_id, run_external_id, step_key, kind, connector, operation, result, actor_kind, actor_name, reason,
      occurred_at, duration_ms: (duration as number | null | undefined) ?? null,
      grants_version: (grants as number | null | undefined) ?? null, prev_digest, digest,
    },
  };
}

/** The batch's shape, every field checked; nothing is coerced. */
export function parseBatch(raw: unknown): Parsed<IntakeBatch> {
  if (!isRecord(raw)) return { ok: false, error: "body is not an object" };
  const batch_id = text(raw, "batch_id", 200);
  if (!batch_id || !ID.test(batch_id)) return { ok: false, error: "batch_id is missing or malformed" };
  const runsRaw = raw.runs ?? [];
  const stepsRaw = raw.steps ?? [];
  if (!Array.isArray(runsRaw) || !Array.isArray(stepsRaw)) return { ok: false, error: "runs and steps must be arrays" };
  if (runsRaw.length + stepsRaw.length === 0) return { ok: false, error: "batch is empty" };
  if (runsRaw.length + stepsRaw.length > MAX_RECORDS) return { ok: false, error: `batch holds more than ${MAX_RECORDS} records` };
  const runs: IntakeRun[] = [];
  for (const [i, r] of runsRaw.entries()) {
    const parsed = parseRun(r, i);
    if (!parsed.ok) return parsed;
    runs.push(parsed.value);
  }
  const steps: IntakeStep[] = [];
  for (const [i, s] of stepsRaw.entries()) {
    const parsed = parseStep(s, i);
    if (!parsed.ok) return parsed;
    steps.push(parsed.value);
  }
  const runKeys = new Set<string>();
  for (const r of runs) {
    const k = `${r.deployment_id}/${r.external_id}`;
    if (runKeys.has(k)) return { ok: false, error: `run ${r.external_id} appears twice` };
    runKeys.add(k);
  }
  const eventKeys = new Set<string>();
  for (const s of steps) {
    const k = `${s.deployment_id}/${s.event_id}`;
    if (eventKeys.has(k)) return { ok: false, error: `event ${s.event_id} appears twice` };
    eventKeys.add(k);
  }
  return { ok: true, value: { batch_id, runs, steps } };
}

const encoder = new TextEncoder();
// Each field as its byte length, a colon, and the value — the same framing as
// the ledger's chain, so no two field lists hash to the same text.
const field = (value: string | number | null) => {
  const t = value === null ? "" : String(value);
  return `${encoder.encode(t).length}:${t}`;
};

/** The text an event's digest is the SHA-256 of, field by field, in order. */
export function eventDigestText(step: Omit<IntakeStep, "digest">): string {
  return [
    step.prev_digest, step.deployment_id, step.event_id, step.run_external_id, step.step_key, step.kind,
    step.connector, step.operation, step.result, step.actor_kind, step.actor_name, step.reason,
    step.occurred_at, step.duration_ms, step.grants_version,
  ].map(field).join("");
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const eventDigest = (step: Omit<IntakeStep, "digest">) => sha256Hex(eventDigestText(step));

/**
 * The first problem with the batch's own chain, or null: each event's digest
 * is what its fields produce, and within each deployment every event points
 * at the one before it in the batch. Whether the first event of a deployment
 * continues what is already stored is decided by the database, which holds
 * the tail.
 */
export async function batchChainProblem(steps: readonly IntakeStep[]): Promise<string | null> {
  const last = new Map<string, string>();
  for (const step of steps) {
    if (await eventDigest(step) !== step.digest) return `event ${step.event_id}: digest does not match its fields`;
    const prev = last.get(step.deployment_id);
    if (prev !== undefined && step.prev_digest !== prev) return `event ${step.event_id}: does not point at the event before it`;
    last.set(step.deployment_id, step.digest);
  }
  return null;
}

export function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Whether `signature` (base64url) is the key's Ed25519 signature of `body`. */
export async function verifySignature(publicKey: string, signature: string, body: Uint8Array): Promise<boolean> {
  const keyBytes = base64UrlDecode(publicKey);
  const sigBytes = base64UrlDecode(signature);
  if (!keyBytes || keyBytes.length !== 32 || !sigBytes || sigBytes.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sigBytes as BufferSource, body as BufferSource);
  } catch {
    return false;
  }
}
