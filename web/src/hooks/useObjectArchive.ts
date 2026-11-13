'use client';

import { translate } from '@/Function/i18n/I18nProvider';
import { normalizeExplorerData, type ExplorerData } from '@/Function/sync/explorerPatch';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { ClaywareObject } from '@/types/database';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useObjects } from '@/Function/sync/explorerData';
import { countActiveObjects } from '@/Function/shared/objectArchive';
import { deleteObject } from './objectData';

// Archive / restore an Object, and the reads that still reach an archived
// one: the Domain's "Archived" list and the Object opened by id. Rules live
// in Function/shared/objectArchive and in the database
// (objects_archive_guard, archive_object / restore_object).

const ARCHIVE_REFUSED = 'Only owners or admins of this Object’s Domain can archive or restore it.';
const ARCHIVE_FAILED = 'The Object could not be archived. Try again.';
const RESTORE_FAILED = 'The Object could not be restored. Try again.';

export type ArchivedObject = Pick<ClaywareObject, 'id' | 'name' | 'color' | 'domain_id' | 'archived_at' | 'archived_by'>;

function refreshAfterArchive(): void {
  const qc = getQueryClient();
  // Every explorer cache (Domain lists, the Object opened by id) and the
  // reads that drop archived work.
  void qc.invalidateQueries({ queryKey: ['explorer'] });
  void qc.invalidateQueries({ queryKey: ['archived-objects'] });
  void qc.invalidateQueries({ queryKey: ['my-elements'] });
  void qc.invalidateQueries({ queryKey: ['nowWork'] });
  void qc.invalidateQueries({ queryKey: ['action-targets'] });
}

export async function archiveObject(objectId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_object', { p_object: objectId });
  if (error?.code === '42501') throw new Error(translate(ARCHIVE_REFUSED));
  if (error) throw new Error(translate(ARCHIVE_FAILED));
  refreshAfterArchive();
}

export async function restoreObject(objectId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_object', { p_object: objectId });
  if (error?.code === '42501') throw new Error(translate(ARCHIVE_REFUSED));
  if (error) throw new Error(translate(RESTORE_FAILED));
  refreshAfterArchive();
}

/** Deletes an archived Object for good, from the Archived list. */
export async function deleteArchivedObject(objectId: string): Promise<void> {
  await deleteObject(objectId);
  refreshAfterArchive();
}

/** Archived Objects whose primary Domain is `domainId`, newest first. */
async function fetchArchivedObjects(domainId: string): Promise<ArchivedObject[]> {
  const { data, error } = await supabase
    .from('objects')
    .select('id, name, color, domain_id, archived_at, archived_by')
    .eq('domain_id', domainId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ArchivedObject[];
}

export function useArchivedObjects(domainId: string | null) {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: ['archived-objects', userId, domainId],
    queryFn: () => fetchArchivedObjects(domainId!),
    enabled: Boolean(userId && domainId),
  });
  return { objects: query.data ?? [], loading: query.isPending && Boolean(userId && domainId) };
}

/**
 * One Object by id, archived or not, in the explorer shape. Lists leave
 * archived Objects out, so a link to one is resolved here. Cached under the
 * explorer prefix, so Element edits patch it and Object changes refresh it.
 */
async function fetchObjectById(objectId: string): Promise<ExplorerData> {
  const { data, error } = await supabase.rpc('get_explorer_data', { p_domain_id: null, p_object_id: objectId });
  if (error) throw error;
  return normalizeExplorerData(data as ExplorerData | null);
}

export function useObjectById(objectId: string | null) {
  const userId = useCurrentUserId();
  const enabled = Boolean(userId && objectId);
  const query = useQuery({
    queryKey: ['explorer', 'by-id', objectId, userId],
    queryFn: () => fetchObjectById(objectId!),
    enabled,
  });
  return {
    object: query.data?.objects[0] ?? null,
    /** True once the read has answered (or there is nothing to read). */
    settled: !enabled || query.isFetched || query.isError,
  };
}

/** How many Objects (archived included) still sit in a Domain. */
export async function countDomainObjects(domainId: string): Promise<number> {
  const { count, error } = await supabase
    .from('objects')
    .select('id', { count: 'exact', head: true })
    .eq('domain_id', domainId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Counts a Strategy's linked Objects the way its Object list shows them:
 * the visible Objects still in use (the all-Domains explorer, shared cache).
 */
export function useActiveObjectCount(): (objectIds: readonly string[]) => number {
  const { data } = useObjects(null);
  const activeIds = useMemo(() => new Set(data.objects.map((o) => o.id)), [data.objects]);
  return useMemo(() => (objectIds: readonly string[]) => countActiveObjects(objectIds, activeIds), [activeIds]);
}
