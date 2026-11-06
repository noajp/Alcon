'use client';

import { AuthPage } from '@/auth/AuthPage';
import { OAuthConsentScreen } from '@/AIP/connectors/oauth/OAuthConsentScreen';
import { useAuthContext } from '@/providers/AuthProvider';

// The OAuth server's authorization path (ADR 0034). Signing in here keeps the
// URL, so the consent follows as soon as the session exists.
export default function OAuthConsentPage() {
  const { isAuthenticated, loading } = useAuthContext();
  if (loading) return null;
  if (!isAuthenticated) return <AuthPage />;
  return <OAuthConsentScreen />;
}
