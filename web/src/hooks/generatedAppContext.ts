import { supabase } from '@/lib/supabase';
import { readAllIn, readAllPages } from './readAllPages';
import type { ClaywareObject, Element, Strategy, Intent, IntentBinding, Phase, Domain } from '@/types/database';

export interface AppContextSnapshot {
  version: 1;
  fetchedAt: string;
  object: Pick<ClaywareObject, 'id' | 'name' | 'description' | 'start_date' | 'due_date'>;
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
    readAllPages<{ strategy_id: string }>('Strategy links', (from, to) => supabase.from('strategy_objects').select('strategy_id', { count: 'exact' }).eq('object_id', objectId).order('strategy_id').range(from, to), r => r.strategy_id),
    readAllPages<{ domain_id: string }>('Domain links', (from, to) => supabase.from('object_domains').select('domain_id', { count: 'exact' }).eq('object_id', objectId).order('domain_id').range(from, to), r => r.domain_id),
  ]);
  const elements = await readAllIn<AppContextSnapshot['elements'][number]>('Elements', [...primary.map(r => r.id), ...homes.map(r => r.element_id)],
    (ids, from, to) => supabase.from('elements').select('id,display_id,title,description,status,priority,progress,start_date,due_date,phase_id,is_approval,approval_state', { count: 'exact' }).in('id', ids).order('id').range(from, to), r => r.id);
  const bindings = await readAllIn<Pick<IntentBinding, 'id' | 'intent_id' | 'target_type' | 'target_id' | 'relationship_type'>>('Intent bindings', [objectId, ...elements.map(e => e.id)],
    (ids, from, to) => supabase.from('intent_bindings').select('id,intent_id,target_type,target_id,relationship_type', { count: 'exact' }).in('target_id', ids).in('target_type', ['object', 'element']).order('id').range(from, to), r => r.id);
  const directIntents = await readAllIn<AppContextSnapshot['intents'][number]>('Bound intents', bindings.map(b => b.intent_id),
    (ids, from, to) => supabase.from('intents').select('id,strategy_id,parent_intent_id,kind,title,subtitle,status,target_value,actual_value,unit,direction,measured_at,horizon,superseded_by_intent_id', { count: 'exact' }).in('id', ids).order('id').range(from, to), r => r.id);
  const initiatives = await readAllIn<AppContextSnapshot['initiatives'][number]>('Strategies', [...strategyLinks.map(r => r.strategy_id), ...directIntents.map(i => i.strategy_id)],
    (ids, from, to) => supabase.from('strategies').select('id,name,description,status', { count: 'exact' }).in('id', ids).order('id').range(from, to), r => r.id);
  const [intents, domains, phases] = await Promise.all([
    readAllIn<AppContextSnapshot['intents'][number]>('Strategy intents', initiatives.map(i => i.id),
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

/** The whole Space as its viewer may see it: the work (Domains, Objects,
 *  Elements and who they are assigned to), the Strategies and what they
 *  measure, the people, the Phases and what waits on what. Element
 *  descriptions are left out to keep it small. */
export interface SpaceContextSnapshot {
  version: 1;
  fetchedAt: string;
  domains: { id: string; name: string }[];
  objects: { id: string; name: string; description: string | null; domain_id: string | null; type: string | null; start_date: string | null; due_date: string | null; lead_id: string | null }[];
  elements: { id: string; display_id: string | null; title: string; status: string | null; priority: string | null; progress: number | null; start_date: string | null; due_date: string | null; object_id: string | null; type: string | null; labels: unknown; is_approval: boolean | null; phase_id: string | null; estimated_hours: number | null; actual_hours: number | null; created_at: string | null; updated_at: string | null }[];
  assignees: { element_id: string; worker_id: string }[];
  workers: { id: string; name: string; type: string | null; role: string | null }[];
  strategies: { id: string; name: string; description: string | null; status: string | null }[];
  strategyObjects: { strategy_id: string; object_id: string }[];
  intents: AppContextSnapshot['intents'];
  phases: { id: string; domain_id: string | null; name: string; start_date: string | null; end_date: string | null; status: string | null }[];
  dependencies: { blocker_object_id: string; blocked_object_id: string }[];
}

/** Every read is the signed-in person's own (RLS), as for the Object snapshot. */
export async function readSpaceContext(spaceId: string, expectedUserId: string): Promise<SpaceContextSnapshot> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !expectedUserId || auth.user?.id !== expectedUserId) throw new Error('Sign in again before reading Space data.');
  const [domains, workers, strategies] = await Promise.all([
    readAllPages<SpaceContextSnapshot['domains'][number]>('Domains', (from, to) => supabase.from('domains').select('id,name', { count: 'exact' }).eq('activity_space_id', spaceId).order('id').range(from, to), r => r.id),
    readAllPages<SpaceContextSnapshot['workers'][number]>('Workers', (from, to) => supabase.from('workers').select('id,name,type,role', { count: 'exact' }).eq('activity_space_id', spaceId).order('id').range(from, to), r => r.id),
    readAllPages<SpaceContextSnapshot['strategies'][number]>('Strategies', (from, to) => supabase.from('strategies').select('id,name,description,status', { count: 'exact' }).eq('activity_space_id', spaceId).order('id').range(from, to), r => r.id),
  ]);
  const domainIds = domains.map(d => d.id);
  const [objects, phases] = await Promise.all([
    readAllIn<SpaceContextSnapshot['objects'][number]>('Objects', domainIds,
      (ids, from, to) => supabase.from('objects').select('id,name,description,domain_id,type,start_date,due_date,lead_id', { count: 'exact' }).in('domain_id', ids).is('archived_at', null).order('id').range(from, to), r => r.id),
    readAllIn<SpaceContextSnapshot['phases'][number]>('Phases', domainIds,
      (ids, from, to) => supabase.from('phases').select('id,domain_id,name,start_date,end_date,status', { count: 'exact' }).in('domain_id', ids).order('id').range(from, to), r => r.id),
  ]);
  const objectIds = objects.map(o => o.id);
  const strategyIds = strategies.map(s => s.id);
  const [elements, strategyObjects, intents, dependencies] = await Promise.all([
    readAllIn<SpaceContextSnapshot['elements'][number]>('Elements', objectIds,
      (ids, from, to) => supabase.from('elements').select('id,display_id,title,status,priority,progress,start_date,due_date,object_id,type,labels,is_approval,phase_id,estimated_hours,actual_hours,created_at,updated_at', { count: 'exact' }).in('object_id', ids).order('id').range(from, to), r => r.id),
    readAllIn<SpaceContextSnapshot['strategyObjects'][number] & { id: string }>('Strategy links', strategyIds,
      (ids, from, to) => supabase.from('strategy_objects').select('id,strategy_id,object_id', { count: 'exact' }).in('strategy_id', ids).order('id').range(from, to), r => r.id),
    readAllIn<SpaceContextSnapshot['intents'][number]>('Intents', strategyIds,
      (ids, from, to) => supabase.from('intents').select('id,strategy_id,parent_intent_id,kind,title,subtitle,status,target_value,actual_value,unit,direction,measured_at,horizon,superseded_by_intent_id', { count: 'exact' }).in('strategy_id', ids).order('id').range(from, to), r => r.id),
    readAllIn<SpaceContextSnapshot['dependencies'][number] & { id: string }>('Dependencies', objectIds,
      (ids, from, to) => supabase.from('object_dependencies').select('id,blocker_object_id,blocked_object_id', { count: 'exact' }).in('blocked_object_id', ids).order('id').range(from, to), r => r.id),
  ]);
  const assignees = await readAllIn<SpaceContextSnapshot['assignees'][number] & { id: string }>('Assignees', elements.map(e => e.id),
    (ids, from, to) => supabase.from('element_assignees').select('id,element_id,worker_id', { count: 'exact' }).in('element_id', ids).order('id').range(from, to), r => r.id);
  const result: SpaceContextSnapshot = {
    version: 1, fetchedAt: new Date().toISOString(), domains, objects, elements, workers, strategies, intents, phases,
    assignees: assignees.map(({ element_id, worker_id }) => ({ element_id, worker_id })),
    strategyObjects: strategyObjects.map(({ strategy_id, object_id }) => ({ strategy_id, object_id })),
    dependencies: dependencies.map(({ blocker_object_id, blocked_object_id }) => ({ blocker_object_id, blocked_object_id })),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 4_000_000) throw new Error('This Space is too large for a canvas to read at once. No partial data was returned.');
  return result;
}
