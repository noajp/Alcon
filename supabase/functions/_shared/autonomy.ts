// Graduated autonomy (back-half B7): track-record lanes over the
// static approval modes. Per connector × command, a clean track
// record earns fewer asks inside a blast-radius lane; a single
// incident takes them back. The static approval modes stay the
// Space's ceiling and the floors do not move — this file computes
// the record and the grants; the gate (approvalPolicy.ts) composes
// a grant as one pre-computed fact and can only turn an ask that
// full delegation would already have lifted into a recorded
// auto-allow for that one action.
//
// The record is computed, never reported: its evidence is B4's
// outcome records and the agent_actions rows beneath them — what a
// person decided, what the executor settled, what a declared verify
// read back, what a human later did to the work. The model whose
// calls are counted writes none of it. Three disciplines:
//
//   - Lanes come from the manifest's reversibility (B2), never from
//     the model's opinion: declared "contained" → lane 1; declared
//     "none" or any critical class → lane 3 (a closed lane, not a
//     high threshold); every other write → lane 2. Lane 1 exists
//     only by declaration.
//   - Promotion is a standing fact that must keep being true: the
//     tick evaluator re-derives it continuously, and a grant whose
//     record no longer supports it lapses. Demotion on an incident
//     is synchronous where the incident is recorded in code — a
//     rejection (decision.ts's hook), a verify mismatch (the
//     executor's seam) — and swept by the evaluator for the
//     incidents that exist only as records (a reopen, a rollback),
//     at the first evaluation that can see them; there is no
//     earlier seam in the system for those, because a person's
//     status change and a promotion rollback are recorded by the
//     client and the RPC, not by a driver.
//   - After an incident, re-promotion needs a fresh clean streak at
//     double length: the system's memory of having been wrong is
//     longer than its memory of being right.
//
// Pure builders first (lanes, attribution, the record, the rule);
// the database shells (evaluator, synchronous revocation, the
// gate's grant loader) at the bottom.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseManifest, reversibilityOf,
  type Manifest, type ManifestCommand,
} from "./connectorManifest.ts";
import { integrationPrefix } from "./integrationTools.ts";
import { windowStartOf } from "./outcomeCollector.ts";
import type { VerifyCheck } from "./verifyReads.ts";

/** The autonomy policy — the program's numbers, in one named place
 *  (design §4.2, owner-adopted defaults). They are policy, not
 *  engineering: the thresholds a record must clear, and the doubled
 *  streak a demotion exacts. */
export const AUTONOMY_POLICY = {
  /** The trailing window records are counted over. */
  windowDays: 28,
  /** Clean completions that earn lane 1 (reversible, contained). */
  lane1Clean: 5,
  /** Clean completions that earn lane 2 (reversible, wide). */
  lane2Clean: 15,
  /** Lane 2 additionally: trailing verify checks that must be green. */
  lane2VerifyGreen: 5,
  /** The streak a demotion leaves to re-earn: base × this. */
  demotionFactor: 2,
  /** Outcome rows one evaluation reads at most (the collector's scale). */
  readLimit: 5000,
} as const;

/** Pure. The clean streak a lane's promotion requires at base. */
export function baseCleanForLane(lane: 1 | 2): number {
  return lane === 1 ? AUTONOMY_POLICY.lane1Clean : AUTONOMY_POLICY.lane2Clean;
}

// ── Lanes ─────────────────────────────────────────────────────────────

export type AutonomyLane = 1 | 2 | 3;

/**
 * Pure. A command's lane, from its manifest alone: the declared
 * reversibility wins (B2's derivation — a critical class reads
 * "none"); "contained" is lane 1, "none" is lane 3, every other
 * write is lane 2. A read has no lane — it never asks, so there is
 * nothing to graduate. The model's opinion of its own call never
 * enters here.
 */
export function laneOfCommand(command: Pick<ManifestCommand, "effect" | "reversibility" | "name" | "action" | "http" | "mcp">): AutonomyLane | null {
  if (command.effect !== "write") return null;
  const r = reversibilityOf(command as ManifestCommand);
  if (r === "contained") return 1;
  if (r === "none") return 3;
  return 2;
}

// ── Attribution: an action row's calls name their commands ────────────

export interface AutonomyIntegration {
  id: string;
  activitySpaceId: string;
  name: string;
  manifest: Manifest;
}

/**
 * Pure. The manifest command a recorded call name belongs to, or
 * null. Call names are `${prefix}__${command.name}` (the prefix is
 * the integration's, derived from its name and id); a collision
 * suffix (`_2`) the planner added is tried as a fallback. A name
 * that maps to no declared command is unattributed — never guessed
 * into one: raw HTTP calls and typed Drive tools have no command,
 * so they can neither earn a record nor hold a grant.
 */
export function commandNameForTool(
  integration: Pick<AutonomyIntegration, "name" | "id">,
  toolName: string,
  manifest: Manifest,
): string | null {
  const prefix = `${integrationPrefix(integration.name, integration.id)}__`;
  if (!toolName.startsWith(prefix)) return null;
  const rest = toolName.slice(prefix.length);
  const candidates = [rest, rest.replace(/_\d+$/, "")];
  for (const c of candidates) {
    if (c && manifest.commands.some((cmd) => cmd.name === c)) return c;
  }
  return null;
}

// ── Evidence: events from the sealed rows ─────────────────────────────

export type IncidentKind = "rejection" | "verify_mismatch" | "reopen" | "rollback" | "verdict_fail";

/** The incidents that revoke a standing grant (design §4.2). A
 *  verifier fail of a run is recorded and breaks streaks, but it is
 *  not in the demotion list: a run fails for many reasons, and only
 *  the four named here speak about THIS action. */
export const DEMOTION_KINDS: readonly IncidentKind[] = ["rejection", "verify_mismatch", "reopen", "rollback"];

export interface CommandEvent {
  spaceId: string;
  integrationId: string;
  action: string;
  /** When the evidence stands: a completion by its run's finish, a
   *  rejection by its decision, a signal by the moment it spoke. */
  at: string;
  kind: "completion" | "failed" | "incident";
  incidentKind?: IncidentKind;
  /** The call's declared verify read-back, when one ran and judged. */
  verify?: "ok" | "mismatch" | "unverified";
  /** A completion whose run's finish was a CHECKED pass — the
   *  "volume without verification earns nothing" fact. */
  checkedPass?: boolean;
}

export interface AutonomyActionRow {
  run_id: string;
  status: string;
  decision_source: string | null;
  decided_at: string | null;
  created_at: string;
  integration_id: string | null;
  tool: string;
  input: unknown;
  result: unknown;
}

export interface AutonomyOutcomeRow {
  run_id: string;
  activity_space_id: string | null;
  verdict_result: string | null;
  human_signal: string;
  signal_source: string | null;
  signal_at: string | null;
  finished_at: string;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Pure. A verify check folded to its one word for the record. */
export function verifyWordOf(check: unknown): "ok" | "mismatch" | "unverified" | undefined {
  const c = obj(check) as VerifyCheck | null;
  if (!c || typeof c.ok !== "boolean") return undefined;
  if (c.ok) return "ok";
  return c.unverified ? "unverified" : "mismatch";
}

interface RecordedCall { id: string; name: string }

/** Pure. The calls an action row proposed, from its sealed input. */
export function callsOfInput(input: unknown): RecordedCall[] {
  const calls = obj(input)?.calls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((c) => {
    const r = obj(c);
    return r && typeof r.id === "string" && typeof r.name === "string" ? [{ id: r.id, name: r.name }] : [];
  });
}

/** Pure. A settled batch's per-call outcomes, when the decision path
 *  sealed them (result.perCall, written since B7): tool_use_id →
 *  { ok, verify }. Rows settled before then carry only the aggregate
 *  and answer with an empty map — their per-call truth is unknown,
 *  and the record says so rather than inventing it. */
export function perCallOfResult(result: unknown): Map<string, { ok: boolean; verify?: "ok" | "mismatch" | "unverified" }> {
  const out = new Map<string, { ok: boolean; verify?: "ok" | "mismatch" | "unverified" }>();
  const per = obj(result)?.perCall;
  if (!Array.isArray(per)) return out;
  for (const p of per) {
    const r = obj(p);
    if (!r || typeof r.id !== "string" || typeof r.ok !== "boolean") continue;
    out.set(r.id, { ok: r.ok, verify: verifyWordOf(r.verify) });
  }
  return out;
}

/**
 * Pure. Every command event the sealed rows hold, attributed per
 * (Space, integration, command). Only runs WITH an outcome record
 * speak — the outcome is the run's settled truth (its verdict, its
 * human signal), and a run still in flight has earned nothing yet.
 *
 * A completion is an execution that landed: a policy row settled
 * executed, a person's approved call that ran clean (per-call where
 * the decision path sealed it; a legacy batch only when every call
 * in it landed). A failed execution is its own event — it breaks a
 * streak without being an incident. A rejection, a verify mismatch,
 * a reopen or send-back of the run's work, a rollback of a promotion
 * the run fed, and a checked FAIL verdict on a run that used the
 * command are incidents, each at the moment it was recorded.
 */
export function commandEventsOf(args: {
  actions: readonly AutonomyActionRow[];
  outcomes: readonly AutonomyOutcomeRow[];
  integrations: readonly AutonomyIntegration[];
}): CommandEvent[] {
  const events: CommandEvent[] = [];
  const integrationsById = new Map(args.integrations.map((i) => [i.id, i]));
  const outcomesByRun = new Map(args.outcomes.map((o) => [o.run_id, o]));
  const usedByRun = new Map<string, Map<string, CommandEvent>>();

  const markUsed = (runId: string, base: Omit<CommandEvent, "kind" | "at">) => {
    const byKey = usedByRun.get(runId) ?? new Map<string, CommandEvent>();
    byKey.set(`${base.integrationId}:${base.action}`, { ...base, kind: "incident", at: "" });
    usedByRun.set(runId, byKey);
  };

  for (const row of args.actions) {
    const outcome = outcomesByRun.get(row.run_id);
    if (!outcome || !outcome.activity_space_id || !row.integration_id) continue;
    const integration = integrationsById.get(row.integration_id);
    if (!integration) continue;
    const calls = callsOfInput(row.input);
    const perCall = perCallOfResult(row.result);
    const rowVerify = verifyWordOf(obj(row.result)?.verify);
    const checkedPass = outcome.verdict_result === "pass";
    for (const call of calls) {
      const action = commandNameForTool(integration, call.name, integration.manifest);
      if (!action) continue;
      const base = { spaceId: outcome.activity_space_id, integrationId: row.integration_id, action };
      markUsed(row.run_id, base);
      if (row.decision_source !== null) {
        // A policy approval (the mode's, or a track record's own):
        // born approved, settled by its landing.
        if (row.status === "executed") {
          events.push({ ...base, kind: "completion", at: outcome.finished_at, verify: rowVerify, checkedPass });
          if (rowVerify === "mismatch") events.push({ ...base, kind: "incident", incidentKind: "verify_mismatch", at: outcome.finished_at });
        } else if (row.status === "failed") {
          events.push({ ...base, kind: "failed", at: outcome.finished_at, verify: rowVerify });
          if (rowVerify === "mismatch") events.push({ ...base, kind: "incident", incidentKind: "verify_mismatch", at: outcome.finished_at });
        }
        continue;
      }
      if (row.status === "rejected") {
        events.push({ ...base, kind: "incident", incidentKind: "rejection", at: row.decided_at ?? row.created_at });
        continue;
      }
      if (row.status !== "executed" && row.status !== "failed") continue;
      const mine = perCall.get(call.id);
      if (mine) {
        events.push({ ...base, kind: mine.ok ? "completion" : "failed", at: outcome.finished_at, verify: mine.verify, checkedPass });
        if (mine.verify === "mismatch") events.push({ ...base, kind: "incident", incidentKind: "verify_mismatch", at: outcome.finished_at });
      } else if (calls.length === 1) {
        events.push({ ...base, kind: row.status === "executed" ? "completion" : "failed", at: outcome.finished_at, verify: rowVerify, checkedPass });
        if (rowVerify === "mismatch") events.push({ ...base, kind: "incident", incidentKind: "verify_mismatch", at: outcome.finished_at });
      } else if (row.status === "executed" && Number(obj(row.result)?.failed ?? -1) === 0) {
        // A legacy batch in which every call landed: the aggregate
        // is per-call truth here, and only here.
        events.push({ ...base, kind: "completion", at: outcome.finished_at, checkedPass });
      }
      // A legacy batch with any failure: which call failed is not
      // recorded, so no call is credited and none is blamed.
    }
  }

  // Run-level incidents: the verdict and the human signal speak about
  // the run's work as a whole; every command the run used hears them.
  for (const outcome of args.outcomes) {
    if (!outcome.activity_space_id) continue;
    const used = usedByRun.get(outcome.run_id);
    if (!used) continue;
    for (const base of used.values()) {
      if (outcome.verdict_result === "fail") {
        events.push({ ...base, kind: "incident", incidentKind: "verdict_fail", at: outcome.finished_at });
      }
      if (outcome.human_signal === "rework" && (outcome.signal_source === "review" || outcome.signal_source === "reopen")) {
        events.push({ ...base, kind: "incident", incidentKind: "reopen", at: outcome.signal_at ?? outcome.finished_at });
      }
      if (outcome.human_signal === "rejected" && outcome.signal_source === "rollback") {
        events.push({ ...base, kind: "incident", incidentKind: "rollback", at: outcome.signal_at ?? outcome.finished_at });
      }
      // An approval rejection (signal_source 'approval') is carried
      // by the action rows themselves, precisely per call — the
      // run-level echo would only double it.
    }
  }
  return events;
}

// ── The record ────────────────────────────────────────────────────────

export interface CommandRecord {
  spaceId: string;
  integrationId: string;
  action: string;
  /** Completions in the window that landed clean (no mismatch). */
  cleanCompletions: number;
  /** Of those, how many their runs' checked passes covered. */
  checkedPasses: number;
  /** The trailing run of clean completions, unbroken by any
   *  incident or failed execution. */
  cleanStreak: number;
  /** Of the streak, how many carry a checked pass. */
  checkedInStreak: number;
  /** Verify checks that judged (ok or mismatch). */
  verifyChecked: number;
  verifyOk: number;
  /** The trailing run of green verify checks (an unverified read
   *  breaks it: absence of evidence is not green). */
  verifyGreenStreak: number;
  incidents: number;
  lastIncidentAt: string | null;
  /** The newest demotion-grade incident, when one stands. */
  lastDemotion: { kind: IncidentKind; at: string } | null;
}

const KIND_RANK = { incident: 0, failed: 1, completion: 2 } as const;

/** Pure. One key's record from its events. Deterministic in the
 *  events alone: newest first, an incident at the same moment as a
 *  completion convicts it (the conviction is about that work). */
export function recordOf(key: { spaceId: string; integrationId: string; action: string }, events: readonly CommandEvent[]): CommandRecord {
  const sorted = [...events].sort((a, b) =>
    b.at.localeCompare(a.at) || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  let cleanStreak = 0, checkedInStreak = 0;
  for (const e of sorted) {
    if (e.kind === "completion" && e.verify !== "mismatch") {
      cleanStreak += 1;
      if (e.checkedPass) checkedInStreak += 1;
    } else break;
  }
  let verifyGreenStreak = 0;
  for (const e of sorted) {
    if (!e.verify) continue;
    if (e.verify === "ok") verifyGreenStreak += 1;
    else break;
  }
  let lastDemotion: { kind: IncidentKind; at: string } | null = null;
  for (const e of sorted) {
    if (e.kind === "incident" && e.incidentKind && DEMOTION_KINDS.includes(e.incidentKind)) { lastDemotion = { kind: e.incidentKind, at: e.at }; break; }
  }
  const incidentEvents = sorted.filter((e) => e.kind === "incident");
  return {
    ...key,
    cleanCompletions: sorted.filter((e) => e.kind === "completion" && e.verify !== "mismatch").length,
    checkedPasses: sorted.filter((e) => e.kind === "completion" && e.verify !== "mismatch" && e.checkedPass).length,
    cleanStreak,
    checkedInStreak,
    verifyChecked: sorted.filter((e) => e.verify === "ok" || e.verify === "mismatch").length,
    verifyOk: sorted.filter((e) => e.verify === "ok").length,
    verifyGreenStreak,
    incidents: incidentEvents.length,
    lastIncidentAt: incidentEvents[0]?.at ?? null,
    lastDemotion,
  };
}

/** Pure. Every key's record, in a stable order. */
export function recordsOf(events: readonly CommandEvent[]): CommandRecord[] {
  const byKey = new Map<string, { key: { spaceId: string; integrationId: string; action: string }; events: CommandEvent[] }>();
  for (const e of events) {
    const k = `${e.spaceId}:${e.integrationId}:${e.action}`;
    const g = byKey.get(k) ?? { key: { spaceId: e.spaceId, integrationId: e.integrationId, action: e.action }, events: [] };
    g.events.push(e);
    byKey.set(k, g);
  }
  return [...byKey.values()]
    .map((g) => recordOf(g.key, g.events))
    .sort((a, b) => `${a.integrationId}:${a.action}`.localeCompare(`${b.integrationId}:${b.action}`));
}

// ── The promotion rule ────────────────────────────────────────────────

export interface GrantStanding {
  level: "ask" | "auto";
  pinned: boolean;
  requiredClean: number;
}

/**
 * Pure. Whether a record earns (or keeps) an auto grant, and the
 * clean streak the decision stands on. The rule is the design's:
 * the lane's threshold of clean completions as an unbroken streak,
 * zero incidents in the window, at least half the streak carrying a
 * checked verifier pass — and for lane 2, a verify declaration on
 * the command whose last checks are green, because a wide write
 * earns trust only where a deterministic check exists to catch it.
 * A demoted grant's doubled requirement (written on the grant row
 * at demotion) outranks the base number.
 */
export function promotionOf(args: {
  lane: AutonomyLane | null;
  hasVerify: boolean;
  record: CommandRecord;
  grant: GrantStanding | null;
}): { eligible: boolean; requiredClean: number } {
  const { lane, record, grant } = args;
  if (lane !== 1 && lane !== 2) return { eligible: false, requiredClean: 0 };
  const requiredClean = grant && grant.requiredClean > 0 ? grant.requiredClean : baseCleanForLane(lane);
  if (record.incidents > 0) return { eligible: false, requiredClean };
  if (record.cleanStreak < requiredClean) return { eligible: false, requiredClean };
  if (record.checkedInStreak * 2 < record.cleanStreak) return { eligible: false, requiredClean };
  if (lane === 2 && (!args.hasVerify || record.verifyGreenStreak < AUTONOMY_POLICY.lane2VerifyGreen)) {
    return { eligible: false, requiredClean };
  }
  return { eligible: true, requiredClean };
}

/** Pure. The basis a grant stands on, as the record counts it — the
 *  numbers a person reads to judge why this action runs unasked. */
export function basisOf(record: CommandRecord, requiredClean: number): Record<string, unknown> {
  return {
    cleanStreak: record.cleanStreak,
    checkedInStreak: record.checkedInStreak,
    verifyGreenStreak: record.verifyGreenStreak,
    incidents: record.incidents,
    requiredClean,
    windowDays: AUTONOMY_POLICY.windowDays,
  };
}

// ── Grants: the gate's loader, the synchronous demotion ───────────────

export interface AutonomyGrantFact {
  lane: 1 | 2;
  /** Clean completions the grant stands on (its basis). */
  clean: number;
}

const grantKey = (integrationId: string, action: string) => `${integrationId}:${action}`;

/**
 * The live auto grants of one Space, keyed for the approval gate.
 * Read at a run's start (the grants a slice judges by are the ones
 * standing when it began — a demotion mid-run lands on the NEXT
 * call's run, and the incident path itself is never gated by this
 * cache). A read failure answers empty: no grant is also the safe
 * answer, because an unread record must never widen what runs
 * unasked.
 */
export async function loadAutonomyGrantFacts(
  admin: SupabaseClient,
  spaceId: string,
): Promise<Map<string, AutonomyGrantFact>> {
  const out = new Map<string, AutonomyGrantFact>();
  try {
    const { data, error } = await admin.from("autonomy_grants")
      .select("integration_id, action, lane, basis")
      .eq("activity_space_id", spaceId).eq("level", "auto");
    if (error) { console.error("autonomy: grant load failed", error.message); return out; }
    for (const g of (data ?? []) as { integration_id: string; action: string; lane: number; basis: unknown }[]) {
      if (g.lane !== 1 && g.lane !== 2) continue;
      const clean = Number(obj(g.basis)?.cleanStreak ?? 0);
      out.set(grantKey(g.integration_id, g.action), { lane: g.lane, clean: Number.isFinite(clean) ? clean : 0 });
    }
  } catch (e) {
    console.error("autonomy: grant load failed", e instanceof Error ? e.message : e);
  }
  return out;
}

/** The grant fact for one call, from a loaded map. */
export function grantFactFor(
  facts: ReadonlyMap<string, AutonomyGrantFact>,
  integrationId: string | null | undefined,
  action: string | null | undefined,
): AutonomyGrantFact | null {
  if (!integrationId || !action) return null;
  return facts.get(grantKey(integrationId, action)) ?? null;
}

export type RevokeOutcome = "revoked" | "pinned" | "not_auto" | "no_grant" | "failed";

/**
 * Synchronous demotion: the first incident takes the grant back in
 * the same flow that records the incident — a person's rejection
 * (decision.ts's hook calls this), a verify mismatch (the executor's
 * seam). The grant row moves to ask, its re-promotion requirement
 * doubles, and the change is logged with the incident behind it. A
 * pinned grant does not move (an owner's freeze outranks every rule,
 * either way). Never throws: the incident's own record already
 * landed, and a demotion that failed is retried by the evaluator's
 * sweep over the same records — it is logged here, loudly.
 */
export async function revokeAutonomyForIncident(
  admin: SupabaseClient,
  args: {
    spaceId: string;
    integrationId: string;
    action: string;
    kind: "rejection" | "verify_mismatch" | "reopen" | "rollback";
    runId?: string | null;
    at?: Date;
  },
): Promise<RevokeOutcome> {
  const at = (args.at ?? new Date()).toISOString();
  try {
    const { data: grant } = await admin.from("autonomy_grants")
      .select("id, lane, level, pinned")
      .eq("activity_space_id", args.spaceId).eq("integration_id", args.integrationId).eq("action", args.action)
      .maybeSingle();
    if (!grant) return "no_grant";
    const g = grant as { id: string; lane: number; level: string; pinned: boolean };
    if (g.pinned) return "pinned";
    if (g.level !== "auto") return "not_auto";
    const requiredClean = (g.lane === 1 || g.lane === 2) ? baseCleanForLane(g.lane) * AUTONOMY_POLICY.demotionFactor : 0;
    const { data: moved, error } = await admin.from("autonomy_grants").update({
      level: "ask", required_clean: requiredClean,
      last_incident_at: at, last_incident_kind: args.kind,
      updated_at: at,
    }).eq("id", g.id).eq("level", "auto").select("id").maybeSingle();
    if (error) { console.error("autonomy: demotion failed", error.message); return "failed"; }
    if (!moved) return "not_auto";
    await admin.from("autonomy_changes").insert({
      activity_space_id: args.spaceId, integration_id: args.integrationId, action: args.action,
      from_level: "auto", to_level: "ask", cause: "demotion",
      detail: { incident: args.kind, ...(args.runId ? { run_id: args.runId } : {}) },
    });
    return "revoked";
  } catch (e) {
    console.error("autonomy: demotion failed", e instanceof Error ? e.message : e);
    return "failed";
  }
}

// ── The evaluator (database shell) ────────────────────────────────────

interface GrantRow {
  id: string;
  activity_space_id: string;
  integration_id: string;
  action: string;
  lane: number;
  level: "ask" | "auto";
  basis: unknown;
  granted_by: string;
  pinned: boolean;
  required_clean: number;
  updated_at: string;
}

const sameBasis = (a: unknown, b: Record<string, unknown>): boolean => {
  const x = obj(a);
  if (!x) return false;
  return Object.entries(b).every(([k, v]) => x[k] === v);
};

/**
 * One evaluation of the track records, on the automations tick
 * beside the collector and the calibration. Order matters: records
 * are recomputed first; demotions (a standing grant its record
 * convicts, or whose lane closed) are applied before promotions, so
 * a key demoted in this pass cannot re-promote in it; promotions
 * write the grant and its change row together. Idempotent: a second
 * evaluation over the same world refreshes the same rows and moves
 * nothing.
 */
export async function evaluateAutonomy(
  admin: SupabaseClient,
  now: Date,
): Promise<{ records: number; promoted: number; demoted: number }> {
  let promoted = 0, demoted = 0;
  const windowStart = windowStartOf(now, AUTONOMY_POLICY.windowDays);
  const nowIso = now.toISOString();

  const { data: outcomeRows } = await admin.from("run_outcomes")
    .select("run_id, activity_space_id, verdict_result, human_signal, signal_source, signal_at, finished_at")
    .gte("finished_at", windowStart)
    .order("finished_at", { ascending: true })
    .limit(AUTONOMY_POLICY.readLimit);
  const outcomes = (outcomeRows ?? []) as AutonomyOutcomeRow[];

  // The Spaces this evaluation can speak about: those with outcomes
  // in the window, plus any Space holding a grant (a lane may have
  // closed on a manifest edit while no run was settling).
  const { data: grantRows } = await admin.from("autonomy_grants")
    .select("id, activity_space_id, integration_id, action, lane, level, basis, granted_by, pinned, required_clean, updated_at");
  const grants = (grantRows ?? []) as GrantRow[];
  const spaceIds = [...new Set([
    ...outcomes.map((o) => o.activity_space_id).filter((x): x is string => !!x),
    ...grants.map((g) => g.activity_space_id),
  ])];
  if (!spaceIds.length) return { records: 0, promoted, demoted };

  const { data: integrationRows } = await admin.from("integrations")
    .select("id, activity_space_id, name, manifest").in("activity_space_id", spaceIds);
  const integrations: AutonomyIntegration[] = ((integrationRows ?? []) as { id: string; activity_space_id: string; name: string; manifest: unknown }[])
    .map((r) => ({ id: r.id, activitySpaceId: r.activity_space_id, name: r.name, manifest: parseManifest(r.manifest).manifest }));
  const integrationsById = new Map(integrations.map((i) => [i.id, i]));

  let actions: AutonomyActionRow[] = [];
  const runIds = outcomes.map((o) => o.run_id);
  for (let i = 0; i < runIds.length; i += 200) {
    const { data: chunk } = await admin.from("agent_actions")
      .select("run_id, status, decision_source, decided_at, created_at, integration_id, tool, input, result")
      .in("run_id", runIds.slice(i, i + 200));
    actions = actions.concat((chunk ?? []) as AutonomyActionRow[]);
  }

  const records = recordsOf(commandEventsOf({ actions, outcomes, integrations }));
  const recordByKey = new Map(records.map((r) => [`${r.spaceId}:${r.integrationId}:${r.action}`, r]));

  // ── The rollup refresh ──────────────────────────────────────────
  let recordRows = 0;
  const { data: stale } = await admin.from("command_track_records").select("id").lt("window_start", windowStart).limit(1);
  if (records.length || (stale ?? []).length) {
    if (records.length) {
      const rows = records.map((r) => ({
        activity_space_id: r.spaceId, integration_id: r.integrationId, action: r.action,
        window_start: windowStart, window_days: AUTONOMY_POLICY.windowDays,
        clean_completions: r.cleanCompletions, checked_passes: r.checkedPasses,
        clean_streak: r.cleanStreak, checked_in_streak: r.checkedInStreak,
        verify_checked: r.verifyChecked, verify_ok: r.verifyOk, verify_green_streak: r.verifyGreenStreak,
        incidents: r.incidents, last_incident_at: r.lastIncidentAt,
        updated_at: nowIso,
      }));
      const { error } = await admin.from("command_track_records")
        .upsert(rows, { onConflict: "activity_space_id,integration_id,action,window_start,window_days" });
      if (error) console.error("autonomy: record upsert failed", error.message);
      else recordRows = rows.length;
    }
    await admin.from("command_track_records").delete().lt("window_start", windowStart);
  }

  const laneFor = (integrationId: string, action: string): { lane: AutonomyLane | null; hasVerify: boolean } => {
    const integration = integrationsById.get(integrationId);
    const command = integration?.manifest.commands.find((c) => c.name === action);
    if (!command) return { lane: null, hasVerify: false };
    return { lane: laneOfCommand(command), hasVerify: !!command.verify };
  };

  const demote = async (g: GrantRow, kind: IncidentKind | "record_lapsed" | "lane_closed", detail: Record<string, unknown>): Promise<void> => {
    const doubled = kind === "record_lapsed" || kind === "lane_closed"
      ? g.required_clean
      : (g.lane === 1 || g.lane === 2 ? baseCleanForLane(g.lane) * AUTONOMY_POLICY.demotionFactor : g.required_clean);
    const { data: moved } = await admin.from("autonomy_grants").update({
      level: "ask", required_clean: doubled,
      last_incident_at: nowIso, last_incident_kind: kind, updated_at: nowIso,
    }).eq("id", g.id).eq("level", "auto").select("id").maybeSingle();
    if (!moved) return;
    demoted += 1;
    await admin.from("autonomy_changes").insert({
      activity_space_id: g.activity_space_id, integration_id: g.integration_id, action: g.action,
      from_level: "auto", to_level: "ask", cause: "demotion",
      detail: { incident: kind, ...detail },
    });
  };

  // ── Demotions: a standing grant must keep being true ────────────
  for (const g of grants) {
    if (g.level !== "auto" || g.pinned) continue;
    const { lane } = laneFor(g.integration_id, g.action);
    if (lane === null || lane === 3) { await demote(g, "lane_closed", {}); continue; }
    const record = recordByKey.get(`${g.activity_space_id}:${g.integration_id}:${g.action}`);
    if (!record) continue; // no evidence in the window either way — silence is not an incident
    if (record.lastDemotion) { await demote(g, record.lastDemotion.kind, {}); continue; }
    const { hasVerify } = laneFor(g.integration_id, g.action);
    const standing: GrantStanding = { level: g.level, pinned: g.pinned, requiredClean: g.required_clean };
    if (!promotionOf({ lane, hasVerify, record, grant: standing }).eligible) {
      await demote(g, "record_lapsed", {});
    } else {
      // Still earned: the basis refreshes to the record as it stands.
      const basis = basisOf(record, promotionOf({ lane, hasVerify, record, grant: standing }).requiredClean);
      if (!sameBasis(g.basis, basis)) {
        await admin.from("autonomy_grants").update({ basis, lane, updated_at: nowIso }).eq("id", g.id);
      }
    }
  }

  // ── Promotions ────────────────────────────────────────────────────
  const grantByKey = new Map(grants.map((g) => [`${g.activity_space_id}:${g.integration_id}:${g.action}`, g]));
  for (const record of records) {
    const key = `${record.spaceId}:${record.integrationId}:${record.action}`;
    const existing = grantByKey.get(key);
    if (existing?.pinned) continue; // an owner's freeze outranks every rule
    const { lane, hasVerify } = laneFor(record.integrationId, record.action);
    if (lane === null || lane === 3) continue;
    const standing: GrantStanding | null = existing
      ? { level: existing.level, pinned: existing.pinned, requiredClean: existing.required_clean }
      : null;
    const { eligible, requiredClean } = promotionOf({ lane, hasVerify, record, grant: standing });
    if (!eligible) continue;
    const basis = basisOf(record, requiredClean);
    if (existing) {
      if (existing.level === "auto") continue; // refreshed in the demotion pass above
      const { data: moved } = await admin.from("autonomy_grants").update({
        level: "auto", lane, basis, granted_by: "system", required_clean: requiredClean, updated_at: nowIso,
      }).eq("id", existing.id).eq("level", "ask").select("id").maybeSingle();
      if (!moved) continue;
      promoted += 1;
      await admin.from("autonomy_changes").insert({
        activity_space_id: record.spaceId, integration_id: record.integrationId, action: record.action,
        from_level: "ask", to_level: "auto", cause: "promotion", detail: { basis },
      });
    } else {
      const { error } = await admin.from("autonomy_grants").insert({
        activity_space_id: record.spaceId, integration_id: record.integrationId, action: record.action,
        lane, level: "auto", basis, granted_by: "system", pinned: false, required_clean: requiredClean,
      });
      if (error) { if (error.code !== "23505") console.error("autonomy: grant insert failed", error.message); continue; }
      promoted += 1;
      await admin.from("autonomy_changes").insert({
        activity_space_id: record.spaceId, integration_id: record.integrationId, action: record.action,
        from_level: null, to_level: "auto", cause: "promotion", detail: { basis },
      });
    }
  }

  return { records: recordRows, promoted, demoted };
}
