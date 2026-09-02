'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import {
  setCachedHomeView, setCachedSendCommentShortcut, setCachedFirstDayOfWeek,
  setCachedDisplayNames, setCachedConvertEmoticons,
  type HomeView, type SendCommentShortcut, type FirstDayOfWeek, type DisplayNames,
} from './preferencesStore';

export interface UserPreferences {
  home_view: HomeView;
  display_names: DisplayNames;
  first_day_of_week: FirstDayOfWeek;
  convert_emoticons: boolean;
  send_comment_shortcut: SendCommentShortcut;
}

const DEFAULTS: UserPreferences = {
  home_view: 'My Elements',
  display_names: 'Full name',
  first_day_of_week: 'Monday',
  convert_emoticons: true,
  send_comment_shortcut: '⌘+Enter',
};

// One cache setter per column, so a save/rollback can mirror only the field
// that actually changed instead of overwriting all five from a (possibly
// stale) full-row snapshot.
const CACHE_SETTERS: { [K in keyof UserPreferences]: (v: UserPreferences[K]) => void } = {
  home_view: setCachedHomeView,
  display_names: setCachedDisplayNames,
  first_day_of_week: setCachedFirstDayOfWeek,
  convert_emoticons: setCachedConvertEmoticons,
  send_comment_shortcut: setCachedSendCommentShortcut,
};

function mirrorFieldToCache<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
  CACHE_SETTERS[key](value);
}

export function useUserPreferences() {
  const { user } = useAuthContext();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULTS);
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
        .from('user_preferences')
        .select('home_view, display_names, first_day_of_week, convert_emoticons, send_comment_shortcut')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
      } else if (data) {
        const next = { ...DEFAULTS, ...data } as UserPreferences;
        setPreferences(next);
        (Object.keys(next) as (keyof UserPreferences)[]).forEach((k) => mirrorFieldToCache(k, next[k]));
      }
      // No row and no error: a genuinely fresh user, whose cache (if any) is
      // already whatever the getCached* fallbacks default to — nothing to
      // mirror. Deliberately NOT mirroring DEFAULTS here: `.maybeSingle()`
      // returns the same `{data: null, error: null}` shape when RLS simply
      // filtered the row out (e.g. a momentarily stale/anon session), and
      // treating that as "fresh user" would silently blow away a real
      // cached value with defaults on every such blip.
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Optimistic update with rollback, one column at a time — never a
  // whole-row snapshot. That snapshot approach let two saves in flight (or
  // two mounted instances, since WindowTabBar keeps every tab's Settings
  // panel mounted) each overwrite the other's already-persisted column with
  // a stale copy of it. A single-column upsert can't clobber a field it
  // never mentions, in the DB or in the cache.
  const savePreference = useCallback(async <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => {
    if (!user) return;
    const previousValue = preferences[key];
    setPreferences((prev) => ({ ...prev, [key]: value }));
    mirrorFieldToCache(key, value);
    const { error: saveError } = await supabase
      .from('user_preferences')
      .upsert({ user_id: user.id, [key]: value }, { onConflict: 'user_id' });
    if (saveError) {
      // The cache rollback isn't React state — it must happen even if this
      // component has since unmounted, or a value that never persisted
      // survives in localStorage (and every getCached* reader) indefinitely.
      mirrorFieldToCache(key, previousValue);
      if (mountedRef.current) {
        setPreferences((prev) => ({ ...prev, [key]: previousValue }));
        setError(saveError.message);
      }
    }
  }, [preferences, user]);

  return { preferences, loading, error, savePreference };
}
