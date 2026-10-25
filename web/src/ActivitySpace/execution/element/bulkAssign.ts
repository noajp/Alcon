'use client';

import { supabase } from '@/lib/supabase';
import { pushUndo } from '@/ActivitySpace/execution/element/bulkUndo';

/**
 * Make `workerIds` exactly the assignees of one Element (reviewers and
 * collaborators stay). The new people go in first: when one of them cannot be
 * assigned — they cannot see the Element's Object, or are not in its Space —
 * nothing is removed and the Element keeps the people it had.
 */
async function setAssignees(elementId: string, current: readonly string[], workerIds: readonly string[]): Promise<boolean> {
  const adding = workerIds.filter((id) => !current.includes(id));
  const added: string[] = [];
  for (const workerId of adding) {
    const { error } = await supabase.from('element_assignees').insert({ element_id: elementId, worker_id: workerId, role: 'assignee' });
    if (error && error.code !== '23505') {
      if (added.length) await supabase.from('element_assignees').delete().eq('element_id', elementId).eq('role', 'assignee').in('worker_id', added);
      return false;
    }
    added.push(workerId);
  }
  const removing = current.filter((id) => !workerIds.includes(id));
  if (removing.length) await supabase.from('element_assignees').delete().eq('element_id', elementId).eq('role', 'assignee').in('worker_id', removing);
  return true;
}

/**
 * Hand a selection of Elements to one person — the Element side of a hand-over
 * when someone leaves or changes role. Registers an undo that puts every
 * Element's previous assignees back. Returns how many could not be handed over.
 */
export async function bulkSetAssignee(elementIds: readonly string[], workerId: string, refresh?: () => unknown): Promise<number> {
  const { data, error } = await supabase.from('element_assignees').select('element_id, worker_id').in('element_id', [...elementIds]).eq('role', 'assignee');
  if (error) throw new Error(error.message);
  const before = new Map<string, string[]>(elementIds.map((id) => [id, []]));
  for (const row of data ?? []) before.get(row.element_id as string)?.push(row.worker_id as string);
  let failed = 0;
  const changed: string[] = [];
  for (const id of elementIds) {
    if (await setAssignees(id, before.get(id) ?? [], [workerId])) changed.push(id);
    else failed += 1;
  }
  await refresh?.();
  if (changed.length) {
    pushUndo({
      label: `Assign ${changed.length} Elements`,
      undo: async () => {
        for (const id of changed) { try { await setAssignees(id, [workerId], before.get(id) ?? []); } catch (e) { console.error(e); } }
        await refresh?.();
      },
    });
  }
  return failed;
}
