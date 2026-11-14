'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import type { NotificationKind } from '@/hooks/useSupabase';
import { notificationEmailDefault } from '@/Function/shared/notificationKinds';

// Which kinds the signed-in person also gets by email. A row in
// notification_email_preferences is their explicit choice; without one the
// default holds (assignment on, the rest off). The server queues and sends
// the email (supabase/migrations/20270109090000_notification_emails.sql).
export function useNotificationEmailPreferences() {
  const { user } = useAuthContext();
  const [choices, setChoices] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    void supabase.from('notification_email_preferences').select('kind, enabled').eq('user_id', user.id)
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) setError(fetchError.message);
        else setChoices(new Map((data ?? []).map((r) => [r.kind as string, r.enabled as boolean])));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user]);

  const isEmailed = useCallback((kind: NotificationKind) => choices.get(kind) ?? notificationEmailDefault(kind), [choices]);

  const setEmailed = useCallback(async (kind: NotificationKind, enabled: boolean) => {
    if (!user || pending.has(kind)) return;
    const before = choices.get(kind);
    setError(null);
    setPending((prev) => new Set(prev).add(kind));
    setChoices((prev) => new Map(prev).set(kind, enabled));
    const { error: saveError } = await supabase.from('notification_email_preferences')
      .upsert({ user_id: user.id, kind, enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id,kind' });
    setPending((prev) => { const next = new Set(prev); next.delete(kind); return next; });
    if (saveError) {
      setChoices((prev) => { const next = new Map(prev); if (before === undefined) next.delete(kind); else next.set(kind, before); return next; });
      setError(saveError.message);
    }
  }, [choices, pending, user]);

  return { isEmailed, setEmailed, loading: loading && !!user, error, pending };
}
