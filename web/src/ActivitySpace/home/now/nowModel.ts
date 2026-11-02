import { normalizeDirection, type ElementEdge, type ElementWithDetails } from '@/types/database';
import { dayIndexOf, toDateOnlyString } from '@/Function/shared/dateUtils';

export type NowLane = 'attention' | 'ready' | 'waiting' | 'later';
export type NowScope = 'mine' | 'team';

export interface NowItem {
  element: ElementWithDetails;
  lane: NowLane;
  /** English message key; render with `t(reason, reasonValues)`. */
  reason: string;
  reasonValues?: Record<string, string | number>;
  blockers: ElementWithDetails[];
  unknownDependency: boolean;
  unlocks: ElementWithDetails[];
  next: string | null;
  overdue: boolean;
}

const isClosed = (e: ElementWithDetails) => e.status === 'done' || e.status === 'cancelled';
const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Calendar dates stay calendar dates; locale-dependent parsing can turn an
 * ambiguous import into a false overdue warning. */
export function validWorkDate(value: string | null | undefined): string | null {
  return dayIndexOf(value) === null ? null : value!;
}

export function localWorkDate(date = new Date()): string {
  return toDateOnlyString(date);
}

function isMyWork(element: ElementWithDetails, userId: string): boolean {
  return element.owner_id === userId || (element.assignees ?? []).some(a =>
    a.worker?.user_id === userId && a.role !== 'collaborator');
}

/** Facts from one complete Space snapshot. No risk score, inferred approver,
 * capacity promise, or inactivity-as-failure judgment is made here. */
export function buildNowItems(
  elements: ElementWithDetails[],
  edges: Pick<ElementEdge, 'from_element' | 'to_element' | 'edge_type'>[],
  userId: string,
  scope: NowScope,
  today: string,
): NowItem[] {
  const byId = new Map(elements.map(e => [e.id, e]));
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.edge_type !== 'depends_on') continue;
    const from = incoming.get(edge.to_element) ?? new Set<string>();
    from.add(edge.from_element);
    incoming.set(edge.to_element, from);
    const to = outgoing.get(edge.from_element) ?? new Set<string>();
    to.add(edge.to_element);
    outgoing.set(edge.from_element, to);
  }

  const unresolved = (id: string) => [...(incoming.get(id) ?? [])].filter(upstream =>
    byId.get(upstream)?.status !== 'done');
  const rows: NowItem[] = [];
  for (const element of byId.values()) {
    if (isClosed(element) || (scope === 'mine' && !isMyWork(element, userId))) continue;
    const pending = unresolved(element.id);
    const blockers = pending.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    const unknownDependency = pending.some(id => !byId.has(id));
    const due = validWorkDate(element.due_date);
    const starts = validWorkDate(element.start_date);
    const overdue = !!due && due < today;
    const approvalPending = !!element.is_approval && element.approval_state !== 'approved';
    const unlocks = [...(outgoing.get(element.id) ?? [])].flatMap(id => {
      const downstream = byId.get(id);
      if (!downstream || downstream.id === element.id || isClosed(downstream) || downstream.status === 'backlog' || downstream.status === 'blocked') return [];
      if ((validWorkDate(downstream.start_date) ?? '') > today) return [];
      return unresolved(id).every(upstream => upstream === element.id) ? [downstream] : [];
    });

    let lane: NowLane;
    let reason: string;
    let reasonValues: Record<string, string | number> | undefined;
    if (pending.length > 0 || element.status === 'blocked') {
      lane = 'waiting';
      if (blockers.length > 1) reasonValues = { n: blockers.length };
      reason = unknownDependency ? 'Dependency outside this view — readiness unknown'
        : blockers.length > 0 ? (blockers.length === 1 ? 'Waiting on 1 Element' : 'Waiting on {n} Elements')
          : 'Marked blocked — share what would let this move';
    } else if (element.status === 'backlog') {
      lane = 'later'; reason = 'Backlog — not committed to execution';
    } else if (starts && starts > today) {
      lane = 'later'; reason = 'Scheduled to start {date}'; reasonValues = { date: starts };
    } else if (approvalPending) {
      lane = 'attention'; reason = element.approval_state === 'changes_requested' ? 'Approval changes requested'
        : element.approval_state === 'rejected' ? 'Approval rejected — clarify the next step'
          : 'Approval pending — confirm who can decide';
    } else if (element.status === 'review') {
      lane = 'attention'; reason = 'In review — check the result and respond';
    } else if (!element.status) {
      lane = 'attention'; reason = 'Status not set — confirm before starting';
    } else {
      lane = 'ready'; reason = element.status === 'in_progress' ? 'In progress — no recorded dependency holding it'
        : incoming.has(element.id) ? 'All recorded prerequisites are done' : 'No dependency recorded';
    }
    rows.push({ element, lane, reason, reasonValues, blockers, unknownDependency, unlocks,
      next: normalizeDirection(element.direction)?.next ?? null, overdue });
  }

  return rows.sort((a, b) =>
    Number(b.overdue) - Number(a.overdue)
    || (priorityRank[a.element.priority ?? 'medium'] - priorityRank[b.element.priority ?? 'medium'])
    || (validWorkDate(a.element.due_date) ?? '9999').localeCompare(validWorkDate(b.element.due_date) ?? '9999')
    || b.unlocks.length - a.unlocks.length
    || a.element.title.localeCompare(b.element.title)
    || a.element.id.localeCompare(b.element.id));
}

export function workAssignees(element: ElementWithDetails): string {
  const names = [...new Set((element.assignees ?? []).filter(a => a.role !== 'collaborator')
    .map(a => a.worker?.name).filter((n): n is string => !!n))];
  return names.length ? names.join(', ') : 'Unassigned';
}
