// Circuit breakers (back-half B11): the harassment guard over a run's
// own call stream. Budgets stop expensive runs; breakers stop *wrong*
// runs — repeated writes to one target, a run whose calls mostly fail,
// a first-ever send to a destination this Space has never written to.
// All three rules are deterministic code over settled call records,
// evaluated in the gate before the approval composition is consulted
// (design §6's ordering: manifest deny → breaker/quota pre-check →
// approval composition → execute → verify-read → record). The model is
// never asked, and no mode, delegation, standing rule or earned
// autonomy grant can lift a trip, because the composition that could
// lift an ask is never reached for a tripped call — the loop holds the
// turn's writes as one pending decision and the run rests for a person.
//
// The evidence base is integration_call_log: one row per manifest-
// command call the executor actually dispatched, written at the record
// stage of that same ordering. It is deliberately NOT agent_actions.
// That table holds only approval-shaped records — what waited for a
// person, what a mode or a track record lifted, what a plan sealed —
// so a write that ran unasked under an allow verdict or full
// delegation leaves no row there: exactly the traffic a harassment
// guard exists to see. (B7 met the same gap and narrowed its scope to
// approval-shaped rows; a runtime safety gate cannot narrow that way,
// so B11 keeps the missing record instead of weakening the rule.)
//
// A trip never silently kills. The run rests in awaiting_approval —
// the one wait a work run can actually be answered from: a work run
// cannot receive messages (dispatch.ts's law), so the design's
// awaiting_input rest is realized through the decision machinery, with
// the trip's reason as the pending action's summary, one breaker_trips
// row for audit, and a notification that tells the person what tripped
// and that approving resumes it. A decision — approve or reject — is
// the only thing that acknowledges a trip; nothing auto-resumes.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  criticalClassOf, requestFor, type ManifestCommand,
} from "./connectorManifest.ts";

/** The breaker policy — the program's numbers, in one named place
 *  (design §6, owner-adopted defaults). They are policy, not
 *  engineering: no settings screen reads them in v1. */
export const BREAKER_POLICY = {
  /** Settled writes to one target key within the window at or above
   *  this hold the next write. A command's manifest quota overrides
   *  it for that command. */
  sameTargetWritesPerHour: 10,
  /** The trailing window the write-rate rule counts over. */
  windowMs: 3_600_000,
  /** The run's own recent settled calls the error-rate rule reads. */
  errorWindow: 20,
  /** The error-rate rule stays silent below this many settled calls:
   *  a small sample proves nothing (the design's burst guard). */
  errorMinSample: 10,
  /** The error fraction at or above which the error-rate rule trips. */
  errorRate: 0.5,
} as const;

export type BreakerRule = "write_rate" | "error_rate" | "first_destination";

/** One trip, as the gate computed it: the rule, the call it stopped,
 *  the one line a person reads, and the counts it stood on. */
export interface BreakerTrip {
  rule: BreakerRule;
  integrationId: string;
  integrationName: string;
  commandName: string;
  targetKey: string;
  /** The one line the paused run and the Inbox candidate carry. */
  reason: string;
  /** The settled counts the decision stood on, sealed onto the trip row. */
  evidence: Record<string, unknown>;
}

// ── Target keys ───────────────────────────────────────────────────────

/**
 * The argument fields that say *where* a call goes, in the fixed order
 * a target key reads them. Content fields (a message body, a file's
 * content, a title) are never among them: two writes carrying
 * different content to the same place are the same target.
 */
const ADDRESSING_FIELDS = [
  "owner", "repo", "repository", "path", "file_path", "branch",
  "channel", "channel_id", "to", "recipient", "recipients", "email",
  "thread_id", "conversation_id", "issue_number", "number",
  "calendar_id", "folder_id", "project_id", "account_id", "user_id",
  "bucket", "key", "id", "url", "endpoint", "address", "name",
] as const;
const MAX_TARGET_PARTS = 4;
const MAX_TARGET_VALUE = 120;

function scalarText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string" || typeof x === "number")) {
    return v.map(String).join(",");
  }
  return null;
}

/** Pure. A call's addressing arguments as `field=value` parts, in the
 *  vocabulary's fixed order (never the input's order, so the same
 *  destination keys the same way every time), skipping the fields a
 *  set names (an HTTP path's parameters already ride in its line). */
function addressingParts(input: Record<string, unknown>, skip: ReadonlySet<string>): string[] {
  const parts: string[] = [];
  for (const f of ADDRESSING_FIELDS) {
    if (skip.has(f)) continue;
    const v = scalarText(input[f]);
    if (v === null || v === "") continue;
    parts.push(`${f}=${v.slice(0, MAX_TARGET_VALUE)}`);
    if (parts.length >= MAX_TARGET_PARTS) break;
  }
  return parts;
}

/**
 * Pure. The target a call writes to, as a stable key. For an HTTP
 * command it is the resolved request line — method and filled path,
 * the resource itself — refined by any addressing arguments the path
 * does not already carry (a recipient named in the body is part of
 * the destination). For an MCP command it is the addressing arguments
 * alone. A call with no addressing argument at all keys on its
 * command: repeated writes to it are same-target writes by any
 * reading. The key is stored beside the integration's id, so it only
 * ever has to distinguish destinations within one connection.
 */
export function targetKeyOf(command: ManifestCommand, input: Record<string, unknown>): string {
  if (command.http) {
    const inPath = new Set([...command.http.path.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]));
    const req = requestFor(command, input);
    const line = "error" in req ? `${command.http.method} ${command.http.path}` : `${req.method} ${req.path}`;
    const parts = addressingParts(input, inPath);
    return parts.length ? `${line} · ${parts.join(", ")}` : line;
  }
  const parts = addressingParts(input, new Set());
  return parts.length ? parts.join(", ") : command.name;
}

// ── Evaluation (pure) ─────────────────────────────────────────────────

export interface BreakerCallFacts {
  integrationId: string;
  integrationName: string;
  command: ManifestCommand;
  targetKey: string;
}

/** The settled counts one evaluation reads — what already ran, never
 *  what is merely proposed. The call being judged is not among them:
 *  it has not run yet. */
export interface BreakerCounts {
  /** Settled writes to (integration, target) inside the window. */
  sameTargetWrites: number;
  /** The run's most recent settled calls, newest first — ok flags. */
  runRecentOk: readonly boolean[];
  /** Settled successful writes this Space has ever made to the target. */
  priorSuccessfulWritesToTarget: number;
}

/**
 * Pure. Whether this write trips a breaker, and which one. Rules are
 * judged in blast-radius order: a first destination is the widest
 * reach a call can have, so it is named first when several rules
 * would trip together.
 */
export function evaluateBreakers(facts: BreakerCallFacts, counts: BreakerCounts): BreakerTrip | null {
  const { command } = facts;
  const base = {
    integrationId: facts.integrationId,
    integrationName: facts.integrationName,
    commandName: command.name,
    targetKey: facts.targetKey,
  };

  // (c) First-destination sends. A lane rule, not a statistic: it does
  // not decay, no record of good behaviour lifts it, and the approval
  // composition is never consulted — only a settled successful write
  // to this very destination, by any run of this Space, clears it.
  if (criticalClassOf(command) === "send" && counts.priorSuccessfulWritesToTarget === 0) {
    return {
      ...base, rule: "first_destination",
      reason: `サーキットブレーカー: ${facts.integrationName} の送信先「${facts.targetKey}」は、この Space でまだ送信したことのない宛先です`,
      evidence: { priorSuccessfulWrites: 0 },
    };
  }

  // (a) Same-target write rate. The manifest's quota is this same
  // check with the command's own number in place of the default.
  const limit = command.quota?.writesPerHour ?? BREAKER_POLICY.sameTargetWritesPerHour;
  if (counts.sameTargetWrites >= limit) {
    return {
      ...base, rule: "write_rate",
      reason: `サーキットブレーカー: ${facts.integrationName} の「${facts.targetKey}」への書き込みが直近1時間で ${counts.sameTargetWrites} 件に達しました（上限 ${limit} 件${command.quota ? "・コマンドの quota" : ""}）`,
      evidence: {
        sameTargetWrites: counts.sameTargetWrites, limit,
        source: command.quota ? "quota" : "default", windowMs: BREAKER_POLICY.windowMs,
      },
    };
  }

  // (b) The run's own error rate over its recent settled calls. Below
  // the minimum sample the rule stays silent: a handful of early
  // failures is a run warming up, not a run gone wrong.
  const sample = counts.runRecentOk.slice(0, BREAKER_POLICY.errorWindow);
  if (sample.length >= BREAKER_POLICY.errorMinSample) {
    const errors = sample.filter((ok) => !ok).length;
    const rate = errors / sample.length;
    if (rate >= BREAKER_POLICY.errorRate) {
      return {
        ...base, rule: "error_rate",
        reason: `サーキットブレーカー: この実行の直近 ${sample.length} 件の呼び出しのうち ${errors} 件が失敗しています（失敗率 ${Math.round(rate * 100)}%）`,
        evidence: { sample: sample.length, errors, rate },
      };
    }
  }

  return null;
}

// ── The record and the counts (database shells) ───────────────────────

/**
 * Records one dispatched call at the record stage of §6's ordering —
 * after it ran, with the outcome it landed with. Best effort by
 * construction, like the credential audit: a failure to record never
 * fails a call that already happened.
 */
export async function recordIntegrationCall(admin: SupabaseClient, row: {
  runId: string; spaceId: string; integrationId: string; commandName: string;
  isWrite: boolean; ok: boolean; targetKey: string | null;
}): Promise<void> {
  try {
    await admin.from("integration_call_log").insert({
      run_id: row.runId, activity_space_id: row.spaceId, integration_id: row.integrationId,
      command_name: row.commandName, is_write: row.isWrite, ok: row.ok, target_key: row.targetKey,
    });
  } catch { /* the record is evidence, not the act */ }
}

/**
 * The counts one gate evaluation reads, from settled call records
 * only. A read that fails answers on the safe side of its own rule:
 * the threshold rules get no evidence (they need positive counts to
 * trip, so a broken counter cannot halt work), while the
 * first-destination count reads an unreadable history as "never
 * sent" — when consent cannot be disproven it is asked, the same
 * discipline as the sign-in gate's unreadable trail.
 */
export async function loadBreakerCounts(admin: SupabaseClient, args: {
  spaceId: string; runId: string; integrationId: string; targetKey: string; now: Date;
}): Promise<BreakerCounts> {
  const windowStart = new Date(args.now.getTime() - BREAKER_POLICY.windowMs).toISOString();
  let sameTargetWrites = 0;
  let priorSuccessfulWritesToTarget = 0;
  let runRecentOk: boolean[] = [];
  try {
    const { count } = await admin.from("integration_call_log")
      .select("id", { count: "exact", head: true })
      .eq("activity_space_id", args.spaceId).eq("integration_id", args.integrationId)
      .eq("target_key", args.targetKey).eq("is_write", true)
      .gte("created_at", windowStart);
    sameTargetWrites = count ?? 0;
  } catch { sameTargetWrites = 0; }
  try {
    const { count } = await admin.from("integration_call_log")
      .select("id", { count: "exact", head: true })
      .eq("activity_space_id", args.spaceId).eq("integration_id", args.integrationId)
      .eq("target_key", args.targetKey).eq("is_write", true).eq("ok", true);
    priorSuccessfulWritesToTarget = count ?? 0;
  } catch { priorSuccessfulWritesToTarget = 0; }
  try {
    const { data } = await admin.from("integration_call_log")
      .select("ok").eq("run_id", args.runId)
      .order("seq", { ascending: false }).limit(BREAKER_POLICY.errorWindow);
    runRecentOk = ((data ?? []) as { ok: boolean }[]).map((r) => r.ok);
  } catch { runRecentOk = []; }
  return { sameTargetWrites, priorSuccessfulWritesToTarget, runRecentOk };
}
