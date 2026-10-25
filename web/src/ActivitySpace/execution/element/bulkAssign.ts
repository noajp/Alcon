'use client';

import { supabase } from '@/lib/supabase';
import { pushUndo } from '@/ActivitySpace/execution/element/bulkUndo';

type Role = 'assignee' | 'reviewer' | 'collaborator';
interface Row { id: string; element_id: string; worker_id: string; role: Role }

/** Every person on these Elements, in every role — read in chunks so a large
 *  selection never builds a URL past the gateway's limit. */
async function peopleOn(elementIds: readonly string[]): Promise<Map<string, Row[]>> {
  const byElement = new Map<string, Row[]>(elementIds.map((id) => [id, []]));
  for (let i = 0; i < elementIds.length; i += 100) {
    const { data, error } = await supabase.from('element_assignees').select('id, element_id, worker_id, role').in('element_id', elementIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Row[]) byElement.get(row.element_id)?.push(row);
  }
  return byElement;
}

/** What one Element looked like before, so undo can put it back exactly. */
interface Before { elementId: string; rows: Row[] }

/**
 * Make one person the only assignee of one Element. They go in first — added,
 * or promoted if they already review or collaborate on it — and only then are
 * the other assignees removed, each removal checked. When the person cannot be
 * assigned (they cannot see the Element's Object, or are not in its Space),
 * nothing is removed and the Element keeps its people.
 */
async function handTo(elementId: string, rows: readonly Row[], workerId: string): Promise<boolean> {
  const mine = rows.find((row) => row.worker_id === workerId);
  if (!mine) {
    const { error } = await supabase.from('element_assignees').insert({ element_id: elementId, worker_id: workerId, role: 'assignee' });
    if (error) return false;
  } else if (mine.role !== 'assignee') {
    const { data, error } = await supabase.from('element_assignees').update({ role: 'assignee' }).eq('id', mine.id).select('id');
    if (error || !data?.length) return false;
  }
  const others = rows.filter((row) => row.role === 'assignee' && row.worker_id !== workerId).map((row) => row.id);
  if (!others.length) return true;
  const { data, error } = await supabase.from('element_assignees').delete().in('id', others).select('id');
  return !error && (data?.length ?? 0) === others.length;
}

/** Put one Element's people back as they were. */
async function restore(before: Before, workerId: string): Promise<boolean> {
  const now = (await peopleOn([before.elementId])).get(before.elementId) ?? [];
  let ok = true;
  const was = before.rows.find((row) => row.worker_id === workerId);
  const mine = now.find((row) => row.worker_id === workerId);
  if (mine && !was) ok = !(await supabase.from('element_assignees').delete().eq('id', mine.id)).error && ok;
  else if (mine && was && was.role !== mine.role) ok = !(await supabase.from('element_assignees').update({ role: was.role }).eq('id', mine.id)).error && ok;
  for (const row of before.rows) {
    if (row.worker_id === workerId || now.some((current) => current.worker_id === row.worker_id)) continue;
    ok = !(await supabase.from('element_assignees').insert({ element_id: before.elementId, worker_id: row.worker_id, role: row.role })).error && ok;
  }
  return ok;
}

/**
 * Hand a selection of Elements to one person — the Element side of a
 * hand-over when someone leaves or changes role. Five at a time. Registers an
 * undo that puts every handed-over Element's people back. Returns the
 * Elements that could not be handed over.
 */
export async function bulkSetAssignee(elementIds: readonly string[], workerId: string, refresh?: () => unknown): Promise<string[]> {
  const people = await peopleOn(elementIds);
  const failed: string[] = [];
  const changed: Before[] = [];
  for (let i = 0; i < elementIds.length; i += 5) {
    await Promise.all(elementIds.slice(i, i + 5).map(async (id) => {
      const rows = people.get(id) ?? [];
      if (await handTo(id, rows, workerId)) changed.push({ elementId: id, rows });
      else failed.push(id);
    }));
  }
  await refresh?.();
  if (changed.length) {
    pushUndo({
      label: `Assign ${changed.length} Elements`,
      undo: async () => {
        for (const before of changed) {
          try { if (!(await restore(before, workerId))) console.error('Undo could not restore every person on', before.elementId); }
          catch (e) { console.error(e); }
        }
        await refresh?.();
      },
    });
  }
  return failed;
}
