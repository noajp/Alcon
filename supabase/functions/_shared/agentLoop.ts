// The agent loop, without I/O. index.ts supplies the model call, the tool
// executors and the stop conditions; this file decides what happens to each
// turn: run tools now, stop for a person's approval, finish, or yield so the
// run continues in a fresh invocation. Everything appended to `messages` is
// append-only — the model's own content blocks (thinking included) go back
// unchanged, and every tool_use gets exactly one tool_result in the single
// user message that follows it.

import type { ModelUsage } from "./aiPricing.ts";
import type { CompensationSummary, FinishClaim } from "./finishClaims.ts";

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
  /** The compensation outcome of this finish's failure settle (B9):
   *  computed by the driver from the run's records after the
   *  compensation pass — never a model argument (the finish tool's
   *  own input cannot set it). Sealed by finishDetailOf. */
  compensation?: CompensationSummary;
}

/**
 * internal / board / read: run right away.
 * write: an external write — needs approval unless its integration is fully
 *   delegated (deps.needsApproval decides).
 * question: files a question ticket for a person (B12) — the call runs
 *   right away to file it, and a filed question rests the run until the
 *   person's answer arrives as the call's tool result.
 * finish: ends the run after the turn's other tools have run.
 */
export type ToolKind = "internal" | "board" | "read" | "write" | "finish" | "question";

export interface ModelTurn {
  content: Block[];
  stop_reason: string | null;
  usage: ModelUsage;
}

export interface ExecResult {
  content: string; is_error?: boolean; finish?: FinishPayload;
  /**
   * A question call that filed its ticket (B12): the loop rests the
   * run on it. The result's `content` is NOT what the model receives —
   * a filed question's tool result is the person's answer, appended
   * when the answer resumes the run (appendDecisionResults, the same
   * single-message discipline as a decision's).
   */
  question?: { ticketId: string };
}

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
  /**
   * The circuit breaker's pre-write check (back-half B11), consulted
   * for a turn's write-kind calls before needsApproval is asked about
   * any of them (§6's ordering: the breaker stands before the approval
   * composition). A non-null answer is a trip: the loop holds ALL of
   * the turn's write-kind calls as one pending decision — a tripped
   * run performs no further writes until a person answers — and the
   * outcome carries the hold, so the driver can record what tripped.
   * The verdict machinery is never consulted about a trip: no mode,
   * delegation, standing rule or track record can lift one.
   */
  breakerHold?(call: ToolCall): Promise<{ reason: string } | null>;
  /**
   * The run's declared patience for a failure class ran out
   * (failure definitions, B13): the loop stops and the driver
   * settles the run as failed with that class. Checked after
   * cancelled(), before budget — a give-up is a failure, not a pause.
   */
  giveUp?(): { failureClass: string; detail: string } | null;
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
   * lets the finish through to the verifier. May answer asynchronously:
   * a check that judges a finish against the run's own records (the
   * coding gate's test evidence, codingLoop.ts) reads them first.
   */
  mechanicalCheck?(finish: FinishPayload): { gaps: string[] } | null | Promise<{ gaps: string[] } | null>;
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

export interface Verdict {
  pass: boolean;
  gaps: string[];
  /**
   * The v3 scoring the verifier gave in the same answer (run-agent/
   * verify.ts reads it; _shared/runVerdict.ts defines the sealed
   * shapes): one result per Checks item as the answer named it —
   * alignment to the declared items is the driver's, at its seam —
   * and one depth per artifact, named by TITLE here because the
   * verifier never sees artifact ids. Optional: a verdict from the
   * mechanical check, or an answer without the blocks, carries none,
   * and the loop's pass/fail behaviour never depends on them.
   */
  checks?: { item: string; result: "pass" | "partial" | "fail" }[];
  deliverables?: { artifactTitle: string; depth: "substantial" | "thin" | "empty"; note: string }[];
}

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
  | {
      kind: "approval"; pending: PendingApproval;
      /** Set when the wait is a circuit-breaker trip (B11), not an
       *  approval composition's ask: the call that tripped and the
       *  one-line reason the run rests on. The pending is decided the
       *  same way — approve continues the batch, reject stops it. */
      breaker?: { call: ToolCall; reason: string };
    }
  | {
      kind: "question"; pending: PendingApproval;
      /** The ticket each pending question call filed, in call order:
       *  the pending's calls are the unanswered ask_question calls,
       *  and a ticket's answer is what resumes the run as that call's
       *  tool result. Two calls that asked the same question share
       *  one ticket (the ticket layer dedups) and both are answered
       *  by its one answer. */
      tickets: { callId: string; ticketId: string }[];
    }
  | { kind: "yield" }
  | { kind: "limit" }
  | { kind: "budget" }
  | { kind: "cancelled" }
  | { kind: "giveup"; failureClass: string; detail: string }
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
    // A give-up (B13) is checked before the budget: the run's failure
    // contract ran out, which is a failure to settle — never a pause
    // a resume could mistake for patience left.
    const giveUp = deps.giveUp?.();
    if (giveUp) return { kind: "giveup", failureClass: giveUp.failureClass, detail: giveUp.detail };
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

    const writeCalls = calls.filter((c) => deps.kindOf(c.name) === "write");
    // The breaker is consulted before the approval gate (§6's
    // ordering), and before anything in the turn executes: one trip
    // holds the turn's writes as a unit, including any the gate would
    // have let run unasked — a tripped run performs no further writes
    // until a person answers.
    let breaker: { call: ToolCall; reason: string } | null = null;
    if (deps.breakerHold) {
      for (const c of writeCalls) {
        const hold = await deps.breakerHold(c);
        if (hold) { breaker = { call: c, reason: hold.reason }; break; }
      }
    }
    const writes: ToolCall[] = [];
    if (breaker) writes.push(...writeCalls);
    else {
      for (const c of writeCalls) {
        if (await deps.needsApproval(c)) writes.push(c);
      }
    }
    const finishCall = calls.find((c) => deps.kindOf(c.name) === "finish");
    const questionCalls = calls.filter((c) => deps.kindOf(c.name) === "question");
    const immediate = calls.filter((c) => !writes.includes(c) && c !== finishCall && !questionCalls.includes(c));

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
      // A run rests in exactly one wait at a time: while writes wait
      // for a decision, a question is not filed — it is answered as
      // not yet askable, and the model asks again once the decision
      // lands and the work it might change is known.
      for (const c of questionCalls) {
        results.push({ type: "tool_result", tool_use_id: c.id, content: "承認待ちの操作があるため、質問はまだ出せません。承認の結果を受け取ってから、あらためて ask_question で質問してください。", is_error: true });
      }
      // A finish in the same turn as writes waiting for approval is
      // premature: answer it as not yet done, and stop for the person.
      if (finishCall) {
        results.push({ type: "tool_result", tool_use_id: finishCall.id, content: "承認待ちの操作があるため、まだ完了できません。承認の結果を受け取ってから finish してください。", is_error: true });
      }
      return { kind: "approval", pending: { calls: writes, partial: results }, ...(breaker ? { breaker } : {}) };
    }

    // Question calls run now — filing the ticket IS their execution —
    // but a filed question's tool result is not known yet: it is the
    // person's answer, appended when the answer resumes the run. A
    // question that could not be filed (its shape refused) is an
    // ordinary error result the model can correct, and rests nothing.
    const filed: { call: ToolCall; ticketId: string }[] = [];
    for (const c of questionCalls) {
      let r: ExecResult;
      try { r = await deps.execute(c); } catch (e) {
        r = { content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true };
      }
      if (r.question && !r.is_error) filed.push({ call: c, ticketId: r.question.ticketId });
      else results.push({ type: "tool_result", tool_use_id: c.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
    }
    if (filed.length > 0) {
      // A finish in the same turn as a filed question is premature in
      // the same way: the answer may change what "done" means here.
      if (finishCall) {
        results.push({ type: "tool_result", tool_use_id: finishCall.id, content: "質問への回答を待っているため、まだ完了できません。回答を受け取ってから finish してください。", is_error: true });
      }
      return {
        kind: "question",
        pending: { calls: filed.map((f) => f.call), partial: results },
        tickets: filed.map((f) => ({ callId: f.call.id, ticketId: f.ticketId })),
      };
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
        const mechanical = await deps.mechanicalCheck?.(r.finish);
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
 * then, and the results of the writes now executed (or rejected). The
 * question rest (B12) resumes through this same append: the pending's
 * partial results plus one tool result per question call, carrying the
 * person's answer verbatim.
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
