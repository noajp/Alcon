import { supabase } from '@/lib/supabase';
import { fetchObjectDomainIds } from './objectData';
import { deepLinkScreen, type DeepLink, type DeepLinkTarget } from '@/lib/deepLink';

/** Finds what a link points at, as the signed-in person can see it (RLS):
 *  its Space and the screen that shows it. null when it does not exist or
 *  is not theirs to see — the two are not told apart. */
export async function resolveDeepLink(link: Exclude<DeepLink, { kind: 'inbox' }>): Promise<DeepLinkTarget | null> {
  if (link.kind === 'strategy') {
    const { data } = await supabase.from('strategies').select('id, activity_space_id').eq('id', link.id).maybeSingle();
    if (!data) return null;
    return { spaceId: data.activity_space_id ?? null, ...deepLinkScreen(link, {}) };
  }

  let objectId: string | null = link.kind === 'object' ? link.id : null;
  if (link.kind === 'element') {
    const { data } = await supabase.from('elements').select('id, object_id').eq('id', link.id).maybeSingle();
    if (!data) return null;
    objectId = data.object_id ?? null;
  } else {
    const { data } = await supabase.from('objects').select('id').eq('id', link.id).maybeSingle();
    if (!data) return null;
  }

  const domainId = objectId ? (await fetchObjectDomainIds(objectId))[0] ?? null : null;
  let spaceId: string | null = null;
  if (domainId) {
    const { data } = await supabase.from('domains').select('activity_space_id').eq('id', domainId).maybeSingle();
    spaceId = data?.activity_space_id ?? null;
  }
  return { spaceId, ...deepLinkScreen(link, { objectId, domainId }) };
}
