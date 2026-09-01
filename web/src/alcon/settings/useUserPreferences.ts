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

// Mirror the fields that something needs to read synchronously (before this
// hook's Supabase fetch resolves) into the localStorage cache.
function mirrorToCache(p: UserPreferences) {
  setCachedHomeView(p.home_view);
  setCachedSendCommentShortcut(p.send_comment_shortcut);
  setCachedFirstDayOfWeek(p.first_day_of_week);
  setCachedDisplayNames(p.display_names);
  setCachedConvertEmoticons(p.convert_emoticons);
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
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
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
        mirrorToCache(next);
      } else {
        // No row yet — the defaults are already what a fresh row would hold.
        mirrorToCache(DEFAULTS);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Optimistic update with rollback: flip local + cache immediately, upsert,
  // and revert both if the write fails so the UI never shows a value that
  // didn't actually persist.
  const savePreference = useCallback(async <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => {
    if (!user) return;
    const previous = preferences;
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    mirrorToCache(next);
    const { error: saveError } = await supabase
      .from('user_preferences')
      .upsert({ user_id: user.id, ...next }, { onConflict: 'user_id' });
    if (saveError && mountedRef.current) {
      setPreferences(previous);
      mirrorToCache(previous);
      setError(saveError.message);
    }
  }, [preferences, user]);

  return { preferences, loading, error, savePreference };
}
