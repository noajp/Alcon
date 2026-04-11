'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
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
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  });
  const [profile, setProfile] = useState<Profile | null>(null);

  // Fetch profile
  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (data) setProfile(data);
  }, []);

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
        else setProfile(null);
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
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  // Update profile
  const updateProfile = async (updates: Partial<Pick<Profile, 'display_name' | 'avatar_url'>>) => {
    if (!state.user) throw new Error('Not authenticated');
    const { error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', state.user.id);
    if (error) throw error;
    await fetchProfile(state.user.id);
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
