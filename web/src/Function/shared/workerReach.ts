import { translate } from '@/Function/i18n/I18nProvider';

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
  const who = name?.trim() || translate('This Worker');
  return translate("{who} has no account connected — assignments and notifications don't reach them. Connect the Worker to an account to fix this.", { who });
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

/** A trigger's accessible name when it shows one or more Worker avatars
 *  with no visible name text of its own to fall back on — an icon-only
 *  assignee/lead button, or a `WorkerAvatarStack` with nothing else in the
 *  DOM (ELE_QLT-040). These triggers are themselves the real interactive
 *  element (a `<button>` already wrapping the avatar as a DropdownMenuTrigger
 *  or PopoverTrigger), so a nested `tabIndex` on the avatar is either a dead
 *  stop in Tab order or unreachable inside a Radix menu — the fix belongs on
 *  the trigger's own accessible name instead, synthesized here the same way
 *  `unreachableWorkerTitle` explains a single avatar's title. Where a
 *  DropdownMenuItem already renders the name as visible text, prefer a
 *  sibling `ReachHint` there instead of this — this helper is for triggers
 *  that render no such text. `base` names the action ("Assignee", "Lead");
 *  an empty/undefined worker list reads as just `base` (nobody assigned). */
export function workerTriggerLabel(
  base: string,
  workers: (ReachSubject & { name?: string | null }) | (ReachSubject & { name?: string | null })[] | null | undefined,
): string {
  const list = Array.isArray(workers) ? workers : workers ? [workers] : [];
  const label = translate(base);
  if (list.length === 0) return label;
  const parts = list.map((w) => {
    const name = w.name?.trim() || translate('Unnamed');
    return isUnreachableWorker(w) ? translate('{name} ({reason})', { name, reason: translate(UNREACHABLE_WORKER_LABEL) }) : name;
  });
  return translate('{label}: {list}', { label, list: parts.join(', ') });
}

/** The DOM facts a hand-rolled avatar needs to carry the mark — ring class,
 *  tooltip, the reachability flag, and (el_QLT-008 review, ELE_QLT-036) the
 *  keyboard/screen-reader path a bare `title` can't offer on an element with
 *  no visible text — derived once so the avatars that are not `WorkerAvatar`
 *  (Workload rows, the roster widget) cannot drift into their own copies of
 *  this. `tabIndex`/`ariaLabel` are only set when unreachable: a reachable
 *  avatar gains no new stop in tab order. Pair with `UnreachableAvatarTooltip`
 *  (`WorkerAvatar.tsx`) so the same title text is also reachable without a
 *  pointer, not just present in the DOM. */
export function unreachableMarkProps(
  worker: ReachSubject | null | undefined,
  name: string | null | undefined,
): {
  ringClass: string;
  title: string | undefined;
  unreachable: true | undefined;
  tabIndex: 0 | undefined;
  ariaLabel: string | undefined;
} {
  const unreachable = isUnreachableWorker(worker);
  const title = unreachable ? unreachableWorkerTitle(name) : undefined;
  return {
    ringClass: unreachable ? UNREACHABLE_WORKER_RING_CLASS : '',
    title,
    unreachable: unreachable || undefined,
    tabIndex: unreachable ? 0 : undefined,
    ariaLabel: title,
  };
}
