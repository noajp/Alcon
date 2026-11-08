// Compensation (back-half B9): when a run fails after some of its
// writes landed, the landed writes are rolled back by the undo each
// write's manifest command declared — or named, in the failure
// report, as standing uncompensated. Declarations live in the
// manifest (connectorManifest.ts); this module is the record and
// the pass:
//
//   record — at the one execution seam (run-agent's callIntegration;
//     the Copilot turn's executor), a write that settles ok and
//     declares an undo leaves its payload in write_compensations,
//     resolved from the actual arguments and the result's state at
//     that moment — bound, never re-derived later. (Writes that ran
//     unasked have no agent_actions row; the payload needed its own
//     record — design §1.3.)
//   pass — at a terminal failure settle, the run's pending payloads
//     form the compensation set in reverse execution order; the
//     policy (a seam B13's failure definitions will feed; the engine
//     default until then is COMPENSATION_DEFAULT) decides whether
//     the set runs now (auto, through the normal policy composition
//     per call), waits as one pending batch for a person (ask), or
//     is only reported (never).
//   report — the failure's record names every landed write:
//     compensated, compensation-failed with its reason, declined,
//     and uncompensated with its reason told apart (no declaration /
//     declared irreversible / incomplete payload / interrupted /
//     never executed). Counts alone would let a silent partial
//     rollback read as a clean one.
//
// A compensation never compensates a compensation (saga depth 1):
// executions the pass or a person's decision drives carry their
// context into the seam, which records them as kind 'compensation'
// rows the set computation never reads. The pass is not
// breaker-gated (design D3): the set is bounded by the run's own
// landed writes, and a trip mid-rollback would strand a
// half-finished rollback with no loop to rest in — but the
// executions are recorded in integration_call_log like any call.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type Manifest, type ManifestCommand, type Reversibility, type UndoDeclaration,
} from "./connectorManifest.ts";
import { stateOfResult } from "./stateDiff.ts";
import { targetKeyOf } from "./breakers.ts";
import { canonicalCalls, type ToolCall } from "./agentLoop.ts";
import { sha256Hex } from "./googleOAuth.ts";
import { approvalSummary, type ApprovalDisplay } from "./integrationTools.ts";
import type { ApprovalVerdict } from "./approvalPolicy.ts";
import type { VerifyCheck } from "./verifyReads.ts";
import type { CompensationSummary } from "./finishClaims.ts";

// ── The policy seam ────────────────────────────────────────────────

/** What a failure's compensation set does: run it now (auto), hold
 *  it as one pending batch for a person (ask), or only report it
 *  (never). */
export type CompensatePolicy = "auto" | "ask" | "never";

/** The engine default until a definition's failure rows speak (B13):
 *  ask — the rollback waits for one tap in the Inbox. An undo is
 *  itself a write, possibly delete-class; nothing rolls back unasked
 *  by default, and `never` would leave the piece inert until B13. */
export const COMPENSATION_DEFAULT: CompensatePolicy = "ask";

/** Where a run's compensation policy comes from. B13's failure
 *  definitions plug in here — a definition's failure row for the
 *  class, then the Space's exception catalog — above this engine
 *  default. B9 ships the seam and the default only: the pass asks
 *  the source; it never classifies failures itself. */
export interface CompensationPolicySource {
  policyFor(args: { runId: string; definitionId: string | null; failureClass: string }): CompensatePolicy;
}

export const engineCompensationPolicy: CompensationPolicySource = {
  policyFor: () => COMPENSATION_DEFAULT,
};

/** The one failure class B9 passes until B13 classifies failures. */
export const RUN_FAILURE_CLASS = "run_failure";

/** The report's reason vocabulary — fixed strings (never raw error
 *  objects), told apart so a reader can see WHY a write stands
 *  uncompensated, not merely that it does. */
export const COMPENSATION_REASONS = {
  policyDenied: "ポリシーで拒否されました",
  commandGone: "undo コマンドが現在の manifest にありません",
  interrupted: "補償が中断されました（状態不明 — 手動確認が必要です）",
  noUndo: "undo が宣言されていません",
  irreversibleNoUndo: "不可逆（reversibility: none）と宣言され、undo が宣言されていません",
  notExecuted: "補償は実行されませんでした",
  policyNever: "ポリシーにより補償は実行されませんでした",
  resultMissing: "実行エラー: 結果が記録されませんでした",
  executionError: (detail: string) => `実行エラー: ${detail.slice(0, 200)}`,
  incompletePayload: (fields: string[]) => `ペイロードが不完全です（不足: ${fields.join("、")}）`,
} as const;

// ── The record ─────────────────────────────────────────────────────

export type CompensationStatus = "pending" | "compensating" | "compensated" | "compensation_failed" | "declined" | "reported";
export type CompensationVerifyStatus = "ok" | "mismatch" | "unverified";

/** One write_compensations row. */
export interface WriteCompensationRow {
  id: string;
  seq: number;
  run_id: string;
  activity_space_id: string | null;
  element_id: string | null;
  integration_id: string;
  command_name: string;
  tool_use_id: string;
  target_key: string | null;
  undo_command_name: string;
  undo_input: Record<string, unknown>;
  unresolved: string[];
  verify_status: CompensationVerifyStatus | null;
  kind: "write" | "compensation";
  compensates_id: string | null;
  status: CompensationStatus;
  status_reason: string | null;
  created_at: string;
  settled_at: string | null;
}

/** Pure. A verify outcome as the record keeps it. */
export function verifyStatusOf(verify: VerifyCheck | undefined): CompensationVerifyStatus | null {
  if (!verify) return null;
  if (verify.ok) return "ok";
  return verify.unverified ? "unverified" : "mismatch";
}

/**
 * Pure. The undo payload a landed write leaves: the declaration's
 * mapping resolved against the write's state — its result's state
 * under its input, the input winning (the verify reading's
 * priority). A mapping value that is a string naming a state field
 * takes the field's value; anything else is a literal. The resolved
 * input is then narrowed to the fields the undo command declares,
 * when it declares any (the verify read's narrowing): the mapping
 * speaks about the undo's arguments, so undeclared fields are not
 * passed. `unresolved` names the undo command's REQUIRED arguments
 * the mapping left unfilled — a payload carrying any is incomplete:
 * reported by name, never partially executed.
 */
export function resolveUndoPayload(args: {
  declaration: UndoDeclaration;
  undoCommand: Pick<ManifestCommand, "input" | "required">;
  writeInput: Record<string, unknown>;
  resultState: Record<string, unknown>;
}): { input: Record<string, unknown>; unresolved: string[] } {
  const state: Record<string, unknown> = { ...args.resultState, ...args.writeInput };
  const mapped: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(args.declaration.input)) {
    mapped[field] = typeof spec === "string" && Object.prototype.hasOwnProperty.call(state, spec) ? state[spec] : spec;
  }
  const declared = Object.keys(args.undoCommand.input ?? {});
  const input: Record<string, unknown> = {};
  if (declared.length) {
    for (const k of declared) if (mapped[k] !== undefined) input[k] = mapped[k];
  } else {
    Object.assign(input, mapped);
  }
  const unresolved = (args.undoCommand.required ?? []).filter((f) => input[f] === undefined || input[f] === null || input[f] === "");
  return { input, unresolved };
}

/**
 * Pure. The compensation set: this run's payloads still awaiting a
 * decision, complete ones only, in REVERSE execution order — the
 * saga principle: the last write is undone first, down the stack of
 * what the run did, so a dependent write is rolled back before the
 * thing it depends on. Rows a compensation execution left
 * (kind 'compensation') never enter: depth 1.
 */
export function compensationSetOf(rows: readonly WriteCompensationRow[]): WriteCompensationRow[] {
  return rows
    .filter((r) => r.kind === "write" && r.status === "pending" && r.unresolved.length === 0)
    .sort((a, b) => b.seq - a.seq);
}

// ── The report ─────────────────────────────────────────────────────

export interface CompensationNamedEntry { rowId: string | null; name: string; target: string | null; count: number }
export interface CompensationDoneEntry extends CompensationNamedEntry { undoName: string }
export interface CompensationFailedEntry extends CompensationNamedEntry { reason: string }
export interface CompensationUncompensatedEntry { name: string; target: string | null; reason: string; count: number }

/** The failure report's structured form: every landed write of the
 *  run, named, in exactly one section. */
export interface CompensationReportData {
  compensated: CompensationDoneEntry[];
  failed: CompensationFailedEntry[];
  declined: CompensationNamedEntry[];
  /** Offered to a person as one pending batch, not yet decided. */
  offered: CompensationDoneEntry[];
  /** Landed writes no rollback covers, each with its reason. */
  uncompensated: CompensationUncompensatedEntry[];
  /** Writes that never landed — reference only, never compensated. */
  failedWrites: CompensationNamedEntry[];
}

export const emptyCompensationReport = (): CompensationReportData => ({
  compensated: [], failed: [], declined: [], offered: [], uncompensated: [], failedWrites: [],
});

/** Pure. Whether the report has anything to say at all. */
export function compensationReportHasContent(r: CompensationReportData): boolean {
  return !!(r.compensated.length || r.failed.length || r.declined.length || r.offered.length || r.uncompensated.length);
}

/** Pure. A rollback that did not cover everything it should have. */
export function compensationIncomplete(r: CompensationReportData): boolean {
  return !!(r.failed.length || r.uncompensated.length);
}

/** Pure. The finish_detail summary (finishClaims.ts): counts, and the
 *  names of the writes that stand uncompensated. */
export function compensationSummaryOf(r: CompensationReportData): CompensationSummary {
  return {
    compensated: r.compensated.length,
    compensationFailed: r.failed.length,
    declined: r.declined.length,
    uncompensated: r.uncompensated.map((u) => (u.target ? `${u.name}（${u.target}）` : u.name)),
  };
}

/** One integration_call_log row, as the report reads it. */
export interface CompensationCallLogRow {
  integration_id: string;
  command_name: string;
  is_write: boolean;
  ok: boolean;
  target_key: string | null;
}

/**
 * Pure. The report over a run's records. The payloads say what was
 * rollback-able and what became of each; the call log says what
 * landed at all — a landed write with no payload row is
 * uncompensatable (no declaration), told apart from a declared-
 * irreversible one, and a write that never landed is reference only.
 * Compensation executions are accounted out of the log by their own
 * rows, so the rollback never appears as the run's writes.
 */
export function buildCompensationReport(args: {
  rows: readonly WriteCompensationRow[];
  callLog: readonly CompensationCallLogRow[];
  integrationNameOf: (integrationId: string) => string;
  reversibilityOfCommand: (integrationId: string, commandName: string) => Reversibility | null;
  offeredRowIds?: ReadonlySet<string>;
}): CompensationReportData {
  const report = emptyCompensationReport();
  const nameOf = (integrationId: string, commandName: string) => `${args.integrationNameOf(integrationId)} の ${commandName}`;
  const writes = args.rows.filter((r) => r.kind === "write");
  for (const row of [...writes].sort((a, b) => b.seq - a.seq)) {
    const base = { rowId: row.id, name: nameOf(row.integration_id, row.command_name), target: row.target_key, count: 1 };
    if (row.status === "compensated") report.compensated.push({ ...base, undoName: row.undo_command_name });
    else if (row.status === "compensation_failed") report.failed.push({ ...base, reason: row.status_reason ?? COMPENSATION_REASONS.resultMissing });
    else if (row.status === "declined") report.declined.push(base);
    else if (row.status === "reported") report.uncompensated.push({ name: base.name, target: base.target, reason: COMPENSATION_REASONS.policyNever, count: 1 });
    else if (row.status === "compensating") report.uncompensated.push({ name: base.name, target: base.target, reason: COMPENSATION_REASONS.interrupted, count: 1 });
    else if (row.unresolved.length) report.uncompensated.push({ name: base.name, target: base.target, reason: COMPENSATION_REASONS.incompletePayload(row.unresolved), count: 1 });
    else if (args.offeredRowIds?.has(row.id)) report.offered.push({ ...base, undoName: row.undo_command_name });
    else report.uncompensated.push({ name: base.name, target: base.target, reason: COMPENSATION_REASONS.notExecuted, count: 1 });
  }
  // The call log's landed writes, minus everything a row accounts
  // for (payload rows and compensation executions alike): what is
  // left landed with no declaration behind it.
  const keyOf = (integrationId: string, command: string, target: string | null) => `${integrationId}\n${command}\n${target ?? ""}`;
  const tally = (entries: readonly { integration_id: string; command_name: string; target_key: string | null }[]) => {
    const m = new Map<string, { integrationId: string; command: string; target: string | null; count: number }>();
    for (const e of entries) {
      const k = keyOf(e.integration_id, e.command_name, e.target_key);
      const cur = m.get(k) ?? { integrationId: e.integration_id, command: e.command_name, target: e.target_key, count: 0 };
      cur.count++;
      m.set(k, cur);
    }
    return m;
  };
  const landed = tally(args.callLog.filter((l) => l.is_write && l.ok));
  const accountedLanded = tally([
    ...writes.map((r) => ({ integration_id: r.integration_id, command_name: r.command_name, target_key: r.target_key })),
    ...args.rows.filter((r) => r.kind === "compensation" && r.status === "compensated")
      .map((r) => ({ integration_id: r.integration_id, command_name: r.command_name, target_key: r.target_key })),
  ]);
  for (const [k, e] of landed) {
    const excess = e.count - (accountedLanded.get(k)?.count ?? 0);
    if (excess <= 0) continue;
    const reversible = args.reversibilityOfCommand(e.integrationId, e.command);
    report.uncompensated.push({
      name: nameOf(e.integrationId, e.command), target: e.target, count: excess,
      reason: reversible === "none" ? COMPENSATION_REASONS.irreversibleNoUndo : COMPENSATION_REASONS.noUndo,
    });
  }
  const failedLog = tally(args.callLog.filter((l) => l.is_write && !l.ok));
  const accountedFailed = tally(args.rows.filter((r) => r.kind === "compensation" && r.status === "compensation_failed")
    .map((r) => ({ integration_id: r.integration_id, command_name: r.command_name, target_key: r.target_key })));
  for (const [k, e] of failedLog) {
    const excess = e.count - (accountedFailed.get(k)?.count ?? 0);
    if (excess > 0) report.failedWrites.push({ rowId: null, name: nameOf(e.integrationId, e.command), target: e.target, count: excess });
  }
  return report;
}

/**
 * Pure. A person's decision on the offered batch, merged into the
 * report the rest left behind: approved entries land as compensated
 * or failed by their recorded outcomes; a rejection declines them
 * all. An offered entry with no recorded outcome after an approval
 * is a failure with that said — never silently compensated.
 */
export function mergeCompensationBatchOutcome(
  report: CompensationReportData,
  args: { approved: boolean; outcomes: ReadonlyMap<string, { ok: boolean; reason?: string }> },
): CompensationReportData {
  const next: CompensationReportData = {
    compensated: [...report.compensated], failed: [...report.failed],
    declined: [...report.declined], offered: [],
    uncompensated: [...report.uncompensated], failedWrites: [...report.failedWrites],
  };
  for (const o of report.offered) {
    if (!args.approved) { next.declined.push({ rowId: o.rowId, name: o.name, target: o.target, count: o.count }); continue; }
    const out = o.rowId ? args.outcomes.get(o.rowId) : undefined;
    if (out?.ok) next.compensated.push(o);
    else next.failed.push({ rowId: o.rowId, name: o.name, target: o.target, count: o.count, reason: out?.reason ?? COMPENSATION_REASONS.resultMissing });
  }
  return next;
}

/** Pure. The report as prose for the Element comment and the run's
 *  compensation step: names and outcomes only — never raw errors,
 *  never payloads. */
export function compensationReportText(r: CompensationReportData): string {
  const named = (e: { name: string; target: string | null; count: number }) => `${e.name}${e.target ? `（${e.target}）` : ""}${e.count > 1 ? ` ×${e.count}` : ""}`;
  const lines: string[] = ["**補償（巻き戻し）の結果**"];
  if (r.compensated.length) lines.push(`- 補償済み（${r.compensated.length}件）: ${r.compensated.map((e) => `${named(e)} → ${e.undoName} で巻き戻し`).join("、")}`);
  if (r.failed.length) lines.push(`- 補償失敗（${r.failed.length}件）: ${r.failed.map((e) => `${named(e)} — ${e.reason}`).join("、")}`);
  if (r.declined.length) lines.push(`- 補償を断られました（${r.declined.length}件）: ${r.declined.map(named).join("、")}`);
  if (r.offered.length) lines.push(`- 補償の承認待ち（${r.offered.length}件）: ${r.offered.map((e) => `${named(e)} → ${e.undoName}`).join("、")}`);
  if (r.uncompensated.length) lines.push(`- 補償されなかった書き込み（${r.uncompensated.length}件）: ${r.uncompensated.map((e) => `${named(e)} — ${e.reason}`).join("、")}`);
  if (r.failedWrites.length) lines.push(`- 着地しなかった書き込み（参考、${r.failedWrites.length}件）: ${r.failedWrites.map(named).join("、")}`);
  if (compensationIncomplete(r)) lines.push("補償は不完全です — 補償されなかった書き込みが残っています。");
  else if (r.offered.length) lines.push("補償は承認待ちです — 承認されると上記の巻き戻しが実行されます。");
  else if (r.compensated.length || r.declined.length) lines.push("着地した書き込みはすべて補償されました（または補償しないことが決まりました）。");
  return lines.join("\n");
}

// ── The record's shell ─────────────────────────────────────────────

const rowOf = (r: Record<string, unknown>): WriteCompensationRow => ({
  id: String(r.id), seq: Number(r.seq), run_id: String(r.run_id),
  activity_space_id: (r.activity_space_id as string | null) ?? null,
  element_id: (r.element_id as string | null) ?? null,
  integration_id: String(r.integration_id), command_name: String(r.command_name),
  tool_use_id: String(r.tool_use_id), target_key: (r.target_key as string | null) ?? null,
  undo_command_name: String(r.undo_command_name),
  undo_input: (r.undo_input && typeof r.undo_input === "object" ? r.undo_input : {}) as Record<string, unknown>,
  unresolved: Array.isArray(r.unresolved) ? r.unresolved.filter((x): x is string => typeof x === "string") : [],
  verify_status: (r.verify_status as CompensationVerifyStatus | null) ?? null,
  kind: r.kind === "compensation" ? "compensation" : "write",
  compensates_id: (r.compensates_id as string | null) ?? null,
  status: r.status as CompensationStatus,
  status_reason: (r.status_reason as string | null) ?? null,
  created_at: String(r.created_at), settled_at: (r.settled_at as string | null) ?? null,
});

export async function loadWriteCompensations(admin: SupabaseClient, runId: string): Promise<WriteCompensationRow[]> {
  const { data } = await admin.from("write_compensations").select("*").eq("run_id", runId).order("seq", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map(rowOf);
}

async function loadCompensationCallLog(admin: SupabaseClient, runId: string): Promise<CompensationCallLogRow[]> {
  const { data } = await admin.from("integration_call_log")
    .select("integration_id, command_name, is_write, ok, target_key").eq("run_id", runId).order("seq", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    integration_id: String(r.integration_id), command_name: String(r.command_name),
    is_write: r.is_write === true, ok: r.ok === true, target_key: (r.target_key as string | null) ?? null,
  }));
}

/** Reversibility read off a stored manifest's raw command entry —
 *  the same derivation parseManifest applies (a declared value wins;
 *  critical reads irreversible; an undeclared write reads wide). The
 *  report needs it for writes that left no payload row, where only
 *  the stored manifest speaks. */
function reversibilityOfRawCommand(raw: unknown): Reversibility | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as { effect?: unknown; critical?: unknown; reversibility?: unknown };
  if (c.reversibility === "contained" || c.reversibility === "wide" || c.reversibility === "none") return c.reversibility;
  if (c.critical === true) return "none";
  if (c.effect === "write") return "wide";
  return null;
}

/** Loads the report over a run's records (rows + call log + the
 *  integrations' names and manifests). */
export async function loadCompensationReport(
  admin: SupabaseClient,
  runId: string,
  opts?: { offeredRowIds?: ReadonlySet<string> },
): Promise<CompensationReportData> {
  const [rows, callLog] = await Promise.all([loadWriteCompensations(admin, runId), loadCompensationCallLog(admin, runId)]);
  const ids = [...new Set([...rows.map((r) => r.integration_id), ...callLog.map((l) => l.integration_id)])];
  const names = new Map<string, string>();
  const manifests = new Map<string, Map<string, unknown>>();
  if (ids.length) {
    const { data } = await admin.from("integrations").select("id, name, manifest").in("id", ids);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      names.set(String(r.id), typeof r.name === "string" && r.name ? r.name : String(r.id));
      const commands = new Map<string, unknown>();
      const manifest = r.manifest as { commands?: unknown } | null;
      if (manifest && Array.isArray(manifest.commands)) {
        for (const c of manifest.commands) {
          if (c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string") commands.set((c as { name: string }).name, c);
        }
      }
      manifests.set(String(r.id), commands);
    }
  }
  return buildCompensationReport({
    rows, callLog,
    integrationNameOf: (id) => names.get(id) ?? id,
    reversibilityOfCommand: (id, command) => reversibilityOfRawCommand(manifests.get(id)?.get(command)),
    offeredRowIds: opts?.offeredRowIds,
  });
}

/**
 * Records a landed write's undo payload at the execution seam.
 * Returns false when the record could not be written — the caller
 * says so on the run: a write its run believes rollback-able must
 * not quietly be otherwise. A command with no declaration records
 * nothing (also false, but the caller only asks when one exists).
 */
export async function recordWriteCompensation(admin: SupabaseClient, args: {
  runId: string; spaceId: string | null; elementId: string | null;
  integrationId: string; command: ManifestCommand; manifest: Manifest | null;
  toolUseId: string; writeInput: Record<string, unknown>; resultText: string;
  verify?: VerifyCheck;
}): Promise<boolean> {
  const declaration = args.command.undo;
  if (!declaration) return false;
  const undoCommand = args.manifest?.commands.find((c) => c.name === declaration.command);
  const resolved = resolveUndoPayload({
    declaration,
    undoCommand: undoCommand ?? { input: {}, required: [] },
    writeInput: args.writeInput,
    resultState: stateOfResult(args.resultText),
  });
  const { error } = await admin.from("write_compensations").insert({
    run_id: args.runId, activity_space_id: args.spaceId, element_id: args.elementId,
    integration_id: args.integrationId, command_name: args.command.name, tool_use_id: args.toolUseId,
    target_key: targetKeyOf(args.command, args.writeInput),
    undo_command_name: declaration.command, undo_input: resolved.input, unresolved: resolved.unresolved,
    verify_status: verifyStatusOf(args.verify), kind: "write", status: "pending",
  });
  return !error;
}

/**
 * Records a compensation's own execution at the seam (kind
 * 'compensation', born settled): the rollback is on the record, and
 * the row's presence is what keeps the execution out of every later
 * set — a compensation never earns a compensation.
 */
export async function recordCompensationExecution(admin: SupabaseClient, args: {
  runId: string; spaceId: string | null; elementId: string | null;
  integrationId: string; commandName: string; toolUseId: string;
  input: Record<string, unknown>; targetKey: string | null; compensatesId: string;
  ok: boolean; reason?: string | null; verify?: VerifyCheck;
}): Promise<void> {
  await admin.from("write_compensations").insert({
    run_id: args.runId, activity_space_id: args.spaceId, element_id: args.elementId,
    integration_id: args.integrationId, command_name: args.commandName, tool_use_id: args.toolUseId,
    target_key: args.targetKey, undo_command_name: args.commandName, undo_input: args.input,
    unresolved: [], verify_status: verifyStatusOf(args.verify), kind: "compensation",
    compensates_id: args.compensatesId,
    status: args.ok ? "compensated" : "compensation_failed",
    status_reason: args.ok ? null : (args.reason ?? COMPENSATION_REASONS.resultMissing),
    settled_at: new Date().toISOString(),
  }).then(() => {}, () => {});
}

/** Claims one payload for execution: the guarded pending →
 *  compensating transition. A row another settle already owns (or
 *  settled) is not claimed — a compensation never runs twice. */
export async function claimWriteCompensation(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await admin.from("write_compensations")
    .update({ status: "compensating" }).eq("id", id).eq("status", "pending").select("id");
  return Array.isArray(data) && data.length === 1;
}

/** Hands a claimed payload back (its undo's verdict asked): the row
 *  returns to pending, to be offered in the run's one batch. */
export async function releaseWriteCompensation(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from("write_compensations").update({ status: "pending" }).eq("id", id).eq("status", "compensating");
}

export async function settleWriteCompensation(
  admin: SupabaseClient, id: string,
  status: Exclude<CompensationStatus, "pending" | "compensating">, reason: string | null,
): Promise<void> {
  await admin.from("write_compensations")
    .update({ status, status_reason: reason, settled_at: new Date().toISOString() }).eq("id", id);
}

/**
 * The dedicated action row for an undo the pass runs unasked: born
 * approved under decision_source 'compensation', so the rollback's
 * executions are first-class records even though no person was
 * asked (the §5.6 rule — an unasked undo never runs off-record).
 */
export async function recordCompensationAction(admin: SupabaseClient, args: {
  runId: string; elementId: string | null; call: ToolCall; display: ApprovalDisplay;
  integrationId: string; ofCompensationId: string; lift: "policy" | "track-record" | null;
}): Promise<string | null> {
  const inputHash = await sha256Hex(canonicalCalls([args.call]));
  const { data } = await admin.from("agent_actions").insert({
    run_id: args.runId, element_id: args.elementId, tool_use_id: args.call.id, tool: args.call.name,
    input: {
      calls: [args.call], display: [args.display],
      compensation: { forRun: args.runId, ofCompensationId: args.ofCompensationId, ...(args.lift ? { lift: args.lift } : {}) },
    },
    input_hash: inputHash, summary: approvalSummary([args.display]),
    integration_id: args.integrationId,
    status: "approved", decided_at: new Date().toISOString(), decision_source: "compensation",
  }).select("id").maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

export async function settleCompensationAction(admin: SupabaseClient, actionId: string, ok: boolean): Promise<void> {
  await admin.from("agent_actions").update({
    status: ok ? "executed" : "failed", executed_at: new Date().toISOString(),
    result: { failed: ok ? 0 : 1, total: 1 },
  }).eq("id", actionId);
}

// ── The pass ───────────────────────────────────────────────────────

/** The driver's half of the pass: everything only the driver knows —
 *  how an undo command resolves to a tool in its assembly, the
 *  normal policy composition for a call, the executor, and the
 *  approval-card display. */
export interface CompensationPassDeps {
  /** The undo command's tool in the driver's assembly, from the
   *  CURRENT manifest: null when it is gone or unreachable (the
   *  command was undeclared, renamed, or its whole integration can
   *  no longer run) — the payload then settles compensation_failed. */
  resolveUndoTool(integrationId: string, commandName: string): { toolName: string } | null;
  /** The normal policy composition for one call — the same verdict
   *  the loop would ask for this call (mode, delegation, autonomy,
   *  manifest rules: deny outranks everything, critical asks). */
  verdictOf(call: ToolCall): { base: ApprovalVerdict; final: ApprovalVerdict; lift: "track-record" | null };
  /** Executes one undo call through the driver's executor. */
  executeUndo(call: ToolCall): Promise<{ ok: boolean; errorText?: string }>;
  /** The approval-card display for one call. */
  displayFor(call: ToolCall): ApprovalDisplay;
}

export type CompensationPassOutcome =
  | { kind: "settled"; report: CompensationReportData }
  | {
    kind: "rest"; calls: ToolCall[]; entries: { callId: string; rowId: string }[];
    displays: ApprovalDisplay[]; report: CompensationReportData;
  };

/**
 * The compensation pass at a run's terminal failure settle. The set
 * is computed from the record (reverse execution order); the policy
 * decides the shape: auto executes each undo through the normal
 * policy composition (a deny never executes; asks collect into one
 * held batch), ask holds the whole set as one batch unexecuted,
 * never only reports. A rest hands the batch to the caller, which
 * parks it as the run's one pending approval; the person's decision
 * executes (or declines) it and finalizes the failure settle.
 */
export async function runCompensationPass(admin: SupabaseClient, args: {
  runId: string; elementId: string | null;
  definitionId: string | null; failureClass?: string;
  policySource?: CompensationPolicySource;
  deps: CompensationPassDeps;
}): Promise<CompensationPassOutcome> {
  const policy = (args.policySource ?? engineCompensationPolicy).policyFor({
    runId: args.runId, definitionId: args.definitionId, failureClass: args.failureClass ?? RUN_FAILURE_CLASS,
  });
  const rows = await loadWriteCompensations(admin, args.runId);
  const set = compensationSetOf(rows);
  const callFor = (row: WriteCompensationRow, toolName: string): ToolCall => ({
    id: `undo-${row.id}`, name: toolName, input: { ...(row.undo_input ?? {}) },
  });
  const rest = async (offered: { row: WriteCompensationRow; call: ToolCall }[]): Promise<CompensationPassOutcome> => ({
    kind: "rest",
    calls: offered.map((o) => o.call),
    entries: offered.map((o) => ({ callId: o.call.id, rowId: o.row.id })),
    displays: offered.map((o) => args.deps.displayFor(o.call)),
    report: await loadCompensationReport(admin, args.runId, { offeredRowIds: new Set(offered.map((o) => o.row.id)) }),
  });

  if (policy === "never") {
    for (const row of set) await settleWriteCompensation(admin, row.id, "reported", COMPENSATION_REASONS.policyNever);
    return { kind: "settled", report: await loadCompensationReport(admin, args.runId) };
  }
  if (policy === "ask") {
    const offered: { row: WriteCompensationRow; call: ToolCall }[] = [];
    for (const row of set) {
      const tool = args.deps.resolveUndoTool(row.integration_id, row.undo_command_name);
      // An undo whose command is gone cannot be offered — it settles
      // failed now, named, rather than riding a batch that cannot run.
      if (!tool) { await settleWriteCompensation(admin, row.id, "compensation_failed", COMPENSATION_REASONS.commandGone); continue; }
      offered.push({ row, call: callFor(row, tool.toolName) });
    }
    if (!offered.length) return { kind: "settled", report: await loadCompensationReport(admin, args.runId) };
    return rest(offered);
  }
  // auto: each undo through the normal policy composition.
  const held: { row: WriteCompensationRow; call: ToolCall }[] = [];
  for (const row of set) {
    const claimed = await claimWriteCompensation(admin, row.id);
    if (!claimed) continue; // another settle owns it; the reloaded report tells its outcome
    const tool = args.deps.resolveUndoTool(row.integration_id, row.undo_command_name);
    if (!tool) { await settleWriteCompensation(admin, row.id, "compensation_failed", COMPENSATION_REASONS.commandGone); continue; }
    const call = callFor(row, tool.toolName);
    const verdict = args.deps.verdictOf(call);
    if (verdict.final === "deny") { await settleWriteCompensation(admin, row.id, "compensation_failed", COMPENSATION_REASONS.policyDenied); continue; }
    if (verdict.final === "ask") { await releaseWriteCompensation(admin, row.id); held.push({ row, call }); continue; }
    const actionId = await recordCompensationAction(admin, {
      runId: args.runId, elementId: args.elementId, call, display: args.deps.displayFor(call),
      integrationId: row.integration_id, ofCompensationId: row.id,
      lift: verdict.lift ?? (verdict.base === "ask" ? "policy" : null),
    });
    const result = await args.deps.executeUndo(call).catch((e): { ok: boolean; errorText?: string } => ({
      ok: false, errorText: e instanceof Error ? e.message : String(e),
    }));
    if (actionId) await settleCompensationAction(admin, actionId, result.ok);
    await settleWriteCompensation(admin, row.id,
      result.ok ? "compensated" : "compensation_failed",
      result.ok ? null : COMPENSATION_REASONS.executionError(result.errorText ?? "不明なエラー"));
  }
  if (held.length) return rest(held);
  return { kind: "settled", report: await loadCompensationReport(admin, args.runId) };
}
