// What a Strategy list row says about the schedule and the people, read off
// the Objects the Strategy holds. A Strategy has no dates or assignee of its
// own — those live in Execution — so its row reports what its Objects carry:
// when its work begins and is due, and who leads most of it.
//
// Pure.

export interface FactObject {
  start_date?: string | null;
  due_date?: string | null;
  lead_id?: string | null;
}

export interface StrategyFacts {
  /** The earliest start among its Objects, or null. */
  start: string | null;
  /** The latest due date among its Objects — when the whole is due — or null. */
  due: string | null;
  /** Who leads the most of its Objects (the first met on a tie), or null. */
  leadId: string | null;
}

export function strategyFacts(objects: readonly FactObject[]): StrategyFacts {
  let start: string | null = null;
  let due: string | null = null;
  const leads = new Map<string, number>();
  for (const o of objects) {
    // 'YYYY-MM-DD' orders as text.
    if (o.start_date && (start === null || o.start_date < start)) start = o.start_date;
    if (o.due_date && (due === null || o.due_date > due)) due = o.due_date;
    if (o.lead_id) leads.set(o.lead_id, (leads.get(o.lead_id) ?? 0) + 1);
  }
  let leadId: string | null = null;
  let best = 0;
  for (const [id, n] of leads) if (n > best) { leadId = id; best = n; }
  return { start, due, leadId };
}
