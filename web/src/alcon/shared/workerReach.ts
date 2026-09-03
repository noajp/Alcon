// Whether anything sent to a Worker can arrive.
//
// Notifications land on `auth.users` uuids (`notifications.recipient_id`,
// ADR 0010), so a human Worker whose `workers.user_id` is null can be
// assigned, counted and planned around while nothing ever reaches them —
// and, until this predicate, nothing said so. A Worker is not required to
// hold an account (contractors, liaison officers, people who exist on the
// board before they exist in the system); the defect was the silence, not
// the absence. Every surface that shows an assignee reads this one predicate
// so the mark cannot drift between the picker, the chip and the roster.
//
// AI agents and robots are deliberately outside the predicate. They never
// receive Inbox notifications and are driven by other means (`run-agent`), so
// marking them "unreachable" would be a lie of the opposite kind.

export interface ReachSubject {
  type?: 'human' | 'ai_agent' | 'robot' | null;
  /** `null` means the Worker has no account. `undefined` means the caller
   *  did not load the column, which is not the same fact — an avatar built
   *  from a `{ name, avatar_url }` stub must never be marked. */
  user_id?: string | null;
}

/** True only when the Worker is known to be human and known to have no
 *  account. Unknown on either side reads as reachable, so a partial subject
 *  cannot raise a false alarm. */
export function isUnreachableWorker(worker: ReachSubject | null | undefined): boolean {
  if (!worker) return false;
  return worker.type === 'human' && worker.user_id === null;
}

/** The mark's explanation. Names the consequence first — that is what the
 *  reader is about to rely on — and the fix second, so the tooltip is also
 *  the pointer to the invitation path (ELE_QLT-031). */
export function unreachableWorkerTitle(name: string | null | undefined): string {
  const who = name?.trim() || 'This Worker';
  return `${who} has no account connected — assignments and notifications don't reach them. Connect the Worker to an account to fix this.`;
}

/** Short row-level wording for pickers and rosters, where the tooltip is
 *  one hover away and the row only needs to say that something is off. */
export const UNREACHABLE_WORKER_LABEL = 'No account';

/** The mark itself: a dashed outline in the muted text tone, replacing the
 *  avatar's solid ring. Shared so the two avatars that are not
 *  `WorkerAvatar` (Workload rows, the roster widget) draw the same mark.
 *  The token is read through `var()` the way WidgetFrame's arrange outline
 *  does, so the ring follows the `.app-sidebar` re-tint like the labels
 *  beside it. */
export const UNREACHABLE_WORKER_RING_CLASS = 'outline-1 outline-dashed outline-[var(--muted-foreground)]';
