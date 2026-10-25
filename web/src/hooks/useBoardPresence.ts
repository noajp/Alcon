'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSessionUserId } from './useWidgetDocument';
import type { SubjectKind } from '@/Function/widget/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BoardViewer { userId: string; name: string }

/**
 * Who else has this subject's board open right now. The channel is private:
 * the server lets in only people who can see the subject (docs/adr/0041), so
 * nobody learns who is looking at something they cannot open. A personal
 * board has no one else to show.
 */
export function useBoardPresence(kind: SubjectKind, subjectId: string | null): BoardViewer[] {
  const { userId } = useSessionUserId();
  const enabled = !!userId && kind !== 'me' && !!subjectId && UUID.test(subjectId);
  const profile = useQuery({
    queryKey: ['presence-name', userId],
    enabled,
    staleTime: Infinity,
    // The name teammates already see on assignments, then the profile's.
    queryFn: async () => {
      const [worker, profile] = await Promise.all([
        supabase.from('workers').select('name').eq('user_id', userId!).eq('type', 'human').limit(1),
        supabase.from('profiles').select('display_name').eq('id', userId!).limit(1),
      ]);
      const name = (worker.data?.[0]?.name as string | null | undefined) || (profile.data?.[0]?.display_name as string | null | undefined);
      return name?.trim() || null;
    },
  });
  const name = profile.data ?? null;
  const [viewers, setViewers] = useState<BoardViewer[]>([]);

  useEffect(() => {
    if (!enabled || profile.isPending) return;
    const channel = supabase.channel(`board:${kind}:${subjectId}`, {
      config: { private: true, presence: { key: userId! } },
    });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<{ name?: unknown }>();
      setViewers(Object.entries(state)
        .filter(([key]) => key !== userId)
        // Names are what other members announce: shown as text, never trusted further.
        .map(([key, metas]) => ({ userId: key, name: String(metas[0]?.name || 'Someone').slice(0, 80) })));
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') void channel.track({ name: name || 'Someone' });
    });
    return () => {
      setViewers([]);
      void supabase.removeChannel(channel);
    };
  }, [enabled, profile.isPending, kind, subjectId, userId, name]);

  return enabled ? viewers : [];
}
