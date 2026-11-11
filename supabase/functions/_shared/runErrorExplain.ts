// Why a run stopped, in words the person who has to fix it can act on.
//
// A run that hits an error pauses, and its starter is told. What they
// were told was the provider's raw answer — a status code and a JSON
// body — which says neither what happened nor who can put it right.
// This reads the raw message for the causes that are somebody's to fix
// (the AI provider's balance, its key, its rate limit, its load) and
// says, for each, what happened and what to do. A cause is read from
// the provider's own words, or from the status code the message opens
// with — never from a number that merely appears somewhere in it. Anything it does not
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

const CAUSES: { cause: Exclude<RunErrorCause, "unknown">; test: RegExp; title: string; body: string }[] = [
  {
    cause: "balance",
    test: /credit balance is too low|insufficient[_ ](balance|quota|credits?)|billing[_ ]hard[_ ]limit|payment required|^\s*402\b/i,
    title: "AI の利用残高がなくなったため、止まっています",
    body: "AI の提供元で残高を足すと動かせます。足したあと、この Element の Resume で続きから再開します。それまで、AI に任せた仕事はどれも進みません。",
  },
  {
    cause: "key",
    test: /invalid x-api-key|invalid api key|incorrect api key|authentication_error/i,
    title: "AI につなぐ鍵が使えないため、止まっています",
    body: "AI の提供元の鍵が無効か、取り消されています。設定で鍵を入れ直したあと、この Element の Resume で続きから再開します。",
  },
  {
    cause: "rate_limit",
    test: /rate[_ ]limit|too many requests|^\s*429\b/i,
    title: "AI の利用が一時的に上限に達したため、止まっています",
    body: "少し待ってから、この Element の Resume で続きから再開してください。何度も起きるときは、AI の提供元で上限を確かめてください。",
  },
  {
    cause: "overloaded",
    test: /overloaded_error|\boverloaded\b|service unavailable|^\s*(529|503)\b/i,
    title: "AI の提供元が混み合っているため、止まっています",
    body: "こちらで直すものはありません。少し待ってから、この Element の Resume で続きから再開してください。",
  },
];

const UNKNOWN_TITLE = "エラーで一時停止しました";

/** Pure. What a raw run error means for the person who started it. */
export function explainRunError(raw: string): RunErrorExplanation {
  const hit = CAUSES.find((c) => c.test.test(raw));
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
