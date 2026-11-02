'use client';

import { supabase } from '@/lib/supabase';
import type { ElementAssignee } from '@/types/database';

/**
 * The one place that writes `element_assignees`. Every surface that changes
 * who is on an Element — the single-Element chips (with their optimistic
 * cache), the bulk hand-over and its undo, the CRM next-step owner — goes
 * through these, so the checks are the same everywhere:
 *
 * - a database error is thrown as-is, so callers can read its `code`
 *   (42501 = the Worker cannot be assigned, 23505 = already on it);
 * - updates and deletes come back with the rows they touched, because RLS
 *   turns a refused change into "no rows" rather than an error.
 *
 * Callers decide what a refusal means for them (roll back, report, skip).
 */

export type AssigneeRole = 'assignee' | 'reviewer' | 'collaborator';

/** Put one Worker on one Element. Throws when the database refuses. */
export async function insertElementAssignee(row: {
  element_id: string;
  worker_id: string;
  role?: AssigneeRole;
}): Promise<ElementAssignee> {
  const { data, error } = await supabase
    .from('element_assignees')
    .insert({ element_id: row.element_id, worker_id: row.worker_id, role: row.role || 'assignee' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Change the role of one assignee row. Returns how many rows changed (0 when RLS refused). */
export async function setElementAssigneeRole(id: string, role: AssigneeRole): Promise<number> {
  const { data, error } = await supabase
    .from('element_assignees')
    .update({ role })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/** Remove assignee rows by id. Returns how many were removed (fewer when RLS refused some). */
export async function deleteElementAssignees(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase
    .from('element_assignees')
    .delete()
    .in('id', [...ids])
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/** Remove one Worker's row of a given role from one Element. Returns how many were removed. */
export async function deleteElementAssigneeOf(elementId: string, workerId: string, role: AssigneeRole): Promise<number> {
  const { data, error } = await supabase
    .from('element_assignees')
    .delete()
    .eq('element_id', elementId)
    .eq('worker_id', workerId)
    .eq('role', role)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}
