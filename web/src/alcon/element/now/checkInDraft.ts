import { normalizeDirection, type Element, type ElementStatus } from '@/types/database';
import type { CheckInInput } from '@/hooks/coordinationData';

export interface CheckInBase {
  id: string;
  title: string;
  updatedAt: string | null;
  status: ElementStatus | null;
  next: string | null;
  approvalPending: boolean;
}

/** null means untouched; an empty next string explicitly clears the next step. */
export interface CheckInDraft {
  status: ElementStatus | null;
  next: string | null;
  note: string;
}

export function checkInBase(element: Pick<Element, 'id' | 'title' | 'updated_at' | 'status' | 'direction' | 'is_approval' | 'approval_state'>): CheckInBase {
  return {
    id: element.id,
    title: element.title,
    updatedAt: element.updated_at,
    status: element.status,
    next: normalizeDirection(element.direction)?.next ?? null,
    approvalPending: !!element.is_approval && element.approval_state !== 'approved',
  };
}

export type CheckInChange = Omit<CheckInInput, 'requestId'>;

/** Only deliberate changes are written, including after an explicit rebase. */
export function checkInChange(base: CheckInBase, draft: CheckInDraft): CheckInChange | null {
  const patch: CheckInInput['patch'] = {};
  if (draft.status !== null && draft.status !== base.status) patch.status = draft.status;
  if (draft.next !== null) {
    const next = draft.next.trim() || null;
    if (next !== base.next) patch.next = next;
  }
  const note = draft.note.trim();
  if (!Object.keys(patch).length && !note) return null;
  return { elementId: base.id, expectedUpdatedAt: base.updatedAt, patch, note };
}

export interface CheckInAttempt { fingerprint: string; requestId: string; input: CheckInChange }

/** A lost response must retry the same operation, not create another comment. */
export function checkInAttempt(
  change: CheckInChange,
  previous: CheckInAttempt | null,
  newId: () => string,
): CheckInAttempt {
  const fingerprint = JSON.stringify(change);
  return previous?.fingerprint === fingerprint ? previous : {
    fingerprint, requestId: newId(), input: JSON.parse(fingerprint) as CheckInChange,
  };
}

export type CheckInFailure = 'conflict' | 'permission' | 'invalid' | 'rejected' | 'unconfirmed' | 'history_changed';

/** A rejection of a retry does not necessarily settle the original request:
 * permission and validation checks precede receipt lookup in the RPC. */
export function checkInFailure(cause: unknown, wasUnconfirmed: boolean): CheckInFailure {
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  if (code === 'P0002') return 'history_changed';
  // The RPC checks for the original receipt before reporting a version conflict.
  if (code === '40001') return 'conflict';
  if (wasUnconfirmed) return 'unconfirmed';
  if (code === '42501') return 'permission';
  if (code === '22023') return 'invalid';
  // These SQL failures abort the transaction. Connection / response errors do
  // not prove whether a commit happened and must retain the original operation.
  if (typeof code === 'string' && /^(22|23|42|53|54|55|57|58|XX)[0-9A-Z]{3}$/.test(code)) return 'rejected';
  return 'unconfirmed';
}

export function hasNewerCheckInVersion(incoming: string | null, base: string | null): boolean {
  if (!incoming || incoming === base) return false;
  const time = Date.parse(incoming);
  return Number.isFinite(time) && (!base || time > Date.parse(base));
}
