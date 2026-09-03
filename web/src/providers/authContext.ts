'use client';

import { createContext, useContext } from 'react';
import type { useAuth } from '@/hooks/useAuth';

export type AuthContextType = ReturnType<typeof useAuth>;

// Leaf module — no runtime imports besides React — so data hooks in
// `hooks/` can read the signed-in user without importing AuthProvider (which
// imports useAuth, which imports the data hooks: a cycle).
export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuthContext(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthContext must be used within AuthProvider');
  return context;
}

/** The signed-in user's id, or null while the session is still resolving /
 *  when signed out. Query keys scope per-user data on this. */
export function useCurrentUserId(): string | null {
  return useContext(AuthContext)?.user?.id ?? null;
}
