// Why a run stopped, in words the person who has to fix it can act on.
//
// A run that hits an error pauses, and its starter is told. What they
// were told was the provider's raw answer — a status code and a JSON
// body — which says neither what happened nor who can put it right.
// This reads the raw message for the causes that are somebody's to fix
// (the AI provider's balance, its key, its rate limit, its load) and
// says, for each, what happened and what to do. Only a message that
// opens with an HTTP status is read as the provider's answer; within
// it, the cause is the provider's own words or that status. Anything it does not
// recognise keeps the plain "paused on an error" wording with the raw
// text beside it, so nothing is hidden behind a guess.
//
// The raw message always stays on the run's step: this is what the
// run's banner and the Inbox say, not what the record keeps.
// Pure: run-agent calls it, and the tests pin it.

export type RunErrorCause = "balance" | "key" | "rate_limit" | "overloaded" | "unknown";

export interface RunErrorExplanation {
  cause: RunErrorCause;
  /** One line: what happened. The Inbox row and the banner lead with it. */
  title: string;
  /** Who can put it right, and how the work goes on after. */
  body: string;
}

// The wording names no place to press: the same explanation is shown on
// an Element's run, in a Strategy conversation and in the Inbox.
const CAUSES: { cause: Exclude<RunErrorCause, "unknown">; test: RegExp; title: string; body: string }[] = [
  {
    cause: "balance",
    test: /credit balance is too low|insufficient[_ ](balance|quota|credits?)|exceeded your current quota|billing[_ ]hard[_ ]limit|payment required|^402\b/i,
    title: "AI の利用残高がなくなったため、止まっています",
    body: "AI の提供元で残高を足すと動かせます。足したあと、止まった仕事は続きから再開できます。それまで、AI に任せた仕事はどれも進みません。",
  },
  {
    cause: "key",
    test: /invalid x-api-key|invalid api key|incorrect api key|authentication_error|^401\b/i,
    title: "AI につなぐ鍵が使えないため、止まっています",
    body: "AI の提供元の鍵が無効か、取り消されています。設定で鍵を入れ直すと、止まった仕事は続きから再開できます。それまで、AI に任せた仕事はどれも進みません。",
  },
  {
    cause: "overloaded",
    test: /overloaded|service unavailable|^(529|503)\b/i,
    title: "AI の提供元が混み合っているため、止まっています",
    body: "こちらで直すものはありません。少し待ってから、止まった仕事を再開してください。",
  },
  {
    cause: "rate_limit",
    test: /rate[_ ]limit|too many requests|^429\b/i,
    title: "AI の利用が一時的に上限に達したため、止まっています",
    body: "少し待ってから、止まった仕事を再開してください。何度も起きるときは、AI の提供元で上限を確かめてください。",
  },
];

/** The causes that stop every run until somebody acts. These are told
 *  once; a passing one (a rate limit, a busy provider) is told for each
 *  run it stopped, since each has to be taken up again on its own. */
const STOPS_EVERY_RUN: ReadonlySet<RunErrorCause> = new Set(["balance", "key"]);

/** Pure. Whether one notice stands for every run this cause stops. */
export function toldOnce(cause: RunErrorCause): boolean {
  return STOPS_EVERY_RUN.has(cause);
}

/** The provider's answer opens with its HTTP status ("400 {...}",
 *  "402 Insufficient Balance"). An error that does not — a database
 *  write that failed, an exception in the run's own code — is not the
 *  provider's, whatever words it happens to contain. */
const PROVIDER_ANSWER = /^\s*[45]\d{2}\b/;

const UNKNOWN_TITLE = "エラーで一時停止しました";

/** Pure. What a raw run error means for the person who started it. */
export function explainRunError(raw: string): RunErrorExplanation {
  const answer = PROVIDER_ANSWER.test(raw) ? raw.trim() : null;
  const hit = answer ? CAUSES.find((c) => c.test.test(answer)) : undefined;
  if (hit) return { cause: hit.cause, title: hit.title, body: hit.body };
  return { cause: "unknown", title: UNKNOWN_TITLE, body: raw };
}

/** Pure. The run's one-line error, as the banner shows it: the plain
 *  explanation for a known cause, the raw text (capped) otherwise. */
export function runErrorLine(raw: string, max = 300): string {
  const e = explainRunError(raw);
  return e.cause === "unknown"
    ? `${e.title}: ${Array.from(raw).slice(0, max).join("")}`
    : `${e.title}。${e.body}`;
}

/** How long one cause is told once: a balance that ran out stops every
 *  run, and the person needs one notice, not one per run. */
export const SAME_CAUSE_QUIET_MS = 6 * 60 * 60_000;
