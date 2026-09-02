'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import type { NotificationKind } from '@/hooks/useSupabase';

// A row in `notification_preferences` means "muted"; absence means enabled.
// See supabase/migrations/20260902130000_notification_preferences.sql — a
// BEFORE INSERT trigger on `notifications` itself checks this table, so
// muting here takes effect regardless of which of the several call sites
// (DB triggers, client-side inserts) tries to create the notification.
export function useNotificationPreferences() {
  const { user } = useAuthContext();
  const [muted, setMuted] = useState<Set<NotificationKind>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { if (!cancelled) setLoading(false); return; }
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('notification_preferences')
        .select('kind')
        .eq('user_id', user.id);
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
      } else {
        setMuted(new Set((data ?? []).map((r) => r.kind as NotificationKind)));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const setKindMuted = useCallback(async (kind: NotificationKind, isMuted: boolean) => {
    if (!user) return;
    const wasMuted = muted.has(kind);
    if (wasMuted === isMuted) return;

    setMuted((prev) => {
      const next = new Set(prev);
      if (isMuted) next.add(kind); else next.delete(kind);
      return next;
    });

    const { error: saveError } = isMuted
      ? await supabase.from('notification_preferences').insert({ user_id: user.id, kind })
      : await supabase.from('notification_preferences').delete().eq('user_id', user.id).eq('kind', kind);

    if (saveError) {
      setMuted((prev) => {
        const next = new Set(prev);
        if (wasMuted) next.add(kind); else next.delete(kind);
        return next;
      });
      if (mountedRef.current) setError(saveError.message);
    }
  }, [muted, user]);

  return { muted, loading, error, setKindMuted };
}
