'use client';

import { Button } from '@/ui/button';

import { useId, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { LanguageSelect } from '@/Function/i18n/LanguageSelect';
import { useI18n } from '@/Function/i18n/I18nProvider';

export function AuthPage() {
  const { t } = useI18n();
  const { signIn, signUp } = useAuthContext();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const ids = { name: useId(), email: useId(), password: useId(), error: useId() };

  // Supabase's English sentences, for the failures a person can act on.
  const readableAuthError = (message: string): string => {
    if (/invalid login credentials/i.test(message)) return t('The email or password is not correct.');
    if (/email not confirmed/i.test(message)) return t('Confirm your email first: open the link we sent you.');
    if (/already registered|already been registered/i.test(message)) return t('An account with this email already exists. Sign in instead.');
    return message;
  };

  const sendReset = async () => {
    setError(null);
    if (!email.trim()) { setError(t('Enter your email, then choose “Forgot password?” again.')); return; }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (resetError) { setError(readableAuthError(resetError.message)); return; }
    setResetSent(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signup') {
        await signUp(email, password, displayName);
        setSignUpSuccess(true);
      } else {
        await signIn(email, password);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? readableAuthError(err.message) : t('Something went wrong'));
    } finally {
      setLoading(false);
    }
  };

  if (signUpSuccess) {
    return (
      <main className="relative min-h-screen flex items-center justify-center bg-[var(--content-bg)]">
        <div className="absolute right-4 top-4"><LanguageSelect /></div>
        <div className="w-full max-w-sm">
          {/* A message, not a form: no card around it. The mark is the app's
              one accent — matte blue with a white check. */}
          <div className="p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--accent-default)] flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary-foreground)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">{t('Check your email')}</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {t('We sent a confirmation link to {email}', { email })}
            </p>
            <button
              onClick={() => { setSignUpSuccess(false); setMode('signin'); }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('Back to sign in')}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center bg-[var(--content-bg)]">
      <div className="absolute right-4 top-4"><LanguageSelect /></div>
      <div className="w-full max-w-sm">
        {/* Card */}
        <div className="bg-card rounded-lg border border-border/40 shadow-[var(--shadow-island)] p-8">
          <h1 className="text-lg font-semibold text-foreground mb-1">
            {t(mode === 'signin' ? 'Welcome back' : 'Create an account')}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {t(mode === 'signin' ? 'Sign in to your Activity Space' : 'Get started with Clayware')}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label htmlFor={ids.name} className="block text-sm font-medium text-foreground mb-1.5">{t('Name')}</label>
                <input
                  id={ids.name}
                  autoComplete="name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('Your name')}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
                />
              </div>
            )}

            <div>
              <label htmlFor={ids.email} className="block text-sm font-medium text-foreground mb-1.5">{t('Email')}</label>
              <input
                id={ids.email}
                autoComplete="email"
                aria-describedby={error ? ids.error : undefined}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label htmlFor={ids.password} className="block text-sm font-medium text-foreground">{t('Password')}</label>
                {mode === 'signin' && (
                  <button type="button" onClick={() => void sendReset()} className="text-[12px] text-muted-foreground hover:text-foreground hover:underline">
                    {t('Forgot password?')}
                  </button>
                )}
              </div>
              <input
                id={ids.password}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                aria-describedby={error ? ids.error : undefined}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? t('At least 6 characters') : undefined}
                required
                minLength={mode === 'signup' ? 6 : undefined}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
              />
            </div>

            {resetSent && !error && (
              <p role="status" className="text-sm text-muted-foreground">{t('Reset email sent. Check your inbox.')}</p>
            )}
            {error && (
              <div id={ids.error} role="alert" className="p-3 bg-[var(--status-danger-subtle)] dark:bg-[var(--status-danger)]/20 border border-[var(--status-danger)] dark:border-[var(--status-danger)] rounded-lg">
                <p className="text-sm text-[var(--status-danger)] dark:text-[var(--status-danger)]">{error}</p>
              </div>
            )}

            <Button variant="primary" size="lg" className="w-full"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                  {t(mode === 'signin' ? 'Signing in...' : 'Creating account...')}
                </span>
              ) : (
                t(mode === 'signin' ? 'Sign in' : 'Create account')
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-sm text-muted-foreground">
              {t(mode === 'signin' ? "Don't have an account? " : 'Already have an account? ')}
            </span>
            <button
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
              className="text-sm font-medium text-foreground hover:underline"
            >
              {t(mode === 'signin' ? 'Sign up' : 'Sign in')}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
