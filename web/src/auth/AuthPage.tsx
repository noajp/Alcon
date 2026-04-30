'use client';

import { useState } from 'react';
import { useAuthContext } from '@/providers/AuthProvider';

export function AuthPage() {
  const { signIn, signUp } = useAuthContext();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

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
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (signUpSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--content-bg)]">
        <div className="w-full max-w-sm">
          <div className="bg-card rounded-lg border border-border shadow-[var(--shadow-island)] p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Check your email</h2>
            <p className="text-sm text-muted-foreground mb-6">
              We sent a confirmation link to <strong className="text-foreground">{email}</strong>
            </p>
            <button
              onClick={() => { setSignUpSuccess(false); setMode('signin'); }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--content-bg)]">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <img src="/alcon-logo-primary.svg" alt="Alcon" className="w-full h-auto dark:hidden" />
          <img src="/alcon-logo-reverse.svg" alt="Alcon" className="w-full h-auto hidden dark:block" />
        </div>

        {/* Card */}
        <div className="bg-card rounded-lg border border-border/40 shadow-[var(--shadow-island)] p-8">
          <h1 className="text-lg font-semibold text-foreground mb-1">
            {mode === 'signin' ? 'Welcome back' : 'Create an account'}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === 'signin' ? 'Sign in to your workspace' : 'Get started with Alcon'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-foreground text-background rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                  {mode === 'signin' ? 'Signing in...' : 'Creating account...'}
                </span>
              ) : (
                mode === 'signin' ? 'Sign in' : 'Create account'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-sm text-muted-foreground">
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            </span>
            <button
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
              className="text-sm font-medium text-foreground hover:underline"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
