import { STATUS_ORDER } from '@/shared/designTokens';
import { checkInChange, type CheckInAttempt, type CheckInBase, type CheckInDraft } from './checkInDraft';

export interface PendingCheckIn {
  version: 1;
  userId: string;
  base: CheckInBase;
  draft: CheckInDraft;
  attempt: CheckInAttempt;
}

type CheckInStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface CheckInLimits { noteMax: number; nextMax: number }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const status = (v: unknown) => v === null || STATUS_ORDER.some(s => s === v);
const timestamp = (v: unknown) => v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)));
const textOrNull = (v: unknown, max: number) => v === null || (typeof v === 'string' && v.length <= max);
const pendingKey = (userId: string, elementId: string) => `alcon:pendingCheckIn:v1:${userId}:${elementId}`;

function validate(pending: PendingCheckIn, userId: string, elementId: string, limits: CheckInLimits) {
  const { base, draft, attempt } = pending ?? {};
  if (pending?.version !== 1 || pending.userId !== userId || !uuid(userId) || !uuid(elementId)
    || !base || base.id !== elementId || typeof base.title !== 'string' || !timestamp(base.updatedAt)
    || !status(base.status) || !textOrNull(base.next, 100_000) || typeof base.approvalPending !== 'boolean'
    || !draft || !status(draft.status) || !textOrNull(draft.next, limits.nextMax)
    || typeof draft.note !== 'string' || draft.note.length > limits.noteMax
    || !attempt || !uuid(attempt.requestId) || typeof attempt.fingerprint !== 'string'
    || attempt.fingerprint !== JSON.stringify(attempt.input)
    || JSON.stringify(checkInChange(base, draft)) !== attempt.fingerprint) {
    throw new Error('The previous update could not be restored safely. Review this Element’s shared history before starting another update in this browser session.');
  }
}

/** Invalid or inaccessible storage must not look like an empty retry slot. */
export function readPendingCheckIn(storage: CheckInStorage, userId: string, elementId: string, limits: CheckInLimits): PendingCheckIn | null {
  const raw = storage.getItem(pendingKey(userId, elementId));
  if (raw === null) return null;
  try {
    if (raw.length > 100_000) throw new Error('oversize');
    const pending = JSON.parse(raw) as PendingCheckIn;
    validate(pending, userId, elementId, limits);
    return pending;
  } catch {
    throw new Error('The previous update could not be restored safely. Review this Element’s shared history before starting another update in this browser session.');
  }
}

/** Write and read back before the RPC, including on the first attempt. */
export function rememberPendingCheckIn(storage: CheckInStorage, pending: PendingCheckIn, limits: CheckInLimits) {
  validate(pending, pending.userId, pending.base.id, limits);
  const previous = readPendingCheckIn(storage, pending.userId, pending.base.id, limits);
  const serialized = JSON.stringify(pending);
  if (previous && JSON.stringify(previous) !== serialized) throw new Error('An earlier update still needs confirmation. Restore it before saving another update.');
  if (serialized.length > 100_000) throw new Error('This update is too large to keep for a safe retry. Shorten it before saving.');
  const key = pendingKey(pending.userId, pending.base.id);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error('This browser could not keep the update for a safe retry. No request was sent.');
}

/** Only a server-confirmed result may release the matching operation. */
export function clearPendingCheckIn(storage: CheckInStorage, pending: PendingCheckIn, limits: CheckInLimits) {
  const previous = readPendingCheckIn(storage, pending.userId, pending.base.id, limits);
  if (previous && (previous.attempt.requestId !== pending.attempt.requestId
    || previous.attempt.fingerprint !== pending.attempt.fingerprint)) throw new Error('A different update is waiting for confirmation.');
  const key = pendingKey(pending.userId, pending.base.id);
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error('The confirmed update could not be cleared from this browser. Restore it before writing another update.');
}
