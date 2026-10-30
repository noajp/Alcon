import { supabase } from '@/lib/supabase';
import { readAllIn, readAllPages } from './readAllPages';
import type { AlconObject, Element, Strategy, Intent, IntentBinding, Phase, Domain } from '@/types/database';

export interface AppContextSnapshot {
  version: 1;
  fetchedAt: string;
  object: Pick<AlconObject, 'id' | 'name' | 'description' | 'start_date' | 'due_date'>;
  elements: Pick<Element, 'id' | 'display_id' | 'title' | 'description' | 'status' | 'priority' | 'progress' | 'start_date' | 'due_date' | 'phase_id' | 'is_approval' | 'approval_state'>[];
  initiatives: Pick<Strategy, 'id' | 'name' | 'description' | 'status'>[];
  intents: Pick<Intent, 'id' | 'strategy_id' | 'parent_intent_id' | 'kind' | 'title' | 'subtitle' | 'status' | 'target_value' | 'actual_value' | 'unit' | 'direction' | 'measured_at' | 'horizon' | 'superseded_by_intent_id'>[];
  bindings: Pick<IntentBinding, 'intent_id' | 'target_type' | 'target_id' | 'relationship_type'>[];
  domains: Pick<Domain, 'id' | 'name'>[];
  phases: Pick<Phase, 'id' | 'name' | 'start_date' | 'end_date'>[];
}
/** No caller-supplied entity IDs: the host closes over the placement. Every read
 * uses the signed-in client/RLS, not cached explorer data or a service key. */
export async function readGeneratedAppContext(objectId: string, expectedUserId: string): Promise<AppContextSnapshot> {
  const checkUser = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !expectedUserId || data.user?.id !== expectedUserId) throw new Error('Sign in again before reading Object data.');
  };
  await checkUser();
  const objectResult = await supabase.from('objects').select('id,name,description,start_date,due_date,domain_id,phase_id').eq('id', objectId).single();
  if (objectResult.error || !objectResult.data) throw new Error('Object unavailable or access denied.');
  const object = objectResult.data;
  const [primary, homes, strategyLinks, domainLinks] = await Promise.all([
    readAllPages<{ id: string }>('Object Elements', (from, to) => supabase.from('elements').select('id', { count: 'exact' }).eq('object_id', objectId).order('id').range(from, to), r => r.id),
    readAllPages<{ element_id: string }>('Element homes', (from, to) => supabase.from('element_objects').select('element_id', { count: 'exact' }).eq('object_id', objectId).order('element_id').range(from, to), r => r.element_id),
    readAllPages<{ strategy_id: string }>('Initiative links', (from, to) => supabase.from('strategy_objects').select('strategy_id', { count: 'exact' }).eq('object_id', objectId).order('strategy_id').range(from, to), r => r.strategy_id),
    readAllPages<{ domain_id: string }>('Domain links', (from, to) => supabase.from('object_domains').select('domain_id', { count: 'exact' }).eq('object_id', objectId).order('domain_id').range(from, to), r => r.domain_id),
  ]);
  const elements = await readAllIn<AppContextSnapshot['elements'][number]>('Elements', [...primary.map(r => r.id), ...homes.map(r => r.element_id)],
    (ids, from, to) => supabase.from('elements').select('id,display_id,title,description,status,priority,progress,start_date,due_date,phase_id,is_approval,approval_state', { count: 'exact' }).in('id', ids).order('id').range(from, to), r => r.id);
  const bindings = await readAllIn<Pick<IntentBinding, 'id' | 'intent_id' | 'target_type' | 'target_id' | 'relationship_type'>>('Intent bindings', [objectId, ...elements.map(e => e.id)],
    (ids, from, to) => supabase.from('intent_bindings').select('id,intent_id,target_type,target_id,relationship_type', { count: 'exact' }).in('target_id', ids).in('target_type', ['object', 'element']).order('id').range(from, to), r => r.id);
  const directIntents = await readAllIn<AppContextSnapshot['intents'][number]>('Bound intents', bindings.map(b => b.intent_id),
    (ids, from, to) => supabase.from('intents').select('id,strategy_id,parent_intent_id,kind,title,subtitle,status,target_value,actual_value,unit,direction,measured_at,horizon,superseded_by_intent_id', { count: 'exact' }).in('id', ids).order('id').range(from, to), r => r.id);
  const initiatives = await readAllIn<AppContextSnapshot['initiatives'][number]>('Initiatives', [...strategyLinks.map(r => r.strategy_id), ...directIntents.map(i => i.strategy_id)],
    (ids, from, to) => supabase.from('strategies').select('id,name,description,status', { count: 'exact' }).in('id', ids).order('id').range(from, to), r => r.id);
  const [intents, domains, phases] = await Promise.all([
    readAllIn<AppContextSnapshot['intents'][number]>('Initiative intents', initiatives.map(i => i.id),
      (ids, from, to) => supabase.from('intents').select('id,strategy_id,parent_intent_id,kind,title,subtitle,status,target_value,actual_value,unit,direction,measured_at,horizon,superseded_by_intent_id', { count: 'exact' }).in('strategy_id', ids).order('id').range(from, to), r => r.id),
    readAllIn<AppContextSnapshot['domains'][number]>('Domains', [...domainLinks.map(r => r.domain_id), ...(object.domain_id ? [object.domain_id] : [])],
      (ids, from, to) => supabase.from('domains').select('id,name', { count: 'exact' }).in('id', ids).order('id').range(from, to), r => r.id),
    readAllIn<AppContextSnapshot['phases'][number]>('Phases', [...elements.flatMap(e => e.phase_id ? [e.phase_id] : []), ...(object.phase_id ? [object.phase_id] : [])],
      (ids, from, to) => supabase.from('phases').select('id,name,start_date,end_date', { count: 'exact' }).in('id', ids).order('id').range(from, to), r => r.id),
  ]);
  await checkUser();
  // Recheck access after the multi-query read. This is a dated observation, not
  // an atomic transaction; never describe it as a live subscription.
  const access = await supabase.from('objects').select('id').eq('id', objectId).single();
  if (access.error || !access.data) throw new Error('Object access changed. Reload the app.');
  const intentIds = new Set(intents.map(i => i.id));
  const result: AppContextSnapshot = { version: 1, fetchedAt: new Date().toISOString(),
    object: { id: object.id, name: object.name, description: object.description, start_date: object.start_date, due_date: object.due_date },
    elements, initiatives, intents, domains, phases,
    bindings: bindings.filter(b => intentIds.has(b.intent_id)).map(({ intent_id, target_type, target_id, relationship_type }) => ({ intent_id, target_type, target_id, relationship_type })),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 1_000_000) throw new Error('Object data is too large for this app. No partial summary was returned.');
  return result;
}
