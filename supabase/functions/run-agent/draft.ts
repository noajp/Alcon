// The draft step's throttle (S2): a chat turn's model calls stream, and
// the growing answer is written to a draft step the panel's live
// display reads — but a step write per token would flood the table, so
// the draft flushes on a rhythm: about every 750 ms, or every 200 new
// characters, whichever comes first. Pure, so the rhythm is pinned.

export const DRAFT_FLUSH_MS = 750;
export const DRAFT_FLUSH_CHARS = 200;

/**
 * Pure. Whether the draft's accumulated text should be written now.
 * Nothing new is never due; the first text is due at once (the
 * caller's last flush sits at the epoch), so a live display starts
 * with the answer's first words rather than after a silent second.
 */
export function draftDue(lastFlushAt: number, lastFlushLength: number, now: number, length: number): boolean {
  if (length <= lastFlushLength) return false;
  return now - lastFlushAt >= DRAFT_FLUSH_MS || length - lastFlushLength >= DRAFT_FLUSH_CHARS;
}
