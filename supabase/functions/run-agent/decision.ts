// The decision half of a paused turn, shared by every driver that can
// hold one: an Element's run (execute) and a Copilot session's run
// (Athena's chat driver). A decision answers the paused turn before anything
// else: the action is marked, the approved batch runs to the end with its
// progress saved as it goes (a slice that runs out of time hands the rest
// to a continuation), or the rejection goes back to the model as the
// calls' results. What runs a call — and what remembering an approval
// writes — is the driver's own, passed in.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  appendDecisionResults, canonicalCalls,
  type FinishPayload, type LoopState, type PendingApproval, type ToolCall, type ToolResult,
} from "../_shared/agentLoop.ts";
import { approvalSummary, criticalOfTool, type ApprovalDisplay, type IntegrationTool } from "../_shared/integrationTools.ts";
import { ruleFromCalls, withRule } from "../_shared/connectorManifest.ts";
import { errorMessage } from "../_shared/boardTools.ts";
import type { VerifyCheck } from "../_shared/verifyReads.ts";
import type { RunVerdict } from "../_shared/runVerdict.ts";
import type { CompensationReportData } from "../_shared/compensation.ts";
import type { ResolvedFailurePolicy } from "../_shared/failurePolicy.ts";

/** A turn's writes waiting for a person, as a transcript carries them. */
export type SavedPending = PendingApproval & {
  approved?: boolean;
  results?: ToolResult[];
  /** Per-call landings of an approved batch, carried across slices
   *  beside the results so the batch's settle can seal each call's
   *  own outcome (decision.ts, the B7 record). */
  perCall?: { id: string; ok: boolean; verify?: VerifyCheck }[];
  /**
   * The compensation rest (B9): this pending is not a turn's writes
   * but a FAILED run's rollback, offered as one batch. The failure
   * it interrupted is carried with it — the finish (with the verdict
   * already computed from the run's own facts) or the refusal's
   * message — because the person's decision finalizes that settle
   * instead of resuming the loop: there is no live turn to answer.
   * `entries` pairs each offered call with the payload row it
   * compensates; `report` is the failure report as the rest left it,
   * merged with the batch's outcomes at finalize.
   */
  compensation?: {
    failure:
      | { kind: "finish"; finish: FinishPayload; verdict: RunVerdict | null }
      | { kind: "fail"; message: string };
    entries: { callId: string; rowId: string }[];
    report: CompensationReportData;
    /** The failure's class and its policy as resolved when the
     *  batch rested (B13): the decision that finalizes this settle
     *  seals the failure record and fires the escalation under
     *  exactly these. Absent on a rest parked before B13 — the
     *  finalize then derives the catch-all class and the defaults,
     *  which is the truth of a settle nobody classified. */
    failureClass?: string;
    failurePolicy?: ResolvedFailurePolicy;
  };
  /**
   * The publish rest (coding capability PR3): this pending is not a
   * turn's writes but a FINISHED coding run's publish — the branch,
   * the tree commit and the PR its patch composes into — offered as
   * one batch because at least one of its calls asked (or a breaker
   * held it, or the target repository is outside the definition's
   * declared set: the critical class). The finish it interrupted is
   * carried with it, verdict already computed from the run's own
   * facts, because the person's decision finalizes that settle
   * instead of resuming the loop: there is no live turn to answer —
   * the publish was never the model's call, it is the server's
   * composition of the run's verified patch. Approving executes the
   * batch and seals the finish; rejecting seals the finish without
   * a PR (the work stands; its patch artifact remains).
   */
  publish?: {
    finish: FinishPayload;
    verdict: RunVerdict | null;
    /** The composed batch's create_pull_request call id: the call
     *  whose landing the finalize reports on. For an amend batch
     *  (below) it is the batch's first call — there is no PR call,
     *  and the finalize judges the batch by all its results. */
    prCallId: string;
    /** The amend rest (coding capability PR4): this publish is a
     *  follow-up run's added commit on an existing PR's branch, not
     *  a new PR. Approving executes the batch and reports the PR as
     *  updated; rejecting seals the finish with the PR untouched. */
    amend?: { codeChangeId: string; repo: string; number: number; branch: string };
  };
};

export interface Decision {
  actionId?: string;
  approve?: boolean;
  note?: string;
  remember?: string[];
}

export interface DecisionDeps {
  admin: SupabaseClient;
  runId: string;
  /** The person who started the run — the only one who may decide. */
  userId: string;
  addStep(type: string, title: string, detail?: string | null): Promise<unknown>;
  /** Persists the loop's state; with a pending, the paused turn with it. */
  saveTranscript(pending?: SavedPending): Promise<void>;
  /** Runs one approved call. */
  executeApproved(call: ToolCall): Promise<{ content: string; is_error?: boolean; verify?: VerifyCheck }>;
  /** Writes a standing approval for these calls, when the driver has one. */
  rememberApproval?(calls: ToolCall[], fields: string[]): Promise<void>;
  /**
   * Told of a rejection in the same flow that records it — the
   * synchronous demotion hook graduated autonomy (B7) hangs on: a
   * person rejecting an action revokes its earned grant now, not at
   * some later evaluation. The rejection itself already stands when
   * this runs; the hook's own failures never reopen it.
   */
  onRejected?(action: Record<string, unknown>, calls: ToolCall[]): Promise<void>;
  /** Hands the rest of an unfinished batch to the next slice. */
  scheduleContinuation(): Promise<void>;
  /** The slice's deadline; the batch yields at it rather than dying mid-call. */
  deadline: number;
}

export interface DecisionOutcome {
  /** The pending that remains (carried into a continuation), if any. */
  pending: SavedPending | undefined;
  /** The batch outlived the slice; a continuation carries it. Stop here. */
  continued: boolean;
  /** Set when a decision was applied: how its batch ended. */
  decided?: { approved: boolean; results: ToolResult[] };
}

/**
 * Applies the request's decision (if any) to the run's paused turn, then
 * runs an approved batch left by an earlier slice. The action's state was
 * already checked against the transcript's pending hash by the caller;
 * this re-reads the action and refuses a stale one the same way.
 */
export async function applyDecision(
  state: LoopState,
  pending: SavedPending | undefined,
  decision: Decision | undefined,
  deps: DecisionDeps,
): Promise<DecisionOutcome> {
  const { admin, runId, userId } = deps;
  let current = pending;

  // ── A decision answers the paused turn first ──────────────────────────
  if (decision && current) {
    const { data: action } = await admin.from("agent_actions").select("*").eq("id", decision.actionId ?? "").eq("run_id", runId).maybeSingle();
    if (!action || action.status !== "pending") throw new Error("この承認依頼はもう処理されています。");
    if (decision.approve) {
      await admin.from("agent_actions").update({ status: "approved", decided_by: userId, decided_at: new Date().toISOString(), decision_note: decision.note ?? null }).eq("id", action.id);
      await deps.addStep("approval", "承認されました", decision.note ?? null);
      if (decision.remember?.length && deps.rememberApproval) await deps.rememberApproval(current.calls, decision.remember);
      current = { ...current, approved: true, results: [], perCall: [] };
      await deps.saveTranscript(current);
    } else {
      await admin.from("agent_actions").update({ status: "rejected", decided_by: userId, decided_at: new Date().toISOString(), decision_note: decision.note ?? null }).eq("id", action.id);
      await deps.addStep("approval", "却下されました", decision.note ?? null);
      // The rejection is recorded; what it revokes is told in the
      // same flow (graduated autonomy's demotion). A hook failure
      // leaves the rejection standing and the evaluator's sweep to
      // catch the grant from the same record.
      if (deps.onRejected) await deps.onRejected(action as Record<string, unknown>, current.calls).catch(() => {});
      const rejected: ToolResult[] = current.calls.map((call) => ({
        type: "tool_result", tool_use_id: call.id, is_error: true,
        content: `実行を始めた人が却下しました。${decision.note ? `理由・指示: ${decision.note}` : ""} 実行していません。指示に沿って案を直すか、finish してください。`,
      }));
      appendDecisionResults(state, current, rejected);
      await deps.saveTranscript();
      return { pending: undefined, continued: false, decided: { approved: false, results: rejected } };
    }
  }

  // An approved batch runs to the end, its progress saved as it goes; if
  // the slice runs out of time mid-batch, the next slice picks up where
  // it left.
  if (current?.approved) {
    const results = current.results ?? [];
    // The batch's per-call truth as it settles (B7): each call's own
    // landing and, where its command declared one, its verify
    // read-back — sealed beside the aggregate so the track record
    // can attribute a completion (or a mismatch) to the command that
    // earned it, instead of a batch standing or falling as one blob.
    const perCall: { id: string; ok: boolean; verify?: VerifyCheck }[] = [...(current.perCall ?? [])];
    const done = new Set(results.map((r) => r.tool_use_id));
    for (const call of current.calls) {
      if (done.has(call.id)) continue;
      if (Date.now() >= deps.deadline) {
        const carried = { ...current, results, perCall };
        await deps.saveTranscript(carried);
        await deps.scheduleContinuation();
        return { pending: carried, continued: true, decided: { approved: true, results } };
      }
      let r: { content: string; is_error?: boolean; verify?: VerifyCheck };
      try { r = await deps.executeApproved(call); } catch (e) { r = { content: `Error: ${errorMessage(e)}`, is_error: true }; }
      results.push({ type: "tool_result", tool_use_id: call.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
      perCall.push({ id: call.id, ok: !r.is_error, ...(r.verify ? { verify: r.verify } : {}) });
      await deps.saveTranscript({ ...current, results });
    }
    const failed = results.filter((r) => r.is_error).length;
    await admin.from("agent_actions").update({ status: failed === current.calls.length ? "failed" : "executed", result: { failed, total: current.calls.length, perCall } })
      .eq("run_id", runId).eq("status", "approved");
    appendDecisionResults(state, current, results);
    await deps.saveTranscript();
    return { pending: undefined, continued: false, decided: { approved: true, results } };
  }

  return { pending: current, continued: false };
}

/**
 * A standing approval: the command these calls are, with the chosen
 * fields' values, runs without asking from now on. Written through the
 * starter's session, so only a Space owner can add one (the integration's
 * own RLS). It never fails the decision it rides on.
 */
export function makeRememberApproval(args: {
  userDb: SupabaseClient;
  tools: Map<string, IntegrationTool>;
  addStep(type: string, title: string, detail?: string | null): Promise<unknown>;
}): (calls: ToolCall[], fields: string[]) => Promise<void> {
  const { userDb, tools, addStep } = args;
  return async (calls: ToolCall[], fields: string[]) => {
    const its = calls.map((c) => tools.get(c.name));
    const first = its[0];
    const command = first?.command;
    // A critical operation asks every time; it never becomes a standing rule.
    if (its.some((it) => criticalOfTool(it))) {
      await addStep("approval", "重要な操作は、今後の自動実行の条件にできません");
      return;
    }
    if (!first || !command || its.some((it) => it?.integration.id !== first.integration.id || it?.command?.name !== command.name)) {
      await addStep("approval", first && !command
        ? "以後の承認は保存できませんでした: 条件を結び付けるコマンドがこの連携にありません"
        : "以後の承認は保存できませんでした: 同じコマンドの呼び出しだけを条件にできます");
      return;
    }
    const rule = ruleFromCalls(calls.map((c) => c.input), fields);
    if ("error" in rule) { await addStep("approval", `以後の承認は保存できませんでした: ${rule.error}`); return; }
    const { data: row } = await userDb.from("integrations").select("manifest").eq("id", first.integration.id).maybeSingle();
    const manifest = withRule(row?.manifest, command.name, rule);
    const { data: saved } = manifest
      ? await userDb.from("integrations").update({ manifest, updated_at: new Date().toISOString() }).eq("id", first.integration.id).select("id")
      : { data: null };
    const condition = Object.entries(rule.when).map(([k, v]) => `${k} = ${v}`).join(", ");
    await addStep("approval", saved?.length
      ? `以後、${command.name}（${condition}）は確認なしで実行します`
      : "以後の承認は保存できませんでした: 連携のルールを変えられるのは Space のオーナーだけです");
  };
}

/**
 * A run resumed while a proposal is still unanswered (a stale decision, a
 * slice cut off before it stopped) goes back to waiting for it — sending
 * the transcript on with an unanswered tool_use would fail every time.
 * The action row is rewritten if the stop never landed it.
 */
export async function restorePendingApproval(args: {
  admin: SupabaseClient;
  runId: string;
  elementId: string | null;
  pending: SavedPending;
  displays: ApprovalDisplay[];
  integrationId?: string | null;
  expiresAt?: string | null;
  sha256(text: string): Promise<string>;
  addStep(type: string, title: string, detail?: string | null): Promise<unknown>;
}): Promise<void> {
  const { admin, runId, pending } = args;
  const { data: open } = await admin.from("agent_actions").select("id").eq("run_id", runId).eq("status", "pending").maybeSingle();
  if (!open) {
    await admin.from("agent_actions").insert({
      run_id: runId, element_id: args.elementId, tool_use_id: pending.calls[0].id, tool: pending.calls.length === 1 ? pending.calls[0].name : "batch",
      input: { calls: pending.calls, display: args.displays }, input_hash: await args.sha256(canonicalCalls(pending.calls)), summary: approvalSummary(args.displays),
      ...(args.integrationId ? { integration_id: args.integrationId } : {}),
      ...(args.expiresAt ? { expires_at: args.expiresAt } : {}),
    });
  }
  await admin.from("agent_runs").update({ status: "awaiting_approval" }).eq("id", runId).eq("status", "running");
  await args.addStep("approval", "承認待ちに戻しました");
}
