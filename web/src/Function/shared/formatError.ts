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

/** The line shown when a caught value carries no readable message. */
const ERROR_FALLBACK = 'Something went wrong.';

/** Pure. A caught value as a readable line. */
export function formatError(e: unknown): string {
  if (e instanceof Error) return e.message || ERROR_FALLBACK;
  if (typeof e === 'string') return e || ERROR_FALLBACK;
  if (e && typeof e === 'object') {
    const message = (e as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return ERROR_FALLBACK;
}
