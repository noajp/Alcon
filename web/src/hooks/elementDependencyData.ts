import { supabase } from '@/lib/supabase';
import type { DependencyKind } from '@/Function/shared/objectDependencyModel';
import type { Json } from '@/types/database';

// Element dependencies: element_edges rows of type 'depends_on', `to_element`
// waiting for `from_element`. Which ends they tie (Function/shared/
// objectDependencyModel) rides in attributes.kind; a row without one is 'fs'.

/** Records that `waiting` waits for `first`, tying the ends `kind` names. */
export async function addElementDependency(first: string, waiting: string, kind: DependencyKind = 'fs'): Promise<void> {
  const { error } = await supabase.from('element_edges')
    .insert({ from_element: first, to_element: waiting, edge_type: 'depends_on', attributes: { kind } });
  if (error) throw new Error(error.message);
}

/** Changes which ends an Element dependency ties, keeping its other attributes. */
export async function setElementDependencyKind(edgeId: string, kind: DependencyKind): Promise<void> {
  const { data: row, error: readError } = await supabase.from('element_edges').select('attributes').eq('id', edgeId).maybeSingle();
  if (readError) throw new Error(readError.message);
  const attributes = { ...((row?.attributes as Record<string, Json> | null) ?? {}), kind };
  const { error } = await supabase.from('element_edges').update({ attributes }).eq('id', edgeId);
  if (error) throw new Error(error.message);
}

export async function removeElementDependency(edgeId: string): Promise<void> {
  const { error } = await supabase.from('element_edges').delete().eq('id', edgeId);
  if (error) throw new Error(error.message);
}
