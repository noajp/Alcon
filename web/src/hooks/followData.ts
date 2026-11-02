'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';

// Follow: the Objects and Elements a person keeps at hand — listed under
// "Follow" in Execution's sidebar, toggled by the star beside an Object's or
// an Element's "…". Kept per person in home_pins (each sees only their own,
// RLS); one that was deleted or that they can no longer see drops out.

export type FollowKind = 'object' | 'element';
export interface Followed {
  kind: FollowKind;
  id: string;
  label: string;
  /** The Object it opens in (itself for an Object, its home for an Element). */
  objectId: string | null;
  domainId: string | null;
  status: string | null;
}

const KEY = (userId: string | null) => ['follows', userId] as const;

/** What this person follows, oldest first. */
export function useFollows() {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: KEY(userId),
    enabled: !!userId,
    queryFn: async (): Promise<Followed[]> => {
      const { data: pins, error } = await supabase.from('home_pins').select('entity_type, entity_id, created_at')
        .in('entity_type', ['object', 'element']).order('created_at');
      if (error) throw error;
      const elementIds = (pins ?? []).filter((p) => p.entity_type === 'element').map((p) => p.entity_id as string);
      const { data: elements, error: elementsError } = elementIds.length
        ? await supabase.from('elements').select('id, title, status, object_id').in('id', elementIds)
        : { data: [], error: null };
      if (elementsError) throw elementsError;
      const objectIds = [...new Set([
        ...(pins ?? []).filter((p) => p.entity_type === 'object').map((p) => p.entity_id as string),
        ...(elements ?? []).map((e) => e.object_id as string | null).filter((id): id is string => !!id),
      ])];
      const { data: objects, error: objectsError } = objectIds.length
        ? await supabase.from('objects').select('id, name, domain_id').in('id', objectIds)
        : { data: [], error: null };
      if (objectsError) throw objectsError;
      const objectById = new Map((objects ?? []).map((o) => [o.id as string, o]));
      const elementById = new Map((elements ?? []).map((e) => [e.id as string, e]));
      const out: Followed[] = [];
      for (const p of pins ?? []) {
        if (p.entity_type === 'object') {
          const o = objectById.get(p.entity_id as string);
          if (o) out.push({ kind: 'object', id: o.id as string, label: o.name as string, objectId: o.id as string, domainId: (o.domain_id as string | null) ?? null, status: null });
        } else {
          const e = elementById.get(p.entity_id as string);
          if (e) out.push({ kind: 'element', id: e.id as string, label: e.title as string, objectId: (e.object_id as string | null) ?? null,
            domainId: e.object_id ? ((objectById.get(e.object_id as string)?.domain_id as string | null) ?? null) : null, status: (e.status as string | null) ?? null });
        }
      }
      return out;
    },
  });
  return { follows: query.data ?? EMPTY, loading: !!userId && query.isPending };
}
const EMPTY: Followed[] = [];

/** Whether this person follows an Object or Element, and the switch. */
export function useFollow(kind: FollowKind, id: string | null) {
  const userId = useCurrentUserId();
  const qc = useQueryClient();
  const { follows } = useFollows();
  const following = !!id && follows.some((f) => f.kind === kind && f.id === id);
  const toggle = useMutation({
    mutationFn: async () => {
      if (!userId || !id) return;
      const { error } = following
        ? await supabase.from('home_pins').delete().eq('user_id', userId).eq('entity_type', kind).eq('entity_id', id)
        : await supabase.from('home_pins').insert({ user_id: userId, entity_type: kind, entity_id: id, position: 0 });
      if (error) throw error;
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['follows'] }); },
  });
  return { following, toggle };
}
