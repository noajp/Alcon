// B8 plan mode (plan -> apply dry-run). A plan run executes a high-risk run
// first on the rehearsal substrate — reads live, writes recorded with their
// exact arguments — and the plan itself is the deliverable: ONE approval unit
// whose hash binds the whole ordered plan (the back-half program design §2/B8,
// owner decision §9.5: a plan approval may cover critical calls LISTED in the
// plan, hash-bound to the listed calls only). On approval a fresh apply run
// executes through the normal executor; every call still passes policy, and
// the plan approval satisfies `ask` for exactly the calls whose canonical
// arguments match a listed, unconsumed entry — anything else (unlisted,
// argument-drifted, policy-denied) asks or refuses on its own. Where a B2
// verify declaration exists the plan also records the expected post-state and
// the pre-state baseline at plan time, so the apply run can re-read before
// writing and fail a drifted call closed with the diff shown.
//
// This module holds the plan record shape and the pure/anchored pieces of the
// protocol. The run driver (run-agent) owns the gates and the lifecycle; the
// pieces here are unit-tested from the web suite like the rest of _shared.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canonicalCalls, type ToolCall } from "./agentLoop.ts";
import { sha256Hex } from "./googleOAuth.ts";
import { jsonEqual, stateOfResult, type DiffMismatch } from "./stateDiff.ts";
import { expectedOfVerify, verifyReadInput, type VerifyCheck } from "./verifyReads.ts";
import {
  approvalSummary,
  executeIntegrationTool,
  type ApprovalDisplay,
  type IntegrationTool,
} from "./integrationTools.ts";
import type { CriticalClass } from "./connectorManifest.ts";

/** The pre-state of the verify read at plan time, narrowed to the expected
 *  fields: present fields land in `values`, fields the read did not return
 *  land in `absent` (so a field appearing later counts as drift too). */
export interface PlanPreState {
  values: Record<string, unknown>;
  absent: string[];
}

/** What a B2 verify declaration promises about one planned write: the read
 *  command that checks it, the expected post-state (from the write's own
 *  arguments), and the plan-time pre-state baseline where it could be read. */
export interface PlanExpectedEffect {
  verifyCommand: string;
  expected: Record<string, unknown>;
  baseline: PlanPreState | null;
}

/** One write the plan run recorded. `display` is built at plan time from the
 *  approval machinery, so the person approving the plan sees exactly what the
 *  approval machinery would show for the call on its own (plus plan notes);
 *  `denied` marks a call policy would refuse even under approval — shown at
 *  plan time, and never covered at apply time. */
export interface PlanCall {
  call: ToolCall;
  /** Canonical argument key (see planCallKey). */
  key: string;
  label: string;
  display: ApprovalDisplay;
  critical: CriticalClass | null;
  denied: boolean;
  /** Why the call could not be assembled at plan time, if it could not. */
  problem: string | null;
  expected: PlanExpectedEffect | null;
  /** Set at apply time when the approval has been spent on a matching call. */
  consumed?: boolean;
}

/** A sealed plan, carried in the plan run's transcript and copied into the
 *  apply run's transcript on approval. `hash` binds the whole ordered plan
 *  (canonicalCalls over the recorded calls); `actionId` names the approval
 *  unit once sealed. */
export interface RunPlan {
  v: 1;
  planRunId: string;
  actionId: string | null;
  hash: string;
  calls: PlanCall[];
}

/** The canonical key of one call for plan matching: canonicalCalls over the
 *  call with an empty id. Call ids are per-run mintings, not arguments — the
 *  apply run's calls carry different ids than the plan run's, so the match the
 *  owner's decision binds (exact canonical ARGUMENTS) excludes the id, while
 *  still going through the approval machinery's own canonicalization. */
export async function planCallKey(call: ToolCall): Promise<string> {
  return await sha256Hex(canonicalCalls([{ id: "", name: call.name, input: call.input }]));
}

/** The hash of the whole ordered plan: canonicalCalls over the recorded calls
 *  as recorded. Order is part of the plan; swapping two calls changes it. */
export async function planHashOf(calls: readonly ToolCall[]): Promise<string> {
  return await sha256Hex(canonicalCalls([...calls]));
}

/** Tolerant reader for a RunPlan riding a transcript (stored jsonb): anything
 *  malformed reads as no plan, never as a partial one — an unreadable plan
 *  covers nothing and refuses decisions, which fails closed. */
export function readRunPlan(json: unknown): RunPlan | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const p = json as Record<string, unknown>;
  if (p.v !== 1 || typeof p.planRunId !== "string" || typeof p.hash !== "string") return null;
  if (!Array.isArray(p.calls)) return null;
  const calls: PlanCall[] = [];
  for (const raw of p.calls) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const c = raw as Record<string, unknown>;
    const call = c.call as Record<string, unknown> | null;
    if (!call || typeof call !== "object" || typeof call.id !== "string" || typeof call.name !== "string") return null;
    if (typeof c.key !== "string" || typeof c.label !== "string") return null;
    calls.push(c as unknown as PlanCall);
  }
  return {
    v: 1,
    planRunId: p.planRunId,
    actionId: typeof p.actionId === "string" ? p.actionId : null,
    hash: p.hash,
    calls,
  };
}

/** Tolerant reader for the plan run's accumulating draft (transcript jsonb). */
export function readPlanCalls(json: unknown): PlanCall[] {
  if (!Array.isArray(json)) return [];
  return json.filter((c): c is PlanCall =>
    !!c && typeof c === "object" && !Array.isArray(c) &&
    typeof (c as PlanCall).key === "string" &&
    !!(c as PlanCall).call && typeof (c as PlanCall).call?.name === "string");
}

/** The coverage rule, pure: the first unconsumed entry whose key matches —
 *  but denied and unassemblable entries never cover anything. Multiset
 *  semantics: a plan that lists the same call twice covers two executions;
 *  the third identical call asks on its own. */
export function matchPlanCall(plan: RunPlan, key: string): PlanCall | null {
  for (const entry of plan.calls) {
    if (entry.consumed || entry.denied || entry.problem) continue;
    if (entry.key === key) return entry;
  }
  return null;
}

/** Narrow a read state to the expected fields (plan-time baseline). */
export function preStateOf(state: Record<string, unknown>, expected: Record<string, unknown>): PlanPreState {
  const values: Record<string, unknown> = {};
  const absent: string[] = [];
  for (const field of Object.keys(expected)) {
    if (Object.prototype.hasOwnProperty.call(state, field) && state[field] !== undefined) values[field] = state[field];
    else absent.push(field);
  }
  return { values, absent };
}

/** Drift between the plan-time baseline and a fresh pre-state, over the
 *  expected fields only: a changed value, an appeared field, or a vanished
 *  field all count. Entries read in the verifyDiffText shape (expected =
 *  what the plan saw, actual = what is there now). */
export function preStateDrift(baseline: PlanPreState, now: PlanPreState): DiffMismatch[] {
  const fields = [...Object.keys(baseline.values), ...baseline.absent];
  const out: DiffMismatch[] = [];
  for (const field of fields) {
    const was = baseline.absent.includes(field) ? undefined : baseline.values[field];
    const is = now.absent.includes(field) ? undefined : now.values[field];
    if (!jsonEqual(was, is)) out.push({ field, expected: was, actual: is });
  }
  return out;
}

/** The verify expectation of a planned write, where the command declares one:
 *  the read-back command and the expected post-state from the write's own
 *  arguments. Pure; null when no verify is declared. */
export function verifyExpectationOf(it: IntegrationTool, call: ToolCall): { verifyCommand: string; expected: Record<string, unknown> } | null {
  const decl = it.command?.verify;
  if (!decl) return null;
  return { verifyCommand: decl.command, expected: expectedOfVerify(decl, call.input) };
}

/** Read the verify pre-state for a write call (live read, no side effect).
 *  The read's input is derived from the write's arguments alone — a read that
 *  needs the write's RESULT to address its target (e.g. a created resource's
 *  number) is not addressable before the write, and reads back null: no
 *  baseline, no drift check, honestly absent rather than invented. */
export async function readVerifyPreState(
  it: IntegrationTool,
  call: ToolCall,
  fields: readonly string[],
): Promise<PlanPreState | null> {
  const decl = it.command?.verify;
  const manifest = it.manifest;
  if (!decl || !manifest) return null;
  const readCommand = manifest.commands.find((c) => c.name === decl.command);
  if (!readCommand || readCommand.effect !== "read") return null;
  const input = verifyReadInput(readCommand, call.input, "");
  for (const field of readCommand.required ?? []) {
    if (input[field] === undefined) return null;
  }
  const readTool: IntegrationTool = {
    ...it,
    command: readCommand,
    remote: readCommand.mcp ? (it.remote ? { ...it.remote, name: readCommand.mcp } : it.remote) : null,
  };
  const result = await executeIntegrationTool(readTool, { id: `${call.id}:planstate`, name: call.name, input });
  if (result.isError) return null;
  const state = stateOfResult(result.text);
  const expected: Record<string, unknown> = {};
  for (const field of fields) expected[field] = null;
  return preStateOf(state, expected);
}

/** Capture a planned write's expected effect at plan time: the expectation
 *  plus the pre-state baseline where the read is addressable pre-write. */
export async function capturePlanExpected(it: IntegrationTool, call: ToolCall): Promise<PlanExpectedEffect | null> {
  const exp = verifyExpectationOf(it, call);
  if (!exp) return null;
  const baseline = await readVerifyPreState(it, call, Object.keys(exp.expected));
  return { verifyCommand: exp.verifyCommand, expected: exp.expected, baseline };
}

/** Re-check a covered call's premise at apply time: re-read the pre-state and
 *  diff it against the plan-time baseline. Null = no baseline was recorded, so
 *  no drift check exists for this call (the expected post-state is still
 *  verified after the write by the normal verify read-back). An unreadable
 *  pre-state returns a single synthetic mismatch — the premise can no longer
 *  be confirmed, so the call fails closed. */
export async function checkPlanDrift(
  it: IntegrationTool,
  call: ToolCall,
  expected: PlanExpectedEffect,
): Promise<DiffMismatch[] | null> {
  if (!expected.baseline) return null;
  const now = await readVerifyPreState(it, call, Object.keys(expected.expected));
  if (!now) {
    return [{ field: `（${expected.verifyCommand} の読み戻し）`, expected: "計画時の状態", actual: "読み戻しに失敗" }];
  }
  return preStateDrift(expected.baseline, now);
}

/** The plan card's expected-effect line for one call. */
export function expectedNote(expected: PlanExpectedEffect): string {
  const fields = Object.keys(expected.expected);
  const base = fields.length
    ? `「${expected.verifyCommand}」で ${fields.join("、")} を照合します`
    : `「${expected.verifyCommand}」で結果を照合します`;
  return expected.baseline ? `${base}（計画時の状態と適用前に照合します）` : base;
}

/** What a plan run is told at its start (the rehearsal notice's sibling):
 *  reads are real, writes are the plan — walk the whole task, because the
 *  plan only covers what the run actually records. */
export const PLAN_TASK_NOTICE =
  "この実行は「計画モード」です。読み取りは実際に行いますが、書き込みは実行せず、引数そのままで計画として記録します。" +
  "最後まで手順を歩き切ってください。書き込みのたびに「実行したもの」として結果を前提にせず、計画に記録されたことを前提に進めてください。" +
  "終わったら finish で、計画として記録した書き込みを要約してください。計画全体が人の承認に回り、承認されれば別の実行が計画どおりに適用します。";

/** What an apply run is told at its start: the approved sequence it is
 *  executing under, and the boundary of the coverage — listed calls with
 *  their exact planned arguments run unasked; anything else asks. */
export function planApplyNotice(plan: RunPlan): string {
  const lines = plan.calls.map((c, i) => `${i + 1}. ${c.label}`).join("\n");
  return "この実行は、承認済みの計画の「適用」です。次の書き込みが、引数そのままに計画に挙がっていれば、承認を求めずに実行します。" +
    "計画にない書き込みや、引数が計画と違う書き込みは、通常どおり承認を求めます。計画の手順に沿って進めてください。\n計画:\n" + lines;
}

// The plan approval's per-call execution record — policyApproval's shape with
// decision_source 'plan': written BEFORE the covered call executes, so the
// lift of that call is on the record whatever happens next, and settled with
// the outcome (executed / failed, with the verify check or the drift that
// refused it). decided_by is the plan's approver — the run's own starter,
// copied from the plan run; the row is evidence of THEIR one decision.
export async function recordPlanApproval(
  admin: SupabaseClient,
  args: {
    runId: string;
    elementId: string | null;
    call: ToolCall;
    display: ApprovalDisplay;
    planActionId: string | null;
    integrationId: string | null;
    decidedBy: string | null;
  },
): Promise<string | null> {
  const inputHash = await sha256Hex(canonicalCalls([args.call]));
  const { data, error } = await admin
    .from("agent_actions")
    .insert({
      run_id: args.runId,
      element_id: args.elementId,
      tool_use_id: args.call.id,
      tool: args.call.name,
      input: { calls: [args.call], display: [args.display], plan: { actionId: args.planActionId } },
      input_hash: inputHash,
      summary: approvalSummary([args.display]),
      integration_id: args.integrationId,
      status: "approved",
      decided_by: args.decidedBy,
      decided_at: new Date().toISOString(),
      decision_source: "plan",
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function settlePlanApproval(
  admin: SupabaseClient,
  actionId: string,
  ok: boolean,
  opts?: { verify?: VerifyCheck; drift?: DiffMismatch[] },
): Promise<void> {
  await admin
    .from("agent_actions")
    .update({
      status: ok ? "executed" : "failed",
      result: {
        failed: ok ? 0 : 1,
        total: 1,
        ...(opts?.verify ? { verify: opts.verify } : {}),
        ...(opts?.drift ? { drift: opts.drift } : {}),
      },
    })
    .eq("id", actionId);
}
