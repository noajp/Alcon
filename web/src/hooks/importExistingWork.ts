'use client';

import { getCurrentUserId, supabase } from '@/lib/supabase';
import { getQueryClient } from '@/lib/queryClient';
import { notifyDomainsChanged } from '@/Function/space/domainsStore';
import { ElementImportRejectedError, INTAKE_LIMIT, type ElementImportRow, type ElementImportResult } from '@/ActivitySpace/execution/element/intake/intakeModel';

export interface WorkImportTarget {
  userId: string;
  spaceId: string;
  batchId: string;
  objectId: string | null;
  domainId: string | null;
  projectName: string;
}

export interface PendingWorkImport { version: 1; target: WorkImportTarget; rows: ElementImportRow[] }
type ImportStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const pendingKey = (userId: string, spaceId: string) => `alcon:pendingWorkImport:${userId}:${spaceId}`;

function validateRequest(target: WorkImportTarget, rows: ElementImportRow[]) {
  if (!uuid(target.userId) || !uuid(target.spaceId) || !uuid(target.batchId)
    || (target.objectId !== null && !uuid(target.objectId)) || (target.domainId !== null && !uuid(target.domainId))) {
    throw new ElementImportRejectedError('The import destination is incomplete. Select a Space and project again.');
  }
  if (typeof target.projectName !== 'string' || (!target.objectId && (!target.projectName.trim() || target.projectName.length > 160))) {
    throw new ElementImportRejectedError('Name this project using 1 to 160 characters before importing.');
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > INTAKE_LIMIT
    || rows.some((row) => !row || typeof row.rowKey !== 'string' || !row.rowKey.trim() || row.rowKey.length > 120
      || typeof row.title !== 'string' || !row.title.trim())
    || new Set(rows.map((row) => row.rowKey)).size !== rows.length) {
    throw new ElementImportRejectedError('Review 1 to 100 Elements with unique row keys before importing.');
  }
}

/** Session storage retains only the reviewed request, never the entire paste. */
export function readPendingWorkImport(storage: ImportStorage, userId: string, spaceId: string): PendingWorkImport | null {
  const raw = storage.getItem(pendingKey(userId, spaceId));
  if (!raw) return null;
  try {
    if (raw.length > 1_100_000) throw new Error('oversize');
    const pending = JSON.parse(raw) as PendingWorkImport;
    if (!pending || pending.version !== 1 || pending.target?.userId !== userId || pending.target?.spaceId !== spaceId) throw new Error('scope');
    validateRequest(pending.target, pending.rows);
    return pending;
  } catch {
    throw new Error('A previous import could not be restored. Check its project before starting another import in this browser session.');
  }
}

export function rememberPendingWorkImport(storage: ImportStorage, pending: PendingWorkImport) {
  validateRequest(pending.target, pending.rows);
  const { userId, spaceId } = pending.target;
  const previous = readPendingWorkImport(storage, userId, spaceId);
  if (previous && JSON.stringify(previous) !== JSON.stringify(pending)) {
    throw new Error('Confirm the previous import before starting another one.');
  }
  const serialized = JSON.stringify(pending);
  if (new TextEncoder().encode(serialized).length > 1_048_576) throw new Error('This import is too large. Start with a smaller project.');
  storage.setItem(pendingKey(userId, spaceId), serialized);
  if (storage.getItem(pendingKey(userId, spaceId)) !== serialized) throw new Error('The import could not be retained for a safe retry. No request was sent.');
}

/** Only a matching confirmed batch can release the slot for a new import. */
export function clearPendingWorkImport(storage: ImportStorage, target: WorkImportTarget) {
  const previous = readPendingWorkImport(storage, target.userId, target.spaceId);
  if (previous && previous.target.batchId !== target.batchId) throw new Error('A different import is waiting for confirmation.');
  storage.removeItem(pendingKey(target.userId, target.spaceId));
}

export async function importExistingWork(target: WorkImportTarget, rows: ElementImportRow[]): Promise<ElementImportResult & { objectId: string }> {
  validateRequest(target, rows);
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Sign in before importing work.');
  if (userId !== target.userId) throw new Error('The signed-in account changed. Return to the account that started this import.');
  const { data, error } = await supabase.rpc('import_existing_work', {
    p_space_id: target.spaceId, p_batch_id: target.batchId, p_object_id: target.objectId,
    p_domain_id: target.domainId, p_project_name: target.projectName, p_rows: rows,
  });
  if (error) {
    const rolledBack = new Set(['22023','22007','22008','22P02','23502','23503','23505','23514','42501','P0001','P2001','54000']);
    if (rolledBack.has(error.code) && !error.message.includes('different contents')) throw new ElementImportRejectedError(error.message);
    throw new Error(error.message);
  }
  const saved = data?.saved as ElementImportResult['saved'] | undefined;
  if (!uuid(data?.objectId) || (target.objectId !== null && data.objectId !== target.objectId)
    || typeof data?.replayed !== 'boolean' || !Array.isArray(saved) || saved.length !== rows.length
    || saved.some(r => !r || typeof r.rowKey !== 'string' || !uuid(r.elementId))
    || new Set(saved.map(r => r.rowKey)).size !== rows.length
    || new Set(saved.map(r => r.elementId)).size !== rows.length
    || saved.some(r => !rows.some(row => row.rowKey === r.rowKey))) {
    throw new Error('The import response could not be confirmed. Retry this import to check the same saved work.');
  }
  notifyDomainsChanged();
  const qc = getQueryClient();
  for (const key of ['nowWork', 'explorer', 'my-elements', 'workers', 'decisionLab']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
  return { saved, objectId: data.objectId as string };
}

/** Explicitly confirm a committed import or fence an unsaved batch against late requests. */
export async function resolveExistingWork(target: WorkImportTarget): Promise<{ committed: boolean; available: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId || userId !== target.userId) throw new Error('Return to the signed-in account that started this import.');
  const { data, error } = await supabase.rpc('resolve_work_import', { p_space_id: target.spaceId, p_batch_id: target.batchId });
  if (error) throw new Error(error.message);
  if (typeof data?.committed !== 'boolean' || typeof data?.available !== 'boolean') {
    throw new Error('The previous import outcome could not be confirmed. Keep this request and try again.');
  }
  return { committed: data.committed, available: data.available };
}
