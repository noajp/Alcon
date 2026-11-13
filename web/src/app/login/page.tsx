'use client';

import { useEffect } from 'react';
import { useAuthContext } from '@/providers/AuthProvider';
import { AuthPage } from '@/auth/AuthPage';

// The sign-in page, linked from the homepage's 「ログイン」. Once signed in,
// the app itself is at /.
export default function LoginPage() {
  const { isAuthenticated, loading } = useAuthContext();

  useEffect(() => {
    if (!loading && isAuthenticated) window.location.replace('/');
  }, [isAuthenticated, loading]);

  if (loading || isAuthenticated) return null;
  return <AuthPage />;
}
