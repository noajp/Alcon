'use client';

import { useState } from 'react';
import { LogOut } from '@/ui/icons';
import { useAuthContext } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabase';
import { SettingsSection, SettingsRow } from './SettingsSection';
import { PersonalMemorySettings } from './MemorySettings';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';

export function AccountSettings() {
  const { user, signOut } = useAuthContext();
  const { t, locale } = useI18n();
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
      setError(e instanceof Error ? e.message : t('Failed to send reset email'));
    } finally {
      setResetting(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to sign out'));
      setSigningOut(false);
    }
  };

  const createdAt = user?.created_at ? new Date(user.created_at).toLocaleDateString(locale) : '—';

  return (
    <div>
      <SettingsSection title={t('Account')} description={t('Authentication and session details.')}>
        <SettingsRow label={t('Email')} hint={t('Your sign-in identifier. Contact support to change.')}>
          <span className="text-[13px] text-muted-foreground">{user?.email ?? '—'}</span>
        </SettingsRow>

        <SettingsRow label={t('User ID')} hint={t('Used by integrations and the Supabase Edge.')}>
          <span className="text-[11px] font-mono text-muted-foreground select-all">
            {user?.id ?? '—'}
          </span>
        </SettingsRow>

        <SettingsRow label={t('Member since')}>
          <span className="text-[13px] text-muted-foreground">{createdAt}</span>
        </SettingsRow>

        <SettingsRow
          label={t('Password')}
          hint={resetSent ? t('Reset email sent. Check your inbox.') : t('Send a reset link to your inbox.')}
        >
          <Button
            variant="ghost"
            onClick={handleResetPassword}
            disabled={resetting || resetSent || !user?.email}
          >
            {resetting ? t('Sending…') : resetSent ? t('Sent') : t('Send reset link')}
          </Button>
        </SettingsRow>
      </SettingsSection>

      {user?.id && <PersonalMemorySettings userId={user.id} />}

      <SettingsSection title={t('Session')}>
        <SettingsRow label={t('Sign out')} hint={t('End your session on this device.')}>
          <Button variant="danger" onClick={handleSignOut} disabled={signingOut}>
            <LogOut size={12} />
            {signingOut ? t('Signing out…') : t('Sign out')}
          </Button>
        </SettingsRow>
      </SettingsSection>

      {error && <p className="text-[12px] text-[var(--status-danger)] mt-2">{error}</p>}
    </div>
  );
}
