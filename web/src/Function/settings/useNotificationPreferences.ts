'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import type { NotificationKind } from '@/hooks/useSupabase';

// A row in `notification_preferences` means "muted"; absence means enabled.
// See supabase/migrations/20260902130000_notification_preferences.sql — a
// BEFORE INSERT trigger on `notifications` itself checks this table, so
// muting here takes effect regardless of which of the several call sites
// (DB triggers, client-side inserts, Edge Functions) tries to create the
// notification.
export function useNotificationPreferences() {
  const { user } = useAuthContext();
  const [muted, setMuted] = useState<Set<NotificationKind>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingKinds, setPendingKinds] = useState<Set<NotificationKind>>(new Set());
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
    // One in-flight write per kind: a second click before the first
    // resolves would otherwise race an INSERT against a DELETE as two
    // independent requests with no ordering guarantee, leaving the row's
    // existence out of sync with whatever the UI ends up showing.
    if (!user || pendingKinds.has(kind)) return;
    const wasMuted = muted.has(kind);
    if (wasMuted === isMuted) return;

    setError(null);
    setPendingKinds((prev) => new Set(prev).add(kind));
    setMuted((prev) => {
      const next = new Set(prev);
      if (isMuted) next.add(kind); else next.delete(kind);
      return next;
    });

    // `insert` alone 23505s if the initial fetch hasn't resolved yet (or a
    // second Settings tab already muted this kind) and local state hasn't
    // caught up — upsert with ignoreDuplicates makes "mute an
    // already-muted kind" a no-op success instead of an error that then
    // rolls the toggle back to the wrong state. `delete` is naturally
    // idempotent (removing a row that isn't there is a no-op), so only the
    // mute direction needs this.
    const { error: saveError } = isMuted
      ? await supabase
          .from('notification_preferences')
          .upsert({ user_id: user.id, kind }, { onConflict: 'user_id,kind', ignoreDuplicates: true })
      : await supabase.from('notification_preferences').delete().eq('user_id', user.id).eq('kind', kind);

    setPendingKinds((prev) => {
      const next = new Set(prev);
      next.delete(kind);
      return next;
    });

    if (saveError) {
      setMuted((prev) => {
        const next = new Set(prev);
        if (wasMuted) next.add(kind); else next.delete(kind);
        return next;
      });
      if (mountedRef.current) setError(saveError.message);
    }
  }, [muted, pendingKinds, user]);

  return { muted, loading, error, pendingKinds, setKindMuted };
}
