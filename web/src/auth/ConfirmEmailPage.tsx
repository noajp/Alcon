'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { verifyEmailLink } from '@/hooks/useAuth';
import { useAuthContext } from '@/providers/AuthProvider';
import { parseEmailLink } from '@/lib/emailLink';
import { LanguageSelect } from '@/Function/i18n/LanguageSelect';
import { useI18n } from '@/Function/i18n/I18nProvider';

type Status = 'verifying' | 'confirmed' | 'failed';

/** Where the link in an auth email lands (supabase/templates). Verifies the
 *  one-time token here, on Clayware's own page, then opens where the person
 *  signed up from. */
export function ConfirmEmailPage() {
  const { t } = useI18n();
  const { isAuthenticated, loading } = useAuthContext();
  const [status, setStatus] = useState<Status>('verifying');
  const next = useRef('/');
  // The token works once: React's development double-run must not spend it twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const link = parseEmailLink(window.location.search, window.location.origin);
    if (link) next.current = link.next;
    (link ? verifyEmailLink(link.tokenHash, link.type) : Promise.reject(new Error('Not an email link')))
      .then(() => {
        setStatus('confirmed');
        window.location.replace(next.current);
      })
      .catch(() => setStatus('failed'));
  }, []);

  // A link opened a second time in the browser that already confirmed it:
  // the person is signed in, so the failure does not matter to them.
  useEffect(() => {
    if (status === 'failed' && !loading && isAuthenticated) window.location.replace(next.current);
  }, [status, loading, isAuthenticated]);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[var(--content-bg)] px-4">
      <div className="absolute right-4 top-4"><LanguageSelect /></div>
      <main className="w-full max-w-sm p-8 text-center" aria-live="polite">
        {status === 'failed' ? (
          <div role="alert">
            <h1 className="text-lg font-semibold text-foreground mb-2">{t('This link no longer works')}</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {t('Confirmation links work once and expire after a while. If you already confirmed your email, sign in. Otherwise, sign up again to get a new link.')}
            </p>
            <Button variant="primary" size="lg" className="w-full" onClick={() => window.location.assign('/login')}>
              {t('Go to sign in')}
            </Button>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[var(--accent-default)] flex items-center justify-center">
              {status === 'confirmed' ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary-foreground)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <div className="w-5 h-5 border-2 border-[var(--primary-foreground)]/30 border-t-[var(--primary-foreground)] rounded-full animate-spin" aria-hidden="true" />
              )}
            </div>
            <h1 className="text-lg font-semibold text-foreground mb-2">
              {t(status === 'confirmed' ? 'Email confirmed' : 'Confirming your email…')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t(status === 'confirmed' ? 'Opening Clayware…' : 'This takes a moment.')}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
