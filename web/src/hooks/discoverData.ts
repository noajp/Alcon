import { supabase } from '@/lib/supabase';
import { onlyActiveObjects } from '@/Function/shared/objectArchive';

// Data for Discover (shell/DiscoverModal): the Domains and Objects the user
// can see but has not joined, and joining them.

export interface DiscoverableDomain {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
}

export interface DiscoverableObject {
  id: string;
  name: string;
  color: string | null;
  domain_id: string | null;
  domain_name: string | null;
}

/** Visible Domains and (active) Objects the user is not a member of. */
export async function fetchDiscoverable(userId: string): Promise<{ domains: DiscoverableDomain[]; objects: DiscoverableObject[] }> {
  const [myDomains, allDomains, myObjects, allObjects] = await Promise.all([
    supabase.from('domain_members').select('domain_id').eq('user_id', userId),
    supabase.from('domains').select('id, name, color, description').order('created_at'),
    supabase.from('object_members').select('object_id').eq('user_id', userId),
    // Archived Objects are not offered to join.
    onlyActiveObjects(supabase.from('objects').select('id, name, color, domain_id')).order('created_at'),
  ]);
  for (const r of [myDomains, allDomains, myObjects, allObjects]) if (r.error) throw r.error;

  const myDomainIds = new Set((myDomains.data ?? []).map((r) => r.domain_id as string));
  const myObjectIds = new Set((myObjects.data ?? []).map((r) => r.object_id as string));
  const domainNameById = new Map<string, string>((allDomains.data ?? []).map((d) => [d.id, d.name]));
  return {
    domains: (allDomains.data ?? [])
      .filter((d) => !myDomainIds.has(d.id))
      .map((d) => ({ id: d.id, name: d.name, color: d.color, description: d.description ?? null })),
    objects: (allObjects.data ?? [])
      .filter((o) => !myObjectIds.has(o.id))
      .map((o) => ({
        id: o.id, name: o.name, color: o.color, domain_id: o.domain_id,
        domain_name: o.domain_id ? domainNameById.get(o.domain_id) ?? null : null,
      })),
  };
}

/** Joins a Domain as a member. A refused insert errors; it is thrown so the
 *  caller does not show a join that did not happen. Domain access only —
 *  joining a Domain does not make the user a member of its Space. */
export async function joinDomain(userId: string, domainId: string): Promise<void> {
  const { error } = await supabase.from('domain_members')
    .insert({ domain_id: domainId, user_id: userId, role: 'member' }).select('domain_id').single();
  if (error) throw error;
}

/** Joins an Object as a member; throws when refused. */
export async function joinObject(userId: string, objectId: string): Promise<void> {
  const { error } = await supabase.from('object_members')
    .insert({ object_id: objectId, user_id: userId, role: 'member' }).select('object_id').single();
  if (error) throw error;
}
