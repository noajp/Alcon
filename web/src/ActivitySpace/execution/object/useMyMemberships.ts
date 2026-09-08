'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// The viewer's own memberships, once, through the query cache. object_members
// and domain_members both let a user read their own rows, so these are the
// two reads that tell the UI what the policies will say before it asks.

export function useMyObjectMemberships(userId: string | null) {
  return useQuery({
    queryKey: ['my-object-memberships', userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<ReadonlySet<string>> => {
      const { data, error } = await supabase.from('object_members').select('object_id').eq('user_id', userId!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.object_id as string));
    },
  });
}

export function useMyDomainRoles(userId: string | null) {
  return useQuery({
    queryKey: ['my-domain-roles', userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<ReadonlyMap<string, string>> => {
      const { data, error } = await supabase.from('domain_members').select('domain_id, role').eq('user_id', userId!);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.domain_id as string, r.role as string]));
    },
  });
}
