// Whether an Element comment reaches the loop, and what it is called when it
// does — the decision el_OPS-030 exists to pin down. Kept separate from
// board-listen.mjs because this is the one piece of that script with no
// socket, no REST call and no timer: given who wrote a comment, what it says,
// and whether the Element belongs to Friction Dev, the answer never changes.
// That is exactly the shape a test can hold still, the same reason
// faultReporter.mjs was split out — see web/tests/faultReporter.test.ts.
//
// The state itself (which Elements are ours, which foreign ones have been
// resolved) still lives in board-listen.mjs, because it is genuinely stateful
// — built from a REST seed and kept live by the websocket. It is passed in
// here as plain Maps rather than closed over, so nothing below needs a socket
// to be exercised.

// What turns a comment into feedback rather than chatter: it names the agent.
// Mirrors ADR 0012's rule for strategy_comments (ORDER), applied here to a
// second table for the same reason — element_comments has a `mentions
// uuid[]` column too, but the composer's mention picker filters to
// `type === 'human' && user_id` on both tables (ElementCommentsPanel.tsx,
// StrategyCommentsPanel.tsx), so an ai_agent Worker can never be mentioned
// through it. `@Claude` stays plain text on every path that can write it —
// see ADR 0012's rejected option 5 for why that is not a workaround but the
// only route that actually works.
export const AGENT_MENTION = /@claude\b/i;

/**
 * Which of the two caches answers for an Element — the one seeded from
 * Friction Dev at startup, or the one resolved on demand for an id that
 * wasn't in it.
 *
 * A foreign Element resolves through neither and is not ours, which is the
 * correct default: silence, not a report, unless the comment names the agent
 * (see classifyElementComment). An id that resolves through neither cache yet
 * — the REST lookup is still in flight, or the Element is gone — is treated
 * the same way; there is nothing else it could safely mean.
 */
export function isOurElement(elementId, { elementState, foreignElementState }) {
  if (elementState.has(elementId)) return true;
  return foreignElementState.get(elementId)?.inScope ?? false;
}

/**
 * A label for an Element by id, preferring the seeded cache, falling back to
 * the on-demand one, and only when both are silent falling back to a bare
 * uuid prefix — which is the failure el_OPS-030 exists to stop happening for
 * anything the on-demand lookup could have resolved.
 */
export function resolveElementName(elementId, { elementState, foreignElementState }) {
  return (
    elementState.get(elementId)?.label ||
    foreignElementState.get(elementId)?.label ||
    `element:${String(elementId).slice(0, 8)}`
  );
}

/**
 * Decide what an INSERT on element_comments becomes, or that it becomes
 * nothing at all.
 *
 *   'COMMENT'  — the Element is ours. Reported regardless of mention, the
 *                same way INITIATIVE chatter is reported for an in-scope
 *                Initiative: it is our own conversation, not something
 *                overheard.
 *   'FEEDBACK' — the Element is somebody else's board, and the comment
 *                names the agent. Reported from any board, in scope or not —
 *                ADR 0012's reasoning for ORDER applies unchanged: a protocol
 *                whose failure mode is silence is a broken protocol.
 *   null       — our own echo round-tripping back, or foreign chatter that
 *                does not name us. The second case is deliberate silence,
 *                not a gap — see FEEDBACK.md: reading another team's working
 *                conversation because it happens to share a database is
 *                surveillance, not context.
 *
 * The self-check runs before the ours-check on purpose: an echo of our own
 * writing back off the stream is not news regardless of which board it
 * landed on. Checking `isOurs` first would re-report every one of our own
 * progress comments on Friction Dev as fresh `COMMENT` lines forever, and
 * would report our own FEEDBACK replies on a foreign board as fresh
 * `FEEDBACK` — a machine reporting its own writing to itself, twice.
 */
export function classifyElementComment({ authorName, content, selfAuthor, isOurs }) {
  if (authorName === selfAuthor) return null;
  if (isOurs) return 'COMMENT';
  return AGENT_MENTION.test(content || '') ? 'FEEDBACK' : null;
}
