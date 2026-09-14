'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuthContext } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabase';
import { SettingsSection, SettingsRow } from './SettingsSection';

export function AccountSettings() {
  const { user, signOut } = useAuthContext();
  const [resetSent, setResetSent] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setResetting(true);
    setError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email);
      if (error) throw error;
      setResetSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send reset email');
    } finally {
      setResetting(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sign out');
      setSigningOut(false);
    }
  };

  const createdAt = user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—';

  return (
    <div>
      <SettingsSection title="Account" description="Authentication and session details.">
        <SettingsRow label="Email" hint="Your sign-in identifier. Contact support to change.">
          <span className="text-[13px] text-muted-foreground">{user?.email ?? '—'}</span>
        </SettingsRow>

        <SettingsRow label="User ID" hint="Used by integrations and the Supabase Edge.">
          <span className="text-[11px] font-mono text-muted-foreground select-all">
            {user?.id ?? '—'}
          </span>
        </SettingsRow>

        <SettingsRow label="Member since">
          <span className="text-[13px] text-muted-foreground">{createdAt}</span>
        </SettingsRow>

        <SettingsRow
          label="Password"
          hint={resetSent ? 'Reset email sent. Check your inbox.' : 'Send a reset link to your inbox.'}
        >
          <button
            onClick={handleResetPassword}
            disabled={resetting || resetSent || !user?.email}
            className="px-3 py-1.5 border border-border rounded-md text-[12px] font-medium text-foreground hover:bg-accent disabled:opacity-40 transition-colors"
          >
            {resetting ? 'Sending…' : resetSent ? 'Sent' : 'Send reset link'}
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Session">
        <SettingsRow label="Sign out" hint="End your session on this device.">
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--status-danger)] dark:border-[var(--status-danger)] text-[var(--status-danger)] dark:text-[var(--status-danger)] rounded-md text-[12px] font-medium hover:bg-[var(--status-danger-subtle)] dark:hover:bg-[var(--status-danger)]/20 disabled:opacity-40 transition-colors"
          >
            <LogOut size={12} />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </SettingsRow>
      </SettingsSection>

      {error && <p className="text-[12px] text-[var(--status-danger)] mt-2">{error}</p>}
    </div>
  );
}
