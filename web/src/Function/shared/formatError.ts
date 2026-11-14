// One way to turn a caught value into words a person can read. Supabase
// throws plain objects, not Error instances — a PostgREST error is
// `{ message, code, details, hint }` — so the common habit of coercing a
// caught value with String() renders a failed call as the literal text
// "[object Object]" on the surface. This is the web twin of the engine's
// errorMessage (_shared/boardTools.ts): an Error's message, a plain
// object's message when it carries one, a string as itself, and anything
// else a human fallback sentence — never a raw object. (A
// functions.invoke error's body is read by the caller that unwraps it —
// invokeEngine in agentData.ts — because reading a Response is async
// and this stays synchronous.)

import { translate } from '@/Function/i18n/I18nProvider';

/** The line shown when a caught value carries no readable message. */
const ERROR_FALLBACK = 'Something went wrong.';

// A model provider answers a failed call with its own JSON, often after the
// HTTP status: `400 {"type":"error","error":{"type":"invalid_request_error",…}}`.
// That text is for a log. A person is told what happened and what to do, by
// the kind of failure; the raw body stays in the run's record.
const SERVICE_ERROR = /^\s*(\d{3})?\s*\{[\s\S]*"type"\s*:\s*"error"/;
const SERVICE_ERROR_LINES = {
  key: 'The AI service did not accept the API key. Check the key under Settings, Connectors.',
  busy: 'The AI service is busy right now. Run it again in a moment.',
  rejected: 'The AI service rejected this request, so the run stopped. Open the run to see the step it stopped at.',
  other: 'The AI service returned an error, so the run stopped. Run it again.',
} as const;

/** Pure. The readable line (an English message key) for a provider's raw
 *  error body, or null when the text is not one. */
export function serviceErrorLine(text: string | null | undefined): string | null {
  if (!text || !SERVICE_ERROR.test(text)) return null;
  const status = Number(text.match(/^\s*(\d{3})/)?.[1] ?? 0);
  const kind = text.match(/"error"\s*:\s*\{\s*"type"\s*:\s*"([a-z_]+)"/)?.[1] ?? '';
  if (status === 401 || status === 403 || kind === 'authentication_error' || kind === 'permission_error') return SERVICE_ERROR_LINES.key;
  if (status === 429 || status === 529 || kind === 'rate_limit_error' || kind === 'overloaded_error') return SERVICE_ERROR_LINES.busy;
  if (status === 400 || kind === 'invalid_request_error') return SERVICE_ERROR_LINES.rejected;
  return SERVICE_ERROR_LINES.other;
}

/** A message as a person reads it: a provider's raw error body becomes its
 *  readable line in the viewer's language, anything else stays as it is. */
function readable(message: string): string {
  const line = serviceErrorLine(message);
  return line ? translate(line) : message;
}

/** A caught value as a readable line. */
export function formatError(e: unknown): string {
  if (e instanceof Error) return e.message ? readable(e.message) : ERROR_FALLBACK;
  if (typeof e === 'string') return e ? readable(e) : ERROR_FALLBACK;
  if (e && typeof e === 'object') {
    const message = (e as { message?: unknown }).message;
    if (typeof message === 'string' && message) return readable(message);
  }
  return ERROR_FALLBACK;
}
