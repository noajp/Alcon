// What the Inbox shows first: the things that wait on the person.
//
// A question a run asked rests the work until it is answered, so it is
// not one more row among reports and status changes — it leads the
// list, under its own heading, for as long as its ticket stands open.
// Whether a ticket is open is the ticket's own state (the notification
// is only the knock on the door), so the list is split against the set
// of open tickets, never by the notification's read flag: reading a
// question does not answer it, and answering it takes it out of the
// waiting group whether or not the row was ever marked read.
//
// Pure: the list component loads the open tickets and renders the split.

interface InboxEntry { kind: string; question_ticket_id?: string | null }

/** The tickets the Inbox's question notifications point at, once each. */
export function questionTicketIdsOf(notifications: readonly InboxEntry[]): string[] {
  const ids = new Set<string>();
  for (const n of notifications) {
    if (n.kind === 'question' && n.question_ticket_id) ids.add(n.question_ticket_id);
  }
  return [...ids];
}

/** The Inbox in two groups, each in the order it came in: what waits on
 *  the person (questions whose ticket is still open), then everything
 *  else. While the open tickets are not known yet, nothing is claimed
 *  to be waiting. */
export function splitInbox<N extends InboxEntry>(
  notifications: readonly N[],
  openTicketIds: ReadonlySet<string> | null,
): { waiting: N[]; rest: N[] } {
  const waiting: N[] = [];
  const rest: N[] = [];
  for (const n of notifications) {
    const open = n.kind === 'question' && !!n.question_ticket_id && !!openTicketIds?.has(n.question_ticket_id);
    (open ? waiting : rest).push(n);
  }
  return { waiting, rest };
}
