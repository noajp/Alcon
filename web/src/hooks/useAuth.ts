'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { ensureAppGuideNotes } from './useNotesDb';
import { clearQueryCache, setQueryCacheUser } from '@/lib/queryCachePersistence';
import { dropOtherUnsavedDrafts } from '@/Function/shared/element/unsavedDraft';
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
    let { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    // A signed-in person without a profile row (it was lost, or predates the
    // sign-up trigger) gets one, named as they already appear in the Space.
    const repaired = !data && !force;
    if (repaired) data = await createOwnProfile(userId);
    if (data) {
      setProfile(data);
      if (force) return;
      void ensureSelfWorker(userId, data);
      // Seed the default "App Guide" note for new users (idempotent) — not
      // for someone whose profile was only repaired: they are not new.
      if (!repaired) void ensureAppGuideNotes();
    }
  }, [ensureSelfWorker]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setQueryCacheUser(session?.user?.id ?? null);
      dropOtherUnsavedDrafts(session?.user?.id ?? null);
      setState({ user: session?.user ?? null, session, loading: false });
      if (session?.user) fetchProfile(session.user.id);
    });

    // Listen for auth changes. A null session here is also a sign-out in
    // another tab or an expired session — the query cache follows the user,
    // so the previous user's data is dropped from memory and IndexedDB.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setQueryCacheUser(session?.user?.id ?? null);
        dropOtherUnsavedDrafts(session?.user?.id ?? null);
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
    // assignee photos, etc. — even for a frame. Unsaved Element drafts go too.
    await clearQueryCache();
    dropOtherUnsavedDrafts(null);
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

/** The signed-in person's missing profile row, named as their own Worker
 *  is, else as their sign-in says, else by their email's local part. */
async function createOwnProfile(userId: string): Promise<Profile | null> {
  const [{ data: worker }, { data: auth }] = await Promise.all([
    supabase.from('workers').select('name').eq('user_id', userId).eq('type', 'human').is('object_id', null).limit(1).maybeSingle(),
    supabase.auth.getUser(),
  ]);
  const meta = auth.user?.user_metadata as { full_name?: string; name?: string } | undefined;
  const display_name = (worker as { name?: string } | null)?.name || meta?.full_name || meta?.name || auth.user?.email?.split('@')[0] || null;
  const { data } = await supabase.from('profiles').insert({ id: userId, display_name }).select('*').maybeSingle();
  return (data as Profile | null) ?? null;
}
