// The agent loop, without I/O. index.ts supplies the model call, the tool
// executors and the stop conditions; this file decides what happens to each
// turn: run tools now, stop for a person's approval, finish, or yield so the
// run continues in a fresh invocation. Everything appended to `messages` is
// append-only — the model's own content blocks (thinking included) go back
// unchanged, and every tool_use gets exactly one tool_result in the single
// user message that follows it.

import type { ModelUsage } from "./aiPricing.ts";
import type { FinishClaim } from "./finishClaims.ts";

export type Block = { type: string; id?: string; name?: string; input?: unknown; text?: string; [k: string]: unknown };
export type Msg = { role: "user" | "assistant"; content: string | Block[] };

export interface ToolCall { id: string; name: string; input: Record<string, unknown> }
export interface ToolResult { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean; [k: string]: unknown }

export interface FinishPayload {
  outcome: "completed" | "partial" | "blocked";
  summary: string;
  message: string;
  /**
   * Readings this finish proposes for the measures of the Strategies the
   * run serves. Copied through unvalidated; the gate
   * (_shared/readingsGate.ts) validates them at finish time, when the
   * bound set and the verdict are both known.
   */
  readings?: { measureId: string; value: number }[];
  /**
   * The facts the finish states, typed at the source (finishClaims.ts):
   * each claim carries its source and when it was retrieved, so code can
   * judge sourcing and freshness mechanically before any verifier reads
   * prose. Absent on finishes that state no checkable facts.
   */
  claims?: FinishClaim[];
  /**
   * What the agent could not confirm, as a field of its own — never a
   * reason to send the finish back, always a mark on it: the record keeps
   * the list and the Reviews filter finds the run by it.
   */
  unconfirmed?: string[];
}

/**
 * internal / board / read: run right away.
 * write: an external write — needs approval unless its integration is fully
 *   delegated (deps.needsApproval decides).
 * finish: ends the run after the turn's other tools have run.
 */
export type ToolKind = "internal" | "board" | "read" | "write" | "finish";

export interface ModelTurn {
  content: Block[];
  stop_reason: string | null;
  usage: ModelUsage;
}

export interface ExecResult { content: string; is_error?: boolean; finish?: FinishPayload }

export interface LoopDeps {
  callModel(messages: Msg[]): Promise<ModelTurn>;
  kindOf(name: string): ToolKind;
  /**
   * Whether one write-kind call waits for a person. May answer
   * asynchronously: a verdict can rest on facts only the driver can
   * fetch (a stored credential's history, for one). The loop asks
   * once per write-kind call per turn, in the order the model made
   * them; drivers keep the answer cheap for the common call.
   */
  needsApproval(call: ToolCall): boolean | Promise<boolean>;
  execute(call: ToolCall): Promise<ExecResult>;
  /** Called with every response's usage; record cost here. */
  onUsage(usage: ModelUsage): Promise<void>;
  budgetExceeded(): boolean;
  cancelled(): Promise<boolean>;
  /** After every completed turn (its tool results appended): persist progress. */
  afterTurn?(): Promise<void>;
  /**
   * The mechanical check of a "completed" finish (finishClaims.ts): claim
   * shape, source presence, freshness — everything code can evaluate alone.
   * Runs before verify; a finish it fails is sent back on its findings and
   * the verifier is never consulted for that finish. Null (or no findings)
   * lets the finish through to the verifier.
   */
  mechanicalCheck?(finish: FinishPayload): { gaps: string[] } | null;
  /**
   * A second reader's check of a "completed" finish against the task, before
   * the run may end on it. Null skips the check (no verifier, or it failed to
   * answer); { pass: false } sends the gaps back to the agent.
   */
  verify?(finish: FinishPayload): Promise<Verdict | null>;
  /**
   * What a sent-back finish tells the agent, when the driver can say
   * more than the gaps: run-agent's execute driver renders the
   * correction envelope (correctionEnvelope.ts) — the unit, the
   * verdict, the evidence the check read, and the scope the
   * correction is bounded to — and keeps it for the run's record.
   * `revision` is the count after this return (1 = the first).
   * Returning null (or not providing the hook) keeps the plain
   * return (revisionRequest).
   */
  revisionMessage?(verdict: Verdict, revision: number): Promise<string | null> | string | null;
  /** What the model is told after a turn with neither text nor a tool call. */
  nudge?: string;
}

export interface Verdict { pass: boolean; gaps: string[] }

/** How many times a run's "completed" may be sent back before it stands. */
export const MAX_REVISIONS = 2;

export interface LoopLimits {
  /** Turns this invocation may take before yielding to a continuation. */
  maxTurnsThisCall: number;
  /** Turns the whole run may take. */
  maxTotalTurns: number;
  /** ms since epoch; yield once past it so the platform never cuts us off. */
  deadline: number;
}

export interface LoopState {
  messages: Msg[]; turns: number; nudges: number;
  /** Times the verifier has sent a finish back. */
  revisions?: number;
}

export interface PendingApproval {
  /** The external writes waiting, in the order the model asked for them. */
  calls: ToolCall[];
  /** Results of the same turn's other tools, already run. */
  partial: ToolResult[];
}

export type LoopOutcome =
  | { kind: "finished"; finish: FinishPayload }
  | { kind: "approval"; pending: PendingApproval }
  | { kind: "yield" }
  | { kind: "limit" }
  | { kind: "budget" }
  | { kind: "cancelled" }
  | { kind: "refusal"; detail: string };

export function toolCalls(content: Block[]): ToolCall[] {
  return content
    .filter((b) => b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
    .map((b) => ({
      id: b.id as string,
      name: b.name as string,
      input: b.input && typeof b.input === "object" && !Array.isArray(b.input) ? (b.input as Record<string, unknown>) : {},
    }));
}

function textOf(content: Block[]): string {
  return content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("\n").trim();
}

/**
 * Pure. Order the turn's results to match the order of its tool_use blocks —
 * the API pairs them by id, but a stable order keeps transcripts readable.
 */
export function orderResults(calls: ToolCall[], results: ToolResult[]): ToolResult[] {
  const byId = new Map(results.map((r) => [r.tool_use_id, r]));
  return calls.map((c) => byId.get(c.id) ?? { type: "tool_result", tool_use_id: c.id, content: "No result.", is_error: true });
}

export async function runLoop(state: LoopState, deps: LoopDeps, limits: LoopLimits): Promise<LoopOutcome> {
  let turnsThisCall = 0;
  while (true) {
    if (await deps.cancelled()) return { kind: "cancelled" };
    if (deps.budgetExceeded()) return { kind: "budget" };
    if (state.turns >= limits.maxTotalTurns) return { kind: "limit" };
    if (turnsThisCall >= limits.maxTurnsThisCall || Date.now() >= limits.deadline) return { kind: "yield" };

    const turn = await deps.callModel(state.messages);
    state.turns++;
    turnsThisCall++;
    await deps.onUsage(turn.usage);
    state.messages.push({ role: "assistant", content: turn.content });

    if (turn.stop_reason === "refusal") {
      return { kind: "refusal", detail: textOf(turn.content) || "The model declined this request." };
    }

    const calls = toolCalls(turn.content);
    // A long server-tool turn (web search) paused mid-way: send the
    // conversation back as it is and the model carries on.
    if (calls.length === 0 && turn.stop_reason === "pause_turn") {
      await deps.afterTurn?.();
      continue;
    }
    if (calls.length === 0) {
      if (turn.stop_reason === "max_tokens") {
        state.messages.push({ role: "user", content: "出力が上限で途中まで切れました。続きを、小さく分けて進めてください。" });
        continue;
      }
      // A plain answer with no tool call is the end of the run: there is no
      // way to force a tool on current models, and the text is the reply.
      const text = textOf(turn.content);
      if (text) return { kind: "finished", finish: { outcome: "completed", summary: text.split("\n")[0].slice(0, 200), message: text } };
      if (state.nudges++ >= 2) return { kind: "finished", finish: { outcome: "blocked", summary: "応答がありませんでした", message: "エージェントが応答を返しませんでした。" } };
      state.messages.push({ role: "user", content: deps.nudge ?? "道具を使って作業を進め、終わったら finish を呼んでください。" });
      continue;
    }

    const writes: ToolCall[] = [];
    for (const c of calls) {
      if (deps.kindOf(c.name) === "write" && await deps.needsApproval(c)) writes.push(c);
    }
    const finishCall = calls.find((c) => deps.kindOf(c.name) === "finish");
    const immediate = calls.filter((c) => !writes.includes(c) && c !== finishCall);

    // The turn's other tools run at the same time; the model asked for them
    // together, so none waits on another's result.
    const results: ToolResult[] = await Promise.all(immediate.map(async (c): Promise<ToolResult> => {
      try {
        const r = await deps.execute(c);
        return { type: "tool_result", tool_use_id: c.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) };
      } catch (e) {
        return { type: "tool_result", tool_use_id: c.id, content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true };
      }
    }));

    if (writes.length > 0) {
      // A finish in the same turn as writes waiting for approval is
      // premature: answer it as not yet done, and stop for the person.
      if (finishCall) {
        results.push({ type: "tool_result", tool_use_id: finishCall.id, content: "承認待ちの操作があるため、まだ完了できません。承認の結果を受け取ってから finish してください。", is_error: true });
      }
      return { kind: "approval", pending: { calls: writes, partial: results } };
    }

    if (finishCall) {
      const r = await deps.execute(finishCall);
      // A "completed" is gated before it may stand. The mechanical check
      // goes first: what code can evaluate (the claims' sources and
      // freshness) is never asked of the model, and a finish it fails is
      // sent back on the mechanical findings alone — the verifier is not
      // consulted for that finish. Only a mechanically sound finish is
      // read by the second reader, for the semantic remainder.
      if (r.finish?.outcome === "completed" && (state.revisions ?? 0) < MAX_REVISIONS && (deps.mechanicalCheck || deps.verify)) {
        let verdict: Verdict | null = null;
        const mechanical = deps.mechanicalCheck?.(r.finish);
        if (mechanical && mechanical.gaps.length) verdict = { pass: false, gaps: mechanical.gaps };
        else if (deps.verify) verdict = await deps.verify(r.finish);
        if (verdict && !verdict.pass) {
          state.revisions = (state.revisions ?? 0) + 1;
          const content = (await deps.revisionMessage?.(verdict, state.revisions)) ?? revisionRequest(verdict);
          results.push({ type: "tool_result", tool_use_id: finishCall.id, is_error: true, content });
          state.messages.push({ role: "user", content: orderResults(calls, results) });
          await deps.afterTurn?.();
          continue;
        }
      }
      results.push({ type: "tool_result", tool_use_id: finishCall.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
      state.messages.push({ role: "user", content: orderResults(calls, results) });
      if (r.finish) return { kind: "finished", finish: r.finish };
      await deps.afterTurn?.();
      continue;
    }

    state.messages.push({ role: "user", content: orderResults(calls, results) });
    await deps.afterTurn?.();
  }
}

/** Pure. What the agent is told when a finish is sent back, in the
 *  plain form — the drivers that know the unit render the correction
 *  envelope instead (LoopDeps.revisionMessage). */
export function revisionRequest(verdict: Verdict): string {
  const gaps = verdict.gaps.length ? verdict.gaps.map((g) => `- ${g}`).join("\n") : "- 任務の完了条件を満たしていません。";
  return `完了はまだ受け付けられません。検証で次の不足が見つかりました。\n${gaps}\n\n道具を使って不足を埋め、成果物と報告を直してから、もう一度 finish を呼んでください。報告する事実は finish の claims に出典と取得時刻を付けて挙げ、どうしても確かめられない点は finish の unconfirmed に挙げてください。`;
}

/**
 * After a person decided on a pending approval: append the single user
 * message that answers the paused turn — the results of the tools that ran
 * then, and the results of the writes now executed (or rejected).
 */
export function appendDecisionResults(state: LoopState, pending: PendingApproval, writeResults: ToolResult[]): void {
  const last = state.messages[state.messages.length - 1];
  const calls = last && last.role === "assistant" && Array.isArray(last.content) ? toolCalls(last.content) : [];
  state.messages.push({ role: "user", content: orderResults(calls, [...pending.partial, ...writeResults]) });
}

/** Pure. A stable hash input for a batch of writes, so a decision binds to exactly what was shown. */
export function canonicalCalls(calls: ToolCall[]): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(calls.map((c) => ({ id: c.id, name: c.name, input: sortKeys(c.input) })));
}
