'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { del } from 'idb-keyval';
import { supabase } from '@/lib/supabase';
import { ensureAppGuideNotes } from './useNotesDb';
import { getQueryClient } from '@/lib/queryClient';
import { QUERY_CACHE_IDB_KEY } from '@/providers/QueryProvider';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  /** Short self-introduction on the Profile page. */
  bio: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  });
  const [profile, setProfile] = useState<Profile | null>(null);

  // Make sure the user has a 'human' Worker row linked to their auth uid,
  // so assignee pickers / TeamSettings always include them. Idempotent —
  // no-op if a matching row already exists. Runs after fetchProfile so we
  // can seed name + avatar from the profile on first creation.
  const ensureSelfWorker = useCallback(async (userId: string, p: Profile) => {
    const { data: existing } = await supabase
      .from('workers')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'human')
      .limit(1)
      .maybeSingle();
    if (existing) return;
    await supabase.from('workers').insert({
      user_id: userId,
      type: 'human',
      name: p.display_name || 'You',
      avatar_url: p.avatar_url ?? null,
      status: 'active',
    });
  }, []);

  // Fetch profile. getSession() and the INITIAL_SESSION / SIGNED_IN auth
  // events all land here for the same user — and SIGNED_IN re-fires whenever
  // the tab regains focus — so guard by user id: one profile read, one
  // self-worker check, one guide-note seed per user per page load. Profile
  // edits go through updateProfile, which re-reads explicitly.
  const profiledUserRef = useRef<string | null>(null);
  const fetchProfile = useCallback(async (userId: string, force = false) => {
    if (!force && profiledUserRef.current === userId) return;
    profiledUserRef.current = userId;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (data) {
      setProfile(data);
      if (force) return;
      void ensureSelfWorker(userId, data);
      // Seed the default "App Guide" note for new users (idempotent).
      void ensureAppGuideNotes();
    }
  }, [ensureSelfWorker]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({ user: session?.user ?? null, session, loading: false });
      if (session?.user) fetchProfile(session.user.id);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setState({ user: session?.user ?? null, session, loading: false });
        if (session?.user) fetchProfile(session.user.id);
        else { setProfile(null); profiledUserRef.current = null; }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // Sign up with email/password
  const signUp = async (email: string, password: string, displayName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split('@')[0] },
        // Signing up on the OAuth consent page: the confirmation link returns
        // to the same request, so connecting continues after confirming.
        ...(typeof window !== 'undefined' && window.location.pathname.startsWith('/oauth/')
          ? { emailRedirectTo: window.location.href }
          : {}),
      },
    });
    if (error) throw error;
    return data;
  };

  // Sign in with email/password
  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  // Sign out
  const signOut = async () => {
    // Wipe the in-memory + IndexedDB-persisted query cache BEFORE Supabase
    // tears down the session, so the next user (or anonymous viewer) on
    // this browser can never see the previous user's domains, members,
    // assignee photos, etc. — even for a frame.
    getQueryClient().clear();
    try { await del(QUERY_CACHE_IDB_KEY); } catch { /* best effort */ }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  // Update profile
  const updateProfile = async (updates: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'bio'>>) => {
    if (!state.user) throw new Error('Not authenticated');
    const { error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', state.user.id);
    if (error) throw error;
    // Mirror display_name + avatar_url onto the user's worker row(s) so
    // assignee chips, mention pickers, TeamSettings, etc. across all Domains
    // immediately reflect the rename. Originally only avatar synced (so
    // workers could have a context-specific name), but in practice that
    // led to "Already a member" + a stale seed name showing up — the
    // friction outweighed the flexibility. Per-Domain display-name overrides
    // can be reintroduced as a separate field later if needed.
    const workerPatch: { name?: string; avatar_url?: string | null; updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    if ('display_name' in updates && updates.display_name) {
      workerPatch.name = updates.display_name;
    }
    if ('avatar_url' in updates) {
      workerPatch.avatar_url = updates.avatar_url ?? null;
    }
    // Only fire if something other than updated_at is set.
    if (Object.keys(workerPatch).length > 1) {
      await supabase
        .from('workers')
        .update(workerPatch)
        .eq('user_id', state.user.id);
    }
    await fetchProfile(state.user.id, true);
  };

  return {
    user: state.user,
    session: state.session,
    profile,
    loading: state.loading,
    isAuthenticated: !!state.user,
    signUp,
    signIn,
    signOut,
    updateProfile,
  };
}
