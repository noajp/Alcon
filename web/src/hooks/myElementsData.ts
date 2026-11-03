import { supabase } from '@/lib/supabase';
import type { Element, ElementAssignee, Worker, ElementWithDetails } from '@/types/database';

export interface MyElementsData {
  elements: ElementWithDetails[];
  workers: Worker[];
}

export async function fetchMyElements(userId: string): Promise<MyElementsData> {
  const { data, error } = await supabase.rpc('get_my_elements');
  if (!error) {
    const row = (data ?? null) as Partial<MyElementsData> | null;
    return { elements: row?.elements ?? [], workers: row?.workers ?? [] };
  }
  // PGRST202 = the function is not on this database yet (the migration ships
  // with the code but is applied to prod by hand). Fall back to assembling
  // the same shape client-side so the surface keeps working either way.
  if (error.code !== 'PGRST202') throw error;
  return fetchMyElementsClientSide(userId);
}

async function fetchMyElementsClientSide(userId: string): Promise<MyElementsData> {
  // 1. Resolve the current user's worker rows (handles seeded "中野貴慶"
  //    style mappings where workers.user_id was backfilled).
  const { data: workersData } = await supabase.from('workers').select('*').eq('user_id', userId);
  const myWorkerRows = (workersData || []) as Worker[];
  const myWorkerIds = myWorkerRows.map((w) => w.id);

  // 2. Element ids where I'm an assignee.
  let assignedIds: string[] = [];
  if (myWorkerIds.length > 0) {
    const { data: assigned } = await supabase
      .from('element_assignees')
      .select('element_id')
      .in('worker_id', myWorkerIds);
    assignedIds = Array.from(new Set((assigned || []).map((r) => r.element_id)));
  }

  // 3. Pull the elements (owner_id = me OR id ∈ assignedIds), in parallel.
  const [ownedRes, assignedRes] = await Promise.all([
    supabase.from('elements').select('*').eq('owner_id', userId),
    assignedIds.length > 0
      ? supabase.from('elements').select('*').in('id', assignedIds)
      : Promise.resolve({ data: [] as Element[] }),
  ]);
  const elementsRaw: Element[] = [];
  const seen = new Set<string>();
  for (const chunk of [(ownedRes.data || []) as Element[], (assignedRes.data || []) as Element[]]) {
    for (const e of chunk) {
      if (!seen.has(e.id)) { seen.add(e.id); elementsRaw.push(e); }
    }
  }
  elementsRaw.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

  // 4. Hydrate assignees + worker details + home Objects.
  const elementIds = elementsRaw.map((e) => e.id);
  let allAssignees: ElementAssignee[] = [];
  let allWorkers: Worker[] = [];
  const objectIdsByElement = new Map<string, string[]>();
  let objectNameById = new Map<string, string>();
  if (elementIds.length > 0) {
    const [{ data: assigneeData }, { data: eoData }] = await Promise.all([
      supabase.from('element_assignees').select('*').in('element_id', elementIds),
      supabase.from('element_objects').select('element_id, object_id').in('element_id', elementIds),
    ]);
    allAssignees = (assigneeData || []) as ElementAssignee[];
    for (const e of elementsRaw) {
      if (e.object_id) objectIdsByElement.set(e.id, [e.object_id]);
    }
    for (const row of (eoData || []) as { element_id: string; object_id: string }[]) {
      const cur = objectIdsByElement.get(row.element_id) ?? [];
      if (!cur.includes(row.object_id)) cur.push(row.object_id);
      objectIdsByElement.set(row.element_id, cur);
    }
    const workerIds = Array.from(new Set(allAssignees.map((a) => a.worker_id)));
    const allObjectIds = Array.from(new Set([...objectIdsByElement.values()].flat()));
    const [workersFull, objRows] = await Promise.all([
      workerIds.length > 0
        ? supabase.from('workers').select('*').in('id', workerIds).then((r) => r.data)
        : Promise.resolve(null),
      allObjectIds.length > 0
        ? supabase.from('objects').select('id, name').in('id', allObjectIds).then((r) => r.data)
        : Promise.resolve(null),
    ]);
    allWorkers = (workersFull || []) as Worker[];
    objectNameById = new Map(((objRows || []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  }

  const elements: ElementWithDetails[] = elementsRaw.map((e) => {
    const objIds = objectIdsByElement.get(e.id) ?? [];
    const objects = objIds
      .map((id) => ({ id, name: objectNameById.get(id) ?? '' }))
      .filter((o) => o.name);
    return {
      ...e,
      assignees: allAssignees
        .filter((a) => a.element_id === e.id)
        .map((a) => ({ ...a, worker: allWorkers.find((w) => w.id === a.worker_id) })),
      objectIds: objIds,
      isMultiHomed: objIds.length > 1,
      objects,
    };
  });
  return { elements, workers: myWorkerRows };
}

