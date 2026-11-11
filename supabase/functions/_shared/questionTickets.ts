// Async question tickets (back-half B12): "I don't know" as a queue
// item, not a run failure. An execute-mode run that cannot proceed
// without a person's knowledge files a ticket with ask_question —
// the question, the choices it can offer (2–5, at most one flagged
// as its recommendation), the context the person needs (what
// decision turns on the answer, links to artifacts and records),
// and what it tried first. The run then rests in awaiting_input and
// the ticket stands in the person's Inbox; the answer resumes the
// run through the `answer` entry (run-agent/dispatch.ts) and is
// appended to the paused turn as the ask_question call's tool
// result — the person's words, verbatim: the agent never invents
// the answer, and nothing in this module phrases one.
//
// Dependents need no machinery of their own: a resting run does not
// complete, so the graph's dependency rule already holds the work
// that waits on it, while unrelated work proceeds. The ticket makes
// the wait legible — the run's summary carries the question's short
// form, which is what the Chain's waiting display reads.
//
// Expiry is honest: a ticket unanswered inside its window expires,
// and the run it holds ends as blocked with the unanswered question
// preserved on the Element's record (settleRunBlockedByQuestions) —
// never a guessed answer, never a silent proceed.
//
// One question, one ticket: question_key is the question's
// normalized identity, unique among a run's open tickets (the
// migration's partial unique index), so re-asking the same question
// while its ticket stands reuses the ticket.
//
// The `tried` field is the design's weak gate against ticket spam:
// its PRESENCE is checked by code (validateAskInput refuses a
// question with nothing tried); its quality is judged by nobody.
// It is stated here as weak on purpose — strengthened only if the
// outcome records (B4) ever show abuse.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** The piece's numbers, in one named place. */
export const QUESTION_POLICY = {
  /** Days a ticket waits for its answer before it expires —
   *  matching the draft lifetimes (G4, promotion). */
  expiryDays: 7,
  minOptions: 2,
  maxOptions: 5,
  maxQuestionChars: 1000,
  maxTriedChars: 2000,
  maxAnswerChars: 4000,
  maxDecisionChars: 500,
  maxLinks: 5,
  /** A standing answer's topic name: short enough to be a memory's
   *  topic, long enough to say what it settles. */
  maxStandingTopicChars: 80,
  /** The Chain's waiting line: the question's short form. */
  shortFormChars: 120,
} as const;

export interface TicketOption { label: string; recommended?: boolean }

export interface TicketLink { label: string; url?: string }

/** standing_topic: when the agent declared that the answer settles more
 *  than this one run (who handles complaints, which address invoices go
 *  to), the topic the answer is kept under. A person's answer to such a
 *  ticket is that person's word, so the engine — never the agent — keeps
 *  it as a durable fact the next run reads (standingAnswerMemory). */
export interface TicketContext { decision?: string; links?: TicketLink[]; standing_topic?: string }

export interface QuestionTicketRow {
  id: string;
  activity_space_id: string | null;
  run_id: string;
  element_id: string | null;
  strategy_id: string | null;
  tool_use_id: string;
  question: string;
  question_key: string;
  options: unknown;
  context: unknown;
  tried: string;
  status: "open" | "answered" | "expired";
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  expires_at: string;
  created_at: string;
}

/** A validated ask_question input, ready to file. */
export interface AskQuestion {
  question: string;
  options: TicketOption[];
  context: TicketContext;
  tried: string;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Pure. A question's dedup identity: the same words, however the
 *  model spaced or cased them, are the same question. */
export function questionKeyOf(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Pure. The question as the run's one line — its first line,
 *  capped: what the Chain's waiting chip and the run panel show. */
export function questionShortForm(question: string): string {
  const first = question.trim().split("\n")[0]?.trim() ?? "";
  return first.length > QUESTION_POLICY.shortFormChars
    ? `${first.slice(0, QUESTION_POLICY.shortFormChars - 1)}…`
    : first;
}

/** Pure. The stored options of a ticket row, read defensively: the
 *  column is jsonb the engine wrote through validateAskInput, but a
 *  reader never trusts a shape it did not check. */
export function ticketOptionsOf(raw: unknown): TicketOption[] {
  if (!Array.isArray(raw)) return [];
  const out: TicketOption[] = [];
  for (const o of raw) {
    if (typeof o === "string" && o.trim()) { out.push({ label: o.trim() }); continue; }
    if (o && typeof o === "object") {
      const label = text((o as { label?: unknown }).label).trim();
      if (label) out.push({ label, ...((o as { recommended?: unknown }).recommended === true ? { recommended: true } : {}) });
    }
  }
  return out;
}

/** Pure. The stored context of a ticket row, read defensively. */
export function ticketContextOf(raw: unknown): TicketContext {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const c = raw as { decision?: unknown; links?: unknown; standing_topic?: unknown };
  const decision = text(c.decision).trim();
  const standingTopic = text(c.standing_topic).trim();
  const links: TicketLink[] = [];
  if (Array.isArray(c.links)) {
    for (const l of c.links) {
      if (!l || typeof l !== "object") continue;
      const label = text((l as { label?: unknown }).label).trim();
      if (!label) continue;
      const url = text((l as { url?: unknown }).url).trim();
      links.push({ label, ...(url ? { url } : {}) });
    }
  }
  return { ...(decision ? { decision } : {}), ...(links.length ? { links } : {}), ...(standingTopic ? { standing_topic: standingTopic } : {}) };
}

export type AskValidation = { ok: true; value: AskQuestion } | { ok: false; error: string };

/**
 * Pure. What code can judge about an ask_question call before a
 * ticket is filed: the question is there, what the agent tried
 * first is stated (the weak gate — presence only, by design), and
 * the options, when offered, are 2–5 distinct choices with at most
 * one recommendation. Every failure is a correctable tool error:
 * the model can fix the call and ask again in the same turn's next
 * step; nothing rests on a malformed question.
 */
export function validateAskInput(input: Record<string, unknown>): AskValidation {
  const question = text(input.question).trim();
  if (!question) return { ok: false, error: "question が必要です。人に何を決めてほしいのか、質問そのものを書いてください。" };
  if (question.length > QUESTION_POLICY.maxQuestionChars) {
    return { ok: false, error: `question が長すぎます（${QUESTION_POLICY.maxQuestionChars} 文字まで）。要点を 1 つの質問に絞ってください。` };
  }
  const tried = text(input.tried).trim();
  if (!tried) {
    return { ok: false, error: "tried が必要です。人に聞く前に自分で何を試したか（調べた記録・試した手段）を書いてください。何も試していないなら、まず自分で調べられる手段を尽くしてください。" };
  }
  if (tried.length > QUESTION_POLICY.maxTriedChars) {
    return { ok: false, error: `tried が長すぎます（${QUESTION_POLICY.maxTriedChars} 文字まで）。試したことの要点だけを書いてください。` };
  }
  const options: TicketOption[] = [];
  if (input.options !== undefined && input.options !== null) {
    if (!Array.isArray(input.options)) return { ok: false, error: "options は選択肢の配列で書いてください。" };
    if (input.options.length < QUESTION_POLICY.minOptions || input.options.length > QUESTION_POLICY.maxOptions) {
      return { ok: false, error: `options は ${QUESTION_POLICY.minOptions}〜${QUESTION_POLICY.maxOptions} 件で書いてください。選択肢にできない質問なら、options を付けずに聞いてください。` };
    }
    const seen = new Set<string>();
    let recommended = 0;
    for (const raw of input.options) {
      const label = (typeof raw === "string" ? raw : text((raw as { label?: unknown } | null)?.label)).trim();
      if (!label) return { ok: false, error: "options の各選択肢には label が必要です。" };
      const key = questionKeyOf(label);
      if (seen.has(key)) return { ok: false, error: `options に同じ選択肢が重なっています: ${label}` };
      seen.add(key);
      const rec = raw !== null && typeof raw === "object" && (raw as { recommended?: unknown }).recommended === true;
      if (rec) recommended += 1;
      options.push({ label, ...(rec ? { recommended: true } : {}) });
    }
    if (recommended > 1) return { ok: false, error: "options でおすすめにできるのは 1 件だけです。" };
  }
  const context: TicketContext = {};
  if (input.context !== undefined && input.context !== null) {
    if (typeof input.context !== "object" || Array.isArray(input.context)) {
      return { ok: false, error: "context は { decision, links } の形で書いてください。" };
    }
    const c = input.context as { decision?: unknown; links?: unknown };
    const decision = text(c.decision).trim();
    if (decision) context.decision = decision.slice(0, QUESTION_POLICY.maxDecisionChars);
    if (c.links !== undefined && c.links !== null) {
      if (!Array.isArray(c.links)) return { ok: false, error: "context.links は配列で書いてください。" };
      const links: TicketLink[] = [];
      for (const raw of c.links.slice(0, QUESTION_POLICY.maxLinks)) {
        if (!raw || typeof raw !== "object") continue;
        const label = text((raw as { label?: unknown }).label).trim();
        if (!label) continue;
        const url = text((raw as { url?: unknown }).url).trim();
        links.push({ label, ...(url ? { url } : {}) });
      }
      if (links.length) context.links = links;
    }
  }
  if (input.standing_topic !== undefined && input.standing_topic !== null) {
    const topic = text(input.standing_topic).trim().replace(/\s+/g, " ");
    if (!topic) return { ok: false, error: "standing_topic は、この答えが今後も使える決まりのときにだけ、その話題名を書いてください。今回限りの質問なら付けません。" };
    if (topic.length > QUESTION_POLICY.maxStandingTopicChars) {
      return { ok: false, error: `standing_topic が長すぎます（${QUESTION_POLICY.maxStandingTopicChars} 文字まで）。話題の名前だけを書いてください。` };
    }
    context.standing_topic = topic;
  }
  return { ok: true, value: { question, options, context, tried } };
}

/** The `remember` input a standing answer becomes. */
export interface StandingAnswerMemory { kind: "fact"; topic: string; title: string; gist: string; body: string }

/**
 * Pure. The durable fact a person's answer becomes, or null when the
 * ticket declared no standing topic or the person kept the answer to
 * this one run. The words kept are the question as it was asked and
 * the answer exactly as the person gave it — nothing the agent
 * phrased after the fact. One topic holds one fact (the memory
 * store's own rule), so answering the same topic again replaces it.
 */
export function standingAnswerMemory(
  ticket: Pick<QuestionTicketRow, "question" | "context">,
  answer: string,
  keep: boolean,
  now: Date,
): StandingAnswerMemory | null {
  const topic = ticketContextOf(ticket.context).standing_topic;
  const said = answer.trim();
  if (!keep || !topic || !said) return null;
  const day = now.toISOString().slice(0, 10);
  const oneLine = said.replace(/\s+/g, " ");
  return {
    kind: "fact",
    topic,
    title: topic.slice(0, 40),
    gist: `${topic}：${oneLine}`.slice(0, 240),
    body: `決まり：${topic}\n答え：${said}\n\n聞いた質問：${ticket.question.trim()}\n決まった日：${day}（質問への人の回答）`,
  };
}

export type AnswerValidation = { ok: true; answer: string } | { ok: false; error: string };

/**
 * Pure. A person's answer, judged against the ticket it answers:
 * an option answer must be one of the choices the ticket offered —
 * matched exactly, and what resumes the run is the stored label,
 * the person's pick verbatim. A free-text answer is the person's
 * own words, trimmed of the transport's surrounding whitespace and
 * nothing else. Anything else is refused before the run is touched:
 * an answer the ticket never offered is not an answer to it.
 */
export function validateTicketAnswer(
  ticket: Pick<QuestionTicketRow, "options">,
  choice: { option?: unknown; text?: unknown },
): AnswerValidation {
  const hasOption = typeof choice.option === "string" && choice.option.trim().length > 0;
  const hasText = typeof choice.text === "string" && choice.text.trim().length > 0;
  if (hasOption === hasText) {
    return { ok: false, error: "回答は、選択肢から 1 つ選ぶか、自由な文章で書くか、どちらか一方で送ってください。" };
  }
  if (hasOption) {
    const wanted = (choice.option as string).trim();
    const match = ticketOptionsOf(ticket.options).find((o) => o.label === wanted);
    if (!match) return { ok: false, error: "その選択肢は、この質問にはありません。画面を更新して、提示された選択肢から選んでください。" };
    return { ok: true, answer: match.label };
  }
  const answer = (choice.text as string).trim();
  if (answer.length > QUESTION_POLICY.maxAnswerChars) {
    return { ok: false, error: `回答が長すぎます（${QUESTION_POLICY.maxAnswerChars} 文字まで）。` };
  }
  return { ok: true, answer };
}

/** Pure. When a ticket filed at `now` stops waiting. */
export function questionExpiresAt(now: Date): string {
  return new Date(now.getTime() + QUESTION_POLICY.expiryDays * 24 * 60 * 60_000).toISOString();
}

/** Pure. The run's one line while it rests on these tickets: the
 *  first question's short form, with the rest counted, never lost. */
export function restingSummaryFor(tickets: readonly Pick<QuestionTicketRow, "question">[]): string {
  if (!tickets.length) return "人の回答を待っています";
  const first = questionShortForm(tickets[0].question);
  return tickets.length === 1 ? first : `${first}（ほか ${tickets.length - 1} 件の質問）`;
}

/** Pure. The run's one line when tickets expired unanswered. */
export function expiredSummaryFor(tickets: readonly Pick<QuestionTicketRow, "question">[]): string {
  if (!tickets.length) return "質問への回答が得られませんでした";
  const first = questionShortForm(tickets[0].question);
  return tickets.length === 1
    ? `質問への回答が得られませんでした: ${first}`
    : `質問への回答が得られませんでした: ${first}（ほか ${tickets.length - 1} 件）`;
}

/** Pure. The Element comment an expiry leaves: the label finishRun's
 *  blocked settle uses, why the run ended, and every unanswered
 *  question preserved verbatim with the choices it offered — the
 *  record a person re-opens the work from. */
export function expiredCommentFor(tickets: readonly Pick<QuestionTicketRow, "question" | "options">[]): string {
  const parts = [
    `**対応が必要です** — 質問への回答が期限（${QUESTION_POLICY.expiryDays}日）内に得られなかったため、この実行はブロックで終了しました。推測で進めることはしませんでした。`,
  ];
  for (const t of tickets) {
    const options = ticketOptionsOf(t.options);
    parts.push(`質問: ${t.question}${options.length ? `\n選択肢: ${options.map((o) => o.label).join(" / ")}` : ""}`);
  }
  return parts.join("\n\n");
}

// ── The record's writers (service role) ─────────────────────────────

const TICKET_COLUMNS = "id, activity_space_id, run_id, element_id, strategy_id, tool_use_id, question, question_key, options, context, tried, status, answer, answered_by, answered_at, expires_at, created_at";

/**
 * File a run's question, or reuse the ticket that already stands
 * for it: the same question (its key) open on the same run is the
 * same ticket, however many times the model asks it — across a
 * turn's parallel calls and across slices alike. The partial
 * unique index is the backstop; a lost insert race re-reads the
 * winner. A ticket filed by an earlier call of the same run under
 * a different call id is found by its key, not by the call.
 */
export async function ensureQuestionTicket(admin: SupabaseClient, args: {
  spaceId: string | null; runId: string; elementId: string | null; strategyId: string | null;
  toolUseId: string; ask: AskQuestion; now: Date;
}): Promise<{ ticket: QuestionTicketRow; created: boolean }> {
  const key = questionKeyOf(args.ask.question);
  const findStanding = async (): Promise<QuestionTicketRow | null> => {
    const byKey = await admin.from("question_tickets").select(TICKET_COLUMNS)
      .eq("run_id", args.runId).eq("status", "open").eq("question_key", key)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (byKey.data) return byKey.data as QuestionTicketRow;
    const byCall = await admin.from("question_tickets").select(TICKET_COLUMNS)
      .eq("run_id", args.runId).eq("tool_use_id", args.toolUseId)
      .limit(1).maybeSingle();
    return (byCall.data as QuestionTicketRow | null) ?? null;
  };
  const standing = await findStanding();
  if (standing) return { ticket: standing, created: false };
  const { data, error } = await admin.from("question_tickets").insert({
    activity_space_id: args.spaceId, run_id: args.runId, element_id: args.elementId, strategy_id: args.strategyId,
    tool_use_id: args.toolUseId, question: args.ask.question, question_key: key,
    options: args.ask.options, context: args.ask.context, tried: args.ask.tried,
    expires_at: questionExpiresAt(args.now),
  }).select(TICKET_COLUMNS).single();
  if (!error && data) return { ticket: data as QuestionTicketRow, created: true };
  // A parallel call of the same turn filed it first (the unique
  // indexes refuse a second standing row): the winner is the ticket.
  const winner = await findStanding();
  if (winner) return { ticket: winner, created: false };
  throw new Error(`質問を登録できませんでした: ${error?.message ?? "unknown"}`);
}

/** One ticket by id, or null. */
export async function loadQuestionTicket(admin: SupabaseClient, ticketId: string): Promise<QuestionTicketRow | null> {
  const { data } = await admin.from("question_tickets").select(TICKET_COLUMNS).eq("id", ticketId).maybeSingle();
  return (data as QuestionTicketRow | null) ?? null;
}

/** A run's tickets by id set — the resting set's current truth,
 *  read at answer time (a ticket's state is its row, never the
 *  transcript's memory of it). */
export async function loadQuestionTickets(admin: SupabaseClient, ticketIds: readonly string[]): Promise<QuestionTicketRow[]> {
  if (!ticketIds.length) return [];
  const { data } = await admin.from("question_tickets").select(TICKET_COLUMNS).in("id", [...ticketIds]);
  return (data ?? []) as QuestionTicketRow[];
}

/**
 * Mark a ticket answered — guarded on it still standing open, so
 * an answer and the expiry sweep can never both take it: whichever
 * transition lands first is the ticket's end, and the loser reads
 * null here and stops. The answer stored is the person's words
 * exactly as validated (validateTicketAnswer).
 */
export async function markQuestionAnswered(admin: SupabaseClient, args: {
  ticketId: string; answer: string; answeredBy: string; now: Date;
}): Promise<QuestionTicketRow | null> {
  const { data } = await admin.from("question_tickets").update({
    status: "answered", answer: args.answer, answered_by: args.answeredBy,
    answered_at: args.now.toISOString(), updated_at: args.now.toISOString(),
  }).eq("id", args.ticketId).eq("status", "open").select(TICKET_COLUMNS).maybeSingle();
  return (data as QuestionTicketRow | null) ?? null;
}

/**
 * The tick's expiry claim: open tickets past their window, each
 * claimed with the same guarded transition (open → expired) before
 * anything settles on it, so two ticks — or a tick and an answer
 * in flight — never settle the same ticket twice.
 */
export async function claimExpiredQuestionTickets(admin: SupabaseClient, now: Date, limit = 50): Promise<QuestionTicketRow[]> {
  const { data: due } = await admin.from("question_tickets").select("id")
    .eq("status", "open").lt("expires_at", now.toISOString())
    .order("expires_at", { ascending: true }).limit(limit);
  const claimed: QuestionTicketRow[] = [];
  for (const row of due ?? []) {
    const { data } = await admin.from("question_tickets").update({
      status: "expired", updated_at: now.toISOString(),
    }).eq("id", (row as { id: string }).id).eq("status", "open").select(TICKET_COLUMNS).maybeSingle();
    if (data) claimed.push(data as QuestionTicketRow);
  }
  return claimed;
}

/**
 * End a run whose question(s) expired unanswered, the way a blocked
 * finish settles (finishRun's shape, minus the verdict — no finish
 * happened here, and the record does not pretend one did): the run
 * closes as completed with the expiry as its summary, its Element
 * moves to blocked, the unanswered questions are preserved verbatim
 * in an Element comment, and the run's starter is told. Guarded on
 * the run still standing in the status the caller found it in
 * (`expectStatus` — awaiting_input for the tick, running for the
 * answer path's lost race), so a run that moved on meanwhile is
 * left alone and the caller learns it settled nothing.
 */
export async function settleRunBlockedByQuestions(admin: SupabaseClient, args: {
  run: { id: string; element_id: string | null; triggered_by: string | null };
  tickets: readonly QuestionTicketRow[];
  expectStatus: string;
  agentName: string;
  actorUserId: string | null;
  now: Date;
}): Promise<boolean> {
  const { run, tickets } = args;
  if (!tickets.length) return false;
  const summary = expiredSummaryFor(tickets);
  const { data: closed } = await admin.from("agent_runs").update({
    status: "completed", summary, finished_at: args.now.toISOString(), continuation_token: null,
  }).eq("id", run.id).eq("status", args.expectStatus).select("id").maybeSingle();
  if (!closed) return false;
  // The run is over, so any sibling ticket of its rest that still
  // stands open dies with it — it can never be answered into a
  // completed run — and its question joins the preserved record.
  const preserved: QuestionTicketRow[] = [...tickets];
  const settledIds = new Set(tickets.map((t) => t.id));
  const { data: siblings } = await admin.from("question_tickets").select(TICKET_COLUMNS)
    .eq("run_id", run.id).eq("status", "open");
  for (const s of (siblings ?? []) as QuestionTicketRow[]) {
    if (settledIds.has(s.id)) continue;
    const { data } = await admin.from("question_tickets").update({
      status: "expired", updated_at: args.now.toISOString(),
    }).eq("id", s.id).eq("status", "open").select(TICKET_COLUMNS).maybeSingle();
    if (data) preserved.push(data as QuestionTicketRow);
  }
  if (run.element_id) {
    const { data: el } = await admin.from("elements").select("status").eq("id", run.element_id).maybeSingle();
    if (el && !["done", "cancelled", "blocked"].includes((el as { status?: string }).status ?? "")) {
      await admin.from("elements").update({ status: "blocked", updated_at: args.now.toISOString() }).eq("id", run.element_id);
    }
    await admin.from("element_comments").insert({
      element_id: run.element_id, author_id: args.actorUserId, author_kind: "ai_agent", author_name: args.agentName,
      content: expiredCommentFor(preserved),
    }).then(() => {}, () => {});
  }
  if (run.triggered_by) {
    await admin.from("notifications").insert({
      recipient_id: run.triggered_by, actor_name: args.agentName, kind: "status_change", element_id: run.element_id,
      title: "質問への回答が得られず、実行がブロックで終了しました", body: summary,
    }).then(() => {}, () => {});
  }
  return true;
}
