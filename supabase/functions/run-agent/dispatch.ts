// Athena's dispatch table: which driver a run belongs to, what shape of
// request may drive it, and from which statuses that request may claim
// it. serve() used to hold these as scattered conditionals; the chat
// driver joins the table here, so the rules for every entry are stated
// once and pinned by tests — above all that the decision path, which
// approvals already travel, admits exactly what it admitted before.
// Pure: no I/O, no clock.

/** The run's subject, as the dispatch reads it. */
export interface RunSubject {
  element_id: string | null;
  strategy_id: string | null;
  ai_session_id: string | null;
  integration_draft_id?: string | null;
  promotion_draft_id?: string | null;
  mode: string;
}

/**
 * One driver per subject: an Element's work, a Strategy conversation, a
 * Copilot chat, a connection draft, a promotion draft. A run with no
 * subject cannot exist (the subject check sees to that); it would fall
 * to execute, which refuses it for having no Element. The one run with
 * no subject column at all is the heartbeat: its subject is the Space
 * itself, carried in activity_space_id, and its mode is its marker.
 */
export type DriverKind = "execute" | "converse" | "chat" | "draft" | "promote" | "heartbeat";

export function driverForRun(run: RunSubject): DriverKind {
  if (run.element_id) return "execute";
  if (run.strategy_id) return "converse";
  if (run.integration_draft_id) return "draft";
  if (run.promotion_draft_id) return "promote";
  if (run.ai_session_id || run.mode === "copilot") return "chat";
  if (run.mode === "heartbeat") return "heartbeat";
  return "execute";
}

/** The shape a request to drive a run takes. */
export type EntryKind = "message" | "decision" | "answer" | "continue" | "resume" | "start";

/** Pure. A request's entry shape, in the order serve() has always
 *  preferred them: a message first (it is the only entry that carries
 *  new words), then a decision, then an answer to a question ticket
 *  (B12 — a person's response to a specific ask, like a decision, but
 *  bound to a ticket rather than to an approval's calls), a
 *  continuation, a resume, a plain start. */
export function entryForBody(body: {
  message?: unknown; decision?: unknown; answer?: unknown; continue?: unknown; resume?: unknown;
}): EntryKind {
  if (body.message !== undefined) return "message";
  if (body.decision) return "decision";
  if (body.answer) return "answer";
  if (body.continue) return "continue";
  if (body.resume) return "resume";
  return "start";
}

/** Pure. A person's words may be posted to a conversation — a Strategy's,
 *  the Copilot's chat, or a draft (the answer to its question, or "fix
 *  this" after a test), whether the draft is drafting a connection or a
 *  promotion — never to a work run, whose words are its Element's
 *  record. */
export function messageAllowed(driver: DriverKind): boolean {
  return driver === "converse" || driver === "chat" || driver === "draft" || driver === "promote";
}

/**
 * Pure. A question ticket's answer may drive only a work run (B12):
 * the ticket is an execute run's ask, filed by its ask_question tool
 * and rested in awaiting_input. Conversations take their person's
 * words as messages, and the draft flows answer through theirs —
 * the answer entry exists because a work run takes no message, and
 * an answer is not a decision: it carries no approval, binds to a
 * ticket instead of a batch's hash, and its words are delivered to
 * the model as the question call's tool result, verbatim.
 */
export function answerAllowed(driver: DriverKind): boolean {
  return driver === "execute";
}

export interface ClaimRule {
  /** The statuses the claim may take the run from. */
  from: readonly string[];
  /** The claim must also match the run's continuation token. */
  token?: boolean;
}

/**
 * Pure. From which statuses each entry may claim its run. A decision
 * answers a run that waits for one; an answer claims a work run
 * resting on its question ticket(s) — awaiting_input is a work run's
 * only rest an answer may take it from (a conversation's
 * awaiting_input is reached by message, and message is preferred
 * over answer in entryForBody, so the two never collide); a
 * continuation is bound to its token rather than to a person's
 * patience; a message reaches a conversation at rest in any of its
 * waiting words ('paused' included, so runs rested under the
 * panel's old host still answer).
 */
export function claimFor(entry: EntryKind): ClaimRule {
  switch (entry) {
    case "message": return { from: ["queued", "awaiting_input", "paused"] };
    case "decision": return { from: ["awaiting_approval"] };
    case "answer": return { from: ["awaiting_input"] };
    case "continue": return { from: ["running"], token: true };
    case "resume": return { from: ["paused"] };
    case "start": return { from: ["queued"] };
  }
}

/**
 * Pure. The entries a heartbeat run may be driven by. A fresh wake is a
 * plain start from queued — the only claim a heartbeat ever takes on
 * its own behalf. The tick's stale revival (resume, or continue with
 * the run's token) is admitted as what it is: the same wake executed
 * again after the platform cut it off, with dedup keeping a repeated
 * wake from notifying twice. A person's words and an approval decision
 * never drive it — nobody converses with a heartbeat, and it holds no
 * approval to decide.
 */
export function heartbeatEntryAllowed(entry: EntryKind): boolean {
  return entry === "start" || entry === "resume" || entry === "continue";
}
